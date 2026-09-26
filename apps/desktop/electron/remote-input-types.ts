/**
 * The shapes an input event has once it reaches the agent. Lives apart from
 * `remote-input.ts` so the pure validator and key tables can name them without
 * importing Electron.
 */

/**
 * Which of the two ways somebody can be driving this machine an event came
 * from. They are independent: a machine can be in a remote session and handing
 * control out in a call at the same time, watching a different monitor in each,
 * and a single target meant whichever was set last captured both.
 */
export type InputSource = 'session' | 'call';

export interface MouseInput {
  action: 'move' | 'down' | 'up' | 'wheel';
  /** Fraction of the shared screen, 0..1, so the two sides need no shared DPI. */
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  deltaY?: number;
  /** Defaults to a remote session, which is the older of the two paths. */
  source?: InputSource;
}

export interface KeyInput {
  action: 'down' | 'up';
  /** The character where there is one - `a`, `A`, `?`. */
  key: string;
  /** The physical key - `KeyA`, `Enter`, `ArrowLeft`. */
  code: string;
  /**
   * Which modifiers the controller was holding when this happened. Sent with
   * every event, because a chord cannot be reconstructed from the order three
   * separate events happened to arrive in - see `modifiers.ts`.
   */
  modifiers?: string[];
  source?: InputSource;
}
