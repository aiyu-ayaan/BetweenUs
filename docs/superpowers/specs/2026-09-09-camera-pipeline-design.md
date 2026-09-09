# Camera Settings, Quality & Effects Pipeline Design Specification

**Date:** 2026-09-09
**Status:** Approved by User
**Target:** Desktop/Web client (`apps/desktop/src`, mounted by `apps/web`) and Android client (`apps/android`)
**Scope:** Phase 1 (camera settings & encoding) and Phase 2 (effects processing stage). Phase 3 (filters & portrait) is specified only as the consumer Phase 2 must satisfy; it gets its own spec.

---

## 1. Objective & Background

BetweenUs gives the microphone and the screen share a full quality treatment and gives the camera none.

**The microphone** has `apps/desktop/src/services/voice-quality.ts` (constraints, Opus encoding, modes), `apps/desktop/src/services/audio-devices.ts` (enumeration, stale-device fallback, capture), a device picker inside the call (`apps/desktop/src/features/voice/DevicePicker.tsx`), and a settings section. Android mirrors this with `AudioPrefs.kt` and `CallDeviceSheet.kt`.

**The screen share** has `apps/desktop/src/services/share-quality.ts` — capture sizing, pixel-scaled bitrate, frame rate, codec preference, degradation preference, and SDP bandwidth patching — applied through `mesh.setSharePublish` and `mesh.preferShareCodec`. Android mirrors this with `ShareQuality.kt`.

**The camera** has neither. On desktop/web it is one line:

```ts
// apps/desktop/src/stores/voice.ts:569
const stream = await navigator.mediaDevices.getUserMedia({ video: true });
```

No device choice, no resolution, no frame rate, no sender encoding parameters, no codec preference. Whatever the browser guesses is what every peer receives — typically a conservative default well below what the hardware and the link can carry. On Android the camera is slightly better served but still fixed: `VoiceEngine.startCamera` (`VoiceEngine.kt:1083`) takes the first front- or back-facing device the enumerator lists, asks for 1080p30, and publishes at a flat `ShareQuality.CAMERA_BITRATE` of 5 Mbps regardless of the resolution actually negotiated.

Consequently there is no way for a user to choose which camera is used, no way to influence quality, and the sent picture is worse than the hardware allows.

### 1.1 Goals

1. **Camera device selection** on every client, in the same two places the microphone offers it: inside the call, and in settings.
2. **Deliberate camera capture and encoding**, derived from resolution the way the screen share's is, replacing both the browser's guess and Android's flat ceiling.
3. **A processing stage between capture and sender** on both platforms, so that colour filters and portrait blur (Phase 3) have a seam to attach to and are not a rewrite of the capture path.

### 1.2 Non-Goals

* Phase 3 itself: no filter set, no segmentation, no ML dependency lands in this spec's implementation. Phase 2 ships the pipeline with an identity transform.
* Simulcast or SVC for the camera slot. The mesh publishes one encoding per slot today; changing that is a separate concern affecting every slot.
* Any change to screen share or microphone behaviour beyond widening shared helpers (§2.4).

### 1.3 Corrected Premises

Two assumptions in the original request do not survive contact with the code, and the design reflects the corrections:

* **There is no separate web camera stack, and Python cannot participate.** `apps/web/src/main.tsx` mounts `apps/desktop/src/App` — the web client *is* the desktop React application under a different runtime. A browser tab has no Python runtime, and `getUserMedia` is not reachable from Pyodide. Web and desktop therefore receive one TypeScript implementation.
* **Native portrait/bokeh is not reachable on either platform.** On Android the app captures through WebRTC's `Camera2Enumerator.createCapturer`, which builds its own `CameraCaptureSession`; native bokeh lives on `CameraExtensionSession`, a different object, and no `androidx.camera` dependency exists in the Gradle files. On web the `backgroundBlur` track constraint is tied to platform video effects available on ChromeOS and a narrow slice of Windows builds, reporting unsupported on most target machines. Colour filters were never native on either platform. Portrait and filters therefore both require the Phase 2 processing stage; this is why Phase 2 exists and why it precedes them.

---

## 2. Phase 1 — Camera Settings & Encoding

### 2.1 `camera-quality.ts` (new, desktop/web)

A new pure module `apps/desktop/src/services/camera-quality.ts` with a companion `camera-quality.check.ts`, modelled directly on `share-quality.ts` and deliberately its sibling rather than an extension of it — a camera and a screen want opposite trade-offs, and the existing file says so at length.

**Types**

* `CameraQuality = 'auto' | '360p' | '720p' | '1080p'` — what the user picks. `auto` resolves against the device's own capabilities.
* `CameraSize { width, height }` — reuses the shape `ShareSize` uses.
* `CameraCapture` — the `getUserMedia({ video })` half: `deviceId`, `width`, `height`, `frameRate`.
* `CameraPublish` — the sender half: `maxBitrate`, `maxFramerate`, `scaleResolutionDownBy`, `degradationPreference`, `videoCodec`, `contentHint`.

**Functions**

* `cameraBitrateFor(size: CameraSize): number` — pixel-scaled against a 1080p reference, the same method `bitrateFor` uses for the screen. A camera has fewer pixels than a screen and nothing on it to read, so the reference is lower than the screen's 20 Mbps: **4 Mbps at 1080p30**, scaling by pixel count, clamped to a 600 kbps floor and an 8 Mbps ceiling. That puts 720p near 1.8 Mbps and 360p near 450 kbps (floored to 600 kbps). The point is that it tracks resolution rather than being the constant 5 Mbps Android currently sends at every size.
* `cameraOptions(quality, override, deviceId): { capture: CameraCapture; publish: CameraPublish }` — the single entry point, mirroring `shareOptions`.

**Fixed choices, and why**

* `contentHint = 'motion'`. A face is motion, not text.
* `degradationPreference = 'balanced'`. The screen share deliberately uses `maintain-resolution` because text must stay readable and frames are the right sacrifice. A camera is the opposite trade: a dropped frame on a face is nearly invisible and a soft face is not, so resolution and frame rate are both allowed to give.
* `scaleResolutionDownBy = 1` — send what was captured; congestion control still shrinks it when the link says so.

**Reused, not duplicated:** `QualityOverride`, `NO_OVERRIDE`, `BITRATE_RANGE`, `FRAME_RATES`, `CodecChoice` and `sortPreferredVideoCodecs` are imported from `share-quality.ts`. They are not screen-specific and a second copy would drift.

### 2.2 Settings storage (desktop/web)

`apps/desktop/src/stores/audioSettings.ts` gains a `camera` block alongside the existing `share` block, persisted by the same mechanism:

```ts
camera: {
  deviceId: string | null;   // null = system default
  quality: CameraQuality;
  frameRate: number | null;  // null = the preset's own
  maxBitrate: number | null; // null = derived from resolution
  videoCodec: CodecChoice;
  mirror: boolean;           // local preview only; never affects what is sent
}
```

`null` means "decide for me" throughout, matching how `share` and the device fields already read.

### 2.3 Capture (desktop/web)

`toggleCamera` in `apps/desktop/src/stores/voice.ts` builds constraints from `cameraOptions` instead of passing `video: true`, then:

1. Requests the capture through a new `openVideoCapture` (§2.4).
2. Reads `track.getSettings()` for the resolution actually granted and recomputes `publish` from it — the same correction the screen share already performs after `getDisplayMedia`, because asking for 1080p and receiving 720p otherwise means publishing a 720p picture at a 1080p bitrate.
3. Applies `contentHint`, hands the publish parameters to the mesh (§2.5), and sets the track.

**Error handling.** `OverconstrainedError` retries once without the resolution constraints, keeping the device; a device-gone error retries without the `deviceId`, keeping the resolution. Both preserve the user's remaining intent instead of collapsing to `video: true`, and a second failure is reported rather than retried.

### 2.4 Widening the device helpers (desktop/web)

`audio-devices.ts` already enumerates every device kind — `realDevices` filters on the empty-id placeholder, and `chosenIsMissing` and `captureIsStale` already take a `MediaDeviceKind` parameter. Only `openAudioCapture` is audio-shaped, and only by its constraint key.

The change is therefore small and belongs at the shared helper rather than in a video twin:

* Add `openVideoCapture(constraints: MediaTrackConstraints)` beside `openAudioCapture`, sharing the same `deviceIsGone` fallback.
* Reuse `chosenIsMissing(devices, 'videoinput', deviceId)` and `captureIsStale(...)` unchanged for the camera, including in the `unpinDevices` path so `followSystemDevices` covers a camera that is unplugged exactly as it covers a headset.

The module's own doc comment is updated to say it serves both kinds. No behaviour change for existing audio callers.

### 2.5 Mesh (desktop/web)

`apps/desktop/src/services/mesh.ts` gains, mirroring the screen path exactly:

* `PeerLink.setCameraPublish(publish: CameraPublish | null)` and a `cameraPublish` field, applied wherever `sharePublish` is applied today — on renegotiation (around `mesh.ts:665`) and on adopt (around `mesh.ts:1771`).
* `PeerLink.preferCameraCodec(codec)`, the `'camera'`-slot analogue of `preferShareCodec`.
* `Mesh.setCameraPublish(...)`, fanning out across links exactly as `Mesh.setSharePublish` does.

`PeerLink.tune` is already public and slot-generic and needs no change. `patchVideoBandwidth` currently patches against `sharePublish`; it is extended to patch the camera's `m=` section from `cameraPublish` rather than leaving it on the 50 Mbps default. This is the SDP half of the ceiling and without it the sender parameters are only half applied.

### 2.6 UI (desktop/web)

* **`apps/desktop/src/features/voice/DevicePicker.tsx`** gains a third `DeviceSelect` for `videoinput`, above the existing two. The closing note is updated to mention camera quality's location.
* **`VoiceSection` in `apps/desktop/src/features/settings/UserSettings.tsx`** gains a "Camera quality" block placed beside the existing "Screen share quality" block, following its established shape: camera device select, quality preset select, frame rate select, a manual-bitrate toggle with slider, a codec select, and a mirror toggle. Copy explains that the defaults are derived and the overrides are for when they are wrong.

### 2.7 Android

* **`ShareQuality.kt`** — `cameraBitrate()` takes a size and scales against the same 1080p reference the screen bitrate uses, replacing the flat `CAMERA_BITRATE` constant. Camera resolution presets are added, matching the desktop's four names so a support conversation about "720p" means one thing on both clients.
* **`VoiceEngine.startCamera`** (`VoiceEngine.kt:1083`) takes a device name and a size from preferences rather than the first front- or back-facing device at a hard-coded 1920×1080. `switchCamera` maps front/back onto device names so flipping continues to work and continues to be the primary control.
* **`AudioPrefs.kt`** gains the camera device id, quality preset and frame rate.
* **`CallDeviceSheet.kt`** gains a camera section listing the enumerator's devices, alongside the existing audio rows.
* `VoiceEngine.tune` already handles `Slot.CAMERA`; it is fed the size-derived numbers.

---

## 3. Phase 2 — The Effects Processing Stage

Phase 2 is user-invisible by design. It inserts a seam between capture and sender and ships it running an identity transform, so that the risky structural change lands and is verified separately from the effects that will use it.

### 3.1 Desktop/web: `camera-effects.ts` (new)

`apps/desktop/src/services/camera-effects.ts`, with `camera-effects.check.ts`.

**Mechanism.** `MediaStreamTrackProcessor` reads `VideoFrame`s from the raw camera track; each frame is drawn to an `OffscreenCanvas`; the canvas is read back through a `VideoTrackGenerator` (or `MediaStreamTrackGenerator` where the newer name is absent) into the track that is published. The transform runs in a dedicated worker so that per-frame work never competes with React on the main thread.

**Capability gate.** Where `MediaStreamTrackProcessor` is unavailable, the module reports effects unsupported and the raw track is published unchanged. The UI reflects unavailability; it never silently accepts an effect setting and drops it.

**Track lifecycle.** The generated track is what reaches `mesh.setTrack('camera', …)`. `localTracks.camera` continues to hold the *raw* track so the existing stop path, the `ended` handling and the mute/enable path are untouched. Tearing down the camera stops the raw track, closes the processor and terminates the worker; a failure in the worker falls back to publishing the raw track rather than ending the call.

**What is pure and tested.** Frame dimension math, the pass-through decision (an identity effect must bypass the canvas entirely rather than paying a copy per frame), the capability probe's interpretation, and the frame-budget guard's arithmetic live in `camera-effects.ts` with assertions in `camera-effects.check.ts`, per the existing `.check.ts` convention. The WebRTC and worker wiring sit beside them and are exercised manually.

**Budget guard.** The stage measures frame time. Sustained overrun drops to pass-through and surfaces a notice; it does not degrade the call quietly and does not thrash between states.

### 3.2 Android: `CameraEffects.kt` (new)

A `VideoProcessor` installed on the `VideoSource` created in `VoiceEngine.beginCapture` (`VoiceEngine.kt:1192`), backed by a `SurfaceTextureHelper` and a GL fragment shader pass. Camera2 delivers texture frames, which the shader consumes directly; the rarer I420 buffer path is converted first. Phase 2 installs the processor with an identity shader.

`beginCapture` is shared with the screen share, so the processor is installed on the camera path only — the screen share's frames are not routed through it.

**Risk.** This is the highest-risk component in the spec: it sits between capture and every peer, and a fault there is a black tile for everyone rather than a degraded one. Mitigation: the processor is installed behind a preference that defaults to on but can be turned off without a rebuild, a frame that fails the GL pass is forwarded unmodified rather than dropped, and Phase 2's identity transform is verified on device before Phase 3 puts anything in the shader.

### 3.3 The Phase 3 contract

Phase 2 is complete when a Phase 3 effect can be added by supplying (a) a canvas filter string or draw step on web and (b) a fragment shader body plus uniforms on Android, with no further change to capture, mesh, lifecycle or settings plumbing. Phase 3 — the filter set as shared colour-matrix definitions, MediaPipe selfie segmentation on web, ML Kit selfie segmentation on Android, and a blur-strength control — is specified separately.

---

## 4. Testing

Following the repository's existing `.check.ts` convention (pure logic asserted under Node; anything needing a browser or a device verified manually):

* `camera-quality.check.ts` — bitrate scales with pixel count and respects floor and ceiling; presets resolve to the expected sizes; overrides win over derived values; `auto` resolves sensibly; degradation and content hint are the camera's, not the screen's.
* `camera-effects.check.ts` — identity effects take the pass-through path; dimension math; capability probe interpretation; budget-guard arithmetic including that it does not oscillate.
* `audio-devices.check.ts` — extended with `videoinput` cases for `chosenIsMissing` and `captureIsStale`, and coverage that the existing audio assertions are unchanged.
* Android — unit tests for size-derived camera bitrate and preset resolution in the existing `ShareQuality` test style.
* Manual — device switching mid-call on both platforms; camera unplugged mid-call with `followSystemDevices` on and off; `OverconstrainedError` fallback; the identity pipeline producing a picture indistinguishable from the raw track on both platforms.

---

## 5. Documentation Updates

Per the repository's documentation-synchronisation rule, the following are updated as part of the implementation, not afterwards:

* `development/claude.md` — camera capture and encoding in the media architecture section.
* `development/devdocs/ARCHITECTURE.md` and `development/devdocs/HowEverythingWorks.md` — the camera path and the effects seam.
* `development/devdocs/TRACK.md` — phase status.
* `docs/docs/features.md` and the relevant `docs/docs/architecture/` pages — camera settings and quality as user-facing features.

---

## 6. Risks & Open Items

| Risk | Assessment |
|---|---|
| Insertable Streams (`MediaStreamTrackProcessor`) is Chromium-only | No impact on the Electron desktop build. On the web client, effects are unavailable on Firefox and Safari; the capability gate (§3.1) makes this explicit rather than broken. Phase 1 is unaffected on every browser. |
| Android GL `VideoProcessor` sits between capture and all peers | Highest-risk item. Mitigated by identity-first delivery, per-frame fallback to the unmodified frame, and a preference to disable. See §3.2. |
| Per-frame cost of the processing stage on low-end hardware | Budget guard with pass-through fallback (§3.1). Phase 2's identity transform bypasses the canvas entirely, so Phase 2 itself costs nothing measurable. |
| Raising the camera bitrate raises call bandwidth | Bitrate is a ceiling, not a floor; congestion control still governs. The manual override and presets exist for constrained links, and `CallUsage` already reports consumption. |
| Camera codec preference may be unavailable on a peer | `sortPreferredVideoCodecs` already degrades to what is available rather than failing, as it does for the screen. |

**Open item:** whether `auto` should resolve from `getCapabilities()` per device or from a fixed ladder. To be settled during implementation with a bias toward the fixed ladder, since `getCapabilities` reports optimistically on several drivers.

---

## 7. Delivery

Phases 1 and 2 are implemented together in this pass, as separate conventional commits per the conventions in `development/Commit.md`, kept local. Phase 3 begins with its own spec once Phase 2's identity pipeline is verified on both platforms.
