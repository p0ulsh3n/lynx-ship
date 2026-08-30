package __PACKAGE_NAME__;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.lynx.tasm.LynxError;
import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewClient;
import com.lynx.tasm.LynxViewBuilder;

public final class MainActivity extends Activity {
    private FrameLayout root;
    private LynxView lynxView;
    private ProgressBar loading;
    private TextView errorView;
    private LynxViewClient lifecycleClient;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        lynxView = new LynxViewBuilder()
                .setTemplateProvider(new ProjectTemplateProvider(this))
                .build(this);
        lifecycleClient = new LynxViewClient() {
            @Override
            public void onPageStart(String url) {
                runOnUiThread(() -> showLoading());
            }

            @Override
            public void onFirstScreen() {
                runOnUiThread(() -> showContent());
            }

            @Override
            public void onReceivedError(LynxError error) {
                runOnUiThread(() -> showError(error == null ? "Lynx failed to load" : error.toString()));
            }
        };
        lynxView.addLynxViewClient(lifecycleClient);

        root.addView(lynxView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        loading = new ProgressBar(this);
        FrameLayout.LayoutParams loadingParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER);
        root.addView(loading, loadingParams);

        errorView = new TextView(this);
        errorView.setGravity(Gravity.CENTER);
        errorView.setTextColor(Color.DKGRAY);
        errorView.setTextSize(16);
        errorView.setPadding(48, 24, 48, 24);
        errorView.setOnClickListener(view -> render());
        FrameLayout.LayoutParams errorParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER);
        errorParams.setMargins(32, 32, 32, 32);
        root.addView(errorView, errorParams);
        render();
    }

    private void render() {
        showLoading();
        try {
            lynxView.renderTemplateUrl("main.lynx.bundle", "");
        } catch (RuntimeException error) {
            showError(error.getMessage() == null ? "Lynx failed to start" : error.getMessage());
        }
    }

    private void showLoading() {
        if (loading != null) loading.setVisibility(View.VISIBLE);
        if (errorView != null) errorView.setVisibility(View.GONE);
    }

    private void showContent() {
        if (loading != null) loading.setVisibility(View.GONE);
        if (errorView != null) errorView.setVisibility(View.GONE);
    }

    private void showError(String message) {
        if (loading != null) loading.setVisibility(View.GONE);
        if (errorView != null) {
            errorView.setText("Unable to load Lynx content.\nTap to retry.\n\n" + message);
            errorView.setVisibility(View.VISIBLE);
        }
    }

    @Override
    protected void onDestroy() {
        if (lynxView != null) {
            if (lifecycleClient != null) lynxView.removeLynxViewClient(lifecycleClient);
            lynxView.destroy();
        }
        super.onDestroy();
    }
}
