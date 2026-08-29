import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createLynxMediaClient,
  createMediaClient,
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
  assert.match(android, /private boolean completed/);
  assert.match(androidRecorder, /FileProvider\.getUriForFile/);
  assert.doesNotMatch(androidRecorder, /Uri\.fromFile/);
  assert.match(ios, /PHPickerViewController/);
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
