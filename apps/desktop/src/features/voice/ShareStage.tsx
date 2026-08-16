/**
 * A shared screen, everybody's cursor on top of it, and the mouse if you were
 * given it.
 *
 * The picture has its own element here rather than going through `VideoSink`
 * because everything else on this component is measured against it. A screen is
 * letterboxed inside its box - `object-contain`, because a desktop must not be
 * cropped - so the picture is not the element, and a cursor placed at the
 * element's coordinates would drift further from the truth the worse the aspect
 * ratio mismatch got. `contentBox` is where the pixels actually are, and every
 * fraction on the wire is a fraction of that.
 *
 * Cursors carry names because a call has more than two people in it. Whoever is
 * driving is the only one whose pointer does anything, but anybody watching can
 * point at the thing they are talking about, which is most of what pointing at
 * a screen share is for. Teams draws them the same way.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShareControlStore } from '../../stores/shareControl';
import { modifiersOf } from '../../services/keyboard';
import type { VoiceShare } from '../../stores/voice';
import { contentBox, fractionIn, EMPTY_BOX, type Box } from './stage-geometry';

export function ShareStage({ share }: { share: VoiceShare }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [content, setContent] = useState<Box>(EMPTY_BOX);

  const pointers = useShareControlStore((state) => state.pointers);
  const driving = useShareControlStore((state) => state.driving);
  const sendPointer = useShareControlStore((state) => state.sendPointer);
  const clearPointer = useShareControlStore((state) => state.clearPointer);
  const sendMouse = useShareControlStore((state) => state.sendMouse);
  const sendKey = useShareControlStore((state) => state.sendKey);
  const stop = useShareControlStore((state) => state.stop);

  const controlling = driving === share.identity;

  useEffect(() => attachTrack(videoRef.current, share.track), [share.track]);

  // Where the picture is inside the element. Recomputed when the window
  // changes and when the far end changes what it is sending - switching monitor
  // mid-call changes the aspect ratio under us.
  const measure = useCallback((): void => {
    const element = videoRef.current;
    if (!element) return setContent(EMPTY_BOX);
    const rect = element.getBoundingClientRect();
    setContent(contentBox(rect.width, rect.height, element.videoWidth, element.videoHeight));
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('loadedmetadata', measure);
    element.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      element.removeEventListener('loadedmetadata', measure);
      element.removeEventListener('resize', measure);
    };
  }, [measure, share.track]);

  // Escape hands the mouse back and never travels: without one key that always
  // stays local, a share that stops responding traps the keyboard.
  useEffect(() => {
    if (!controlling) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        stop();
        return;
      }
      event.preventDefault();
      // The modifiers ride along with every key: the far side reconstructs the
      // chord from them rather than from the order three events arrived in.
      sendKey(
        event.type === 'keydown' ? 'down' : 'up',
        event.key,
        event.code,
        modifiersOf(event),
      );
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [controlling, sendKey, stop]);

  // Leaving the call, or the stage, must not leave a cursor behind on
  // everybody else's screen.
  useEffect(() => () => clearPointer(), [clearPointer]);

  /** Pointer position as a fraction of the picture, or null when outside it. */
  const pointFrom = (event: React.MouseEvent): { x: number; y: number } | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    return fractionIn(content, event.clientX - rect.left, event.clientY - rect.top);
  };

  const buttonOf = (button: number): 'left' | 'right' | 'middle' =>
    button === 2 ? 'right' : button === 1 ? 'middle' : 'left';

  // Only what arrived over the wire, so this is everybody else by construction:
  // a client never records its own pointer, it has a real one.
  const others = Object.values(pointers);

  return (
    <div
      className={`relative h-full w-full ${controlling ? 'cursor-crosshair' : ''}`}
      onMouseMove={(event) => {
        const point = pointFrom(event);
        if (!point) return;
        sendPointer(point.x, point.y);
        if (controlling) sendMouse('move', point.x, point.y);
      }}
      onMouseLeave={clearPointer}
      onMouseDown={(event) => {
        const point = pointFrom(event);
        if (point && controlling) sendMouse('down', point.x, point.y, buttonOf(event.button));
      }}
      onMouseUp={(event) => {
        const point = pointFrom(event);
        if (point && controlling) sendMouse('up', point.x, point.y, buttonOf(event.button));
      }}
      onWheel={(event) => {
        if (controlling) sendMouse('wheel', 0, 0, undefined, Math.sign(event.deltaY) * 120);
      }}
      // The other machine's own context menu is what a right-click is for.
      onContextMenu={(event) => event.preventDefault()}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />

      {/* Cursors sit in the picture, not in the element: the black bars either
          side of a 16:10 desktop in a 16:9 box are not part of the screen. */}
      {others.map((pointer) => (
        <span
          key={pointer.identity}
          aria-hidden="true"
          className="pointer-events-none absolute z-10 -translate-y-0.5"
          style={{
            left: content.left + pointer.x * content.width,
            top: content.top + pointer.y * content.height,
          }}
        >
          <CursorMark />
          <span className="ml-3 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-white shadow">
            {pointer.name}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Puts a track on an element and takes it off again. */
function attachTrack(
  element: HTMLVideoElement | null,
  track: MediaStreamTrack | null,
): () => void {
  if (!element || !track) return () => undefined;
  element.srcObject = new MediaStream([track]);
  return () => {
    element.srcObject = null;
  };
}

function CursorMark(): JSX.Element {
  return (
    <svg viewBox="0 0 12 18" className="absolute h-4 w-3 drop-shadow" fill="currentColor">
      <path
        d="M0 0l11 11H5.5l-1.5 6z"
        className="text-accent"
        fill="currentColor"
        stroke="white"
        strokeWidth="1"
      />
    </svg>
  );
}
