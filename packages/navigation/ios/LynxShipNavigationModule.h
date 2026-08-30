#import <Foundation/Foundation.h>
#import <Lynx/LynxModule.h>

NS_ASSUME_NONNULL_BEGIN

@protocol LynxShipNavigationHost <NSObject>
- (BOOL)lynxShipOpenURL:(NSURL *)url replace:(BOOL)replace;
- (BOOL)lynxShipGoBack;
@optional
- (BOOL)lynxShipCreateURL:(NSURL *)url;
- (BOOL)lynxShipClose;
- (BOOL)lynxShipUpdateChromeJSON:(NSString *)json;
@end

@LynxNativeModule("LynxShipNavigation")
@interface LynxShipNavigationModule : NSObject
@end

NS_ASSUME_NONNULL_END
