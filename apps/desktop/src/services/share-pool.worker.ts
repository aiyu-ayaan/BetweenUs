/**
 * The encoded half of the shared share encoder. See `share-pool.ts`.
 *
 * Two kinds of transform run here, both on encoded frames and never on
 * pixels:
 *
 * - **The producer**, on the one sender that really encodes the share. Each
 *   frame it encodes is copied to every pooled link's queue and then dropped:
 *   that sender's own connection is a loopback that carries nothing.
 * - **A carrier**, on each link's screen sender. While the link is pooled, the
 *   sender is encoding a 16x16 picture that exists only to give it a frame
 *   clock; every one of those frames leaves with the next shared frame in its
 *   place. While it is not, its own frames go out untouched.
 *
 * A link joins at a keyframe and only ever sends whole, in-order runs from
 * there, because an H.264 delta that lost its reference is a broken picture
 * until the next keyframe.
 */

/** Frames a link may fall behind by before it is resynchronised on a keyframe. */
const QUEUE_LIMIT = 6;
/** A second overflow this soon after the first is a link that cannot keep up. */
const OVERFLOW_WINDOW_MS = 5_000;

interface Carrier {
  /** Whether this link is being sent the shared frames. */
  pooled: boolean;
  /** Shared frames waiting for this link's next carrier frame. */
  queue: ArrayBuffer[];
  /** Waiting for a keyframe before it can be sent anything. */
  needKey: boolean;
  /** Whether the carrier has produced its first frame - its first keyframe is not a request. */
  started: boolean;
  /** When this link last fell `QUEUE_LIMIT` frames behind. */
  overflowAt: number;
  /** Reported as unable to keep up; fed nothing until the main thread decides. */
  stalled: boolean;
}

type Inbound =
  | { type: 'pool'; id: number }
  | { type: 'own'; id: number }
  | { type: 'drop'; id: number }
  | { type: 'reset' };

export type PoolWorkerEvent =
  | { type: 'frame' }
  | { type: 'key' }
  | { type: 'stalled'; id: number };

interface TransformerOptions {
  role: 'producer' | 'carrier';
  id?: number;
}

interface ScriptTransformer {
  readonly readable: ReadableStream<RTCEncodedVideoFrame>;
  readonly writable: WritableStream<RTCEncodedVideoFrame>;
  readonly options: TransformerOptions;
}

const scope = self as unknown as {
  onrtctransform: ((event: { transformer: ScriptTransformer }) => void) | null;
  onmessage: ((event: MessageEvent<Inbound>) => void) | null;
  postMessage: (message: PoolWorkerEvent) => void;
};

const carriers = new Map<number, Carrier>();
/** A keyframe has been asked for and has not arrived; one request covers everybody. */
let keyAsked = false;

function carrier(id: number): Carrier {
  let found = carriers.get(id);
  if (!found) {
    found = { pooled: false, queue: [], needKey: true, started: false, overflowAt: 0, stalled: false };
    carriers.set(id, found);
  }
  return found;
}

function askForKey(): void {
  if (keyAsked) return;
  keyAsked = true;
  scope.postMessage({ type: 'key' });
}

/** Back to waiting for a keyframe, and asks for one. */
function resync(link: Carrier): void {
  link.queue.length = 0;
  link.needKey = true;
  askForKey();
}

function onProducerFrame(frame: RTCEncodedVideoFrame): void {
  const key = frame.type === 'key';
  if (key) keyAsked = false;
  let fed = false;

  for (const [id, link] of carriers) {
    if (!link.pooled || link.stalled) continue;
    if (link.needKey && !key) continue;
    if (key) {
      link.queue.length = 0;
      link.needKey = false;
    }
    // A copy each: a buffer handed to one outgoing frame is that frame's.
    link.queue.push(frame.data.slice(0));
    fed = true;

    if (link.queue.length > QUEUE_LIMIT) {
      const now = performance.now();
      if (now - link.overflowAt < OVERFLOW_WINDOW_MS) {
        link.stalled = true;
        link.queue.length = 0;
        scope.postMessage({ type: 'stalled', id });
      } else {
        link.overflowAt = now;
        resync(link);
      }
    }
  }

  // One carrier frame per shared frame, for every pooled link at once.
  if (fed) scope.postMessage({ type: 'frame' });
}

function onCarrierFrame(
  link: Carrier,
  frame: RTCEncodedVideoFrame,
  controller: TransformStreamDefaultController<RTCEncodedVideoFrame>,
): void {
  if (!link.pooled) {
    controller.enqueue(frame);
    return;
  }
  // The carrier's picture barely changes, so after its first frame a keyframe
  // from it is the far end asking for one - and only a shared keyframe answers.
  if (frame.type === 'key' && link.started) resync(link);
  link.started = true;

  const next = link.queue.shift();
  // No shared frame to send: this one is dropped rather than sent as itself.
  if (!next) return;
  frame.data = next;
  controller.enqueue(frame);
}

scope.onrtctransform = (event) => {
  const transformer = event.transformer;
  const { role, id } = transformer.options;

  if (role === 'producer') {
    void transformer.readable
      .pipeTo(new WritableStream({ write: onProducerFrame }))
      .catch(() => undefined);
    return;
  }

  const link = carrier(id ?? -1);
  void transformer.readable
    .pipeThrough(
      new TransformStream<RTCEncodedVideoFrame, RTCEncodedVideoFrame>({
        transform: (frame, controller) => onCarrierFrame(link, frame, controller),
      }),
    )
    .pipeTo(transformer.writable)
    .catch(() => undefined);
};

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'pool': {
      const link = carrier(message.id);
      link.pooled = true;
      link.stalled = false;
      link.started = false;
      link.overflowAt = 0;
      resync(link);
      return;
    }
    case 'own': {
      const link = carrier(message.id);
      link.pooled = false;
      link.queue.length = 0;
      return;
    }
    case 'drop':
      carriers.delete(message.id);
      return;
    case 'reset':
      for (const link of carriers.values()) {
        link.pooled = false;
        link.queue.length = 0;
      }
      keyAsked = false;
      return;
  }
};
