package com.lynxship.expo

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.provider.Settings
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.memory.PoolConfig
import com.facebook.imagepipeline.memory.PoolFactory
import com.lynx.service.http.LynxHttpService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
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
    private val onError by EventDispatcher()
    private val onUpdate by EventDispatcher()
    private val preferences: SharedPreferences = applicationContext.getSharedPreferences("lynxship-expo", Context.MODE_PRIVATE)
    private val metadata: Bundle = applicationContext.applicationInfo.metaData ?: Bundle()
    private val otaClient = createOtaClient(applicationContext)
    private val templateProvider = object : AbsTemplateProvider() {
        override fun loadTemplate(uri: String, callback: Callback) {
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
    var bundleName: String = metadata.getString("com.lynxship.expo.embeddedBundle", "main.lynx.bundle")
    var initialData: String = ""
    var reloadOnUpdate: Boolean = true

    init {
        initializeLynx(context)
        lynxView = LynxViewBuilder().setTemplateProvider(templateProvider).build(applicationContext)
        lynxView.addLynxViewClient(object : LynxViewClient() {
            override fun onFirstScreen() {
                try {
                    otaClient?.markLaunchSuccess()
                } catch (error: IOException) {
                    onError(mapOf("message" to (error.message ?: "Could not record Lynx launch"), "recoverable" to true))
                }
                onReady(mapOf("bundle" to bundleName, "sequence" to (otaClient?.activeSequence() ?: 0)))
            }
        })
        addView(lynxView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        try {
            otaClient?.beginLaunch()
            installUpdateInBackground()
            render()
        } catch (error: Exception) {
            onError(mapOf("message" to (error.message ?: "Lynx startup failed")))
        }
    }

    fun reload() {
        render()
    }

    private fun render() {
        try {
            lynxView.renderTemplateUrl(bundleName, initialData)
        } catch (error: Exception) {
            onError(mapOf("message" to (error.message ?: "Lynx render failed")))
        }
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
