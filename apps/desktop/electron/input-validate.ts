/**
 * Whether one remote input event is sane enough to hand to the injection layer.
 *
 * The gateway checks which *permission* an event type needs and forwards the
 * event unread; it says nothing about whether `x` is a number or `code` is a
 * key. This is the agent's half: the last thing between a controller's bytes
 * and somebody's real keyboard. It returns a freshly built, whitelisted object
 * or a reason - it never throws, so a hostile payload cannot reach the
 * injection layer through an exception path, and the reason is a fixed word,
 * never the offending value, so a rejected keystroke cannot end up in a log.
 *
 * Pure: no Electron, no clock of its own (the rate budget takes `now`). See
 * `input-validate.check.ts`.
 */
import { isKnownCode } from './input-keymap';
import { readModifiers } from './modifiers';
import type { InputSource, KeyInput, MouseInput } from './remote-input-types';

export type Rejection =
  | 'shape'
  | 'type'
  | 'action'
  | 'coordinate'
  | 'button'
  | 'wheel'
  | 'key'
  | 'code'
  | 'modifiers'
  | 'source'
  | 'rate';

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: Rejection };

/**
 * A pointer at the very edge is a fraction of 1.0 give or take rounding on the
 * controller's side; that is clamped. Anything further out is not a rounding
 * error, it is somebody aiming off the screen.
 */
export const COORDINATE_SLACK = 0.02;
/** Browsers report about 100 per notch; a hard trackpad flick reaches a few hundred. */
export const MAX_WHEEL_DELTA = 2400;
const MAX_KEYS_ON_EVENT = 12;
const MAX_KEY_LENGTH = 16;
const MAX_CODE_LENGTH = 24;
const MAX_MODIFIERS = 8;
const MAX_MODIFIER_LENGTH = 8;

const MOUSE_ACTIONS = ['move', 'down', 'up', 'wheel'] as const;
const BUTTONS = ['left', 'right', 'middle'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail<T>(reason: Rejection): Verdict<T> {
  return { ok: false, reason };
}

function readSource(value: unknown): InputSource | null {
  if (value === undefined) return 'session';
  return value === 'session' || value === 'call' ? value : null;
}

/** A fraction of the screen: finite, in range up to a little rounding slack. */
function fraction(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < -COORDINATE_SLACK || value > 1 + COORDINATE_SLACK) return null;
  return Math.min(1, Math.max(0, value));
}

export function validateMouse(raw: unknown): Verdict<MouseInput> {
  if (!isRecord(raw)) return fail('shape');
  if (Object.keys(raw).length > MAX_KEYS_ON_EVENT) return fail('shape');
  if (raw.type !== undefined && raw.type !== 'input.mouse') return fail('type');

  const action = MOUSE_ACTIONS.find((candidate) => candidate === raw.action);
  if (!action) return fail('action');

  const x = fraction(raw.x);
  const y = fraction(raw.y);
  if (x === null || y === null) return fail('coordinate');

  const source = readSource(raw.source);
  if (!source) return fail('source');

  let button: MouseInput['button'];
  if (raw.button !== undefined) {
    button = BUTTONS.find((candidate) => candidate === raw.button);
    if (!button) return fail('button');
  }

  let deltaY: number | undefined;
  if (action === 'wheel') {
    if (typeof raw.deltaY !== 'number' || !Number.isFinite(raw.deltaY)) return fail('wheel');
    deltaY = Math.round(Math.min(MAX_WHEEL_DELTA, Math.max(-MAX_WHEEL_DELTA, raw.deltaY)));
  } else if (raw.deltaY !== undefined) {
    // A delta on an event that is not a scroll is not something the wire defines.
    return fail('wheel');
  }

  return {
    ok: true,
    value: {
      action,
      x,
      y,
      source,
      ...(button ? { button } : {}),
      ...(deltaY !== undefined ? { deltaY } : {}),
    },
  };
}

/** A printable character, or a short ASCII key name such as `Enter`. */
function readKeyName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_KEY_LENGTH) return null;
  const points = Array.from(value);
  if (points.length === 0) return '';
  if (points.length === 1) {
    const point = points[0]?.codePointAt(0) ?? 0;
    // A control character or half a surrogate pair is not a key.
    if (point < 0x20 || (point >= 0x7f && point < 0xa0)) return null;
    if (point >= 0xd800 && point <= 0xdfff) return null;
    return value;
  }
  return /^[A-Za-z0-9]+$/.test(value) ? value : null;
}

export function validateKey(raw: unknown): Verdict<KeyInput> {
  if (!isRecord(raw)) return fail('shape');
  if (Object.keys(raw).length > MAX_KEYS_ON_EVENT) return fail('shape');
  if (raw.type !== undefined && raw.type !== 'input.key') return fail('type');
  if (raw.action !== 'down' && raw.action !== 'up') return fail('action');

  const key = readKeyName(raw.key);
  if (key === null) return fail('key');

  // The table of keys this design injects is the allowlist. Anything the
  // controller invented - or a key that would be a different machine's
  // hardware button - is not in it.
  if (typeof raw.code !== 'string' || raw.code.length > MAX_CODE_LENGTH) return fail('code');
  if (!isKnownCode(raw.code)) return fail('code');

  let modifiers: string[] | undefined;
  if (raw.modifiers !== undefined) {
    if (!Array.isArray(raw.modifiers) || raw.modifiers.length > MAX_MODIFIERS) {
      return fail('modifiers');
    }
    for (const entry of raw.modifiers) {
      if (typeof entry !== 'string' || entry.length > MAX_MODIFIER_LENGTH) {
        return fail('modifiers');
      }
    }
    modifiers = readModifiers(raw.modifiers as string[]);
  }

  const source = readSource(raw.source);
  if (!source) return fail('source');

  return {
    ok: true,
    value: { action: raw.action, key, code: raw.code, source, ...(modifiers ? { modifiers } : {}) },
  };
}

// --- Rate ---------------------------------------------------------------------

interface Bucket {
  tokens: number;
  at: number;
}

export interface RateLimits {
  /** Sustained events per second, and how many may arrive in one burst. */
  move: { perSecond: number; burst: number };
  key: { perSecond: number; burst: number };
  wheel: { perSecond: number; burst: number };
}

/**
 * A pointer at 240 Hz is legitimate; a keyboard at 300 keys a second is a
 * paste or an attack, and 100 wheel events a second is a stuck trackpad.
 */
export const DEFAULT_LIMITS: RateLimits = {
  move: { perSecond: 300, burst: 120 },
  key: { perSecond: 100, burst: 80 },
  wheel: { perSecond: 60, burst: 30 },
};

export type RateClass = keyof RateLimits;

/**
 * A token bucket per source and class. Releases (`up`) are never rationed:
 * dropping the one event that lets go of a key or a button leaves it held on
 * the machine, which is worse than any flood, and a release costs nothing.
 */
export class InputBudget {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly limits: RateLimits = DEFAULT_LIMITS) {}

  allow(source: InputSource, kind: RateClass, now: number, release = false): boolean {
    if (release) return true;
    const limit = this.limits[kind];
    const id = `${source}:${kind}`;
    const bucket = this.buckets.get(id) ?? { tokens: limit.burst, at: now };
    const elapsed = Math.max(0, now - bucket.at) / 1000;
    bucket.tokens = Math.min(limit.burst, bucket.tokens + elapsed * limit.perSecond);
    bucket.at = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(id, bucket);
    return allowed;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export function rateClassOfMouse(input: MouseInput): { kind: RateClass; release: boolean } {
  if (input.action === 'move') return { kind: 'move', release: false };
  if (input.action === 'wheel') return { kind: 'wheel', release: false };
  return { kind: 'key', release: input.action === 'up' };
}

export type Counts = Record<Rejection, number>;

export function emptyCounts(): Counts {
  return {
    shape: 0,
    type: 0,
    action: 0,
    coordinate: 0,
    button: 0,
    wheel: 0,
    key: 0,
    code: 0,
    modifiers: 0,
    source: 0,
    rate: 0,
  };
}
