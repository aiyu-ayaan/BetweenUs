/**
 * "What do you want to share?" - screens on one tab, windows on the other,
 * each with a live thumbnail, the way Discord asks.
 *
 * The sources come from the main process over IPC; the renderer has no business
 * enumerating them itself. Picking one records the choice in main and only then
 * starts the capture, because Chromium asks which surface to hand over at
 * capture time, far too late to put a chooser on screen.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVoiceStore } from '../../stores/voice';
import { isDesktopRuntime } from '../../services/platform';
import { useAudioSettings } from '../../stores/audioSettings';
import type { ShareIntent } from '../../services/share-quality';
import { ScreenShareIcon } from '../../components/icons';

export function ScreenSharePicker({ onClose }: { onClose: () => void }): JSX.Element {
  const shareScreen = useVoiceStore((state) => state.shareScreen);

  // A browser has no source list to show: Chromium puts its own chooser up when
  // capture starts, so this dialog is only here to ask what is being shared.
  const native = isDesktopRuntime();

  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  // Two different questions wearing one name. On the desktop this app captures
  // the machine's output itself, which only Windows can do, so the offer is
  // ours to make. In a browser the choice belongs to the surface picker - it
  // offers a tab's audio or the whole system's, next to the thing being shared,
  // and it only offers either when the capture asked for audio at all. So the
  // browser is always asked, and never shown a checkbox of ours that would
  // either duplicate that one or quietly contradict it.
  const audioSupported = native ? window.betweenus?.platform === 'win32' : true;
  const [withAudio, setWithAudio] = useState(audioSupported);
  // What is on the screen, not how good it should be. The two want opposite
  // things from the encoder and neither is the better one - see
  // `services/share-quality.ts`.
  const [intent, setIntent] = useState<ShareIntent>('detail');
  // Said here rather than only in settings, because this is where somebody
  // finds out the picture is soft - and a setting three screens away is one
  // nobody knows is on.
  const share = useAudioSettings((state) => state.settings.share);

  useEffect(() => {
    const bridge = window.betweenus;
    if (!bridge) {
      // A plain browser has no source list; the runtime asks on its own.
      setSources([]);
      return;
    }
    bridge
      .screenSources()
      .then(setSources)
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : 'Could not list screens');
        setSources([]);
      });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = (sources ?? []).filter((source) => source.kind === tab);
  const chosen = (sources ?? []).find((source) => source.id === selected) ?? null;

  const start = (): void => {
    onClose();
    void shareScreen(chosen, withAudio && audioSupported, intent);
  };

  // Rendered into the document body rather than where it is written.
  //
  // The button that opens this sits in the call's control bar, and that bar is
  // frosted glass - `backdrop-filter`. An element with a backdrop-filter is a
  // containing block for every fixed-position descendant, exactly as a
  // `transform` is, so `fixed inset-0` stopped meaning the viewport and started
  // meaning the little pill the buttons live in: the dialog was laid out a few
  // hundred pixels wide inside the toolbar, which is what "the picker does not
  // open" looked like. A portal takes it out of that subtree entirely, so no
  // ancestor's paint effects can ever own it again.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose what to share"
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl animate-pop flex-col rounded-xl border border-edge bg-surface-900 shadow-pop"
      >
        <header className="flex items-center gap-3 border-b border-edge px-5 py-4">
          <ScreenShareIcon className="h-5 w-5 text-slate-400" />
          <h2 className="font-semibold text-slate-100">Screen share</h2>
          {native && (
            <div className="ms-auto flex gap-1 rounded-md bg-surface-900 p-1">
              <TabButton active={tab === 'screen'} onClick={() => setTab('screen')}>
                Screens
              </TabButton>
              <TabButton active={tab === 'window'} onClick={() => setTab('window')}>
                Applications
              </TabButton>
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {sources === null && <p className="py-10 text-center text-slate-400">Looking…</p>}

          {failure && (
            <p role="alert" className="mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {failure}
            </p>
          )}

          {sources !== null && shown.length === 0 && (
            <p className="py-10 text-center text-slate-500">
              {!native
                ? 'Your browser will ask which tab, window or screen to share, and offers to bring its audio along in the same dialog.'
                : tab === 'screen'
                  ? 'No screens found.'
                  : 'No open windows to share.'}
            </p>
          )}

          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {shown.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => setSelected(source.id)}
                  onDoubleClick={start}
                  aria-pressed={selected === source.id}
                  className={`w-full cursor-pointer overflow-hidden rounded-lg border-2 bg-surface-900 text-start transition-colors duration-200 ${
                    selected === source.id
                      ? 'border-accent'
                      : 'border-transparent hover:border-surface-700'
                  }`}
                >
                  <img
                    src={source.thumbnail}
                    alt=""
                    className="aspect-video w-full bg-black object-contain"
                  />
                  <p className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-300">
                    {source.appIcon && <img src={source.appIcon} alt="" className="h-4 w-4" />}
                    <span className="truncate">{source.name}</span>
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Asked rather than guessed: a film is worth more bits and a
            soundtrack, a document is worth neither. Neither answer spends the
            resolution - that used to be what "video and motion" quietly meant,
            and it is what a share dropping to 480p turned out to be. */}
        <div className="flex gap-2 border-t border-edge px-5 pt-4">
          <IntentCard
            active={intent === 'detail'}
            onClick={() => setIntent('detail')}
            title="Text and detail"
            hint="A desktop, a document, code. Stays razor-sharp; 60 fps high bitrate."
          />
          <IntentCard
            active={intent === 'motion'}
            onClick={() => setIntent('motion')}
            title="Video and motion"
            hint="A film or a game. Full resolution at 60 fps, full-quality sound."
          />
        </div>

        <footer className="flex items-center gap-3 px-5 py-4">
          {native && (
            <label
              className={`flex items-center gap-2 text-sm ${
                audioSupported ? 'text-slate-300' : 'text-slate-500'
              }`}
              title={audioSupported ? undefined : 'System audio capture is Windows-only'}
            >
              <input
                type="checkbox"
                disabled={!audioSupported}
                checked={withAudio && audioSupported}
                onChange={(event) => setWithAudio(event.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Share system audio
            </label>
          )}

          {/* Whether anything has been forced, and what. Automatic says
              nothing: a line reading "automatic" on every share is noise, and
              the only state worth reporting is the one somebody chose and may
              have forgotten. */}
          {(share.maxBitrate !== null || share.frameRate !== null || share.videoCodec !== 'auto') && (
            <p className="text-xs text-amber-300/90" title="Settings → Voice & Video">
              Forced:{' '}
              {[
                share.maxBitrate !== null && `${Math.round(share.maxBitrate / 1_000_000)} Mbps`,
                share.frameRate !== null && `${share.frameRate} fps`,
                share.videoCodec !== 'auto' && share.videoCodec,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="ms-auto cursor-pointer rounded-md px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={start}
            disabled={sources !== null && sources.length > 0 && !selected}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Go live
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function IntentCard({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 cursor-pointer rounded-lg border-2 px-3 py-2 text-start transition-colors duration-200 ${
        active ? 'border-accent bg-accent/10' : 'border-surface-700 hover:border-surface-600'
      }`}
    >
      <span className="block text-sm font-medium text-slate-100">{title}</span>
      <span className="block text-xs text-slate-400">{hint}</span>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded px-3 py-1 text-sm transition-colors duration-200 ${
        active ? 'bg-surface-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
