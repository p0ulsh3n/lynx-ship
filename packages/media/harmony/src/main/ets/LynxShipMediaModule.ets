import { LynxContext, LynxModule } from '@lynx/lynx';
import { BusinessError } from '@kit.BasicServicesKit';
import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { camera, cameraPicker } from '@kit.CameraKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { media } from '@kit.MediaKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';

type UriCallback = (uri: string) => void;

/**
 * HarmonyOS system-picker bridge.
 *
 * PhotoViewPicker and CameraPicker are deliberately used instead of broad
 * media-library access. The system controls consent and returns a URI scoped
 * to the item selected or captured by the user. Audio recording uses a
 * separate foreground recorder lifecycle and app-private cache file.
 */
export class LynxShipMediaModule extends LynxModule {
  private recorder: media.AVRecorder | undefined = undefined;
  private recordingFileDescriptor: number | undefined = undefined;
  private recordingPath: string = '';
  private operationInFlight: boolean = false;

  constructor(context: LynxContext, param?: Object) {
    super(context, param);
  }

  public getCapabilities(callback: (capabilities: string) => void): void {
    callback('{"pickPhoto":true,"pickVideo":true,"capturePhoto":true,"recordAudio":true}');
  }

  public requestAccess(kind: string, callback: (granted: boolean) => void): void {
    if (kind === 'photo-library' || kind === 'video-library') {
      callback(true);
      return;
    }
    if (kind !== 'camera' && kind !== 'microphone') {
      callback(false);
      return;
    }
    const permission: Permissions = kind === 'camera'
      ? 'ohos.permission.CAMERA'
      : 'ohos.permission.MICROPHONE';
    try {
      const context = this.getAbilityContext();
      const access = abilityAccessCtrl.createAtManager();
      const current = access.checkAccessTokenSync(context.applicationInfo.accessTokenId, permission);
      if (current === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
        callback(true);
        return;
      }
      access.requestPermissionsFromUser(context, [permission], 0, (error, result) => {
        if (error || !result) {
          callback(false);
          return;
        }
        callback(result.authResults.length > 0 && result.authResults[0] === 0);
      });
    } catch (_error) {
      callback(false);
    }
  }

  public pick(kind: string, callback: UriCallback): void {
    if (kind !== 'photo-library' && kind !== 'video-library') {
      callback('');
      return;
    }
    try {
      const options = new photoAccessHelper.PhotoSelectOptions();
      options.MIMEType = kind === 'video-library'
        ? photoAccessHelper.PhotoViewMIMETypes.VIDEO_TYPE
        : photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
      options.maxSelectNumber = 1;
      const picker = new photoAccessHelper.PhotoViewPicker();
      picker.select(options)
        .then((result: photoAccessHelper.PhotoSelectResult) =>
          callback(result.photoUris.length > 0 ? result.photoUris[0] : ''))
        .catch((_error: BusinessError) => callback(''));
    } catch (_error) {
      callback('');
    }
  }

  public capture(kind: string, callback: UriCallback): void {
    if (kind !== 'camera') {
      callback('');
      return;
    }
    try {
      const profile: cameraPicker.PickerProfile = {
        cameraPosition: camera.CameraPosition.CAMERA_POSITION_BACK,
      };
      cameraPicker
        .pick(getContext(), [cameraPicker.PickerMediaType.PHOTO], profile)
        .then((result: cameraPicker.PickerResult) =>
          callback(result.resultCode === 0 ? result.resultUri : ''))
        .catch((_error: BusinessError) => callback(''));
    } catch (_error) {
      callback('');
    }
  }

  public startRecording(callback: (started: boolean) => void): void {
    if (this.operationInFlight || this.recorder !== undefined) {
      callback(false);
      return;
    }
    this.operationInFlight = true;
    this.startRecordingInternal(callback);
  }

  public stopRecording(callback: UriCallback): void {
    if (this.operationInFlight || this.recorder === undefined || this.recordingFileDescriptor === undefined) {
      callback('');
      return;
    }
    this.operationInFlight = true;
    this.stopRecordingInternal(callback);
  }

  private async startRecordingInternal(callback: (started: boolean) => void): Promise<void> {
    let fileDescriptor: number | undefined;
    let path = '';
    let recorder: media.AVRecorder | undefined;
    try {
      const context = this.getAbilityContext();
      path = `${context.cacheDir}/lynxship-recording-${Date.now()}.m4a`;
      const file = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
      fileDescriptor = file.fd;
      recorder = await media.createAVRecorder();
      recorder.on('error', (_error: BusinessError) => {
        console.error('LynxShip audio recorder error');
        if (this.recorder === recorder) {
          void this.abortRecordingAfterError(recorder, fileDescriptor, path);
        }
      });
      await recorder.prepare({
        audioSourceType: media.AudioSourceType.AUDIO_SOURCE_TYPE_MIC,
        profile: {
          audioBitrate: 128000,
          audioChannels: 1,
          audioCodec: media.CodecMimeType.AUDIO_AAC,
          audioSampleRate: 44100,
          fileFormat: media.ContainerFormatType.CFT_MPEG_4A,
        },
        url: `fd://${fileDescriptor.toString()}`,
      });
      await recorder.start();
      this.recordingFileDescriptor = fileDescriptor;
      this.recordingPath = path;
      this.recorder = recorder;
      callback(true);
    } catch (_error) {
      if (recorder !== undefined) {
        try { await recorder.release(); } catch (_releaseError) { /* cleanup is best effort */ }
      }
      if (fileDescriptor !== undefined) {
        try { fileIo.closeSync(fileDescriptor); } catch (_closeError) { /* already closed */ }
      }
      if (path.length > 0) {
        try { fileIo.unlinkSync(path); } catch (_unlinkError) { /* file may not exist */ }
      }
      callback(false);
    } finally {
      this.operationInFlight = false;
    }
  }

  private async stopRecordingInternal(callback: UriCallback): Promise<void> {
    const recorder = this.recorder;
    const fileDescriptor = this.recordingFileDescriptor;
    const path = this.recordingPath;
    this.recorder = undefined;
    this.recordingFileDescriptor = undefined;
    this.recordingPath = '';
    try {
      if (recorder !== undefined && (recorder.state === 'started' || recorder.state === 'paused')) {
        await recorder.stop();
      }
      if (recorder !== undefined) await recorder.release();
      if (fileDescriptor !== undefined) fileIo.closeSync(fileDescriptor);
      callback(path.length > 0 ? fileUri.getUriFromPath(path) : '');
    } catch (_error) {
      if (fileDescriptor !== undefined) {
        try { fileIo.closeSync(fileDescriptor); } catch (_closeError) { /* already closed */ }
      }
      if (path.length > 0) {
        try { fileIo.unlinkSync(path); } catch (_unlinkError) { /* file may not exist */ }
      }
      callback('');
    } finally {
      this.operationInFlight = false;
    }
  }

  private async abortRecordingAfterError(
    recorder: media.AVRecorder,
    fileDescriptor: number,
    path: string,
  ): Promise<void> {
    this.recorder = undefined;
    this.recordingFileDescriptor = undefined;
    this.recordingPath = '';
    try { await recorder.release(); } catch (_releaseError) { /* cleanup is best effort */ }
    try { fileIo.closeSync(fileDescriptor); } catch (_closeError) { /* already closed */ }
    try { fileIo.unlinkSync(path); } catch (_unlinkError) { /* file may not exist */ }
  }

  private getAbilityContext(): common.UIAbilityContext {
    return getContext() as common.UIAbilityContext;
  }
}
