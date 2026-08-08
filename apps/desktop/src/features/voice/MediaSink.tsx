/** Attaches LiveKit tracks to real DOM elements and detaches on unmount. */
import { useEffect, useRef } from 'react';
import type { Track } from 'livekit-client';

export function VideoSink({
  track,
  // A camera fills its tile; a shared screen must not be cropped.
  fit = 'cover',
}: {
  track: Track;
  fit?: 'cover' | 'contain';
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
    />
  );
}

export function AudioSink({ track }: { track: Track }): JSX.Element {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return <audio ref={ref} autoPlay />;
}
