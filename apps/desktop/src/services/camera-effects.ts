/**
 * A seam between the camera and the sender, running nothing yet.
 *
 * Filters and a portrait blur both need the same thing: somewhere to stand
 * between the captured frames and the ones that go on the wire. That place did
 * not exist - the camera track went straight from `getUserMedia` to
 * `RTCRtpSender.replaceTrack` - and building it at the same time as the first
 * effect would have meant debugging a shader and a track lifecycle at once,
 * with a black tile for everybody in the call as the failure mode.
 *
 * What lands here is the structural half: the worker, the track swap, the
 * teardown, the capability gate and the budget guard. The colour filters ride
 * along with it - not as scope creep, but because a seam with nothing going
 * through it is not a verified seam, it is dead code waiting to be debugged
 * later underneath a shader. `ctx.filter` is one assignment and no dependency,
 * which makes it the cheapest honest load to prove the pipeline with.
 *
 * The portrait blur is what is *not* here, and it is the expensive half:
 * blurring a background means knowing which pixels are background, which means
 * a segmentation model and the download that comes with it. It attaches to this
 * pipeline rather than replacing it.
 *
 * **Why native blur is not simply used instead.** It is not reachable. The
 * `backgroundBlur` track constraint is wired to platform video effects that
 * ship on ChromeOS and a thin slice of Windows builds and report unsupported
 * on nearly every machine this runs on; colour filters were never native
 * anywhere. That is the whole reason there is a processing stage.
 *
 * **What this costs where it is unavailable.** `MediaStreamTrackProcessor` is
 * Chromium's, which is free in Electron and absent in Firefox and Safari on the
 * web client. There, `effectsSupported()` is false and the raw track is
 * published - said out loud in the interface rather than accepted as a setting
 * and silently dropped.
 *
 * The pure parts are here with a self-check. Everything that needs a real
 * camera is in `camera-effects.worker.ts`, which cannot be tested under Node.
 */

/**
 * What to do to each frame.
 *
 * A canvas filter string, because that is the form both halves of phase 3 want:
 * the colour filters are one directly (`saturate(1.2) sepia(.3)`), and the
 * portrait blur is one applied to a masked background layer. `null` is "leave
 * the frame alone", which is not the same as an empty string - see
 * `isPassThrough`.
 */
export interface CameraEffect {
  /** A CSS filter string for `CanvasRenderingContext2D.filter`, or null. */
  filter: string | null;
  /** Background blur radius in pixels; 0 is off. Phase 3 consumes this. */
  blurBackground: number;
}

export const NO_EFFECT: CameraEffect = { filter: null, blurBackground: 0 };

/**
 * The filters on offer, as canvas filter strings.
 *
 * These ship with the seam rather than after it, and deliberately: a pipeline
 * with nothing going through it is not a verified pipeline, it is dead code
 * that will be debugged later under a shader. A filter is the cheapest possible
 * load to run it with - `ctx.filter` is one assignment, the compositing is the
 * browser's, and there is no model, no dependency and no wasm to download.
 *
 * The portrait blur is *not* here, because it is the expensive half: blurring a
 * background means knowing which pixels are the background, which means a
 * segmentation model. `blurBackground` above is the field it will fill.
 *
 * Values are gentle on purpose. A filter somebody notices is a filter they turn
 * off; these are the difference between a webcam's flat colour and a picture
 * that looks deliberate, and the strongest of them is still a face.
 */
export const FILTERS: Record<string, CameraEffect> = {
  none: NO_EFFECT,
  // A cheap sensor under an office light renders skin grey. This is the
  // correction, not a look.
  warm: { filter: 'saturate(1.15) sepia(0.16) contrast(1.04)', blurBackground: 0 },
  cool: { filter: 'saturate(1.08) hue-rotate(-8deg) brightness(1.04)', blurBackground: 0 },
  vivid: { filter: 'saturate(1.4) contrast(1.12)', blurBackground: 0 },
  mono: { filter: 'grayscale(1) contrast(1.08)', blurBackground: 0 },
  // Lifts the black point rather than blurring: a soft-focus look that costs
  // nothing, as opposed to the real background blur that costs a model.
  soft: { filter: 'brightness(1.06) contrast(0.94) saturate(1.05)', blurBackground: 0 },
};

export type FilterName = keyof typeof FILTERS;

/** The chosen filter, or nothing at all when the name is one we dropped. */
export function effectFor(name: string): CameraEffect {
  return FILTERS[name] ?? NO_EFFECT;
}

/**
 * Whether an effect is worth building a pipeline for at all.
 *
 * A pass-through still costs a full copy of every frame - decode into a canvas,
 * read back out, re-encode - at whatever resolution and frame rate the camera
 * is running. At 1080p30 that is a continuous, entirely pointless load on a
 * machine that is already encoding video. So "no effect" does not mean "an
 * identity transform"; it means the raw track goes to the sender and no worker
 * is started at all.
 *
 * `'none'` is a real CSS filter value meaning no filtering, and an empty string
 * is not a valid one. Both are treated as nothing to do, because both arrive
 * from an interface where "off" is a perfectly reasonable thing to have picked.
 */
export function isPassThrough(effect: CameraEffect): boolean {
  const filter = effect.filter?.trim();
  const filtering = filter !== undefined && filter !== '' && filter !== 'none';
  return !filtering && effect.blurBackground <= 0;
}

/**
 * Whether this runtime can process frames at all.
 *
 * Both halves are needed and they arrived in different releases:
 * `MediaStreamTrackProcessor` reads frames out of a track, and one of
 * `VideoTrackGenerator` (the current name, in a worker) or
 * `MediaStreamTrackGenerator` (the older one) puts them back into a track.
 * Probing for one and using the other is how this fails on exactly the browsers
 * nobody tests on.
 *
 * Deliberately takes the global to probe, so the self-check can ask about a
 * runtime it is not running in.
 */
export function effectsSupported(scope: Record<string, unknown> = globalThis): boolean {
  const reader = typeof scope.MediaStreamTrackProcessor === 'function';
  const writer =
    typeof scope.VideoTrackGenerator === 'function' ||
    typeof scope.MediaStreamTrackGenerator === 'function';
  return reader && writer;
}

/**
 * How long one frame may take before the pipeline is not worth running.
 *
 * A budget rather than a frame rate: the pipeline is not the only thing on this
 * machine, and the number that matters is what fraction of a frame interval it
 * is eating. At 30 fps a frame arrives every 33 ms; spending more than half of
 * that on an effect means the encoder and the rest of the application are
 * fighting for what is left, and the visible result is a call that stutters
 * rather than a picture that looks worse.
 */
export const FRAME_BUDGET_MS = 16;

/**
 * How many consecutive over-budget frames end it, and how much slack is
 * required to come back.
 *
 * Asymmetric on purpose. Dropping out takes a sustained run, so one scheduling
 * hiccup - a garbage collection, a window being dragged - does not turn an
 * effect off. Coming back requires the frames to be comfortably *under*
 * budget, not merely at it, or a machine sitting exactly on the line toggles
 * the effect on and off for the length of the call, which is far worse to look
 * at than either state.
 */
const OVER_BUDGET_FRAMES = 30;
const RECOVERY_FRAMES = 90;
const RECOVERY_RATIO = 0.6;

/**
 * Decides whether the effect should still be running, from frame times.
 *
 * A small state machine rather than a running average, because the question is
 * not "how fast is this on average" - it is "has this been too slow for long
 * enough to give up on, and has it been reliably fast enough to trust again".
 * An average answers neither and oscillates around the threshold.
 *
 * Pure, and self-checked, because the failure it guards against is a call that
 * flickers between filtered and unfiltered and nobody can reproduce it.
 */
export class FrameBudget {
  private overRun = 0;
  private underRun = 0;
  private degraded = false;

  /** True while the effect should be bypassed. */
  get bypassed(): boolean {
    return this.degraded;
  }

  /**
   * Records one frame's processing time and returns whether the bypass state
   * changed - which is the caller's cue to swap the track and say so.
   */
  record(ms: number): boolean {
    if (this.degraded) {
      this.underRun = ms <= FRAME_BUDGET_MS * RECOVERY_RATIO ? this.underRun + 1 : 0;
      if (this.underRun >= RECOVERY_FRAMES) {
        this.degraded = false;
        this.underRun = 0;
        this.overRun = 0;
        return true;
      }
      return false;
    }

    this.overRun = ms > FRAME_BUDGET_MS ? this.overRun + 1 : 0;
    if (this.overRun >= OVER_BUDGET_FRAMES) {
      this.degraded = true;
      this.overRun = 0;
      this.underRun = 0;
      return true;
    }
    return false;
  }
}

/**
 * The frame size an effect runs at.
 *
 * The capture's own size, always. Processing at anything smaller and letting
 * the encoder scale back up would be the permanently soft picture
 * `camera-quality.ts` exists to prevent, arriving by a different route - and
 * the effect would be visibly lower resolution than the face under it.
 *
 * The clamp is for a camera that reports nothing useful. A zero-sized canvas
 * throws on `getContext`, which would take down the pipeline on the first frame
 * rather than degrading, so an unreadable size falls back to the ladder's
 * default rather than trusting the reading.
 */
export function frameSize(track: MediaStreamTrack): { width: number; height: number } {
  const settings = track.getSettings();
  const width = settings.width ?? 0;
  const height = settings.height ?? 0;
  return width > 0 && height > 0 ? { width, height } : { width: 1280, height: 720 };
}

// --- The live pipeline ------------------------------------------------------
//
// Everything above is pure and self-checked. Everything below needs a real
// camera and a real worker, and is exercised by using the application.

/**
 * Insertable Streams, which are Chromium's and are not in the DOM types.
 *
 * Spelled out rather than cast away at each use, because getting one of these
 * wrong is a runtime failure on the one code path that sits between a camera
 * and every peer in the call.
 */
interface TrackProcessor {
  readable: ReadableStream<VideoFrame>;
}
interface TrackGenerator {
  writable: WritableStream<VideoFrame>;
  readonly track?: MediaStreamTrack;
}
type ProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessor;
type GeneratorCtor = new (init?: { kind: 'video' }) => TrackGenerator & MediaStreamTrack;

/**
 * A camera track with an effect on it, and the machinery to take it off again.
 *
 * The raw track is deliberately *not* owned here. Whoever captured it still
 * stops it, still reads `getSettings()` off it for the publish parameters, and
 * still hands it to the mute path - so the effect can be added and removed
 * mid-call without any of that changing. This owns only what it created.
 */
export class CameraPipeline {
  private worker: Worker | null = null;
  private readonly budget = new FrameBudget();

  /**
   * `track` is the *generated* one - what the sender publishes. The generator
   * object itself is not held: its `writable` end was transferred to the
   * worker, so this side has nothing left to do with it.
   */
  private constructor(readonly track: MediaStreamTrack) {}

  /**
   * Puts `effect` on `source` and hands back the track to publish.
   *
   * Returns null - rather than throwing - whenever the effect cannot be run:
   * an unsupported runtime, a pass-through effect, or a pipeline that failed to
   * start. The caller publishes the raw track in every one of those cases,
   * which is why none of them is an error: a call with an unfiltered camera is
   * working software, and a call with no camera is not.
   */
  static start(
    source: MediaStreamTrack,
    effect: CameraEffect,
    onBypass: (bypassed: boolean) => void,
  ): CameraPipeline | null {
    if (isPassThrough(effect) || !effectsSupported()) return null;

    try {
      const scope = globalThis as unknown as {
        MediaStreamTrackProcessor: ProcessorCtor;
        VideoTrackGenerator?: GeneratorCtor;
        MediaStreamTrackGenerator?: GeneratorCtor;
      };
      const Generator = scope.VideoTrackGenerator ?? scope.MediaStreamTrackGenerator;
      if (!Generator) return null;

      const processor = new scope.MediaStreamTrackProcessor({ track: source });
      const generator = new Generator({ kind: 'video' });
      // `VideoTrackGenerator` exposes its track through a property; the older
      // `MediaStreamTrackGenerator` *is* one.
      const output = generator.track ?? (generator as MediaStreamTrack);

      const pipeline = new CameraPipeline(output);

      const worker = new Worker(new URL('./camera-effects.worker.ts', import.meta.url), {
        type: 'module',
      });
      pipeline.worker = worker;
      worker.onmessage = (event: MessageEvent<{ type: string; ms?: number }>) => {
        if (event.data.type === 'failed') {
          onBypass(true);
          return;
        }
        if (pipeline.budget.record(event.data.ms ?? 0)) {
          onBypass(pipeline.budget.bypassed);
        }
      };

      // Transferred, not copied: the frames never cross the main thread.
      worker.postMessage(
        { type: 'start', readable: processor.readable, writable: generator.writable, effect },
        [processor.readable as unknown as Transferable, generator.writable as unknown as Transferable],
      );

      return pipeline;
    } catch {
      // Insertable Streams exist but refused. The raw camera is the fallback,
      // and it is a working camera.
      return null;
    }
  }

  /** Changes the effect without rebuilding anything. */
  setEffect(effect: CameraEffect): void {
    this.worker?.postMessage({ type: 'effect', effect });
  }

  /**
   * Tears the pipeline down.
   *
   * The generated track is stopped here because this created it; the source
   * track is not, because this did not. Getting that backwards either leaks a
   * camera light that stays on after a call, or stops the capture somebody is
   * still using.
   */
  stop(): void {
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    this.track.stop();
  }
}
