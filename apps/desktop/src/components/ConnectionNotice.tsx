import { useEffect, useState } from 'react';
import {
  connectionState,
  onConnectionChange,
  retryConnection,
  type ConnectionState,
} from '../services/socket';
import { t } from '../services/i18n';

/**
 * What the realtime connection is doing, when it is not simply working.
 *
 * Nothing is drawn while both sockets are up, which is almost always. A window
 * whose sockets are down looks identical to one that is idle - no messages
 * arrive either way - and that silence was the thing people read as the app
 * being broken. It is a bar rather than a modal: the history on screen is still
 * readable, and reading it is most of what somebody does while waiting.
 *
 * The worked example for `services/i18n.ts`: every string here goes through
 * `t(key, english)`, which is what the rest of the client's screens will look
 * like once each is extracted. Nothing else in the app does yet - the
 * extraction is per-screen and this is one screen.
 */
export function ConnectionNotice(): JSX.Element | null {
  const [state, setState] = useState<ConnectionState>(connectionState);

  useEffect(() => onConnectionChange(setState), []);

  if (state === 'online') return null;

  const reconnecting = state === 'reconnecting';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 px-3 py-1.5 text-sm ${
        reconnecting ? 'bg-amber-500/15 text-amber-200' : 'bg-red-500/15 text-red-200'
      }`}
    >
      {reconnecting && <Spinner />}
      <span>{reconnecting
          ? t('connection.reconnecting', 'Reconnecting…')
          : t('connection.offline', 'Disconnected')}</span>
      {!reconnecting && (
        <button
          type="button"
          onClick={retryConnection}
          className="rounded-md bg-red-500/20 px-2 py-0.5 font-medium hover:bg-red-500/30"
        >
          {t('connection.retry', 'Try again')}
        </button>
      )}
    </div>
  );
}

/** The circular one. `animate-spin` on a ring with a quarter of it missing. */
function Spinner(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
