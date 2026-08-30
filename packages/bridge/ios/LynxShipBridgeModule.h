#import <Foundation/Foundation.h>
#import <Lynx/LynxModule.h>

NS_ASSUME_NONNULL_BEGIN

@protocol LynxShipBridgeHost <NSObject>
- (BOOL)lynxShipInvokeRequestJSON:(NSString *)requestJSON
                        completion:(void (^)(NSString * _Nullable responseJSON))completion;
@optional
- (BOOL)lynxShipSubscribeEvent:(NSString *)event
                       callback:(void (^)(NSString *responseJSON))callback;
- (void)lynxShipUnsubscribeEvent:(NSString *)event;
@end

@LynxNativeModule("LynxShipBridge")
@interface LynxShipBridgeModule : NSObject
@end

NS_ASSUME_NONNULL_END
