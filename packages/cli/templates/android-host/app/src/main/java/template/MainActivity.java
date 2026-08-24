package __PACKAGE_NAME__;

import android.app.Activity;
import android.os.Bundle;

import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewBuilder;

public final class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LynxView lynxView = new LynxViewBuilder()
                .setTemplateProvider(new ProjectTemplateProvider(this))
                .build(this);
        setContentView(lynxView);
        lynxView.renderTemplateUrl("main.lynx.bundle", "");
    }
}
