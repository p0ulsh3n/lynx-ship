#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^LynxShipAudioRecorderStartCallback)(BOOL started);
typedef void (^LynxShipAudioRecorderStopCallback)(NSString *uri);

/** Owns one AVAudioRecorder session and returns an app-private file URI. */
@interface LynxShipAudioRecorder : NSObject
- (void)start:(LynxShipAudioRecorderStartCallback)callback;
- (void)stop:(LynxShipAudioRecorderStopCallback)callback;
- (void)cancel;
@end

NS_ASSUME_NONNULL_END
