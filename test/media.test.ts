import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createLynxMediaClient,
  createMediaClient,
  validateMediaDataURLRequest,
  validateMediaFileRequest,
  validateMediaSelectionOptions,
  validateMediaSelectionResult,
  validateMediaDownloadResult,
  validateMediaUploadResult,
  validateMediaTransferURL,
  type MediaAdapter,
} from "@lynxship/media";

test("media client exposes only declared host capabilities", async () => {
  const adapter: MediaAdapter = {
    has: (kind, capability) => kind === "camera" && capability === "enumerate",
    requestAccess: async () => true,
    listDevices: async () => [{ id: "front", kind: "camera", facing: "front" }],
  };
  const client = createMediaClient(adapter);
  assert.equal(client.has("camera", "enumerate"), true);
  assert.deepEqual(await client.listDevices(), [
    { id: "front", kind: "camera", facing: "front" },
  ]);
  await assert.rejects(
    () => client.capture({ kind: "camera" }),
    /does not support/,
  );
});

test("media transfer helpers validate secure URLs, bounded files and data URLs", () => {
  assert.equal(
    validateMediaTransferURL("https://cdn.example.test/upload"),
    "https://cdn.example.test/upload",
  );
  assert.equal(
    validateMediaTransferURL("http://127.0.0.1:3000/upload"),
    "http://127.0.0.1:3000/upload",
  );
  assert.throws(
    () => validateMediaTransferURL("https://user:pass@example.test/upload"),
    /credentials/,
  );
  assert.throws(
    () =>
      validateMediaFileRequest({
        fileUri: "/private/photo.jpg",
        url: "https://cdn.example.test/upload",
      }),
    /app-scoped/,
  );
  assert.deepEqual(
    validateMediaFileRequest({
      fileUri: "file:///private/photo.jpg",
      url: "https://cdn.example.test/upload",
      headers: { Authorization: "Bearer token" },
    }).headers,
    { Authorization: "Bearer token" },
  );
  const sparklingRequest = validateMediaFileRequest({
    filePath: "file:///private/photo.jpg",
    url: "https://cdn.example.test/upload",
    header: { Authorization: "Bearer token" },
    timeoutInterval: 5,
  });
  assert.equal(sparklingRequest.fileUri, "file:///private/photo.jpg");
  assert.equal(sparklingRequest.timeoutMs, 5000);
  assert.deepEqual(sparklingRequest.header, { Authorization: "Bearer token" });
  assert.throws(
    () =>
      validateMediaDataURLRequest({
        dataURL: "data:text/plain;base64,aGVsbG8=",
        filename: "../unsafe",
        extension: "txt",
      }),
    /filename or extension/,
  );
});

test("media transfer methods remain explicit when the host has no transport", async () => {
  const client = createMediaClient({
    has: () => false,
    requestAccess: async () => false,
  });
  await assert.rejects(
    () =>
      client.uploadFile({
        fileUri: "file:///tmp/photo.jpg",
        url: "https://cdn.example.test/upload",
      }),
    /did not provide media uploadFile/,
  );
});

test("media transfer results are canonicalized and reject unsafe host data", () => {
  assert.deepEqual(
    validateMediaDownloadResult({
      status: 200,
      filePath: "file:///cache/photo.jpg",
      bytes: 12,
      header: { "content-type": "image/jpeg" },
    }),
    {
      status: 200,
      fileUri: "file:///cache/photo.jpg",
      filePath: "file:///cache/photo.jpg",
      bytes: 12,
      header: { "content-type": "image/jpeg" },
    },
  );
  assert.deepEqual(
    validateMediaUploadResult({
      status: 201,
      url: "https://cdn.example.test/photo.jpg",
      response: { id: "photo" },
    }),
    {
      status: 201,
      url: "https://cdn.example.test/photo.jpg",
      response: { id: "photo" },
    },
  );
  assert.throws(
    () =>
      validateMediaDownloadResult({
        status: 200,
        filePath: "/tmp/photo.jpg",
        bytes: 1,
      }),
    /app-scoped/,
  );
  assert.throws(
    () =>
      validateMediaUploadResult({
        status: 200,
        url: "http://cdn.example.test/photo.jpg",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateMediaDownloadResult(
        {
          status: 200,
          fileUri: "file:///cache/photo.jpg",
          bytes: 101,
        },
        100,
      ),
    /between 0 and 100/,
  );
});

test("unified media selection matches the public album/camera contract", async () => {
  const requests: unknown[] = [];
  const client = createMediaClient({
    has: () => false,
    requestAccess: async () => true,
    chooseMedia: async (options) => {
      requests.push(options);
      return {
        tempFiles: [
          {
            tempFilePath: "photo.jpg",
            tempFileAbsolutePath: "file:///private/photo.jpg",
            size: 42,
            mediaType: "image",
            mimeType: "image/jpeg",
          },
        ],
      };
    },
  });
  const result = await client.chooseMedia({
    mediaTypes: ["image"],
    sourceType: "album",
    maxCount: 3,
    compressImage: true,
    compressQuality: 80,
  });
  assert.equal(result.tempFiles[0]?.mimeType, "image/jpeg");
  assert.deepEqual(requests[0], {
    mediaTypes: ["image"],
    sourceType: "album",
    maxCount: 3,
    compressImage: true,
    saveToPhotoAlbum: false,
    needBase64Data: false,
    compressOption: 0,
    compressWidth: 0,
    compressHeight: 0,
    compressQuality: 80,
  });
});

test("unified media selection rejects unsafe or contradictory requests/results", () => {
  assert.throws(
    () =>
      validateMediaSelectionOptions({
        mediaTypes: ["image"],
        sourceType: "camera",
        cameraType: "front",
        maxCount: 2,
      }),
    /exactly one/,
  );
  assert.throws(
    () =>
      validateMediaSelectionOptions({
        mediaTypes: ["image"],
        sourceType: "album",
        cameraType: "front",
      }),
    /only valid/,
  );
  assert.throws(
    () =>
      validateMediaSelectionResult({
        tempFiles: [
          {
            tempFilePath: "photo.jpg",
            tempFileAbsolutePath: "file:///private/photo.jpg",
            size: 1,
            mediaType: "image",
            mimeType: "image/jpeg",
            base64Data: "x".repeat(140 * 1024 * 1024 + 1),
          },
        ],
      }),
    /too large/,
  );
});

test("native media bridges keep picker and capability boundaries explicit", () => {
  const android = readFileSync(
    resolve(
      "packages/media/android/src/main/java/com/lynxship/media/LynxShipMediaActivity.java",
    ),
    "utf8",
  );
  const androidModule = readFileSync(
    resolve(
      "packages/media/android/src/main/java/com/lynxship/media/LynxShipMediaModule.java",
    ),
    "utf8",
  );
  const androidRecorder = readFileSync(
    resolve(
      "packages/media/android/src/main/java/com/lynxship/media/LynxShipAudioRecorder.java",
    ),
    "utf8",
  );
  const ios = readFileSync(
    resolve("packages/media/ios/LynxShipMediaModule.m"),
    "utf8",
  );
  const iosRecorder = readFileSync(
    resolve("packages/media/ios/LynxShipAudioRecorder.m"),
    "utf8",
  );
  const harmony = readFileSync(
    resolve("packages/media/harmony/src/main/ets/LynxShipMediaModule.ets"),
    "utf8",
  );
  assert.match(android, /FLAG_GRANT_PERSISTABLE_URI_PERMISSION/);
  assert.match(android, /ACTION_OPEN_DOCUMENT/);
  assert.match(android, /FileProvider\.getUriForFile/);
  assert.match(android, /createChooseIntent/);
  assert.match(android, /MAX_FILE_BYTES/);
  assert.match(android, /IS_PENDING/);
  assert.match(android, /saveToAlbum/);
  assert.match(android, /private boolean completed/);
  assert.match(androidRecorder, /FileProvider\.getUriForFile/);
  assert.doesNotMatch(androidRecorder, /Uri\.fromFile/);
  assert.match(ios, /PHPickerViewController/);
  assert.match(ios, /chooseMedia/);
  assert.match(ios, /completeSelection/);
  assert.match(ios, /PHAccessLevelAddOnly/);
  assert.match(ios, /performChanges/);
  assert.match(androidModule, /startRecording/);
  assert.match(androidRecorder, /MediaRecorder/);
  assert.match(ios, /AVAudioApplication/);
  assert.match(iosRecorder, /AVAudioSessionInterruptionNotification/);
  assert.match(iosRecorder, /finishStop:NO/);
  assert.match(ios, /recordAudio\\\":true/);
  assert.match(harmony, /createAVRecorder/);
  assert.match(harmony, /abortRecordingAfterError/);
  assert.match(harmony, /ohos\.permission\.MICROPHONE/);
});

test("pure Lynx media adapter discovers native capabilities and delegates access", async () => {
  const calls: string[] = [];
  const client = createLynxMediaClient({
    getCapabilities(callback) {
      callback(
        '{"pickPhoto":true,"pickVideo":false,"capturePhoto":true,"recordAudio":false}',
      );
    },
    requestAccess(kind, callback) {
      calls.push(kind);
      callback(kind === "camera");
    },
    pick(_kind, callback) {
      callback("file:///photo.jpg");
    },
    capture(_kind, callback) {
      callback("file:///capture.jpg");
    },
  });
  assert.equal(client.has("photo-library", "pick"), true);
  assert.equal(client.has("video-library", "pick"), false);
  assert.equal(await client.requestAccess("camera"), true);
  assert.equal(await client.capture({ kind: "camera" }), "file:///capture.jpg");
  assert.deepEqual(calls, ["camera"]);
});

test("pure Lynx media adapter never invokes unsupported native operations", async () => {
  let invoked = false;
  const client = createLynxMediaClient({
    getCapabilities(callback) {
      callback(
        '{"pickPhoto":false,"pickVideo":false,"capturePhoto":false,"recordAudio":false}',
      );
    },
    requestAccess(_kind, callback) {
      callback(false);
    },
    pick(_kind, callback) {
      invoked = true;
      callback("file:///unexpected.jpg");
    },
    capture(_kind, callback) {
      invoked = true;
      callback("file:///unexpected.jpg");
    },
  });
  await assert.rejects(
    () => client.capture({ kind: "camera" }),
    /does not support/,
  );
  await assert.rejects(
    () => client.pick({ kind: "photo-library" }),
    /does not support/,
  );
  await assert.rejects(() => client.listDevices(), /does not support/);
  assert.equal(invoked, false);
});

test("media recording uses an explicit start/stop lifecycle", async () => {
  const calls: string[] = [];
  const client = createMediaClient({
    has: (_kind, capability) => capability === "capture",
    requestAccess: async () => true,
    startRecording: async () => {
      calls.push("start");
    },
    stopRecording: async () => {
      calls.push("stop");
      return "file:///recording.m4a";
    },
  });
  await client.startRecording();
  assert.equal(await client.stopRecording(), "file:///recording.m4a");
  assert.deepEqual(calls, ["start", "stop"]);
});
