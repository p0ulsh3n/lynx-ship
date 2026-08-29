#import "LynxShipMediaModule.h"
#import "LynxShipAudioRecorder.h"
#import <AVFoundation/AVFoundation.h>
#import <PhotosUI/PhotosUI.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@interface LynxShipMediaModule ()
@property(nonatomic, copy) void (^pendingCallback)(NSString *value);
@property(nonatomic, copy) NSString *pendingKind;
@property(nonatomic, strong) UIImagePickerController *cameraPicker;
@property(nonatomic, strong) PHPickerViewController *libraryPicker;
@property(nonatomic, strong) LynxShipAudioRecorder *audioRecorder;
@end

@implementation LynxShipMediaModule

+ (NSString *)name { return @"LynxShipMedia"; }

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"getCapabilities": NSStringFromSelector(@selector(getCapabilities:)),
    @"requestAccess": NSStringFromSelector(@selector(requestAccess:callback:)),
    @"pick": NSStringFromSelector(@selector(pick:callback:)),
    @"capture": NSStringFromSelector(@selector(capture:callback:)),
    @"startRecording": NSStringFromSelector(@selector(startRecording:)),
    @"stopRecording": NSStringFromSelector(@selector(stopRecording:)),
  };
}

- (void)getCapabilities:(void (^)(NSString *))callback {
  callback(@"{\"pickPhoto\":true,\"pickVideo\":true,\"capturePhoto\":true,\"recordAudio\":true}");
}

- (void)requestAccess:(NSString *)kind callback:(void (^)(BOOL))callback {
  if ([kind isEqualToString:@"photo-library"] || [kind isEqualToString:@"video-library"]) {
    callback(YES);
    return;
  }
  if (![kind isEqualToString:@"camera"] && ![kind isEqualToString:@"microphone"]) {
    callback(NO);
    return;
  }
  if ([kind isEqualToString:@"microphone"]) {
    void (^complete)(BOOL) = ^(BOOL granted) {
      dispatch_async(dispatch_get_main_queue(), ^{ callback(granted); });
    };
    if (@available(iOS 17.0, *)) {
      [AVAudioApplication requestRecordPermissionWithCompletionHandler:complete];
    } else {
      [[AVAudioSession sharedInstance] requestRecordPermission:complete];
    }
    return;
  }
  AVMediaType type = AVMediaTypeVideo;
  [AVCaptureDevice requestAccessForMediaType:type completionHandler:^(BOOL granted) {
    dispatch_async(dispatch_get_main_queue(), ^{ callback(granted); });
  }];
}

- (void)startRecording:(void (^)(BOOL))callback {
  if (self.audioRecorder == nil) self.audioRecorder = [LynxShipAudioRecorder new];
  [self.audioRecorder start:callback];
}

- (void)stopRecording:(void (^)(NSString *))callback {
  if (self.audioRecorder == nil) {
    callback(@"");
    return;
  }
  [self.audioRecorder stop:callback];
}

- (void)pick:(NSString *)kind callback:(void (^)(NSString *))callback {
  if (![kind isEqualToString:@"photo-library"] && ![kind isEqualToString:@"video-library"]) {
    callback(@"");
    return;
  }
  if (self.libraryPicker != nil || self.cameraPicker != nil) {
    callback(@"");
    return;
  }

  PHPickerConfiguration *configuration = [[PHPickerConfiguration alloc] init];
  configuration.filter = [kind isEqualToString:@"video-library"]
      ? [PHPickerFilter videosFilter]
      : [PHPickerFilter imagesFilter];
  configuration.selectionLimit = 1;
  PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:configuration];
  picker.delegate = self;
  self.pendingCallback = callback;
  self.pendingKind = kind;
  self.libraryPicker = picker;
  [self present:picker];
}

- (void)capture:(NSString *)kind callback:(void (^)(NSString *))callback {
  if (![kind isEqualToString:@"camera"] || ![UIImagePickerController isSourceTypeAvailable:UIImagePickerControllerSourceTypeCamera]) {
    callback(@"");
    return;
  }
  if (self.libraryPicker != nil || self.cameraPicker != nil) {
    callback(@"");
    return;
  }

  UIImagePickerController *picker = [UIImagePickerController new];
  picker.sourceType = UIImagePickerControllerSourceTypeCamera;
  picker.mediaTypes = @[UTTypeImage.identifier];
  picker.delegate = self;
  self.pendingCallback = callback;
  self.pendingKind = kind;
  self.cameraPicker = picker;
  [self present:picker];
}

- (void)present:(UIViewController *)controller {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIViewController *presenter = [self presenter];
    if (presenter == nil) {
      [self complete:@""];
      return;
    }
    [presenter presentViewController:controller animated:YES completion:nil];
  });
}

- (UIViewController *)presenter {
  UIWindow *activeWindow = nil;
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive || ![scene isKindOfClass:[UIWindowScene class]]) {
      continue;
    }
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (window.isKeyWindow) {
        activeWindow = window;
        break;
      }
    }
    if (activeWindow != nil) break;
  }

  UIViewController *controller = activeWindow.rootViewController;
  while (controller.presentedViewController != nil) controller = controller.presentedViewController;
  return controller;
}

- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results {
  PHPickerResult *result = results.firstObject;
  if (result == nil) {
    [self complete:@""];
    return;
  }

  NSString *typeIdentifier = [self.pendingKind isEqualToString:@"video-library"]
      ? UTTypeMovie.identifier
      : UTTypeImage.identifier;
  NSItemProvider *provider = result.itemProvider;
  __weak LynxShipMediaModule *weakSelf = self;
  [picker dismissViewControllerAnimated:YES completion:^{
    if ([weakSelf.pendingKind isEqualToString:@"video-library"]) {
      [provider loadFileRepresentationForTypeIdentifier:typeIdentifier completionHandler:^(NSURL *url, NSError *error) {
        NSString *value = error == nil ? [weakSelf copyTemporaryFile:url] : @"";
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf complete:value]; });
      }];
    } else {
      [provider loadDataRepresentationForTypeIdentifier:typeIdentifier completionHandler:^(NSData *data, NSError *error) {
        NSString *value = error == nil ? [weakSelf writeTemporaryData:data extension:@"jpg"] : @"";
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf complete:value]; });
      }];
    }
  }];
}

- (void)imagePickerController:(UIImagePickerController *)picker didFinishPickingMediaWithInfo:(NSDictionary<UIImagePickerControllerInfoKey, id> *)info {
  UIImage *image = info[UIImagePickerControllerOriginalImage];
  __weak LynxShipMediaModule *weakSelf = self;
  [picker dismissViewControllerAnimated:YES completion:^{
    NSString *value = [weakSelf writeTemporaryData:UIImageJPEGRepresentation(image, 0.92) extension:@"jpg"];
    [weakSelf complete:value];
  }];
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker {
  [picker dismissViewControllerAnimated:YES completion:^{ [self complete:@""]; }];
}

- (NSString *)copyTemporaryFile:(NSURL *)source {
  if (source == nil) return @"";
  NSString *extension = source.pathExtension.length > 0 ? source.pathExtension : @"bin";
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"lynxship-%@.%@", NSUUID.UUID.UUIDString, extension]];
  NSURL *destination = [NSURL fileURLWithPath:path];
  return [[NSFileManager defaultManager] copyItemAtURL:source toURL:destination error:nil] ? destination.absoluteString : @"";
}

- (NSString *)writeTemporaryData:(NSData *)data extension:(NSString *)extension {
  if (data == nil || data.length == 0) return @"";
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"lynxship-%@.%@", NSUUID.UUID.UUIDString, extension]];
  return [data writeToFile:path atomically:YES] ? [NSURL fileURLWithPath:path].absoluteString : @"";
}

- (void)complete:(NSString *)value {
  void (^callback)(NSString *) = self.pendingCallback;
  self.pendingCallback = nil;
  self.pendingKind = nil;
  self.libraryPicker = nil;
  self.cameraPicker = nil;
  if (callback != nil) callback(value ?: @"");
}

@end
