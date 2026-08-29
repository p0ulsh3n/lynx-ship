#import <Foundation/Foundation.h>
#import <Lynx/LynxModule.h>
#import <PhotosUI/PhotosUI.h>
#import <UIKit/UIKit.h>

@LynxNativeModule("LynxShipMedia")
@interface LynxShipMediaModule : NSObject <UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate>
- (void)startRecording:(void (^)(BOOL started))callback;
- (void)stopRecording:(void (^)(NSString *uri))callback;
@end
