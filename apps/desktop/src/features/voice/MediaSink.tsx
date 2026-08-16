/**
 * Attaches media tracks to real DOM elements and detaches on unmount.
 *
 * A track from the mesh is a plain `MediaStreamTrack`, so attaching is wrapping
 * it in a `MediaStream` and handing that to the element. One stream per sink
 * rather than a shared one: two elements pointed at the same stream fight over
 * it when either unmounts.
 */
import { useEffect, useRef } from 'react';
import { useAudioSettings } from '../../stores/audioSettings';
import { elementVolume, usePeerAudio } from '../../stores/peerAudio';

export function VideoSink({
  track,
  // A camera fills its tile; a shared screen must not be cropped.
  fit = 'cover',
}: {
  track: MediaStreamTrack;
  fit?: 'cover' | 'contain';
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = new MediaStream([track]);
    return () => {
      element.srcObject = null;
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

/**
 * `userId` is whose voice this is, so the per-person volume can be applied.
 * Absent for anything that belongs to nobody in particular.
 */
export function AudioSink({
  track,
  userId,
}: {
  track: MediaStreamTrack;
  userId?: string;
}): JSX.Element {
  const ref = useRef<HTMLAudioElement>(null);
  const outputDeviceId = useAudioSettings((state) => state.settings.outputDeviceId);
  // Subscribed to the map rather than to one entry: a person with no entry is
  // at the default, and there is nothing to subscribe to until they are not.
  const people = usePeerAudio((state) => state.people);
  const volume = elementVolume(userId ? people[userId] : undefined);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = new MediaStream([track]);
    // Autoplay policy can still refuse the first one; a call is entered by
    // clicking, so this is a formality rather than the thing that makes it work.
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [track]);

  // Applied to the element rather than to the track: muting a track would stop
  // it being decoded, and then unmuting waits for the next keyframe of somebody
  // already mid-sentence.
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  // Which speakers to use. There is no room object to ask any more, so the sink
  // that owns the element is the thing that can answer it.
  useEffect(() => {
    const element = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!element?.setSinkId) return;
    void element.setSinkId(outputDeviceId ?? 'default').catch(() => undefined);
  }, [outputDeviceId]);

  return <audio ref={ref} autoPlay />;
}
