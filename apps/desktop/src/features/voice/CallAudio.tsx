/**
 * Every remote voice track in the call, playing, for as long as the call lasts.
 *
 * Mounted once at the root of the workbench and never unmounted, which is the
 * whole point of it: the sinks used to live in the sidebar panel, so switching
 * to another server - or to the home screen, which swaps the sidebar entirely -
 * tore down every `<audio>` element and the call went silent while it was
 * still, by every other measure, connected.
 *
 * It renders nothing. The panel says who is here; this makes them audible.
 */
import { useVoiceStore } from '../../stores/voice';
import { AudioSink } from './MediaSink';

export function CallAudio(): JSX.Element | null {
  const status = useVoiceStore((state) => state.status);
  const tiles = useVoiceStore((state) => state.tiles);
  const watching = useVoiceStore((state) => state.watching);

  if (status === 'idle') return null;

  return (
    <>
      {tiles.map((tile) => (
        <span key={tile.identity}>
          {tile.audioTrack && <AudioSink track={tile.audioTrack} userId={tile.userId} />}
          {/* A shared screen brings its sound only to whoever is watching it,
              and at whatever volume that person is set to: turning somebody
              down and then being blasted by their film would be a lie. */}
          {tile.screenAudioTrack && watching === tile.identity && (
            <AudioSink track={tile.screenAudioTrack} userId={tile.userId} />
          )}
        </span>
      ))}
    </>
  );
}
