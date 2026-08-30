#import "LynxShipBridgeModule.h"

#import <UIKit/UIKit.h>

static NSUInteger const LynxShipBridgeMaxRequestBytes = 256 * 1024;

@implementation LynxShipBridgeModule

+ (NSString *)name { return @"LynxShipBridge"; }

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"invoke": NSStringFromSelector(@selector(invoke:callback:)),
    @"subscribe": NSStringFromSelector(@selector(subscribe:callback:)),
    @"unsubscribe": NSStringFromSelector(@selector(unsubscribe:)),
  };
}

- (void)invoke:(NSString *)requestJSON callback:(void (^)(NSString *))callback {
  NSDictionary *request = [self validRequest:requestJSON callback:callback];
  if (request == nil) return;
  UIViewController *controller = [self activeController];
  id<LynxShipBridgeHost> host = [self hostFromController:controller];
  if (host == nil) {
    callback([self error:@"No LynxShipBridgeHost is registered."]);
    return;
  }
  if (![host lynxShipInvokeRequestJSON:requestJSON completion:callback])
    callback([self error:@"The LynxShipBridgeHost rejected the request."]);
}

- (void)subscribe:(NSString *)event callback:(void (^)(NSString *))callback {
  if (![self safeIdentifier:event] || callback == nil) return;
  id<LynxShipBridgeHost> host = [self hostFromController:[self activeController]];
  if ([host respondsToSelector:@selector(lynxShipSubscribeEvent:callback:)] &&
      [host lynxShipSubscribeEvent:event callback:callback]) return;
  callback([self error:@"The LynxShipBridgeHost rejected the event."]);
}

- (void)unsubscribe:(NSString *)event {
  if (![self safeIdentifier:event]) return;
  id<LynxShipBridgeHost> host = [self hostFromController:[self activeController]];
  if ([host respondsToSelector:@selector(lynxShipUnsubscribeEvent:)])
    [host lynxShipUnsubscribeEvent:event];
}

- (NSDictionary *)validRequest:(NSString *)requestJSON callback:(void (^)(NSString *))callback {
  if (requestJSON == nil || requestJSON.length == 0 ||
      [requestJSON dataUsingEncoding:NSUTF8StringEncoding].length > LynxShipBridgeMaxRequestBytes) {
    callback([self error:@"Bridge request is missing or too large."]);
    return nil;
  }
  NSData *data = [requestJSON dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![request isKindOfClass:NSDictionary.class] ||
      ![self safeIdentifier:request[@"method"]] ||
      ![self safeKey:request[@"requestId"]]) {
    callback([self error:@"Bridge method or request ID is invalid."]);
    return nil;
  }
  NSString *idempotencyKey = request[@"idempotencyKey"];
  if (idempotencyKey != nil && ![self safeKey:idempotencyKey]) {
    callback([self error:@"Bridge idempotency key is invalid."]);
    return nil;
  }
  NSString *priority = request[@"priority"] ?: @"normal";
  if (![priority isEqualToString:@"high"] && ![priority isEqualToString:@"normal"] &&
      ![priority isEqualToString:@"low"]) {
    callback([self error:@"Bridge priority is invalid."]);
    return nil;
  }
  return request;
}

- (BOOL)safeIdentifier:(id)value {
  if (![value isKindOfClass:NSString.class]) return NO;
  NSRange range = [value rangeOfString:@"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$"
                              options:NSRegularExpressionSearch];
  return range.location != NSNotFound && range.length == [value length];
}

- (BOOL)safeKey:(id)value {
  if (![value isKindOfClass:NSString.class]) return NO;
  NSRange range = [value rangeOfString:@"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
                              options:NSRegularExpressionSearch];
  return range.location != NSNotFound && range.length == [value length];
}

- (NSString *)error:(NSString *)message {
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{ @"code": @(-1), @"msg": message }
                                                    options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"{\"success\":false}";
}

- (id<LynxShipBridgeHost>)hostFromController:(UIViewController *)controller {
  return [controller conformsToProtocol:@protocol(LynxShipBridgeHost)]
      ? (id<LynxShipBridgeHost>)controller : nil;
}

- (UIViewController *)activeController {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive &&
        scene.activationState != UISceneActivationStateForegroundInactive) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (!window.isKeyWindow || window.rootViewController == nil) continue;
      UIViewController *controller = window.rootViewController;
      while (controller.presentedViewController != nil) controller = controller.presentedViewController;
      while ([controller isKindOfClass:UINavigationController.class])
        controller = ((UINavigationController *)controller).topViewController;
      while ([controller isKindOfClass:UITabBarController.class])
        controller = ((UITabBarController *)controller).selectedViewController;
      return controller;
    }
  }
  return nil;
}

@end
