/**
 * "This client and this deployment do not agree."
 *
 * Until now a client too old for a deployment found out through a request that
 * failed - a 404 on a route that moved, or a body it could not parse - which
 * reads as "the app is broken" and gets reported as one. The contract number is
 * one integer that only moves when something a client can notice changes, so
 * the mismatch can be said in a sentence instead.
 *
 * Deliberately not a wall: the client is very often still usable, and refusing
 * to start over a number would turn a warning into an outage. It can also be
 * dismissed, because somebody who has read it and cannot upgrade today should
 * not have to read it again every launch.
 */
import { useEffect, useState } from 'react';
import { API_CONTRACT_VERSION } from '@betweenus/shared-types';
import { fetchServerContract, serverUrl, versionVerdict } from '../services/endpoint';
import { XIcon } from './icons';

const DISMISSED_KEY = 'betweenus.versionNoticeDismissed';

const WORDING = {
  'client-too-old':
    'This deployment is newer than this client. Some things will not work until the app is updated.',
  'server-too-old':
    'This deployment is older than this client. Some things will not work until the server is updated.',
} as const;

export function VersionNotice(): JSX.Element | null {
  const [verdict, setVerdict] = useState<keyof typeof WORDING | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchServerContract().then((contract) => {
      if (cancelled) return;
      const result = versionVerdict(contract, API_CONTRACT_VERSION);
      if (!result) return;
      // Dismissal is per deployment and per pair of numbers: a different server,
      // or either side moving, is news again.
      const stamp = `${serverUrl()}:${contract}:${API_CONTRACT_VERSION}`;
      if (localStorage.getItem(DISMISSED_KEY) === stamp) return;
      setVerdict(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!verdict) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-200"
    >
      <span className="min-w-0 flex-1">{WORDING[verdict]}</span>
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => {
          void fetchServerContract().then((contract) => {
            localStorage.setItem(
              DISMISSED_KEY,
              `${serverUrl()}:${contract}:${API_CONTRACT_VERSION}`,
            );
          });
          setVerdict(null);
        }}
        className="cursor-pointer rounded p-1 transition-colors duration-150 hover:bg-white/10"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
