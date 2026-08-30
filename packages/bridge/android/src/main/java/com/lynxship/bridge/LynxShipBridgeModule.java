package com.lynxship.bridge;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/** Native Lynx transport for the host-neutral @lynxship/bridge contract. */
public final class LynxShipBridgeModule extends LynxModule {
    private static final int MAX_REQUEST_BYTES = 256 * 1024;
    private static final Pattern SAFE_IDENTIFIER =
            Pattern.compile("^[A-Za-z][A-Za-z0-9_.:-]{0,127}$");
    private static final Pattern SAFE_KEY =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$");
    private final Context moduleContext;

    public LynxShipBridgeModule(LynxContext context) {
        super(context);
        moduleContext = context.getContext();
    }

    @LynxMethod
    public void invoke(String requestJson, Callback callback) {
        if (!validateRequest(requestJson, callback)) return;
        Activity activity = findActivity(moduleContext);
        if (!(activity instanceof LynxShipBridgeHost)) {
            callback.invoke(error("No LynxShipBridgeHost is registered."));
            return;
        }
        if (!((LynxShipBridgeHost) activity).invoke(requestJson, callback))
            callback.invoke(error("The LynxShipBridgeHost rejected the request."));
    }

    @LynxMethod
    public void subscribe(String event, Callback callback) {
        if (callback == null || !SAFE_IDENTIFIER.matcher(event == null ? "" : event).matches()) {
            if (callback != null) callback.invoke(error("Invalid bridge event."));
            return;
        }
        Activity activity = findActivity(moduleContext);
        if (!(activity instanceof LynxShipBridgeHost)
                || !((LynxShipBridgeHost) activity).subscribe(event, callback))
            callback.invoke(error("The LynxShipBridgeHost rejected the event."));
    }

    @LynxMethod
    public void unsubscribe(String event) {
        if (!SAFE_IDENTIFIER.matcher(event == null ? "" : event).matches()) return;
        Activity activity = findActivity(moduleContext);
        if (activity instanceof LynxShipBridgeHost)
            ((LynxShipBridgeHost) activity).unsubscribe(event);
    }

    private static boolean validateRequest(String requestJson, Callback callback) {
        if (callback == null) return false;
        if (requestJson == null
                || requestJson.getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST_BYTES) {
            callback.invoke(error("Bridge request is missing or too large."));
            return false;
        }
        try {
            JSONObject request = new JSONObject(requestJson);
            if (!SAFE_IDENTIFIER.matcher(request.optString("method", "")).matches()
                    || !SAFE_KEY.matcher(request.optString("requestId", "")).matches()) {
                callback.invoke(error("Bridge method or request ID is invalid."));
                return false;
            }
            String idempotencyKey = request.optString("idempotencyKey", "");
            if (!idempotencyKey.isEmpty() && !SAFE_KEY.matcher(idempotencyKey).matches()) {
                callback.invoke(error("Bridge idempotency key is invalid."));
                return false;
            }
            String priority = request.optString("priority", "normal");
            if (!("high".equals(priority) || "normal".equals(priority) || "low".equals(priority))) {
                callback.invoke(error("Bridge priority is invalid."));
                return false;
            }
            return true;
        } catch (Exception error) {
            callback.invoke(error("Bridge request is not valid JSON."));
            return false;
        }
    }

    private static String error(String message) {
        return "{\"code\":-1,\"msg\":" + JSONObject.quote(message) + "}";
    }

    private static Activity findActivity(Context context) {
        Context current = context;
        while (current instanceof ContextWrapper) {
            if (current instanceof Activity) return (Activity) current;
            Context next = ((ContextWrapper) current).getBaseContext();
            if (next == current) break;
            current = next;
        }
        return current instanceof Activity ? (Activity) current : null;
    }
}
