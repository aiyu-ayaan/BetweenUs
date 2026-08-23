import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../services/api';
import {
  formatSafetyNumber,
  identityMaterial,
  safetyNumber,
  userFingerprint,
} from '../../services/safety-numbers';
import {
  clearVerified,
  markVerified,
  verificationOf,
  type VerificationState,
} from '../../services/safety-verification';
import { ShieldIcon, XIcon } from '../../components/icons';

/**
 * The screen where two people check they hold each other's real keys.
 *
 * Everything else in the encryption design protects a message from whoever
 * reads the database. This is the only part that protects against the server
 * *lying about a public key*, and it is the only part that cannot be done by
 * software alone: the comparison has to happen over a channel the server does
 * not control - a phone call, a room, anything but this app.
 *
 * So the dialog's job is not to compute the number. It is to make the
 * comparison something a person will actually do: sixty digits, grouped the way
 * they are read aloud, with a plain sentence about what a mismatch means.
 */
export function SafetyNumberDialog({
  userId,
  displayName,
  channelId,
  onClose,
}: {
  userId: string;
  displayName: string;
  channelId: string;
  onClose: () => void;
}): JSX.Element {
  const me = useAuthStore((state) => state.user);
  const [digits, setDigits] = useState<string | null>(null);
  const [theirs, setTheirs] = useState('');
  const [state, setState] = useState<VerificationState>('unverified');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        // The same directory read the channel already does. There is no
        // endpoint that answers "this one person's keys", on purpose: asking
        // about somebody through a channel you share is a question you are
        // already entitled to ask, and a per-user lookup would be a new one.
        const devices = await api.channelDevices(channelId);
        const mine = devices.filter((device) => device.userId === me?.id);
        const them = devices.filter((device) => device.userId === userId);

        const [ours, yours] = await Promise.all([
          userFingerprint(me?.id ?? '', await identityMaterial(mine)),
          userFingerprint(userId, await identityMaterial(them)),
        ]);
        if (!live) return;

        setTheirs(yours);
        setDigits(safetyNumber(ours, yours));
        setState(verificationOf(userId, yours));
      } catch (problem) {
        if (!live) return;
        setError(problem instanceof Error ? problem.message : 'Could not read the key directory');
        setDigits('');
      }
    })();

    return () => {
      live = false;
    };
  }, [channelId, me?.id, userId]);

  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md animate-pop rounded-xl border border-edge bg-surface-900 shadow-pop">
        <header className="flex items-center gap-3 border-b border-edge px-5 py-4">
          <ShieldIcon className="h-5 w-5 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-50">Safety number</h2>
            <p className="truncate text-xs text-slate-400">You and {displayName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-4">
          {state === 'changed' && (
            <p
              role="alert"
              className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
            >
              This number has changed since you last checked it. That happens
              when {displayName} adds or removes a device — and it is also what
              it would look like if somebody replaced their key. There is no way
              to tell those apart from here, so check the new number with them
              before you trust it.
            </p>
          )}

          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {digits === null && <p className="py-6 text-center text-sm text-slate-400">Working it out…</p>}

          {digits === '' && !error && (
            <p className="py-6 text-center text-sm text-slate-400">
              {displayName} has not published a device key yet, so there is
              nothing to compare. Their messages cannot be sealed for them
              either — this is the same thing seen from another angle.
            </p>
          )}

          {digits && (
            <>
              <pre className="select-text rounded-lg bg-surface-850 px-4 py-4 text-center font-mono text-base leading-8 tracking-[0.15em] text-slate-100">
                {formatSafetyNumber(digits)}
              </pre>

              <p className="mt-4 text-sm text-slate-400">
                Read these digits to {displayName} over something that is not
                this app — a phone call, or in person. If they see the same
                sixty digits, nobody is between you.
              </p>

              <div className="mt-4 flex gap-2">
                {state === 'verified' ? (
                  <button
                    type="button"
                    onClick={() => {
                      clearVerified(userId);
                      setState('unverified');
                    }}
                    className="cursor-pointer rounded bg-surface-700 px-4 py-2 text-sm text-slate-100 transition-colors duration-200 hover:bg-white/[0.1]"
                  >
                    Mark as unverified
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      markVerified(userId, theirs);
                      setState('verified');
                    }}
                    className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98]"
                  >
                    They match
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(formatSafetyNumber(digits))}
                  className="cursor-pointer rounded bg-surface-700 px-4 py-2 text-sm text-slate-200 transition-colors duration-200 hover:bg-white/[0.1]"
                >
                  Copy
                </button>
              </div>

              {state === 'verified' && (
                <p className="mt-3 text-xs text-emerald-300">
                  Verified on this machine. Verification is not shared with the
                  server or with your other devices — a server that could set it
                  could also lie about the key it applies to.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
