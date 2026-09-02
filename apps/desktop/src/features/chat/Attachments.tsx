/**
 * Attachments as they appear under a message.
 *
 * Nothing here can use a plain `<img src>`: what the server holds is
 * ciphertext, so every file is fetched, decrypted in the client and handed to
 * the DOM as an object URL. That is also why an image only starts loading when
 * its row is rendered, and why the bytes are cached - scrolling past the same
 * picture twice should not decrypt it twice.
 */
import { useEffect, useRef, useState } from 'react';
import { isVoiceNote, type MessageAttachment } from '@betweenus/shared-types';
import {
  formatBytes,
  openAttachment,
  readAttachmentText,
  saveAttachment,
} from '../../services/attachments';
import {
  DownloadIcon,
  EyeIcon,
  FileIcon,
  InfoIcon,
  OneTimeIcon,
  PlayIcon,
  XIcon,
} from '../../components/icons';
import { holdMessage, releaseMessage, useChatStore } from '../../stores/chat';
import { isDesktopRuntime } from '../../services/platform';
import { DOWNLOAD_URL } from '../../services/downloads';
import { VoiceMessage } from './VoiceMessage';
import { useFocusTrap } from '../../services/focus-trap';

/** Text small enough to read in the message list without opening anything. */
const INLINE_TEXT_CHARS = 800;

export function AttachmentList({
  channelId,
  attachments,
  author,
  mine,
  oneTime,
}: {
  channelId: string;
  attachments: MessageAttachment[];
  /** Drawn on a voice message, the way every phone messenger draws one. */
  author?: { displayName: string; avatarUrl: string | null };
  /** Whether this account sent the message, which decides a voice note's accent. */
  mine?: boolean;
  /**
   * Present when this message is one-time, which changes everything below:
   * nothing is drawn inline, nothing is cached to disk, and opening it is what
   * destroys it.
   */
  oneTime?: { messageId: string; viewedByMe: boolean; mine: boolean };
}): JSX.Element | null {
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  if (attachments.length === 0) return null;

  // A one-time message is not an ordinary message with a flag on it. Its
  // pictures are never drawn in the list - a thumbnail is a look, and it would
  // be a look nobody chose to spend - so the whole block becomes one card that
  // has to be opened deliberately.
  if (oneTime) {
    return <OneTimeAttachments channelId={channelId} attachments={attachments} {...oneTime} />;
  }

  // Two or more photos are an album, not two attachments that happen to be
  // pictures: they get one tiled block, the way every phone messenger draws
  // them. A single photo is still a photo, at its own shape.
  const photos = attachments.filter((a) => a.contentType.startsWith('image/'));
  const album = photos.length > 1 ? photos : [];
  const rest = album.length > 0 ? attachments.filter((a) => !album.includes(a)) : attachments;

  return (
    <>
      {album.length > 0 && (
        <PhotoAlbum channelId={channelId} photos={album} onOpen={setPreview} />
      )}

      {rest.length > 0 && (
      <ul className="mt-1 flex flex-col gap-2">
        {rest.map((attachment) => (
          <li key={attachment.key} className="max-w-lg">
            {attachment.contentType.startsWith('image/') ? (
              <ImageAttachment
                channelId={channelId}
                attachment={attachment}
                onOpen={() => setPreview(attachment)}
              />
            ) : attachment.contentType.startsWith('audio/') ? (
              // All audio gets the same player. A recording is somebody
              // talking and its name is a timestamp, so it has none drawn; a
              // track somebody shared is mostly its name, so it keeps it.
              // Both beat the browser's own `<audio controls>`, which is a
              // different width and colour in every engine.
              <VoiceMessage
                channelId={channelId}
                attachment={attachment}
                author={author}
                mine={mine}
                fileName={isVoiceNote(attachment) ? undefined : attachment.name}
              />
            ) : isPlayable(attachment) ? (
              <MediaAttachment channelId={channelId} attachment={attachment} />
            ) : isTextual(attachment) ? (
              <TextAttachment
                channelId={channelId}
                attachment={attachment}
                onOpen={() => setPreview(attachment)}
              />
            ) : (
              <FileCard channelId={channelId} attachment={attachment} />
            )}
          </li>
        ))}
      </ul>
      )}

      {preview && (
        <PreviewOverlay
          channelId={channelId}
          attachment={preview}
          // An album of five shows four tiles, so the fifth is only reachable
          // from in here. Everything in the album is, once one of them is open.
          siblings={album.includes(preview) ? album : []}
          onShow={setPreview}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

/** True for anything worth showing as text rather than offering as a download. */
function isTextual(attachment: MessageAttachment): boolean {
  return (
    attachment.contentType.startsWith('text/') ||
    attachment.contentType === 'application/json' ||
    attachment.contentType === 'application/xml'
  );
}

/** Video and audio the runtime can play back rather than only hand over. */
function isPlayable(attachment: MessageAttachment): boolean {
  return (
    attachment.contentType.startsWith('video/') || attachment.contentType.startsWith('audio/')
  );
}

/**
 * Video and audio up to this size fetch themselves when scrolled to. A phone
 * clip is a few megabytes; a screen recording is not, and that is the one worth
 * asking about first.
 */
const AUTO_LOAD_BYTES = 40 * 1024 * 1024;

// --- Images -----------------------------------------------------------------

/**
 * The box a preview is allowed to occupy in the message list. A photo from a
 * phone is 3000px tall; rendered at its own size one message would be the
 * whole channel. So it is fitted into this box with its aspect ratio kept, and
 * the full size is one click away.
 */
const PREVIEW_WIDTH = 360;
const PREVIEW_HEIGHT = 240;

/** The size a preview renders at: the original, shrunk to fit, never enlarged. */
function fitted(attachment: MessageAttachment): { width: number; height: number } | null {
  if (!attachment.width || !attachment.height) return null;
  const scale = Math.min(
    1,
    PREVIEW_WIDTH / attachment.width,
    PREVIEW_HEIGHT / attachment.height,
  );
  return {
    width: Math.round(attachment.width * scale),
    height: Math.round(attachment.height * scale),
  };
}

function ImageAttachment({
  channelId,
  attachment,
  onOpen,
}: {
  channelId: string;
  attachment: MessageAttachment;
  onOpen: () => void;
}): JSX.Element {
  const { url, error } = useDecrypted(channelId, attachment);

  if (error) return <FileCard channelId={channelId} attachment={attachment} note={error} />;

  // The stored pixel size also reserves the space before the bytes arrive, so
  // the message list does not jump as images resolve. Without it - a GIF, which
  // is never re-encoded and so has no recorded size - CSS does the same job
  // once the image loads.
  const box = fitted(attachment);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={attachment.name}
      className="block cursor-pointer overflow-hidden rounded-lg border border-edge bg-surface-850"
      style={box ? { width: box.width, height: box.height } : undefined}
    >
      {url ? (
        <img
          src={url}
          alt={attachment.name}
          className="h-full w-full object-contain"
          style={box ? undefined : { maxWidth: PREVIEW_WIDTH, maxHeight: PREVIEW_HEIGHT }}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-800" />
      )}
    </button>
  );
}

// --- Albums -----------------------------------------------------------------

/**
 * More than one photo in a message is drawn as one tiled block.
 *
 * The shapes are the ones every phone messenger settled on: two side by side,
 * three as one tall picture beside two stacked, four as a square. Past four the
 * fourth tile carries a "+n" and the rest are only in the preview - a message
 * with twenty photos should still be the height of a message.
 *
 * Tiles crop rather than fit. An album of mixed portrait and landscape shots
 * laid out at their own aspect ratios is a ragged mess; the whole point of the
 * grid is that it is a grid.
 */
const ALBUM_WIDTH = 320;
const ALBUM_GAP = 2;
const ALBUM_TILES = 4;

function PhotoAlbum({
  channelId,
  photos,
  onOpen,
}: {
  channelId: string;
  photos: MessageAttachment[];
  onOpen: (attachment: MessageAttachment) => void;
}): JSX.Element {
  const shown = photos.slice(0, ALBUM_TILES);
  const hidden = photos.length - shown.length;
  const pair = shown.length === 2;
  const trio = shown.length === 3;

  return (
    <div
      className="mt-1 grid overflow-hidden rounded-lg border border-edge bg-surface-850"
      style={{
        width: ALBUM_WIDTH,
        height: pair ? ALBUM_WIDTH / 2 : ALBUM_WIDTH * 0.75,
        gap: ALBUM_GAP,
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: pair ? '1fr' : '1fr 1fr',
      }}
    >
      {shown.map((photo, index) => (
        <PhotoTile
          key={photo.key}
          channelId={channelId}
          attachment={photo}
          onOpen={() => onOpen(photo)}
          // The tall one in a set of three is the first.
          span={trio && index === 0}
          more={index === shown.length - 1 ? hidden : 0}
        />
      ))}
    </div>
  );
}

function PhotoTile({
  channelId,
  attachment,
  onOpen,
  span,
  more,
}: {
  channelId: string;
  attachment: MessageAttachment;
  onOpen: () => void;
  span: boolean;
  /** How many further photos this tile stands in for, if it is the last one. */
  more: number;
}): JSX.Element {
  const { url, error } = useDecrypted(channelId, attachment);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={attachment.name}
      className={`relative block h-full w-full cursor-pointer overflow-hidden bg-surface-800 ${
        span ? 'row-span-2' : ''
      }`}
    >
      {url && !error ? (
        <img src={url} alt={attachment.name} className="h-full w-full object-cover" />
      ) : error ? (
        <FileIcon className="mx-auto h-6 w-6 text-slate-500" />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-800" />
      )}
      {more > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-medium text-white">
          +{more}
        </span>
      )}
    </button>
  );
}

// --- Video and audio --------------------------------------------------------

/**
 * A player, not a download link.
 *
 * The source is an object URL over the decrypted bytes, so the whole file has
 * to arrive before playback starts - there is no range request to make against
 * a blob, and the ciphertext is one sealed unit anyway.
 *
 * It used to wait for a click before fetching anything, which meant every video
 * in a channel was a grey card that had to be poked before it would even show
 * its first frame. Now anything small enough fetches itself as soon as it is
 * scrolled to, and only the genuinely large files still ask first - the point
 * of the click was never the click, it was not spending 200 MB of somebody's
 * connection on a message they scrolled past.
 */
function MediaAttachment({
  channelId,
  attachment,
}: {
  channelId: string;
  attachment: MessageAttachment;
}): JSX.Element {
  const [asked, setAsked] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(box);
  const wanted = asked || (attachment.size <= AUTO_LOAD_BYTES && onScreen);
  const { url, error } = useDecrypted(channelId, wanted ? attachment : null);
  const isVideo = attachment.contentType.startsWith('video/');

  if (error) return <FileCard channelId={channelId} attachment={attachment} note={error} />;

  return (
    <div ref={box}>
      {!wanted ? (
        <FileCard
          channelId={channelId}
          attachment={attachment}
          note={`${formatBytes(attachment.size)} - click to load`}
          onPlay={() => setAsked(true)}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge bg-surface-850">
          {url ? (
            isVideo ? (
              <video
                src={url}
                controls
                // Only a deliberate click starts playback. A video that fetched
                // itself on the way past and then started talking is worse than
                // the grey card this replaced.
                autoPlay={asked}
                preload="auto"
                className="block max-h-[320px] w-full bg-black"
                style={{ maxWidth: PREVIEW_WIDTH * 1.4 }}
              />
            ) : (
              <audio src={url} controls autoPlay={asked} className="block w-full" />
            )
          ) : (
            <p className="px-3 py-6 text-center text-sm text-slate-400">
              Decrypting {attachment.name}…
            </p>
          )}
          <div className="flex items-center gap-2 border-t border-edge px-3 py-1.5">
            <span className="truncate text-xs text-slate-400">
              {attachment.name} · {formatBytes(attachment.size)}
            </span>
            <div className="ms-auto">
              <IconButton
                label="Download"
                onClick={() => void saveAttachment(channelId, attachment)}
                icon={<DownloadIcon className="h-4 w-4" />}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Text -------------------------------------------------------------------

/**
 * A text file, shown rather than offered. This is where an over-long message
 * lands: it reads as the message it was, with the rest a click away.
 */
function TextAttachment({
  channelId,
  attachment,
  onOpen,
}: {
  channelId: string;
  attachment: MessageAttachment;
  onOpen: () => void;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readAttachmentText(channelId, attachment, INLINE_TEXT_CHARS + 1)
      .then((value) => !cancelled && setText(value))
      .catch(() => !cancelled && setError('This file could not be opened'));
    return () => {
      cancelled = true;
    };
  }, [channelId, attachment]);

  if (error) return <FileCard channelId={channelId} attachment={attachment} note={error} />;

  const truncated = (text?.length ?? 0) > INLINE_TEXT_CHARS;

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-850">
      <pre className="max-h-56 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm text-slate-200">
        {text ?? 'Decrypting…'}
      </pre>
      <div className="flex items-center gap-2 border-t border-edge px-3 py-1.5">
        <span className="truncate text-xs text-slate-400">
          {attachment.overflow ? 'Message too long, sent as a file' : attachment.name} ·{' '}
          {formatBytes(attachment.size)}
        </span>
        <div className="ms-auto flex gap-1">
          {truncated && <IconButton label="Expand" onClick={onOpen} icon={<EyeIcon className="h-4 w-4" />} />}
          <IconButton
            label="Download"
            onClick={() => void saveAttachment(channelId, attachment)}
            icon={<DownloadIcon className="h-4 w-4" />}
          />
        </div>
      </div>
    </div>
  );
}

// --- One-time messages ------------------------------------------------------

/**
 * A one-time message, before and after it is opened.
 *
 * Three states, and the middle one is the feature. Before: a card naming what
 * is inside it, deliberately not a thumbnail - a thumbnail is a look, and it
 * would be a look nobody chose to spend. During: a full-screen viewer with the
 * ordinary affordances removed. After: a line saying it is gone, which is all
 * that is left, because the server destroyed the row and the blobs the moment
 * the viewer opened.
 *
 * The author is not a viewer. Somebody re-reading what they themselves sent
 * has not spent anybody's one look, so their own copy opens as often as they
 * like and burns nothing - and the server agrees, which is what makes that
 * safe rather than a client-side courtesy.
 *
 * ## What "protected" can and cannot mean here
 *
 * The viewer refuses the download, the context menu, the drag and the text
 * selection, and the message list never draws the picture at all. That closes
 * every path this application offers for keeping a copy.
 *
 * It does not stop a screenshot, and no application on a general-purpose
 * computer can. The pixels have to reach a screen for the picture to be looked
 * at, and at that point the operating system, another window, or a phone
 * pointed at the monitor can all have them. What this feature honestly
 * provides is that the file stops existing - on the server, in the object
 * store, and in every client's cache - the moment it has been seen once. The
 * copy on screen says exactly that, because a viewer implying more would be
 * lying to the person deciding what to send.
 */
function OneTimeAttachments({
  channelId,
  attachments,
  messageId,
  viewedByMe,
  mine,
}: {
  channelId: string;
  attachments: MessageAttachment[];
  messageId: string;
  /** Whether *this account* has already spent its look. One look each. */
  viewedByMe: boolean;
  /** Whether this account sent it. The author never gets to open one. */
  mine: boolean;
}): JSX.Element {
  const burnMessage = useChatStore((state) => state.burnMessage);
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);

  /**
   * The author does not get to open their own one-time message.
   *
   * They sent it. It was never theirs to look at again, and a sender who can
   * re-open it on another device has a message that is one-time for exactly
   * one of the two people in the conversation - which is not what the sender
   * chose when they turned the switch on.
   *
   * The server refuses them the bytes as well; this only stops the app
   * offering something that would fail. See `mayOpenOneTime` in the uploads
   * controller, which is where the guarantee actually lives.
   */
  const spent = mine || viewedByMe;

  /**
   * A browser cannot open one of these, and says so instead of trying.
   *
   * Every other client hides its window from screen capture while a one-time
   * message is on screen - `FLAG_SECURE` on Android, `setContentProtection` on
   * the desktop - and the operating system enforces both. A page has no such
   * thing and there is no API that would give it one.
   *
   * So the web build refuses rather than showing a picture it cannot make the
   * promise about. The alternative is worse than useless: a sender choosing
   * "one-time" and quietly being given none of it, on a client that looked
   * identical to the ones where it works.
   */
  const webRefuses = !isDesktopRuntime();
  const canOpen = !spent && !webRefuses;

  return (
    <>
      {/* Drawn first, and outside everything below, because the viewer has to
          outlive the state changes its own opening causes. Reporting the look
          comes back as an updated message with this account in `viewedBy`,
          which flips `viewedByMe` - and returning early on that dropped the
          viewer a second or two after it opened. Whether this account has
          looked decides what the *card* says, and nothing more. */}
      {open && (
        <OneTimeViewer
          channelId={channelId}
          attachments={attachments}
          onSpend={() => burnMessage(messageId)}
          onClose={() => {
            setOpen(false);
            // Now it may go, if the server said so while it was open.
            releaseMessage(messageId);
          }}
        />
      )}

      {spent ? (
        <p className="mt-1 flex items-center gap-2 text-sm italic text-slate-500">
          <OneTimeIcon className="h-4 w-4 shrink-0" />
          {mine ? 'One-time — only they can open it' : 'Opened'}
        </p>
      ) : (
        <div className="mt-1 flex w-full max-w-sm items-center gap-2">
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => {
              // Held first, and burned later - by the viewer, once it actually
              // has the bytes. Burning from here raced the download of the
              // very blob being opened, and on a phone the download lost.
              holdMessage(messageId);
              setOpen(true);
            }}
            className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors duration-200 ${
              canOpen
                ? 'cursor-pointer border-accent/40 bg-accent/[0.06] hover:bg-accent/[0.12]'
                : 'cursor-not-allowed border-edge bg-surface-850'
            }`}
          >
            <OneTimeIcon
              className={`h-7 w-7 shrink-0 ${canOpen ? 'text-accent' : 'text-slate-500'}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-100">
                {describeOneTime(attachments)}
              </span>
              <span className="block truncate text-xs text-slate-400">
                {webRefuses ? 'Open in the desktop app' : 'One-time — you get one look'}
              </span>
            </span>
          </button>

          {webRefuses && (
            <button
              type="button"
              onClick={() => setWhy(true)}
              aria-label="Why can I not open this here?"
              title="Why can I not open this here?"
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-edge text-slate-400 transition-colors duration-200 hover:border-accent hover:text-slate-100"
            >
              <InfoIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {why && <WebOneTimeNotice onClose={() => setWhy(false)} />}
    </>
  );
}

/**
 * Why a browser will not open a one-time message.
 *
 * Worth a dialog rather than a tooltip because it is a security explanation
 * and a recommendation, and because somebody meeting it is being told they
 * cannot do something - which deserves a reason rather than a shrug.
 *
 * The reason is stated as a limitation of the browser rather than of
 * BetweenUs, because that is what it is: there is no API that would let a page
 * refuse a screenshot, and there is not going to be one.
 */
function WebOneTimeNotice({ onClose }: { onClose: () => void }): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-labelledby="one-time-web-title"
        className="w-full max-w-md animate-pop rounded-2xl border border-edge bg-surface-900 p-6 shadow-pop"
      >
        <h2
          id="one-time-web-title"
          className="flex items-center gap-2 text-lg font-semibold text-slate-50"
        >
          <OneTimeIcon className="h-5 w-5 text-accent" />
          One-time messages need the app
        </h2>

        <p className="mt-3 text-sm text-slate-300">
          The desktop and Android apps hide their window from screen capture while a one-time
          message is open — the operating system itself refuses the screenshot and records black.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          A browser tab cannot do that. A page has no say over the screen it is drawn on, and
          there is no setting or permission that would change it. Rather than show you the picture
          and quietly break the promise the sender chose, this build does not open it.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Nothing has been used up. Your one look is still there, and it will be waiting when you
          open this conversation in the app.
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
          >
            Get the app
          </a>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-edge px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:text-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** What is inside, said in the words a person would use for it. */
export function describeOneTime(attachments: MessageAttachment[]): string {
  const kinds = new Set(
    attachments.map((attachment) =>
      attachment.contentType.startsWith('image/')
        ? 'Photo'
        : attachment.contentType.startsWith('video/')
          ? 'Video'
          : attachment.contentType.startsWith('audio/')
            ? 'Voice message'
            : 'File',
    ),
  );
  const only = kinds.size === 1 ? ([...kinds][0] ?? 'File') : 'File';
  return attachments.length > 1
    ? `${attachments.length} ${only.toLowerCase()}s`
    : only;
}

/**
 * The viewer for a one-time message.
 *
 * Everything that would leave a copy behind is taken away: no download button,
 * no context menu, nothing draggable, nothing selectable, and `controlsList`
 * telling a media element not to offer its own download item. Those are the
 * paths this application controls, and they are all closed.
 *
 * See the note above for what this cannot do, and why the sentence under the
 * picture says so out loud.
 */
function OneTimeViewer({
  channelId,
  attachments,
  onSpend,
  onClose,
}: {
  channelId: string;
  attachments: MessageAttachment[];
  /**
   * Records this account's look. Awaited, and nothing is drawn until it
   * resolves - a picture shown before the server has written the look down is
   * a look that was never spent.
   */
  onSpend: () => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const [at, setAt] = useState(0);
  const index = Math.min(at, attachments.length - 1);
  const current = attachments[index];

  /**
   * Every file, fetched and decrypted before anything is reported as seen.
   *
   * All of them, not the one on screen: burning destroys the blobs of the
   * whole message, so a second picture left to fetch when the first is
   * reported would be a picture whose bytes are already gone. One message,
   * one look, and everything in it has to arrive before the look is spent.
   */
  const [urls, setUrls] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];

    void Promise.all(attachments.map((file) => openAttachment(channelId, file)))
      .then((blobs) => {
        if (cancelled) return;
        for (const blob of blobs) made.push(URL.createObjectURL(blob));
        setUrls(made);
      })
      .catch(() => {
        if (!cancelled) setFailure('This message could not be opened');
      });

    return () => {
      cancelled = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [channelId, attachments]);

  /**
   * The look, recorded once the bytes are in hand and *before* they are drawn.
   *
   * Two orderings meet here and both matter. The burn deletes the blobs, so it
   * cannot come first - that raced the download and lost. And the picture
   * cannot come first either: showing it and then recording is a look that was
   * spent only if the write happened to succeed, which is not one look, it is
   * one look on a good network.
   *
   * So: fetch, record, draw. A failure draws nothing and spends nothing, and
   * the person can try again - the server has no row for it, so nothing has
   * been taken from them.
   */
  const [spent, setSpent] = useState(false);
  const spending = useRef(false);
  useEffect(() => {
    if (!urls || spending.current) return;
    spending.current = true;
    void onSpend()
      .then(() => setSpent(true))
      .catch(() => setFailure('That could not be opened. Nothing has been used up — try again.'));
  }, [urls, onSpend]);

  /**
   * Hidden from screen capture for exactly as long as this is open.
   *
   * The desktop counterpart of Android's `FLAG_SECURE`, and enforced by the
   * operating system rather than by this app. It answers false in a browser,
   * where a page has no say over the screen it is drawn on - which is why the
   * sentence below changes with it rather than claiming the same thing twice.
   */
  const [protectedWindow, setProtectedWindow] = useState(false);
  useEffect(() => {
    const protect = window.betweenus?.protectContent;
    if (!protect) return;
    void protect(true).then(setProtectedWindow).catch(() => undefined);
    return () => {
      void protect(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setAt((was) => Math.max(0, was - 1));
      if (event.key === 'ArrowRight') setAt((was) => Math.min(attachments.length - 1, was + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, attachments.length]);

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="One-time message"
      onClick={onClose}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed inset-0 z-50 flex select-none flex-col items-center justify-center gap-3 bg-black/90 p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col items-center gap-3"
      >
        {failure ? (
          <p className="max-w-sm text-center text-sm text-danger">{failure}</p>
        ) : !urls || !spent ? (
          <p className="text-sm text-slate-400">Decrypting…</p>
        ) : (
          current && <OneTimeMedia attachment={current} url={urls[index] ?? ''} />
        )}

        {attachments.length > 1 && (
          <p className="text-xs text-slate-400">
            {index + 1} of {attachments.length} — use the arrow keys
          </p>
        )}

        {/* What this actually protects, which is not the same on both builds.
            The Electron window can be excluded from screen capture by the
            operating system; a browser tab cannot be, and saying otherwise
            would be lying to the person deciding what to send. */}
        <p className="max-w-md text-center text-xs text-slate-500">
          {protectedWindow
            ? 'This is gone once you close it. Screenshots and screen recording are blocked here, but another camera is not — only send what you would trust them with.'
            : 'This is gone once you close it. Saving and sharing are switched off, but a browser cannot stop a screenshot — only send what you would trust them with.'}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-md bg-surface-800 px-4 py-2 text-sm text-slate-200 transition-colors duration-200 hover:bg-white/[0.07]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * One file inside the viewer, drawn with everything that copies it removed.
 *
 * Handed a URL rather than fetching one: the viewer above has already
 * downloaded and decrypted every file, because reporting the look is what
 * destroys the blobs and nothing may still be waiting on them when it does.
 */
function OneTimeMedia({
  attachment,
  url,
}: {
  attachment: MessageAttachment;
  url: string;
}): JSX.Element {
  if (attachment.contentType.startsWith('image/')) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        className="max-h-[70vh] max-w-full select-none object-contain"
      />
    );
  }

  if (attachment.contentType.startsWith('video/')) {
    return (
      <video
        src={url}
        controls
        autoPlay
        // The browser's own download item, refused. It is the one copy path a
        // media element offers that markup around it cannot take away.
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
        className="max-h-[70vh] max-w-full select-none"
      />
    );
  }

  return (
    <audio
      src={url}
      controls
      autoPlay
      controlsList="nodownload"
      onContextMenu={(event) => event.preventDefault()}
      className="w-full max-w-md"
    />
  );
}

// --- Everything else --------------------------------------------------------


function FileCard({
  channelId,
  attachment,
  note,
  onPlay,
}: {
  channelId: string;
  attachment: MessageAttachment;
  note?: string;
  /** Present for video and audio: fetch and decrypt, then play it here. */
  onPlay?: () => void;
}): JSX.Element {
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-edge bg-surface-850 px-3 py-2.5">
      {onPlay ? (
        <PlayIcon className="h-8 w-8 shrink-0 text-accent" />
      ) : (
        <FileIcon className="h-8 w-8 shrink-0 text-accent" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-100">{attachment.name}</p>
        <p className="truncate text-xs text-slate-400">
          {note ?? failure ?? formatBytes(attachment.size)}
        </p>
      </div>
      {onPlay && (
        <IconButton
          label={`Play ${attachment.name}`}
          onClick={onPlay}
          icon={<PlayIcon className="h-4 w-4" />}
        />
      )}
      <IconButton
        label={`Download ${attachment.name}`}
        onClick={() => {
          setFailure(null);
          void saveAttachment(channelId, attachment).catch(() =>
            setFailure('This file could not be opened'),
          );
        }}
        icon={<DownloadIcon className="h-4 w-4" />}
      />
    </div>
  );
}

// --- Full-size preview ------------------------------------------------------

function PreviewOverlay({
  channelId,
  attachment,
  siblings = [],
  onShow,
  onClose,
}: {
  channelId: string;
  attachment: MessageAttachment;
  /** The album this picture belongs to, if it belongs to one. */
  siblings?: MessageAttachment[];
  onShow?: (attachment: MessageAttachment) => void;
  onClose: () => void;
}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const isImage = attachment.contentType.startsWith('image/');
  const { url } = useDecrypted(channelId, isImage ? attachment : null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (isImage) return;
    let cancelled = false;
    void readAttachmentText(channelId, attachment).then((value) => !cancelled && setText(value));
    return () => {
      cancelled = true;
    };
  }, [channelId, attachment, isImage]);

  const at = siblings.indexOf(attachment);
  const step = (by: number): void => {
    if (at < 0 || !onShow) return;
    const next = siblings[(at + by + siblings.length) % siblings.length];
    if (next) onShow(next);
  };

  // Escape closes, the way every other overlay in this app behaves; the arrow
  // keys walk the album, the way every other gallery does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl animate-pop flex-col overflow-hidden rounded-xl border border-edge bg-surface-900 shadow-pop"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge px-4">
          <p className="truncate text-sm font-medium text-slate-100">{attachment.name}</p>
          {at >= 0 && siblings.length > 1 && (
            <span className="shrink-0 text-xs text-slate-400">
              {at + 1} / {siblings.length}
            </span>
          )}
          {!isImage && (
            <span className="text-xs text-slate-400">{formatBytes(attachment.size)}</span>
          )}
          <div className="ms-auto flex gap-1">
            {at >= 0 && siblings.length > 1 && (
              <>
                <IconButton label="Previous" onClick={() => step(-1)} icon={<span aria-hidden>‹</span>} />
                <IconButton label="Next" onClick={() => step(1)} icon={<span aria-hidden>›</span>} />
              </>
            )}
            <IconButton
              label="Download"
              onClick={() => void saveAttachment(channelId, attachment)}
              icon={<DownloadIcon className="h-4 w-4" />}
            />
            <IconButton label="Close" onClick={onClose} icon={<XIcon className="h-4 w-4" />} />
          </div>
        </header>

        {isImage ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
            {url ? (
              <img src={url} alt={attachment.name} className="max-h-[70vh] max-w-full" />
            ) : (
              <p className="text-slate-400">Decrypting…</p>
            )}
          </div>
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm text-slate-200">
            {text ?? 'Decrypting…'}
          </pre>
        )}
      </div>
    </div>
  );
}

// --- Shared bits ------------------------------------------------------------

/**
 * Decrypts an attachment into an object URL, and releases it when the message
 * scrolls out of the tree. Passing null keeps the hook's position in the list
 * of hooks while fetching nothing.
 */
function useDecrypted(
  channelId: string,
  attachment: MessageAttachment | null,
): { url: string | null; error: string | null } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revoke = useRef<string | null>(null);

  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;

    openAttachment(channelId, attachment)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        revoke.current = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setError('This file could not be opened'));

    return () => {
      cancelled = true;
      if (revoke.current) URL.revokeObjectURL(revoke.current);
      revoke.current = null;
    };
  }, [channelId, attachment]);

  return { url, error };
}

/**
 * Whether an element is on screen. Used to decide when a video is worth
 * fetching: "in the channel" is not the same question as "being looked at",
 * and a channel of forty clips would otherwise download all forty at once.
 */
function useOnScreen(ref: { current: Element | null }): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    // No observer (or no element yet) means fetch rather than never fetch.
    if (!element || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // One way only: a video that has been scrolled past has already been
        // fetched, and un-setting this would tear down the player mid-frame.
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      // A little ahead of the viewport, so it is ready by the time it arrives.
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return seen;
}

function IconButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
    >
      {icon}
    </button>
  );
}
