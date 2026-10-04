/**
 * Puts a picture from the conversation on the system clipboard.
 *
 * The source is the `blob:` URL the `<img>` is already drawing - the attachment
 * after it was decrypted on this device - so nothing is fetched from the
 * server and nothing leaves the machine except into the clipboard the person
 * asked for.
 *
 * PNG, whatever it was sent as: `image/png` is the one image type the Clipboard
 * API is required to accept, and a JPEG or WebP handed over as itself is
 * refused outright by Chromium. An animated GIF arrives as its first frame,
 * which is what every other app's "Copy image" does too.
 */
export async function copyImage(src: string): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('This app cannot copy pictures here');
  }
  // Handed over as a promise rather than awaited first: Safari drops the
  // user's gesture across an await and then refuses the write.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': asPng(src) })]);
}

async function asPng(src: string): Promise<Blob> {
  const source = await (await fetch(src)).blob();
  if (source.type === 'image/png') return source;

  const image = new Image();
  image.src = src;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not copy that picture');
  context.drawImage(image, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not copy that picture'))),
      'image/png',
    );
  });
}

/**
 * Which picture a right-click on a message means: the one under the pointer,
 * or the message's only one. A message of several pictures, clicked between
 * them, means none in particular, and the menu says nothing rather than guess.
 *
 * Only decrypted attachments count. They are the only `blob:` images in a
 * message; an avatar or a custom emoji is a plain URL and not what anybody
 * means by "copy image" on a message.
 */
export function pictureAt(target: EventTarget | null, message: Element): string | null {
  const isPicture = (node: Element | null): node is HTMLImageElement =>
    node instanceof HTMLImageElement && node.src.startsWith('blob:');

  const under = target instanceof Element ? target.closest('img') : null;
  if (isPicture(under)) return under.src;

  const all = Array.from(message.querySelectorAll('img')).filter(isPicture);
  return all.length === 1 ? (all[0]?.src ?? null) : null;
}
