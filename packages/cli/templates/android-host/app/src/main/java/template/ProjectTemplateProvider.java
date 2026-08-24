package __PACKAGE_NAME__;

import android.content.Context;

import com.lynx.tasm.provider.AbsTemplateProvider;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

public final class ProjectTemplateProvider extends AbsTemplateProvider {
    private final Context context;

    public ProjectTemplateProvider(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public void loadTemplate(String uri, Callback callback) {
        new Thread(() -> {
            try (InputStream input = context.getAssets().open(uri);
                    ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                callback.onSuccess(output.toByteArray());
            } catch (IOException error) {
                callback.onFailed(error.getMessage());
            }
        }, "lynx-template-loader").start();
    }
}
