# Lynx discovers native modules through annotations and reflection.
-keep class com.lynxship.notifications.** { *; }
-keep @interface com.lynx.jsbridge.LynxMethod
-keep @com.lynx.jsbridge.LynxMethod class * { *; }
