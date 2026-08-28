#import <Foundation/Foundation.h>
#import <Lynx/LynxModule.h>
#import "src/generated/LynxShipNotificationsSpec.h"

NS_ASSUME_NONNULL_BEGIN

/**
 * Pass the APNs token from the host application's
 * application:didRegisterForRemoteNotificationsWithDeviceToken: callback.
 */
FOUNDATION_EXPORT void LynxShipNotificationsStoreAPNsDeviceToken(NSData *deviceToken);

@LynxNativeModule("LynxShipNotifications")
@interface LynxShipNotificationsModule : NSObject <LynxShipNotificationsSpec>
@end

NS_ASSUME_NONNULL_END
