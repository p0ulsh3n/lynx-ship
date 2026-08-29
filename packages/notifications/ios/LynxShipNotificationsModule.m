#import "LynxShipNotificationsModule.h"

#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

static NSString *const LynxShipAPNsTokenKey = @"com.lynxship.notifications.apns-token";
static NSString *const LynxShipAPNsTokenDidChange =
    @"com.lynxship.notifications.apns-token-did-change";

@interface LynxShipNotificationsModule ()
@property(nonatomic, strong, nullable) id tokenObserver;
@property(nonatomic, copy, nullable) void (^tokenCallback)(NSString *token);
@end

@implementation LynxShipNotificationsModule

+ (NSString *)name {
  return @"LynxShipNotifications";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"requestPermission": NSStringFromSelector(@selector(requestPermission)),
    @"getToken": NSStringFromSelector(@selector(getToken)),
    @"requestPermissionAsync": NSStringFromSelector(@selector(requestPermissionAsync:)),
    @"getTokenAsync": NSStringFromSelector(@selector(getTokenAsync:)),
    @"subscribeTokenChanges": NSStringFromSelector(@selector(subscribeTokenChanges:)),
    @"clearTokenChangeListeners": NSStringFromSelector(@selector(clearTokenChangeListeners)),
  };
}

- (BOOL)requestPermission {
  __block UNAuthorizationStatus status = UNAuthorizationStatusNotDetermined;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  [[UNUserNotificationCenter currentNotificationCenter]
      getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    status = settings.authorizationStatus;
    dispatch_semaphore_signal(semaphore);
  }];
  // The generated synchronous bridge cannot present a permission prompt. It
  // can still report the already-known state without ever blocking the main
  // thread, which is the only safe behavior for a synchronous API.
  if ([NSThread isMainThread] ||
      dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC)) != 0) {
    return NO;
  }
  return status == UNAuthorizationStatusAuthorized ||
      status == UNAuthorizationStatusProvisional ||
      status == UNAuthorizationStatusEphemeral;
}

- (void)requestPermissionAsync:(id)callbackValue {
  void (^callback)(BOOL) = callbackValue;
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert |
                                            UNAuthorizationOptionBadge |
                                            UNAuthorizationOptionSound)
                        completionHandler:^(BOOL granted, NSError * _Nullable error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      callback(granted && error == nil);
      if (granted && error == nil) {
        [[UIApplication sharedApplication] registerForRemoteNotifications];
      }
    });
  }];
}

- (NSString *)getToken {
  NSString *token = [[NSUserDefaults standardUserDefaults] stringForKey:LynxShipAPNsTokenKey];
  return token.length == 0 ? @"" : token;
}

- (void)getTokenAsync:(id)callbackValue {
  void (^callback)(NSString *) = callbackValue;
  NSString *token = [[NSUserDefaults standardUserDefaults] stringForKey:LynxShipAPNsTokenKey];
  callback(token.length == 0 ? @"" : token);
}

- (void)subscribeTokenChanges:(id)callbackValue {
  void (^callback)(NSString *) = callbackValue;
  [self clearTokenChangeListeners];
  self.tokenCallback = callback;
  __weak typeof(self) weakSelf = self;
  self.tokenObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:LynxShipAPNsTokenDidChange
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(__unused NSNotification *note) {
    __strong typeof(weakSelf) self = weakSelf;
    NSString *token = [[NSUserDefaults standardUserDefaults]
        stringForKey:LynxShipAPNsTokenKey];
    if (self.tokenCallback != nil && token.length > 0) self.tokenCallback(token);
  }];
}

- (void)clearTokenChangeListeners {
  if (self.tokenObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.tokenObserver];
    self.tokenObserver = nil;
  }
  self.tokenCallback = nil;
}

@end

void LynxShipNotificationsStoreAPNsDeviceToken(NSData *deviceToken) {
  const unsigned char *bytes = deviceToken.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:deviceToken.length * 2];
  for (NSUInteger index = 0; index < deviceToken.length; index++) {
    [hex appendFormat:@"%02x", bytes[index]];
  }
  [[NSUserDefaults standardUserDefaults] setObject:hex forKey:LynxShipAPNsTokenKey];
  [[NSUserDefaults standardUserDefaults] synchronize];
  [[NSNotificationCenter defaultCenter]
      postNotificationName:LynxShipAPNsTokenDidChange
                    object:nil];
}
