/**
 * A server's own emoji: what is available, and how one gets into a message.
 *
 * The shape of the feature, in one place, because it is spread over four
 * screens otherwise:
 *
 * - The list per server is fetched once and kept. It is small, public, and read
 *   on every message render, so a request per render is out of the question.
 * - A message carries the pictures it uses inside its encrypted body. The text
 *   keeps the literal `:name:`, so a client that has never heard of custom
 *   emoji shows what was meant rather than a marker, and a reader who is not in
 *   the server still sees the picture - a shortcode forwarded into a direct
 *   message would otherwise render as a word.
 * - Only the emoji actually used travel. A server with two hundred of them must
 *   not put two hundred URLs in every "ok" somebody sends.
 *
 * The splitting and the manifest are pure and checked; the fetching is not.
 */
import type { MessageCustomEmoji, ServerEmoji } from '@betweenus/shared-types';
import { api } from './api';

/**
 * The largest picture an emoji may be, in bytes.
 *
 * Far below the picture route's own ceiling, and deliberately: an emoji is
 * drawn at 22 pixels and a hundred times a screen. Discord's limit is 256 KB
 * for the same reason - a 4 MB GIF is not an emoji, it is an attachment that
 * happens to be square.
 */
export const MAX_EMOJI_BYTES = 256 * 1024;

/** What an animated one can be. Anything else is re-encoded to a still WebP. */
export function isAnimatedType(contentType: string): boolean {
  return contentType === 'image/gif' || contentType === 'image/webp';
}

// --- The list, per server -----------------------------------------------------

const cached = new Map<string, ServerEmoji[]>();
const listeners = new Set<() => void>();

/** What this client knows for a server. Empty until it has been fetched. */
export function emojiFor(serverId: string | null): ServerEmoji[] {
  return serverId ? (cached.get(serverId) ?? []) : [];
}

export function onEmojiChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(serverId: string, emoji: ServerEmoji[]): void {
  cached.set(serverId, emoji);
  for (const listener of listeners) listener();
}

/** Reads a server's emoji. Failure is an empty list, not an error on screen. */
export async function loadEmoji(serverId: string): Promise<void> {
  try {
    publish(serverId, await api.serverEmoji(serverId));
  } catch {
    // A server whose emoji cannot be read is a server whose messages still
    // render, with the shortcodes showing as text.
  }
}

export async function addEmoji(
  serverId: string,
  name: string,
  url: string,
  animated: boolean,
): Promise<ServerEmoji> {
  const created = await api.addServerEmoji(serverId, { name, url, animated });
  publish(serverId, [...emojiFor(serverId), created].sort((a, b) => a.name.localeCompare(b.name)));
  return created;
}

export async function removeEmoji(serverId: string, emojiId: string): Promise<void> {
  await api.removeServerEmoji(serverId, emojiId);
  publish(
    serverId,
    emojiFor(serverId).filter((emoji) => emoji.id !== emojiId),
  );
}

export function forgetEmoji(): void {
  cached.clear();
  for (const listener of listeners) listener();
}

// --- Getting one into, and out of, a message ---------------------------------

/** Every `:name:` in a line, as written. */
const SHORTCODE = /:([a-z0-9_]{2,32}):/g;

/**
 * The manifest for one message: the emoji it actually uses, and nothing else.
 *
 * Deduplicated, because a message that says `:party: :party: :party:` is one
 * picture three times and the body is what has to carry it.
 */
export function usedEmoji(text: string, available: readonly ServerEmoji[]): MessageCustomEmoji[] {
  if (available.length === 0) return [];
  const byName = new Map(available.map((emoji) => [emoji.name, emoji]));
  const used = new Map<string, MessageCustomEmoji>();

  for (const match of text.matchAll(SHORTCODE)) {
    const name = match[1];
    if (name === undefined || used.has(name)) continue;
    const emoji = byName.get(name);
    if (emoji) used.set(name, { name: emoji.name, url: emoji.url, animated: emoji.animated });
  }

  return [...used.values()];
}

/** One piece of a rendered message: some text, or one emoji to draw. */
export type MessagePiece =
  | { kind: 'text'; text: string }
  | { kind: 'emoji'; emoji: MessageCustomEmoji };

/**
 * Splits a message into what to draw.
 *
 * A shortcode with no picture in the manifest stays text - which is what makes
 * a deleted emoji, or one from a server this reader is not in, degrade to the
 * word somebody typed rather than to a broken image.
 */
export function splitMessage(
  text: string,
  manifest: readonly MessageCustomEmoji[],
): MessagePiece[] {
  if (manifest.length === 0) return text ? [{ kind: 'text', text }] : [];

  const byName = new Map(manifest.map((emoji) => [emoji.name, emoji]));
  const pieces: MessagePiece[] = [];
  let at = 0;

  for (const match of text.matchAll(SHORTCODE)) {
    const name = match[1];
    const emoji = name === undefined ? undefined : byName.get(name);
    if (!emoji) continue;

    const start = match.index ?? 0;
    if (start > at) pieces.push({ kind: 'text', text: text.slice(at, start) });
    pieces.push({ kind: 'emoji', emoji });
    at = start + match[0].length;
  }

  if (at < text.length) pieces.push({ kind: 'text', text: text.slice(at) });
  return pieces;
}

/**
 * Whether a message is nothing but emoji.
 *
 * Every chat app draws those larger, and it is not decoration: a reaction sent
 * as a message is the whole message, and at 22 pixels it reads as a typo.
 */
export function isOnlyEmoji(pieces: readonly MessagePiece[]): boolean {
  if (pieces.length === 0) return false;
  return pieces.every(
    (piece) => piece.kind === 'emoji' || piece.text.trim().length === 0,
  );
}
