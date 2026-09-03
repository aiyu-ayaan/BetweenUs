/**
 * The bytes behind a status, as something an `<img>` or a `<video>` can take.
 *
 * A status is stored in the clear, unlike an attachment, but it is still
 * fetched rather than linked: the download route wants an Authorization header
 * and no element sends one. So the bytes come down through `fetch` and become
 * an object URL, exactly as a decrypted attachment does - the difference is
 * only that there is nothing to decrypt on the way.
 *
 * Cached by status id, because a story is opened, closed and opened again, and
 * the second look should not be another download. Released when the post goes
 * or the window closes; a URL that is revoked while an element still points at
 * it draws nothing, so nothing revokes on unmount.
 */
const urls = new Map<string, Promise<string>>();

/** The object URL for one status's media, fetching it the first time. */
export function statusMedia(statusId: string, mediaUrl: string): Promise<string> {
  const known = urls.get(statusId);
  if (known) return known;

  const pending = fetchBlobUrl(mediaUrl).catch((error: unknown) => {
    // A failure must not be cached: the next look should try again rather than
    // replay the same error for as long as the window is open.
    urls.delete(statusId);
    throw error;
  });
  urls.set(statusId, pending);
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

async function fetchBlobUrl(mediaUrl: string): Promise<string> {
  // Imported lazily so this module can be read by a check without pulling the
  // whole API surface - and so the import graph stays one way: the store
  // imports this, this does not import the store.
  const { api } = await import('./api');
  return URL.createObjectURL(await api.fetchBlob(mediaUrl));
}
