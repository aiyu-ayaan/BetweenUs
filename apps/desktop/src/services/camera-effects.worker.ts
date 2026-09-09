/**
 * The frame loop, off the main thread.
 *
 * A camera at 1080p30 is thirty full-frame canvas draws a second, for as long
 * as the call lasts - and with the portrait blur on, thirty runs of a
 * segmentation model on top of that. On the main thread all of it competes with
 * React, with the message list rendering, and with every animation in the
 * application; the symptom is not a slow filter, it is a call where the whole
 * interface stutters whenever the camera is on.
 *
 * `MediaStreamTrackProcessor` and `VideoTrackGenerator` are transferable to a
 * worker, so the frames never touch the main thread at all: they arrive here,
 * go through a canvas, and leave as a track the sender publishes.
 *
 * Everything worth asserting about is in `camera-effects.ts`, which is pure.
 * This file is the wiring, and it cannot run under Node.
 */

/// <reference lib="webworker" />

import type { CameraEffect } from './camera-effects';

interface StartMessage {
  type: 'start';
  readable: ReadableStream<VideoFrame>;
  writable: WritableStream<VideoFrame>;
  effect: CameraEffect;
}

interface EffectMessage {
  type: 'effect';
  effect: CameraEffect;
}

interface StopMessage {
  type: 'stop';
}

type Incoming = StartMessage | EffectMessage | StopMessage;

let effect: CameraEffect = { filter: null, blurBackground: 0 };
let stopping = false;

/** The frame being built. */
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

/**
 * Two scratch surfaces the portrait blur needs and the filters do not.
 *
 * `cutout` holds the person with a transparent background; `mask` holds the
 * model's answer as an alpha channel. Both are created on first use, so a
 * filter-only session allocates neither.
 */
let cutout: OffscreenCanvas | null = null;
let cutoutContext: OffscreenCanvasRenderingContext2D | null = null;
let mask: OffscreenCanvas | null = null;
let maskContext: OffscreenCanvasRenderingContext2D | null = null;

/**
 * The segmenter, and the promise that is loading it.
 *
 * Loaded on demand, because it is twelve megabytes of WebAssembly plus a model
 * and the overwhelming majority of calls never turn the blur on. `null` after a
 * failed load is deliberate and sticky: a machine that could not start it will
 * not start it on the next frame either, and retrying thirty times a second is
 * how a missing file becomes a hung call.
 */
type Segmenter = {
  segmentForVideo: (
    frame: CanvasImageSource,
    timestampMs: number,
    callback: (result: { categoryMask?: { getAsUint8Array(): Uint8Array; width: number; height: number; close(): void } }) => void,
  ) => void;
  close: () => void;
};

let segmenter: Segmenter | null = null;
let segmenterLoad: Promise<Segmenter | null> | null = null;

async function loadSegmenter(): Promise<Segmenter | null> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  // Same origin, staged by `vite-mediapipe.ts`. Never a CDN: that would be
  // remote code in this window, which `script-src 'self'` exists to refuse.
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe', true);
  try {
    return (await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate: 'GPU' },
      outputCategoryMask: true,
      outputConfidenceMasks: false,
      runningMode: 'VIDEO',
    })) as unknown as Segmenter;
  } catch (gpuError) {
    // GPU delegate can fail under certain drivers or virtual devices. Falling back
    // to CPU keeps portrait blur working smoothly rather than dropping the feature.
    return (await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate: 'CPU' },
      outputCategoryMask: true,
      outputConfidenceMasks: false,
      runningMode: 'VIDEO',
    })) as unknown as Segmenter;
  }
}

/**
 * The canvas, resized only when the frame size actually changes.
 *
 * A camera can change size mid-capture - `applyConstraints`, or a driver
 * renegotiating under load - and a canvas left at the old size would letterbox
 * or crop every frame after it. Reassigning width or height also clears the
 * context state, so the filter is set per frame below rather than once here.
 */
function surfaceFor(frame: VideoFrame): OffscreenCanvasRenderingContext2D | null {
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  if (width <= 0 || height <= 0) return null;

  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    // No `alpha: false` here any more: the portrait path composites a cutout
    // with a transparent background onto this surface, and an opaque context
    // discards the alpha that makes that work.
    context = canvas.getContext('2d', { desynchronized: true });
    cutout = null;
    cutoutContext = null;
  }
  return context;
}

/**
 * Draws the person sharp over a blurred copy of their own room.
 *
 * The order matters and is the whole trick: the background is the *same frame*
 * blurred, not a separate image, so the light and the colour behind somebody
 * stay theirs and only the detail goes. Then the cutout is drawn on top.
 *
 * `destination-in` is what turns the model's mask into an alpha channel: it
 * keeps the pixels of what is already drawn wherever the incoming shape is
 * opaque, and clears the rest. So the cutout surface gets the whole frame, then
 * has everything that is not a person erased out of it.
 *
 * Returns false when the frame could not be segmented, so the caller can fall
 * back to drawing it plainly rather than sending a black rectangle.
 */
function drawPortrait(frame: VideoFrame, ctx: OffscreenCanvasRenderingContext2D): boolean {
  if (!segmenter || !canvas) return false;

  const width = canvas.width;
  const height = canvas.height;

  let categoryMask: { getAsUint8Array(): Uint8Array; width: number; height: number; close(): void } | undefined;
  segmenter.segmentForVideo(frame, performance.now(), (result) => {
    categoryMask = result.categoryMask;
  });
  if (!categoryMask) return false;

  try {
    const values = categoryMask.getAsUint8Array();
    const maskWidth = categoryMask.width;
    const maskHeight = categoryMask.height;

    if (!mask || mask.width !== maskWidth || mask.height !== maskHeight) {
      mask = new OffscreenCanvas(maskWidth, maskHeight);
      maskContext = mask.getContext('2d', { willReadFrequently: true });
    }
    if (!maskContext || !mask) return false;

    // The model's mask is one byte per pixel; a canvas wants four. Only alpha
    // is set - the colour is irrelevant, because this surface is never drawn
    // for its pixels, only for its shape.
    const image = maskContext.createImageData(maskWidth, maskHeight);
    const data = image.data;
    for (let i = 0; i < values.length; i += 1) {
      // Category 0 is the background in the selfie segmenter; anything else is
      // a person. Written as "not background" rather than "== 1" so a model
      // with more classes than this one still cuts out the right side.
      data[i * 4 + 3] = values[i] === 0 ? 0 : 255;
    }
    maskContext.putImageData(image, 0, 0);

    if (!cutout || cutout.width !== width || cutout.height !== height) {
      cutout = new OffscreenCanvas(width, height);
      cutoutContext = cutout.getContext('2d');
    }
    if (!cutoutContext || !cutout) return false;

    cutoutContext.globalCompositeOperation = 'source-over';
    cutoutContext.filter = effect.filter ?? 'none';
    cutoutContext.clearRect(0, 0, width, height);
    cutoutContext.drawImage(frame, 0, 0, width, height);
    // The mask is smaller than the frame - the model runs at its own
    // resolution - so it is scaled up here. The softness that gives the edge is
    // a bonus rather than an accident: a hard cut at the shoulders is what
    // makes a bad portrait mode look bad.
    cutoutContext.filter = 'none';
    cutoutContext.globalCompositeOperation = 'destination-in';
    cutoutContext.drawImage(mask, 0, 0, width, height);
    cutoutContext.globalCompositeOperation = 'source-over';

    // The background: the same frame, with the chosen filter and the blur.
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = `${effect.filter ?? ''} blur(${effect.blurBackground}px)`.trim();
    ctx.drawImage(frame, 0, 0, width, height);
    ctx.filter = 'none';
    ctx.drawImage(cutout, 0, 0);
    return true;
  } finally {
    categoryMask.close();
  }
}

/**
 * One frame in, one frame out.
 *
 * The incoming frame is closed in every path, including the failure ones. A
 * `VideoFrame` holds a decoder buffer, and leaking them stalls the capture
 * within a second or two - the camera simply stops, with no error anywhere.
 */
function process(frame: VideoFrame): VideoFrame {
  const ctx = surfaceFor(frame);
  if (!ctx || !canvas) return frame;

  try {
    const portrait = effect.blurBackground > 0 && segmenter !== null;
    // A frame the model could not answer for is drawn plainly rather than
    // dropped or blacked out: one unblurred frame is invisible, and a hole in
    // the stream is not.
    if (!portrait || !drawPortrait(frame, ctx)) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = effect.filter ?? 'none';
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    }

    // The timestamp has to be carried across or the receiver has no idea when
    // this frame belongs, and the far end plays a stutter that looks like a
    // network fault.
    const out = new VideoFrame(canvas, {
      timestamp: frame.timestamp ?? 0,
      duration: frame.duration ?? undefined,
    });
    frame.close();
    return out;
  } catch {
    // A frame that cannot be drawn is forwarded untouched rather than dropped.
    // This sits between a camera and every peer: an unfiltered frame is a
    // cosmetic failure, and a missing one is a stall everybody sees.
    return frame;
  }
}

/**
 * Starts the segmenter if this effect wants one and it is not up yet.
 *
 * Fire and forget: the frames keep flowing unblurred while it loads, which is a
 * second or two of the plain camera rather than a second or two of nothing.
 */
function ensureSegmenter(): void {
  if (effect.blurBackground <= 0 || segmenter || segmenterLoad) return;
  segmenterLoad = loadSegmenter()
    .then((loaded) => {
      segmenter = loaded;
      return loaded;
    })
    .catch(() => {
      // Sticky: a machine that could not start it will not start it on the next
      // frame either, and retrying per frame is how a missing file becomes a
      // hung call. `segmenterLoad` stays set, so nothing tries again.
      self.postMessage({ type: 'no-portrait' });
      return null;
    });
}

async function run(message: StartMessage): Promise<void> {
  effect = message.effect;
  ensureSegmenter();
  const reader = message.readable.getReader();
  const writer = message.writable.getWriter();

  try {
    while (!stopping) {
      const { done, value } = await reader.read();
      if (done || !value) break;

      const began = performance.now();
      const out = process(value);
      const took = performance.now() - began;

      await writer.write(out);

      // The cost is reported and never judged here: the budget depends on which
      // effect is running and the decision to bypass belongs to the side that
      // owns the track swap. A worker that quietly stopped filtering would
      // leave the interface saying an effect is on while it is not.
      self.postMessage({ type: 'frame', ms: took });
    }
  } catch {
    self.postMessage({ type: 'failed' });
  } finally {
    reader.releaseLock();
    await writer.close().catch(() => undefined);
    segmenter?.close();
    segmenter = null;
  }
}

self.onmessage = (event: MessageEvent<Incoming>): void => {
  const message = event.data;
  if (message.type === 'start') {
    void run(message);
  } else if (message.type === 'effect') {
    effect = message.effect;
    ensureSegmenter();
  } else if (message.type === 'stop') {
    stopping = true;
  }
};
