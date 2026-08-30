#import "LynxShipNavigationModule.h"
#import <UIKit/UIKit.h>

@implementation LynxShipNavigationModule

+ (NSString *)name { return @"LynxShipNavigation"; }

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"create": NSStringFromSelector(@selector(create:callback:)),
    @"open": NSStringFromSelector(@selector(open:callback:)),
    @"replace": NSStringFromSelector(@selector(replace:callback:)),
    @"openInSystemBrowser": NSStringFromSelector(@selector(openInSystemBrowser:callback:)),
    @"back": NSStringFromSelector(@selector(back:)),
    @"close": NSStringFromSelector(@selector(close:)),
    @"updateChrome": NSStringFromSelector(@selector(updateChrome:callback:)),
  };
}

- (void)create:(NSString *)rawURL callback:(void (^)(BOOL))callback {
  NSURL *url = [NSURL URLWithString:rawURL];
  if (!url || ![self allowedLynxURL:url]) { callback(NO); return; }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *controller = [self topViewController];
    id<LynxShipNavigationHost> host = [self hostFromController:controller];
    callback(host && [host respondsToSelector:@selector(lynxShipCreateURL:)] ?
      [host lynxShipCreateURL:url] : NO);
  });
}

- (void)open:(NSString *)rawURL callback:(void (^)(BOOL))callback {
  [self dispatchURL:rawURL replace:NO callback:callback];
}

- (void)replace:(NSString *)rawURL callback:(void (^)(BOOL))callback {
  [self dispatchURL:rawURL replace:YES callback:callback];
}

- (void)openInSystemBrowser:(NSString *)rawURL callback:(void (^)(BOOL))callback {
  NSURL *url = [NSURL URLWithString:rawURL];
  if (!url || ![self allowedBrowserURL:url]) { callback(NO); return; }
  dispatch_async(dispatch_get_main_queue(), ^{
    [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:callback];
  });
}

- (void)back:(void (^)(BOOL))callback {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *controller = [self topViewController];
    id<LynxShipNavigationHost> host = [self hostFromController:controller];
    if (host) {
      callback([host lynxShipGoBack]);
      return;
    }
    if (controller.navigationController.viewControllers.count > 1) {
      [controller.navigationController popViewControllerAnimated:YES];
      callback(YES);
      return;
    }
    if (controller.presentingViewController) {
      [controller dismissViewControllerAnimated:YES completion:^{ callback(YES); }];
      return;
    }
    callback(NO);
  });
}

- (void)close:(void (^)(BOOL))callback {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *controller = [self topViewController];
    id<LynxShipNavigationHost> host = [self hostFromController:controller];
    if (host && [host respondsToSelector:@selector(lynxShipClose)]) {
      callback([host lynxShipClose]);
      return;
    }
    if (controller.navigationController.viewControllers.count > 1) {
      [controller.navigationController popViewControllerAnimated:YES];
      callback(YES);
      return;
    }
    if (controller.presentingViewController) {
      [controller dismissViewControllerAnimated:YES completion:^{ callback(YES); }];
      return;
    }
    callback(NO);
  });
}

- (void)updateChrome:(NSString *)json callback:(void (^)(BOOL))callback {
  if (![self validChromeJSON:json]) { callback(NO); return; }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *controller = [self topViewController];
    id<LynxShipNavigationHost> host = [self hostFromController:controller];
    callback(host && [host respondsToSelector:@selector(lynxShipUpdateChromeJSON:)] ?
      [host lynxShipUpdateChromeJSON:json] : NO);
  });
}

- (void)dispatchURL:(NSString *)rawURL replace:(BOOL)replace callback:(void (^)(BOOL))callback {
  NSURL *url = [NSURL URLWithString:rawURL];
  if (!url || ![self allowedURL:url]) {
    callback(NO);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *controller = [self topViewController];
    id<LynxShipNavigationHost> host = [self hostFromController:controller];
    if (host) {
      callback([host lynxShipOpenURL:url replace:replace]);
      return;
    }
    if ([self openDefaultLynxPage:url replace:replace from:controller]) {
      callback(YES);
      return;
    }
    [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:callback];
  });
}

- (BOOL)openDefaultLynxPage:(NSURL *)url replace:(BOOL)replace from:(UIViewController *)controller {
  if (![self hasLocalBundle:url] || !controller) return NO;
  Class pageClass = NSClassFromString(@"LynxShipNavigationPageViewController");
  if (!pageClass) return NO;
  id allocated = [pageClass alloc];
  SEL selector = NSSelectorFromString(@"initWithURL:");
  if (![allocated respondsToSelector:selector]) return NO;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  UIViewController *page = [allocated performSelector:selector withObject:url];
#pragma clang diagnostic pop
  if (!page) return NO;
  UINavigationController *navigation = controller.navigationController;
  if (navigation) {
    if (replace && navigation.viewControllers.count > 0) {
      NSMutableArray *stack = [navigation.viewControllers mutableCopy];
      [stack removeLastObject];
      [stack addObject:page];
      [navigation setViewControllers:stack animated:YES];
    } else {
      [navigation pushViewController:page animated:YES];
    }
  } else {
    UINavigationController *navigation = [[UINavigationController alloc] initWithRootViewController:page];
    [controller presentViewController:navigation animated:YES completion:nil];
  }
  return YES;
}

- (BOOL)hasLocalBundle:(NSURL *)url {
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  NSString *bundle = nil;
  for (NSURLQueryItem *item in components.queryItems) {
    if ([item.name isEqualToString:@"bundle"]) { bundle = item.value; break; }
  }
  return bundle.length > 0 && bundle.length <= 4096 && ![bundle hasPrefix:@"/"] &&
    [bundle rangeOfString:@"\\"].location == NSNotFound && [bundle rangeOfString:@".."].location == NSNotFound &&
    [bundle rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location == NSNotFound;
}

- (BOOL)allowedURL:(NSURL *)url {
  if (url.absoluteString.length == 0 || url.absoluteString.length > 8192 || url.user != nil || url.password != nil) return NO;
  NSString *scheme = url.scheme.lowercaseString;
  if (scheme.length == 0) return NO;
  if ([scheme isEqualToString:@"https"] && url.host.length == 0) return NO;
  return scheme.length > 0 && ([scheme isEqualToString:@"lynx"] ||
    [scheme isEqualToString:@"lynxship"] || [scheme isEqualToString:@"hybrid"] ||
    [scheme isEqualToString:@"https"]);
}

- (BOOL)allowedLynxURL:(NSURL *)url {
  if (![self allowedURL:url]) return NO;
  NSString *scheme = url.scheme.lowercaseString;
  return [scheme isEqualToString:@"lynx"] || [scheme isEqualToString:@"lynxship"] || [scheme isEqualToString:@"hybrid"];
}

- (BOOL)allowedBrowserURL:(NSURL *)url {
  if (![self allowedURL:url]) return NO;
  return [url.scheme.lowercaseString isEqualToString:@"https"];
}

- (BOOL)validChromeJSON:(NSString *)json {
  if (json.length == 0 || json.length > 16384) return NO;
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return NO;
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [value isKindOfClass:NSDictionary.class] && [(NSDictionary *)value count] > 0;
}

- (UIViewController *)topViewController {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive &&
        scene.activationState != UISceneActivationStateForegroundInactive) continue;
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *window in windowScene.windows) {
      if (!window.isKeyWindow || !window.rootViewController) continue;
      UIViewController *controller = window.rootViewController;
      while (controller.presentedViewController) controller = controller.presentedViewController;
      while ([controller isKindOfClass:UINavigationController.class])
        controller = ((UINavigationController *)controller).topViewController;
      while ([controller isKindOfClass:UITabBarController.class])
        controller = ((UITabBarController *)controller).selectedViewController;
      return controller;
    }
  }
  return nil;
}

- (id<LynxShipNavigationHost>)hostFromController:(UIViewController *)controller {
  return [controller conformsToProtocol:@protocol(LynxShipNavigationHost)] ?
    (id<LynxShipNavigationHost>)controller : nil;
}

@end
