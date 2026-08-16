/**
 * Whether a peer's camera or screen is on.
 *
 * There are two signals about a remote video slot and they answer different
 * questions, which is the mistake this exists to stop anyone making again.
 *
 * *Frames decoded* say whether a picture is arriving right now. They are the
 * only honest signal for that: a video receiver unmutes on the padding sent to
 * probe for bandwidth, so a track that never carried anything looks live. What
 * they do NOT say is whether the far end is still sharing - a screen share of a
 * document nobody is typing in decodes no frames for minutes at a time, and it
 * is still very much a share.
 *
 * *The declared media state*, which every client publishes over the peer's data
 * channel whenever it turns something on or off, is the answer to "are they
 * sharing". It is a statement of intent from the only party that knows.
 *
 * Deciding existence from frames is what made a viewer open somebody's share,
 * watch a still screen for five seconds, and be dropped back to the grid with
 * an offer to watch it again.
 */

/**
 * The track to show for one slot: what has arrived, unless its owner says that
 * slot is off.
 *
 * `declared` is `undefined` for the moment between a track arriving and the
 * peer's first media state landing - and for any client that publishes none.
 * There, what arrived is the best answer available, which is what this used to
 * do all the time.
 */
export function visibleVideo<T>(declared: boolean | undefined, arrived: T | null): T | null {
  if (!arrived) return null;
  return declared === false ? null : arrived;
}
