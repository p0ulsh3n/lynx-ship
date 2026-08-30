#import "LynxShipMediaModule.h"
#import "LynxShipAudioRecorder.h"
#import <AVFoundation/AVFoundation.h>
#import <Photos/Photos.h>
#import <PhotosUI/PhotosUI.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@interface LynxShipMediaModule ()
@property(nonatomic, copy) void (^pendingCallback)(NSString *value);
@property(nonatomic, copy) NSString *pendingKind;
@property(nonatomic, copy) void (^pendingSelectionCallback)(NSString *value);
@property(nonatomic, copy) NSDictionary *pendingSelectionOptions;
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
    @"chooseMedia": NSStringFromSelector(@selector(chooseMedia:callback:)),
    @"startRecording": NSStringFromSelector(@selector(startRecording:)),
    @"stopRecording": NSStringFromSelector(@selector(stopRecording:)),
  };
}

- (void)getCapabilities:(void (^)(NSString *))callback {
  callback(@"{\"pickPhoto\":true,\"pickVideo\":true,\"capturePhoto\":true,\"recordAudio\":true}");
}

- (void)chooseMedia:(NSString *)request callback:(void (^)(NSString *))callback {
  if (callback == nil || request.length > 16384 || self.libraryPicker != nil || self.cameraPicker != nil) {
    if (callback != nil) callback([self errorResult:@"Media selection is unavailable."]);
    return;
  }
  NSData *data = [request dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *options = data == nil ? nil : [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  NSArray *types = [options isKindOfClass:[NSDictionary class]] ? options[@"mediaTypes"] : nil;
  NSString *source = [options isKindOfClass:[NSDictionary class]] ? options[@"sourceType"] : nil;
  NSNumber *maxCount = [options isKindOfClass:[NSDictionary class]] ? options[@"maxCount"] : nil;
  BOOL validSource = [source isEqualToString:@"album"] || [source isEqualToString:@"camera"];
  if (![types isKindOfClass:[NSArray class]] || types.count == 0 || types.count > 2 || !validSource || maxCount.integerValue < 1 || maxCount.integerValue > 100) {
    callback([self errorResult:@"Invalid media selection options."]);
    return;
  }
  if ([options[@"saveToPhotoAlbum"] boolValue] && [source isEqualToString:@"album"]) {
    callback([self errorResult:@"saveToPhotoAlbum is only supported for camera selection."]);
    return;
  }
  if ([source isEqualToString:@"camera"] && (types.count != 1 || maxCount.integerValue != 1)) {
    callback([self errorResult:@"iOS camera selection requires exactly one media type and one item."]);
    return;
  }
  self.pendingSelectionCallback = callback;
  self.pendingSelectionOptions = options;
  if ([source isEqualToString:@"album"]) {
    PHPickerConfiguration *configuration = [[PHPickerConfiguration alloc] init];
    if (types.count == 1) configuration.filter = [types.firstObject isEqualToString:@"video"] ? [PHPickerFilter videosFilter] : [PHPickerFilter imagesFilter];
    configuration.selectionLimit = maxCount.integerValue;
    PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:configuration];
    picker.delegate = self;
    self.libraryPicker = picker;
    [self present:picker];
    return;
  }
  NSString *type = types.firstObject;
  if (![type isEqualToString:@"image"] && ![type isEqualToString:@"video"]) {
    [self completeSelectionWithError:@"Unsupported camera media type."];
    return;
  }
  if (![UIImagePickerController isSourceTypeAvailable:UIImagePickerControllerSourceTypeCamera]) {
    [self completeSelectionWithError:@"Camera is not available."];
    return;
  }
  UIImagePickerController *picker = [UIImagePickerController new];
  picker.sourceType = UIImagePickerControllerSourceTypeCamera;
  picker.mediaTypes = @[[type isEqualToString:@"video"] ? UTTypeMovie.identifier : UTTypeImage.identifier];
  picker.cameraDevice = [options[@"cameraType"] isEqualToString:@"front"] ? UIImagePickerControllerCameraDeviceFront : UIImagePickerControllerCameraDeviceRear;
  picker.delegate = self;
  self.cameraPicker = picker;
  [self present:picker];
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
  if (self.pendingSelectionCallback != nil) {
    if (results.count == 0) { [self completeSelectionWithError:nil]; return; }
    NSMutableArray *files = [NSMutableArray arrayWithCapacity:results.count];
    for (NSUInteger index = 0; index < results.count; index++) [files addObject:[NSNull null]];
    dispatch_group_t group = dispatch_group_create();
    for (NSUInteger index = 0; index < results.count; index++) {
      PHPickerResult *result = results[index];
      NSString *identifier = result.itemProvider.registeredTypeIdentifiers.firstObject;
      if (identifier == nil) continue;
      dispatch_group_enter(group);
      [result.itemProvider loadFileRepresentationForTypeIdentifier:identifier completionHandler:^(NSURL *url, NSError *error) {
        NSDictionary *file = error == nil ? [self materializeURL:url options:self.pendingSelectionOptions] : nil;
        @synchronized (files) { if (file != nil) files[index] = file; }
        dispatch_group_leave(group);
      }];
    }
    [picker dismissViewControllerAnimated:YES completion:^{
      dispatch_group_notify(group, dispatch_get_main_queue(), ^{
        NSMutableArray *valid = [NSMutableArray array];
        for (id file in files) if (![file isKindOfClass:[NSNull class]]) [valid addObject:file];
        [self completeSelection:valid];
      });
    }];
    return;
  }
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
  if (self.pendingSelectionCallback != nil) {
    NSString *mediaType = info[UIImagePickerControllerMediaType];
    NSDictionary *value = [mediaType isEqualToString:UTTypeMovie.identifier]
        ? [self materializeURL:info[UIImagePickerControllerMediaURL] options:self.pendingSelectionOptions]
        : [self materializeImage:info[UIImagePickerControllerOriginalImage] options:self.pendingSelectionOptions];
    [picker dismissViewControllerAnimated:YES completion:^{
      if (value == nil) {
        [self completeSelectionWithError:@"Media capture failed."];
      } else if ([self.pendingSelectionOptions[@"saveToPhotoAlbum"] boolValue]) {
        [self saveFileToPhotoAlbum:value completion:^(BOOL saved) {
          saved ? [self completeSelection:@[value]] : [self completeSelectionWithError:@"Media could not be saved to the photo album."];
        }];
      } else {
        [self completeSelection:@[value]];
      }
    }];
    return;
  }
  UIImage *image = info[UIImagePickerControllerOriginalImage];
  __weak LynxShipMediaModule *weakSelf = self;
  [picker dismissViewControllerAnimated:YES completion:^{
    NSString *value = [weakSelf writeTemporaryData:UIImageJPEGRepresentation(image, 0.92) extension:@"jpg"];
    [weakSelf complete:value];
  }];
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker {
  [picker dismissViewControllerAnimated:YES completion:^{
    if (self.pendingSelectionCallback != nil) [self completeSelectionWithError:nil];
    else [self complete:@""];
  }];
}

- (NSDictionary *)materializeURL:(NSURL *)source options:(NSDictionary *)options {
  if (source == nil) return nil;
  NSString *extension = source.pathExtension.length > 0 ? source.pathExtension : @"bin";
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"lynxship-%@.%@", NSUUID.UUID.UUIDString, extension]];
  if (![[NSFileManager defaultManager] copyItemAtURL:source toURL:[NSURL fileURLWithPath:path] error:nil]) return nil;
  NSString *lower = extension.lowercaseString;
  NSString *mediaType = ([lower isEqualToString:@"mp4"] || [lower isEqualToString:@"mov"] || [lower isEqualToString:@"m4v"]) ? @"video" : @"image";
  return [self fileDescriptor:path mediaType:mediaType mimeType:[self mimeForExtension:lower] options:options];
}

- (NSDictionary *)materializeImage:(UIImage *)image options:(NSDictionary *)options {
  if (image == nil) return nil;
  NSNumber *quality = options[@"compressQuality"] ?: @100;
  CGFloat normalizedQuality = MAX(0, MIN(1, quality.doubleValue / 100.0));
  NSData *data = UIImageJPEGRepresentation(image, normalizedQuality);
  if (data == nil) return nil;
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"lynxship-%@.jpg", NSUUID.UUID.UUIDString]];
  if (![data writeToFile:path atomically:YES]) return nil;
  return [self fileDescriptor:path mediaType:@"image" mimeType:@"image/jpeg" options:options];
}

- (NSDictionary *)fileDescriptor:(NSString *)path mediaType:(NSString *)mediaType mimeType:(NSString *)mimeType options:(NSDictionary *)options {
  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
  unsigned long long size = [attributes[NSFileSize] unsignedLongLongValue];
  if (size > 100ULL * 1024ULL * 1024ULL) return nil;
  NSMutableDictionary *file = [@{ @"tempFilePath": [NSURL fileURLWithPath:path].absoluteString, @"tempFileAbsolutePath": path, @"size": @(size), @"mediaType": mediaType, @"mimeType": mimeType } mutableCopy];
  if ([options[@"needBase64Data"] boolValue]) {
    if (size > 16ULL * 1024ULL * 1024ULL) return nil;
    NSData *data = [NSData dataWithContentsOfFile:path];
    file[@"base64Data"] = [data base64EncodedStringWithOptions:0];
  }
  return file;
}

- (void)saveFileToPhotoAlbum:(NSDictionary *)file completion:(void (^)(BOOL saved))completion {
  NSString *path = file[@"tempFileAbsolutePath"];
  NSString *mediaType = file[@"mediaType"];
  if (path.length == 0 || mediaType.length == 0) { completion(NO); return; }
  void (^save)(void) = ^{
    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
      if ([mediaType isEqualToString:@"video"]) {
        [PHAssetChangeRequest creationRequestForAssetFromVideoAtFileURL:[NSURL fileURLWithPath:path]];
      } else {
        UIImage *image = [UIImage imageWithContentsOfFile:path];
        if (image != nil) [PHAssetChangeRequest creationRequestForAssetFromImage:image];
      }
    } completionHandler:^(BOOL success, NSError *error) {
      dispatch_async(dispatch_get_main_queue(), ^{ completion(success && error == nil); });
    }];
  };
  if (@available(iOS 14.0, *)) {
    PHAuthorizationStatus status = [PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelAddOnly];
    if (status == PHAuthorizationStatusAuthorized || status == PHAuthorizationStatusLimited) { save(); return; }
    if (status == PHAuthorizationStatusNotDetermined) {
      [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelAddOnly handler:^(PHAuthorizationStatus updated) {
        dispatch_async(dispatch_get_main_queue(), ^{ if (updated == PHAuthorizationStatusAuthorized || updated == PHAuthorizationStatusLimited) save(); else completion(NO); });
      }];
      return;
    }
    completion(NO);
    return;
  }
  [PHPhotoLibrary requestAuthorization:^(PHAuthorizationStatus status) {
    dispatch_async(dispatch_get_main_queue(), ^{ status == PHAuthorizationStatusAuthorized ? save() : completion(NO); });
  }];
}

- (NSString *)mimeForExtension:(NSString *)extension {
  if ([extension isEqualToString:@"mov"]) return @"video/quicktime";
  if ([extension isEqualToString:@"mp4"] || [extension isEqualToString:@"m4v"]) return @"video/mp4";
  if ([extension isEqualToString:@"png"]) return @"image/png";
  return @"image/jpeg";
}

- (void)completeSelection:(NSArray *)files {
  void (^callback)(NSString *) = self.pendingSelectionCallback;
  self.pendingSelectionCallback = nil;
  self.pendingSelectionOptions = nil;
  self.libraryPicker = nil;
  self.cameraPicker = nil;
  if (callback == nil) return;
  if (files.count == 0) { callback([self errorResult:@"No media item was selected."]); return; }
  callback([self JSONString:@{ @"code": @1, @"data": @{ @"tempFiles": files } }]);
}

- (void)completeSelectionWithError:(NSString *)message {
  void (^callback)(NSString *) = self.pendingSelectionCallback;
  self.pendingSelectionCallback = nil;
  self.pendingSelectionOptions = nil;
  self.libraryPicker = nil;
  self.cameraPicker = nil;
  if (callback != nil) callback([self errorResult:message ?: @"Media selection was cancelled."]);
}

- (NSString *)JSONString:(NSDictionary *)value {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data == nil ? @"{\"code\":0,\"msg\":\"Media operation failed.\"}" : [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (NSString *)errorResult:(NSString *)message { return [self JSONString:@{ @"code": @0, @"msg": message ?: @"Media operation failed." }]; }

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
