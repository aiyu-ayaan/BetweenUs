/**
 * The bytes behind a status, opened, as something an `<img>` or a `<video>`
 * can take.
 *
 * The object comes down as ciphertext - the server has never held anything
 * else - so this is the attachment path with a different key: fetch, decrypt,
 * and hand back an object URL. The type on the blob comes from the post rather
 * than from the response, because the response says `application/octet-stream`
 * and a `<video>` will not decode a blob with no type on it.
 *
 * Cached by status id, because a story is opened, closed and opened again, and
 * the second look should not be another download and another decryption.
 * Released when the post goes or the window closes; a URL that is revoked
 * while an element still points at it draws nothing, so nothing revokes on
 * unmount.
 */
import type { StatusEntry } from '@betweenus/shared-types';

const urls = new Map<string, Promise<string>>();

/** The object URL for one post's media, fetching and opening it the first time. */
export function statusMedia(post: StatusEntry): Promise<string> {
  const known = urls.get(post.id);
  if (known) return known;

  const pending = fetchBlobUrl(post).catch((error: unknown) => {
    // A failure must not be cached: the next look should try again rather than
    // replay the same error for as long as the window is open.
    urls.delete(post.id);
    throw error;
  });
  urls.set(post.id, pending);
  return pending;
}

/** Frees one post's bytes - it was deleted, or it expired. */
export function releaseStatusMedia(statusId: string): void {
  const pending = urls.get(statusId);
  urls.delete(statusId);
  void pending?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
}

/** Frees everything. Called when the session ends. */
export function releaseAllStatusMedia(): void {
  for (const statusId of [...urls.keys()]) releaseStatusMedia(statusId);
}

async function fetchBlobUrl(post: StatusEntry): Promise<string> {
  if (!post.mediaUrl) throw new Error('That post has no media');
  // Imported lazily so this module can be read by a check without pulling the
  // whole API surface - and so the import graph stays one way: the store
  // imports this, this does not import the store.
  const [{ api }, { openStatusMedia }, { viewableImage }] = await Promise.all([
    import('./api'),
    import('./e2ee'),
    import('./attachments'),
  ]);
  const sealed = await api.fetchObject(post.mediaUrl);
  const opened = await openStatusMedia(post, sealed);
  // Through the same door an attachment goes through, because it is the same
  // problem: a phone camera writes HEIC, Chromium has never decoded one, and a
  // moment posted from Android drew as a broken image here for exactly that
  // reason. Anything else comes back untouched.
  const blob = await viewableImage(new Blob([opened], { type: post.mediaType ?? '' }));
  return URL.createObjectURL(blob);
}
