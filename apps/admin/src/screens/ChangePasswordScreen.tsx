import { useState, type FormEvent } from 'react';
import type { PublicUser } from '@betweenus/shared-types';
import { api, session } from '../api';
import { messageOf } from '../App';

/**
 * Forced on first login. The generated password was printed to a terminal and
 * possibly a scrollback buffer, so it is treated as already compromised.
 */
export function ChangePasswordScreen({
  user,
  onDone,
}: {
  user: PublicUser;
  onDone: (user: PublicUser) => void;
}): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError('The two new passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      // Every old session died; this response carries the replacement.
      session.start(result);
      onDone(result.user);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-surface-800 p-8 shadow-2xl" noValidate>
        <h1 className="mb-1 text-2xl font-semibold text-slate-50">Choose a password</h1>
        <p className="mb-6 text-sm text-slate-400">
          @{user.username} is still on the password the CLI generated. Pick your own to continue.
        </p>

        <Field
          id="current"
          label="Generated password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <Field
          id="new"
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
        />
        <Field
          id="confirm"
          label="Repeat new password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />

        {error && (
          <p role="alert" className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-slate-100 focus:border-accent"
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
