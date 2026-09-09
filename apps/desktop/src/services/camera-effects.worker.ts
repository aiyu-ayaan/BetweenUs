/**
 * The frame loop, off the main thread.
 *
 * A camera at 1080p30 is thirty full-frame canvas draws a second, for as long
 * as the call lasts. On the main thread all of it competes with React, with the
 * message list rendering, and with every animation in the application.
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

let effect: CameraEffect = { filter: null };
let stopping = false;

/** The frame being built. */
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

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
    context = canvas.getContext('2d', { desynchronized: true, alpha: false });
  }
  return context;
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
    ctx.filter = effect.filter ?? 'none';
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);

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

async function run(message: StartMessage): Promise<void> {
  effect = message.effect;
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
  }
}

self.onmessage = (event: MessageEvent<Incoming>): void => {
  const message = event.data;
  if (message.type === 'start') {
    void run(message);
  } else if (message.type === 'effect') {
    effect = message.effect;
  } else if (message.type === 'stop') {
    stopping = true;
  }
};
