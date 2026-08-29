# @lynxship/permissions

Permission state and request contracts for Lynx applications. Android and iOS
bridges are supported by the current Native Module path. A HarmonyOS bridge is
staged for the preview Autolink workflow, but current released Lynx SDK
documentation does not yet make HarmonyOS Native Modules a generally
available production target. Where the host supports that bridge, HarmonyOS
camera and microphone use `abilityAccessCtrl`; notifications use the current
`NotificationKit` enable/check APIs. The bridge obtains the UIAbility context
supplied by the Lynx host and does not fake a grant.

Native declarations remain host/config-plugin responsibilities and must follow the platform's current permission rules. Runtime requests should be made only in response to an intentional user action. A host must expose a valid UIAbility context, and the app must declare each sensitive permission in its Harmony module configuration before requesting it.

On Android, the bridge serializes the permission trampoline and returns
`blocked` when the platform reports that asking again is no longer appropriate;
the application can then direct the user to settings. A second concurrent
request is rejected instead of leaving either JavaScript callback unresolved.
