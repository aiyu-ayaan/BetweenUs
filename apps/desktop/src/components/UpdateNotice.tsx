/**
 * One line at the top of the window when there is a newer BetweenUs.
 *
 * The same strip as VersionNotice next to it, and for the same reason: an
 * update is worth saying and is not worth a dialog over a conversation
 * somebody is in the middle of. It can be dismissed, and dismissing it is per
 * version, so the next release says so again.
 *
 * What the buttons do differs by client - a download and a restart on the
 * desktop, a reload in a tab - but the deciding is all in stores/updates.ts;
 * this only draws it.
 */
import { useEffect } from 'react';
import { useUpdateStore } from '../stores/updates';
import { DownloadIcon, XIcon } from './icons';

export function UpdateNotice(): JSX.Element | null {
  const start = useUpdateStore((state) => state.start);
  const showing = useUpdateStore((state) => state.showing());
  const stage = useUpdateStore((state) => state.stage);
  const offer = useUpdateStore((state) => state.offer);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const reloadReady = useUpdateStore((state) => state.reloadReady);
  const download = useUpdateStore((state) => state.download);
  const install = useUpdateStore((state) => state.install);
  const dismiss = useUpdateStore((state) => state.dismiss);

  // The one place the watch is started, whichever client this is.
  useEffect(() => start(), [start]);

  if (!showing) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 bg-accent/15 px-4 py-1.5 text-xs text-slate-100"
    >
      <DownloadIcon className="h-3.5 w-3.5 shrink-0" />

      <span className="min-w-0 flex-1 truncate">
        {reloadReady
          ? 'A newer version of BetweenUs has been deployed. Reload to pick it up.'
          : `BetweenUs ${offer?.version ?? ''} is available.`}
        {error ? <span className="ml-2 text-amber-200">{error}</span> : null}
      </span>

      {stage === 'downloading' ? (
        <span className="shrink-0 tabular-nums text-slate-300">
          {progress < 0 ? 'Downloading…' : `Downloading… ${Math.round(progress * 100)}%`}
        </span>
      ) : null}

      {reloadReady ? (
        <NoticeButton onClick={() => location.reload()}>Reload</NoticeButton>
      ) : stage === 'available' ? (
        <NoticeButton onClick={() => void download()}>Download</NoticeButton>
      ) : stage === 'ready' ? (
        <NoticeButton onClick={() => void install()}>Restart and install</NoticeButton>
      ) : null}

      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={dismiss}
        className="cursor-pointer rounded p-1 transition-colors duration-150 hover:bg-white/10"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function NoticeButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 cursor-pointer rounded bg-white/10 px-2 py-0.5 font-semibold transition-colors duration-150 hover:bg-white/20"
    >
      {children}
    </button>
  );
}
