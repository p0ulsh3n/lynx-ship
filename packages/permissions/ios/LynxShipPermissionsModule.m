#import "LynxShipPermissionsModule.h"
#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

@implementation LynxShipPermissionsModule

+ (NSString *)name { return @"LynxShipPermissions"; }

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"checkPermission": NSStringFromSelector(@selector(checkPermission:callback:)),
    @"requestPermission": NSStringFromSelector(@selector(requestPermission:callback:)),
    @"openSettings": NSStringFromSelector(@selector(openSettings:)),
  };
}

- (void)checkPermission:(NSString *)name callback:(void (^)(NSString *))callback {
  if ([name isEqualToString:@"camera"] || [name isEqualToString:@"microphone"]) {
    AVMediaType type = [name isEqualToString:@"camera"] ? AVMediaTypeVideo : AVMediaTypeAudio;
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:type];
    callback(status == AVAuthorizationStatusAuthorized ? @"granted" : (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted ? @"blocked" : @"denied"));
    return;
  }
  if ([name isEqualToString:@"notifications"]) {
    [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      callback(settings.authorizationStatus == UNAuthorizationStatusAuthorized ? @"granted" : @"denied");
    }];
    return;
  }
  callback(@"unavailable");
}

- (void)requestPermission:(NSString *)name callback:(void (^)(NSString *))callback {
  if ([name isEqualToString:@"camera"] || [name isEqualToString:@"microphone"]) {
    AVMediaType type = [name isEqualToString:@"camera"] ? AVMediaTypeVideo : AVMediaTypeAudio;
    [AVCaptureDevice requestAccessForMediaType:type completionHandler:^(BOOL granted) { dispatch_async(dispatch_get_main_queue(), ^{ callback(granted ? @"granted" : @"denied"); }); }];
    return;
  }
  if ([name isEqualToString:@"notifications"]) {
    [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionBadge | UNAuthorizationOptionSound) completionHandler:^(BOOL granted, NSError *error) { callback(granted && error == nil ? @"granted" : @"denied"); }];
    return;
  }
  callback(@"unavailable");
}

- (void)openSettings:(void (^)(BOOL))callback {
  dispatch_async(dispatch_get_main_queue(), ^{ [[UIApplication sharedApplication] openURL:[NSURL URLWithString:UIApplicationOpenSettingsURLString] options:@{} completionHandler:^(BOOL success) { callback(success); }]; });
}

@end
