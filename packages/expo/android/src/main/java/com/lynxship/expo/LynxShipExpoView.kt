package com.lynxship.expo

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import android.os.Bundle
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.View.MeasureSpec
import android.view.WindowInsets
import android.view.accessibility.AccessibilityManager
import com.lynx.react.bridge.JavaOnlyArray
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.memory.PoolConfig
import com.facebook.imagepipeline.memory.PoolFactory
import com.lynx.service.http.LynxHttpService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.LynxError
import com.lynx.tasm.LynxLoadMeta
import com.lynx.tasm.LynxUpdateMeta
import com.lynx.tasm.TemplateData
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewClient
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.provider.AbsTemplateProvider
import com.lynx.tasm.service.LynxServiceCenter
import com.lynxship.sdk.android.LynxShipOtaClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID

class LynxShipExpoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val applicationContext = context.applicationContext
    private val onReady by EventDispatcher()
    private val onLoadStart by EventDispatcher()
    private val onResourceFetchStart by EventDispatcher()
    private val onLoadSuccess by EventDispatcher()
    private val onError by EventDispatcher()
    private val onUpdate by EventDispatcher()
    private val onShow by EventDispatcher()
    private val onHide by EventDispatcher()
    private val preferences: SharedPreferences = applicationContext.getSharedPreferences("lynxship-expo", Context.MODE_PRIVATE)
    private val metadata: Bundle = applicationContext.applicationInfo.metaData ?: Bundle()
    private val otaClient = createOtaClient(applicationContext)
    private val templateProvider = object : AbsTemplateProvider() {
        override fun loadTemplate(uri: String, callback: Callback) {
            post { onResourceFetchStart(mapOf("bundle" to uri)) }
            Thread {
                try {
                    val bytes = otaClient?.openActiveAsset(uri) ?: readEmbeddedAsset(uri)
                    callback.onSuccess(bytes)
                    otaClient?.markLaunchSuccess()
                } catch (error: Exception) {
                    callback.onFailed(error.message ?: "Unable to load Lynx bundle")
                }
            }.start()
        }
    }
    private val lynxView: LynxView
    private var bundleNameValue: String = metadata.getString("com.lynxship.expo.embeddedBundle", "main.lynx.bundle")
    private var initialDataValue: String = ""
    private var globalProps: Map<String, Any?> = emptyMap()
    var reloadOnUpdate: Boolean = true
    var autoGlobalProps: Boolean = true
        set(value) {
            field = value
            if (hasRendered) pushGlobalProps()
        }
    private var hasRendered = false
    private var loadState = "idle"
    private var started = false
    private val containerId = UUID.randomUUID().toString()
    private val containerInitTime = System.currentTimeMillis().toString()
    private var appInBackground = false

    init {
        initializeLynx(context)
        // The Lynx view must be created with the host/view context. Keep the
        // application context only for process-wide services and storage.
        lynxView = LynxViewBuilder().setTemplateProvider(templateProvider).build(context)
        lynxView.addLynxViewClient(object : LynxViewClient() {
            override fun onPageStart(url: String?) {
                loadState = "loading"
                onLoadStart(mapOf("bundle" to (url ?: bundleNameValue)))
            }

            override fun onFirstScreen() {
                loadState = "loaded"
                try {
                    otaClient?.markLaunchSuccess()
                } catch (error: IOException) {
                    onError(mapOf("message" to (error.message ?: "Could not record Lynx launch"), "recoverable" to true))
                }
                val event = mapOf("bundle" to bundleNameValue, "sequence" to (otaClient?.activeSequence() ?: 0))
                onLoadSuccess(event)
                onReady(event)
            }

            override fun onReceivedError(error: LynxError) {
                loadState = "failed"
                onError(mapOf("message" to error.toString(), "recoverable" to false))
            }
        })
        addView(lynxView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        lynxView.onEnterForeground()
        onShow(emptyMap<String, Any>())
        if (started) return
        started = true
        try {
            otaClient?.beginLaunch()
            installUpdateInBackground()
            if (!hasRendered) render()
        } catch (error: Exception) {
            onError(mapOf("message" to (error.message ?: "Lynx startup failed")))
        }
    }

    override fun onDetachedFromWindow() {
        lynxView.onEnterBackground()
        onHide(emptyMap<String, Any>())
        super.onDetachedFromWindow()
    }

    fun reload() {
        render()
    }

    fun getContainerId(): String = containerId

    fun getLoadState(): String = loadState

    fun isLoadSuccess(): Boolean = loadState == "loaded"

    fun updateData(data: String, processorName: String? = null) {
        require(data.length <= 8 * 1024 * 1024) { "Lynx update data is larger than 8 MiB" }
        check(hasRendered) { "Lynx view has not loaded a bundle" }
        if (processorName != null) {
            require(processorName.isNotBlank() && processorName.length <= 256 && processorName.none { it.isISOControl() }) {
                "Lynx data processor name is invalid"
            }
        }
        val templateData = TemplateData.fromString(data)
        processorName?.let(templateData::markState)
        val builder = LynxUpdateMeta.Builder()
        builder.setUpdatedData(templateData)
        lynxView.updateMetaData(builder.build())
        initialDataValue = data
        onUpdate(mapOf("bundle" to bundleNameValue, "reason" to "data"))
    }

    fun setBundleName(value: String) {
        if (value == bundleNameValue) return
        bundleNameValue = value
        if (started) render()
    }

    fun setInitialData(value: String) {
        if (value == initialDataValue) return
        initialDataValue = value
        if (started) render()
    }

    fun updateGlobalProps(props: Map<String, Any?>) {
        globalProps = props.toMap()
        pushGlobalProps()
    }

    fun updateGlobalPropsByIncrement(props: Map<String, Any?>) {
        if (props.isEmpty()) return
        globalProps = buildMap {
            putAll(globalProps)
            putAll(props)
        }
        lynxView.updateGlobalProps(TemplateData.fromMap(props))
    }

    fun sendGlobalEvent(eventName: String, params: List<Any?>) {
        require(eventName.isNotBlank()) { "Lynx global event name cannot be blank" }
        require(eventName.length <= 256) { "Lynx global event name is too long" }
        require(params.size <= 256) { "Lynx global event payload is too large" }
        lynxView.sendGlobalEvent(
            eventName,
            JavaOnlyArray.from(params),
        )
    }

    fun show() {
        visibility = View.VISIBLE
    }

    fun hide() {
        visibility = View.INVISIBLE
    }

    fun updateViewport(width: Double, height: Double) {
        require(width.isFinite() && height.isFinite() && width >= 0 && height >= 0) {
            "Lynx viewport dimensions must be finite and non-negative"
        }
        lynxView.updateViewport(
            MeasureSpec.makeMeasureSpec(width.toInt(), MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height.toInt(), MeasureSpec.EXACTLY),
        )
    }

    private fun render() {
        try {
            loadState = "loading"
            val builder = LynxLoadMeta.Builder()
            builder.setUrl(bundleNameValue)
            if (initialDataValue.isNotEmpty()) {
                builder.setInitialData(TemplateData.fromString(initialDataValue))
            }
            if (autoGlobalProps || globalProps.isNotEmpty()) {
                builder.setGlobalProps(TemplateData.fromMap(effectiveGlobalProps()))
            }
            lynxView.loadTemplate(builder.build())
            hasRendered = true
        } catch (error: Exception) {
            loadState = "failed"
            onError(mapOf("message" to (error.message ?: "Lynx render failed")))
        }
    }

    override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        super.onSizeChanged(width, height, oldWidth, oldHeight)
        if (width > 0 && height > 0) {
            lynxView.updateViewport(
                MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
            )
            if (hasRendered && autoGlobalProps) pushGlobalProps()
        }
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        val nextBackground = visibility != View.VISIBLE
        if (nextBackground == appInBackground) return
        appInBackground = nextBackground
        if (hasRendered && autoGlobalProps) pushGlobalProps()
    }

    private fun pushGlobalProps() {
        if (!autoGlobalProps && globalProps.isEmpty()) return
        lynxView.updateGlobalProps(TemplateData.fromMap(effectiveGlobalProps()))
    }

    private fun effectiveGlobalProps(): Map<String, Any?> {
        if (!autoGlobalProps) return globalProps
        val metrics = resources.displayMetrics
        val density = metrics.density.takeIf { it > 0f } ?: 1f
        val screenWidth = metrics.widthPixels.toDouble() / density
        val screenHeight = metrics.heightPixels.toDouble() / density
        val contentWidth = width.toDouble() / density
        val contentHeight = height.toDouble() / density
        val insets = systemInsets()
        val orientation = if (resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
            "landscape"
        } else {
            "portrait"
        }
        val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        val theme = if (night == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
        val locale = resources.configuration.locales[0]?.toLanguageTag() ?: "en-US"
        val powerManager = getContext().getSystemService(Context.POWER_SERVICE) as? PowerManager
        val hasCutout = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && rootWindowInsets?.displayCutout != null
        val isTablet = resources.configuration.smallestScreenWidthDp >= 600
        return buildMap {
            putAll(globalProps)
            put("os", "android")
            put("osVersion", Build.VERSION.RELEASE ?: "unknown")
            put("deviceModel", Build.MODEL ?: "unknown")
            put("containerID", containerId)
            put("containerInitTime", containerInitTime)
            put("screenWidth", screenWidth)
            put("screenHeight", screenHeight)
            put("contentWidth", contentWidth.coerceAtLeast(0.0))
            put("contentHeight", contentHeight.coerceAtLeast(0.0))
            put("safeAreaInsets", insets)
            put("pixelRatio", density.toDouble())
            put("accessibleMode", accessibilityMode())
            put("isIPhoneX", 0)
            put("isIPhoneXMax", 0)
            put("isPad", if (isTablet) 1 else 0)
            put("isNotchScreen", hasCutout)
            put("isLowPowerMode", if (powerManager?.isPowerSaveMode == true) 1 else 0)
            put("orientation", orientation)
            put("screenOrientation", orientation)
            put("theme", theme)
            put("appLanguage", locale.substringBefore('-'))
            put("appLocale", locale)
            put("isAppBackground", appInBackground)
            put("queryItems", emptyMap<String, String>())
            put("statusBarHeight", insets["top"] ?: 0.0)
            put("navigationBarHeight", insets["bottom"] ?: 0.0)
            put("safeAreaHeight", insets["top"] ?: 0.0)
        }
    }

    private fun systemInsets(): Map<String, Double> {
        val insets = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            rootWindowInsets?.getInsets(WindowInsets.Type.systemBars())
        } else {
            null
        }
        val density = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        if (insets != null) {
            return mapOf(
                "top" to (insets.top / density).toDouble(),
                "right" to (insets.right / density).toDouble(),
                "bottom" to (insets.bottom / density).toDouble(),
                "left" to (insets.left / density).toDouble(),
            )
        }
        val legacy = rootWindowInsets
        return mapOf(
            "top" to (((legacy?.systemWindowInsetTop ?: 0) / density).toDouble()),
            "right" to (((legacy?.systemWindowInsetRight ?: 0) / density).toDouble()),
            "bottom" to (((legacy?.systemWindowInsetBottom ?: 0) / density).toDouble()),
            "left" to (((legacy?.systemWindowInsetLeft ?: 0) / density).toDouble()),
        )
    }

    private fun accessibilityMode(): Int {
        val manager = getContext().getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
        return if (manager?.isTouchExplorationEnabled == true) 1 else 0
    }

    fun release() {
        if (hasRendered) {
            lynxView.destroy()
            hasRendered = false
        }
        loadState = "released"
    }

    private fun installUpdateInBackground() {
        otaClient?.checkAndInstallAsync(object : LynxShipOtaClient.Listener {
            override fun onSuccess(updateAvailable: Boolean) {
                if (!updateAvailable) return
                try {
                    otaClient.activateCandidate()
                    post {
                        onUpdate(mapOf("sequence" to otaClient.activeSequence()))
                        if (reloadOnUpdate) render()
                    }
                } catch (error: Exception) {
                    emitError(error, "OTA activation failed", recoverable = true)
                }
            }

            override fun onFailure(error: Exception) {
                emitError(error, "OTA check failed", recoverable = true)
            }
        })
    }

    private fun emitError(error: Exception, fallback: String, recoverable: Boolean = false) {
        post {
            onError(
                mapOf(
                    "message" to (error.message ?: fallback),
                    "recoverable" to recoverable,
                ),
            )
        }
    }

    private fun readEmbeddedAsset(path: String): ByteArray {
        if (path.contains("..") || path.startsWith("/") || path.contains("\\")) throw IOException("Unsafe Lynx asset path")
        applicationContext.assets.open(path).use { input ->
            ByteArrayOutputStream().use { output ->
                input.copyTo(output)
                return output.toByteArray()
            }
        }
    }

    private fun createOtaClient(context: Context): LynxShipOtaClient? {
        val endpoint = metadata.getString("com.lynxship.expo.endpoint", "")
        val projectId = metadata.getString("com.lynxship.expo.projectId", "")
        val runtimeVersion = metadata.getString("com.lynxship.expo.runtimeVersion", "")
        val keyJson = metadata.getString("com.lynxship.expo.publicKeys", "{}")
        if (endpoint.isBlank() || projectId.isBlank() || runtimeVersion.isBlank()) return null
        return try {
            val keys = org.json.JSONObject(keyJson).let { json ->
                buildMap {
                    json.keys().forEach { key -> put(key, json.getString(key)) }
                }
            }
            val installationId = preferences.getString("installationId", null) ?: Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: UUID.randomUUID().toString()
            preferences.edit().putString("installationId", installationId).apply()
            LynxShipOtaClient(
                LynxShipOtaClient.Config(
                    File(context.filesDir, "lynxship-ota"), endpoint, projectId,
                    metadata.getString("com.lynxship.expo.channel", "production"), "android",
                    runtimeVersion, installationId, keys, { path -> readEmbeddedAsset(path) },
                    3,
                    metadata.getString("com.lynxship.expo.maxReleaseBytes", "104857600").toLong(),
                    10_000,
                    30_000,
                ),
            )
        } catch (error: Exception) {
            onError(mapOf("message" to (error.message ?: "Invalid LynxShip OTA configuration")))
            null
        }
    }

    private fun initializeLynx(context: Context) {
        synchronized(LynxShipExpoView::class.java) {
            if (!initialized) {
                val applicationContext = context.applicationContext
                val application = applicationContext as? Application
                    ?: throw IllegalStateException("LynxShip requires an Android Application context")
                // Lynx's official Android integration requires these services
                // before a LynxView is created. Expo does not give this package
                // an application subclass, so initialize them once at the
                // first view creation. If the host already initialized Fresco,
                // keep that host-owned instance and continue registering Lynx's
                // services against it.
                val factory = PoolFactory(PoolConfig.newBuilder().build())
                val builder = ImagePipelineConfig.newBuilder(applicationContext).setPoolFactory(factory)
                try {
                    Fresco.initialize(applicationContext, builder.build())
                } catch (_: IllegalStateException) {
                    // Fresco was initialized by the host application.
                }
                LynxServiceCenter.inst().registerService(LynxImageService.getInstance())
                LynxServiceCenter.inst().registerService(LynxLogService)
                LynxServiceCenter.inst().registerService(LynxHttpService)
                LynxEnv.inst().init(application, null, null, null)
                initialized = true
            }
        }
    }

    companion object {
        @Volatile private var initialized = false
    }
}
