#import "LynxShipAudioRecorder.h"

#import <AVFoundation/AVFoundation.h>

@interface LynxShipAudioRecorder () <AVAudioRecorderDelegate>
@property(nonatomic, strong) AVAudioRecorder *recorder;
@property(nonatomic, strong) NSURL *outputURL;
@property(nonatomic, copy) LynxShipAudioRecorderStopCallback pendingStop;
@property(nonatomic, assign) BOOL discardNextStop;
@end

@implementation LynxShipAudioRecorder

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(audioSessionInterrupted:)
                                                 name:AVAudioSessionInterruptionNotification
                                               object:[AVAudioSession sharedInstance]];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)start:(LynxShipAudioRecorderStartCallback)callback {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.recorder != nil) {
      callback(NO);
      return;
    }

    void (^startAfterPermission)(BOOL) = ^(BOOL granted) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (!granted || self.recorder != nil) {
          callback(NO);
          return;
        }
        NSError *error = nil;
        AVAudioSession *session = [AVAudioSession sharedInstance];
        if (![session setCategory:AVAudioSessionCategoryRecord
                              mode:AVAudioSessionModeDefault
                           options:0
                             error:&error] ||
            ![session setActive:YES error:&error]) {
          callback(NO);
          return;
        }

        NSString *name = [NSString stringWithFormat:@"lynxship-%@.m4a", NSUUID.UUID.UUIDString];
        NSURL *url = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:name]];
        NSDictionary *settings = @{
          AVFormatIDKey: @(kAudioFormatMPEG4AAC),
          AVSampleRateKey: @44100,
          AVNumberOfChannelsKey: @1,
          AVEncoderAudioQualityKey: @(AVAudioQualityHigh),
        };
        AVAudioRecorder *recorder = [[AVAudioRecorder alloc] initWithURL:url settings:settings error:&error];
        recorder.delegate = self;
        if (error != nil || ![recorder prepareToRecord] || ![recorder record]) {
          [session setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
          [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
          callback(NO);
          return;
        }
        self.recorder = recorder;
        self.outputURL = url;
        callback(YES);
      });
    };

    if (@available(iOS 17.0, *)) {
      [AVAudioApplication requestRecordPermissionWithCompletionHandler:startAfterPermission];
    } else {
      [[AVAudioSession sharedInstance] requestRecordPermission:startAfterPermission];
    }
  });
}

- (void)stop:(LynxShipAudioRecorderStopCallback)callback {
  dispatch_async(dispatch_get_main_queue(), ^{
    AVAudioRecorder *recorder = self.recorder;
    NSURL *url = self.outputURL;
    if (recorder == nil || url == nil || !recorder.isRecording) {
      callback(@"");
      return;
    }
    self.pendingStop = callback;
    [recorder stop];
    // AVAudioRecorderDelegate is the single completion path. This avoids
    // returning a URI before the encoder has finished flushing the file.
  });
}

- (void)cancel {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.discardNextStop = YES;
    [self.recorder stop];
    [self finishStop:NO];
  });
}

- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)flag {
  [self finishStop:flag];
}

- (void)audioRecorderEncodeErrorDidOccur:(AVAudioRecorder *)recorder error:(NSError *)error {
  [self finishStop:NO];
}

- (void)audioSessionInterrupted:(NSNotification *)notification {
  NSNumber *type = notification.userInfo[AVAudioSessionInterruptionTypeKey];
  if (type.unsignedIntegerValue != AVAudioSessionInterruptionTypeBegan) return;
  AVAudioRecorder *recorder = self.recorder;
  if (recorder == nil || !recorder.isRecording) return;
  self.discardNextStop = YES;
  [recorder stop];
  // Apple does not guarantee the normal finish delegate callback for an
  // interruption. Finish explicitly as well as through the delegate path;
  // the nil recorder guard makes a synchronous or later delegate callback
  // harmless and the flag prevents a partial file from being returned.
  [self finishStop:NO];
}

- (void)finishStop:(BOOL)success {
  LynxShipAudioRecorderStopCallback callback = self.pendingStop;
  self.pendingStop = nil;
  success = success && !self.discardNextStop;
  self.discardNextStop = NO;
  NSURL *url = self.outputURL;
  self.recorder.delegate = nil;
  self.recorder = nil;
  self.outputURL = nil;
  [[AVAudioSession sharedInstance] setActive:NO
                                 withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                       error:nil];

  NSString *value = @"";
  if (success && url != nil) {
    NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:url.path error:nil];
    if ([attributes[NSFileSize] unsignedLongLongValue] > 0) value = url.absoluteString;
  }
  if (value.length == 0 && url != nil) [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
  if (callback != nil) callback(value);
}

@end
