/**
 * Filters and the background blur, on your own tile, inside the call.
 *
 * The same argument the device picker makes: the full set of camera controls
 * lives in Settings → Voice & Video, and the moment somebody wants a filter is
 * the moment they can see their own face and have decided they do not like it.
 * Sending them to a settings screen to find out means leaving the picture they
 * are judging the change against.
 *
 * So it is a button on the self-view, and the preview *is* the setting: the
 * pipeline applies the effect to the published track, and the self tile draws
 * that same track, so what is on screen while this panel is open is exactly
 * what everybody else is receiving.
 *
 * It writes to the store the settings screen writes to, so the two can never
 * disagree about what is on - and the voice store applies it to the running
 * call without reopening the camera.
 */
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAudioSettings } from '../../stores/audioSettings';
import { FILTERS, PORTRAIT_BLUR, effectsSupported } from '../../services/camera-effects';
import { SparklesIcon, XIcon } from '../../components/icons';

const FILTER_LABELS: Record<string, string> = {
  none: 'None',
  warm: 'Warm',
  cool: 'Cool',
  vivid: 'Vivid',
  mono: 'Mono',
  soft: 'Soft',
};

const PORTRAIT_LABELS: Record<string, string> = {
  off: 'Off',
  light: 'Light',
  strong: 'Strong',
};

export function CameraLook({
  anchor,
  onClose,
}: {
  anchor?: HTMLElement | null;
  onClose: () => void;
}): JSX.Element {
  const settings = useAudioSettings((state) => state.settings);
  const update = useAudioSettings((state) => state.update);
  const panel = useRef<HTMLDivElement>(null);
  const supported = effectsSupported();

  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const updatePosition = (): void => {
      const rect = anchor.getBoundingClientRect();
      const popupWidth = 240;
      const popupHeight = panel.current?.offsetHeight || 320;
      const margin = 8;

      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;

      // When room below is too tight (e.g. tile in bottom-right corner), flip upwards
      const openUpwards = spaceBelow < popupHeight && spaceAbove > spaceBelow;

      let right = window.innerWidth - rect.right;
      if (right + popupWidth > window.innerWidth - margin) {
        right = Math.max(margin, window.innerWidth - popupWidth - margin);
      }
      right = Math.max(margin, right);

      if (openUpwards) {
        setCoords({
          bottom: window.innerHeight - rect.top + margin,
          right,
          maxHeight: Math.max(160, spaceAbove - margin),
        });
      } else {
        setCoords({
          top: rect.bottom + margin,
          right,
          maxHeight: Math.max(160, spaceBelow - margin),
        });
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchor]);

  // Closes on a click away or Escape, the same way `DevicePicker` does - a
  // pointerdown rather than a click, so a drag that starts outside counts.
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panel.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose, anchor]);

  const camera = settings.camera;

  const content = (
    <div
      ref={panel}
      role="dialog"
      aria-label="Camera look"
      style={
        coords
          ? {
              position: 'fixed',
              ...(coords.bottom !== undefined ? { bottom: coords.bottom } : { top: coords.top }),
              right: coords.right,
              maxHeight: coords.maxHeight,
            }
          : { position: 'fixed', top: 48, right: 16 }
      }
      className="z-[90] w-60 space-y-3 overflow-y-auto animate-pop rounded-xl border border-edge bg-surface-900/95 p-3 shadow-pop backdrop-blur-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Look</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {!supported ? (
        <p className="text-xs text-slate-400">
          This browser cannot process camera frames, so filters and the background blur are not
          available here. The desktop app and Chrome or Edge can. Your camera itself is unaffected.
        </p>
      ) : (
        <>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">Filter</span>
            <div className="grid grid-cols-3 gap-1">
              {Object.keys(FILTERS).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => update({ camera: { ...camera, filter: name } })}
                  aria-pressed={camera.filter === name}
                  className={`cursor-pointer rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    camera.filter === name
                      ? 'bg-accent text-white'
                      : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.12] hover:text-white'
                  }`}
                >
                  {FILTER_LABELS[name] ?? name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">
              Blur background
            </span>
            <div className="grid grid-cols-3 gap-1">
              {Object.keys(PORTRAIT_BLUR).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => update({ camera: { ...camera, portrait: level } })}
                  aria-pressed={camera.portrait === level}
                  className={`cursor-pointer rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    camera.portrait === level
                      ? 'bg-accent text-white'
                      : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.12] hover:text-white'
                  }`}
                >
                  {PORTRAIT_LABELS[level] ?? level}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              Everyone in the call sees this, not just you. It takes a moment to start the first
              time, and turns itself off if this machine cannot keep up.
            </p>
          </div>
        </>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

/**
 * The button that opens it, styled to match the pin on the other corner.
 *
 * Drawn only on your own tile and only while a camera is running: there is
 * nothing to filter otherwise, and a control for somebody else's picture would
 * be a control that cannot do anything.
 */
export const CameraLookButton = forwardRef<
  HTMLButtonElement,
  {
    open: boolean;
    onToggle: () => void;
    compact: boolean;
  }
>(function CameraLookButton({ open, onToggle, compact }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="Filters and background blur"
      title="Filters and background blur"
      className={`absolute end-2 top-2 z-30 flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold backdrop-blur-md transition-all duration-200 focus-visible:opacity-100 active:scale-95 ${
        open
          ? 'bg-accent text-white opacity-100'
          : 'bg-black/65 text-slate-200 opacity-0 hover:bg-black/80 hover:text-white group-hover:opacity-100'
      }`}
    >
      <SparklesIcon className="h-3.5 w-3.5" />
      {!compact && <span>Look</span>}
    </button>
  );
});
