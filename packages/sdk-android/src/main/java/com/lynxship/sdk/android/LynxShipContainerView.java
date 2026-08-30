package com.lynxship.sdk.android;

import android.content.Context;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.lynx.react.bridge.JavaOnlyArray;
import com.lynx.tasm.LynxError;
import com.lynx.tasm.LynxLoadMeta;
import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewBuilder;
import com.lynx.tasm.LynxViewClient;
import com.lynx.tasm.LynxUpdateMeta;
import com.lynx.tasm.TemplateData;
import com.lynx.tasm.provider.AbsTemplateProvider;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.UUID;

/**
 * Reusable native Lynx container for Android hosts.
 *
 * The host owns bundle policy and supplies the loader. This view owns Lynx
 * lifecycle ordering, first-screen readiness, updates and resource release.
 * All public methods must be called on the Android main thread.
 */
public final class LynxShipContainerView extends ViewGroup {
    private static final int MAX_PREPARED_TEMPLATE_BYTES = 32 * 1024 * 1024;
    public enum State { IDLE, LOADING, LOADED, FAILED, RELEASED }

    private final LynxShipContainerAssetLoader assetLoader;
    private final LynxShipContainerListener listener;
    private final LynxShipContainerUiProvider uiProvider;
    private final LynxShipContainerBuilderConfigurator builderConfigurator;
    private final String containerId = UUID.randomUUID().toString();
    private final ExecutorService loaderExecutor = Executors.newSingleThreadExecutor();
    private final LynxView lynxView;
    private final LynxViewClient lifecycleClient;
    private State state = State.IDLE;
    private String bundleName;
    private String initialData = "";
    private Map<String, Object> globalProps = Collections.emptyMap();
    private boolean autoGlobalProps = true;
    private boolean appInBackground;
    private final String containerInitTime = Long.toString(System.currentTimeMillis());
    private volatile String preparedBundleName;
    private volatile byte[] preparedTemplate;
    private View overlayView;

    public LynxShipContainerView(
            @NonNull Context context,
            @NonNull LynxShipContainerAssetLoader assetLoader,
            @Nullable LynxShipContainerListener listener) {
        this(context, assetLoader, listener, null);
    }

    public LynxShipContainerView(
            @NonNull Context context,
            @NonNull LynxShipContainerAssetLoader assetLoader,
            @Nullable LynxShipContainerListener listener,
            @Nullable LynxShipContainerUiProvider uiProvider) {
        this(context, assetLoader, listener, uiProvider, null);
    }

    /**
     * Creates a container with an optional per-instance Lynx builder
     * configurator. The configurator is the supported place to register local
     * custom UI behaviors; it runs before the official Lynx view is built.
     */
    public LynxShipContainerView(
            @NonNull Context context,
            @NonNull LynxShipContainerAssetLoader assetLoader,
            @Nullable LynxShipContainerListener listener,
            @Nullable LynxShipContainerUiProvider uiProvider,
            @Nullable LynxShipContainerBuilderConfigurator builderConfigurator) {
        super(context);
        this.assetLoader = assetLoader;
        this.listener = listener == null ? new LynxShipContainerListener() {} : listener;
        this.uiProvider = uiProvider == null ? new LynxShipContainerUiProvider() {} : uiProvider;
        this.builderConfigurator = builderConfigurator;
        AbsTemplateProvider provider = new AbsTemplateProvider() {
            @Override
            public void loadTemplate(String uri, Callback callback) {
                post(() -> {
                    if (state != State.RELEASED) listener.onResourceFetchStart(LynxShipContainerView.this, uri);
                });
                loaderExecutor.execute(() -> {
                    try {
                        byte[] prepared = preparedTemplate;
                        String preparedName = preparedBundleName;
                        callback.onSuccess(
                                prepared != null && uri.equals(preparedName)
                                        ? prepared
                                        : LynxShipContainerView.this.assetLoader.load(uri));
                    } catch (Exception error) {
                        callback.onFailed(error.getMessage() == null ? "Unable to load Lynx bundle" : error.getMessage());
                    }
                });
            }
        };
        LynxViewBuilder builder = new LynxViewBuilder().setTemplateProvider(provider);
        if (builderConfigurator != null) builderConfigurator.configure(builder);
        lynxView = builder.build(context);
        lifecycleClient = new LynxViewClient() {
            @Override
            public void onPageStart(String url) {
                if (Looper.myLooper() != Looper.getMainLooper()) {
                    post(() -> onPageStart(url));
                    return;
                }
                if (state != State.RELEASED) {
                    state = State.LOADING;
                    showLoadingUi();
                    listener.onLoadStart(LynxShipContainerView.this, bundleName);
                }
            }

            @Override
            public void onFirstScreen() {
                if (Looper.myLooper() != Looper.getMainLooper()) {
                    post(this::onFirstScreen);
                    return;
                }
                if (state != State.RELEASED) {
                    state = State.LOADED;
                    clearOverlay();
                    listener.onFirstScreen(LynxShipContainerView.this, bundleName);
                }
            }

            @Override
            public void onReceivedError(LynxError error) {
                if (Looper.myLooper() != Looper.getMainLooper()) {
                    post(() -> onReceivedError(error));
                    return;
                }
                if (state != State.RELEASED) {
                    state = State.FAILED;
                    showErrorUi(error);
                    listener.onLoadError(LynxShipContainerView.this, bundleName, error);
                }
            }
        };
        lynxView.addLynxViewClient(lifecycleClient);
        addView(lynxView, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    }

    public State getState() { return state; }

    /** Stable identifier for this container instance. */
    @NonNull
    public String getContainerId() { return containerId; }

    /** True only after Lynx reports that the first screen has rendered. */
    public boolean isLoadSuccess() { return state == State.LOADED; }

    /**
     * Enables the reserved Sparkling-compatible host context by default. Set
     * false only when the host owns every global-props field itself.
     */
    public void setAutoGlobalProps(boolean enabled) {
        ensureMainThread();
        autoGlobalProps = enabled;
        if (state != State.IDLE && state != State.RELEASED) applyGlobalProps();
    }

    public boolean getAutoGlobalProps() { return autoGlobalProps; }

    @Nullable
    public String getBundleName() { return bundleName; }

    /**
     * Loads and retains one verified bundle source without mounting a Lynx
     * view. The injected loader remains responsible for HTTPS, signatures and
     * disk-cache policy; this bounded memory cache only avoids a duplicate
     * source read for the next load of the same bundle.
     */
    public void prepare(@NonNull String bundleName) {
        ensureMainThread();
        ensureActive();
        validateBundleName(bundleName);
        loaderExecutor.execute(() -> {
            try {
                byte[] template = assetLoader.load(bundleName);
                if (template == null || template.length > MAX_PREPARED_TEMPLATE_BYTES)
                    throw new IllegalArgumentException("Prepared Lynx bundle is empty or too large");
                preparedBundleName = bundleName;
                preparedTemplate = template;
                post(() -> {
                    if (state != State.RELEASED) {
                        listener.onPrepared(this, bundleName);
                    }
                });
            } catch (Exception error) {
                post(() -> {
                    if (state != State.RELEASED) listener.onPrepareError(this, bundleName, error);
                });
            }
        });
    }

    public void load(@NonNull String bundleName) { load(bundleName, "", Collections.emptyMap()); }

    public void load(
            @NonNull String bundleName,
            @Nullable String initialData,
            @Nullable Map<String, Object> globalProps) {
        ensureMainThread();
        ensureActive();
        validateBundleName(bundleName);
        this.bundleName = bundleName;
        this.initialData = initialData == null ? "" : initialData;
        this.globalProps = snapshot(globalProps);
        render();
    }

    public void reload() {
        ensureMainThread();
        ensureActive();
        if (bundleName == null) throw new IllegalStateException("No Lynx bundle has been loaded");
        render();
    }

    /** Updates initData through Lynx's official non-remounting update API. */
    public void updateData(@NonNull String data) {
        updateData(data, null);
    }

    /**
     * Updates initData and optionally selects a registered Lynx data processor
     * without remounting the active template.
     */
    public void updateData(@NonNull String data, @Nullable String processorName) {
        ensureMainThread();
        ensureActive();
        if (bundleName == null) throw new IllegalStateException("No Lynx bundle has been loaded");
        validateData(data);
        TemplateData templateData = TemplateData.fromString(data);
        if (processorName != null) {
            validateProcessorName(processorName);
            templateData.markState(processorName);
        }
        LynxUpdateMeta.Builder builder = new LynxUpdateMeta.Builder();
        builder.setUpdatedData(templateData);
        lynxView.updateMetaData(builder.build());
        initialData = data;
        listener.onUpdate(this, bundleName);
    }

    public void updateGlobalProps(@NonNull Map<String, Object> props) {
        ensureMainThread();
        ensureActive();
        globalProps = snapshot(props);
        if (autoGlobalProps) applyGlobalProps();
        else lynxView.updateGlobalProps(TemplateData.fromMap(globalProps));
    }

    /** Applies a partial global-props update without remounting the view. */
    public void updateGlobalPropsByIncrement(@NonNull Map<String, Object> props) {
        ensureMainThread();
        ensureActive();
        Map<String, Object> increment = snapshot(props);
        if (!increment.isEmpty()) {
            Map<String, Object> merged = new HashMap<>(globalProps);
            merged.putAll(increment);
            globalProps = Collections.unmodifiableMap(merged);
            if (autoGlobalProps) applyGlobalProps();
            else lynxView.updateGlobalProps(TemplateData.fromMap(increment));
        }
    }

    public void sendGlobalEvent(@NonNull String eventName, @NonNull List<Object> params) {
        ensureMainThread();
        ensureActive();
        if (eventName.trim().isEmpty() || eventName.length() > 256 || params.size() > 256)
            throw new IllegalArgumentException("Invalid Lynx global event");
        lynxView.sendGlobalEvent(eventName, JavaOnlyArray.from(params));
    }

    public void show() { ensureMainThread(); ensureActive(); setVisibility(View.VISIBLE); }
    public void hide() { ensureMainThread(); ensureActive(); setVisibility(View.INVISIBLE); }

    public void release() {
        ensureMainThread();
        if (state == State.RELEASED) return;
        state = State.RELEASED;
        preparedBundleName = null;
        preparedTemplate = null;
        clearOverlay();
        lynxView.removeLynxViewClient(lifecycleClient);
        lynxView.destroy();
        loaderExecutor.shutdownNow();
        removeAllViews();
    }

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        appInBackground = false;
        if (state != State.RELEASED) {
            lynxView.onEnterForeground();
            listener.onShow(this);
            if (state != State.IDLE && autoGlobalProps) applyGlobalProps();
        }
    }

    @Override protected void onDetachedFromWindow() {
        if (state != State.RELEASED) {
            appInBackground = true;
            lynxView.onEnterBackground();
            listener.onHide(this);
        }
        super.onDetachedFromWindow();
    }

    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        boolean nextBackground = visibility != View.VISIBLE;
        if (nextBackground == appInBackground) return;
        appInBackground = nextBackground;
        if (state != State.IDLE && state != State.RELEASED && autoGlobalProps) applyGlobalProps();
    }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec));
        lynxView.measure(widthMeasureSpec, heightMeasureSpec);
        if (overlayView != null) overlayView.measure(widthMeasureSpec, heightMeasureSpec);
    }

    @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        int width = right - left;
        int height = bottom - top;
        lynxView.layout(0, 0, width, height);
        if (overlayView != null) overlayView.layout(0, 0, width, height);
        if (width > 0 && height > 0)
            lynxView.updateViewport(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                    MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY));
    }

    private void render() {
        state = State.LOADING;
        showLoadingUi();
        LynxLoadMeta.Builder builder = new LynxLoadMeta.Builder();
        builder.setUrl(bundleName);
        if (!initialData.isEmpty()) builder.setInitialData(TemplateData.fromString(initialData));
        if (autoGlobalProps || !globalProps.isEmpty())
            builder.setGlobalProps(TemplateData.fromMap(globalPropsForLynx()));
        lynxView.loadTemplate(builder.build());
    }

    private void applyGlobalProps() {
        LynxShipGlobalProps.apply(lynxView, this, containerId, containerInitTime,
                globalProps, autoGlobalProps, appInBackground);
    }

    @NonNull
    private Map<String, Object> globalPropsForLynx() {
        return autoGlobalProps
                ? LynxShipGlobalProps.create(this, containerId, containerInitTime, globalProps, appInBackground)
                : globalProps;
    }

    private void ensureActive() {
        if (state == State.RELEASED) throw new IllegalStateException("Lynx container has been released");
    }

    private void showLoadingUi() {
        clearOverlay();
        try {
            setOverlay(uiProvider.createLoadingView(getContext(), this, bundleName));
        } catch (RuntimeException ignored) {
            // Presentation failures must not turn a valid Lynx load into a failure.
        }
    }

    private void showErrorUi(@NonNull LynxError error) {
        clearOverlay();
        try {
            String bundle = bundleName == null ? "" : bundleName;
            setOverlay(uiProvider.createErrorView(getContext(), this, bundle, error, () -> {
                try {
                    reload();
                } catch (RuntimeException ignored) {
                    // The lifecycle callback remains the source of truth.
                }
            }));
        } catch (RuntimeException ignored) {
            // Presentation failures must not mask the original Lynx error.
        }
    }

    private void setOverlay(@Nullable View view) {
        if (view == null) return;
        if (view.getParent() != null && view.getParent() != this)
            throw new IllegalArgumentException("Container UI view already has a parent");
        if (view.getParent() == this) removeView(view);
        addView(view, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        overlayView = view;
        view.bringToFront();
    }

    private void clearOverlay() {
        if (overlayView == null) return;
        removeView(overlayView);
        overlayView = null;
    }

    private static Map<String, Object> snapshot(@Nullable Map<String, Object> props) {
        return props == null ? Collections.emptyMap() :
                Collections.unmodifiableMap(new HashMap<>(props));
    }

    private static void validateBundleName(String bundleName) {
        if (bundleName.trim().isEmpty() || bundleName.length() > 4096)
            throw new IllegalArgumentException("Lynx bundle name is empty or too long");
    }

    private static void validateData(String data) {
        if (data.length() > 8 * 1024 * 1024)
            throw new IllegalArgumentException("Lynx update data is larger than 8 MiB");
    }

    private static void validateProcessorName(String processorName) {
        if (processorName.trim().isEmpty() || processorName.length() > 256
                || processorName.matches(".*[\\u0000-\\u001F\\u007F].*"))
            throw new IllegalArgumentException("Lynx data processor name is invalid");
    }

    private static void ensureMainThread() {
        if (Looper.myLooper() != Looper.getMainLooper())
            throw new IllegalStateException("Lynx container methods must run on the Android main thread");
    }
}
