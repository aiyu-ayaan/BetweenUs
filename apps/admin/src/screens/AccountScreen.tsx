import { useState } from 'react';
import type { PublicUser } from '@betweenus/shared-types';
import { api, session } from '../api';
import { messageOf } from '../App';

/** The administrator's own account: name, username, password. */
export function AccountScreen({
  user,
  onUpdated,
}: {
  user: PublicUser;
  onUpdated: (user: PublicUser) => void;
}): JSX.Element {
  return (
    <div className="grid max-w-3xl gap-6">
      <ProfileCard user={user} onUpdated={onUpdated} />
      <PasswordCard onUpdated={onUpdated} />
    </div>
  );
}

function ProfileCard({
  user,
  onUpdated,
}: {
  user: PublicUser;
  onUpdated: (user: PublicUser) => void;
}): JSX.Element {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [state, setState] = useState<{ error?: string; status?: string }>({});
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setState({});
    try {
      const updated = await api.updateAccount({ username: username.trim(), displayName: displayName.trim() });
      onUpdated(updated);
      setState({ status: 'Saved.' });
    } catch (caught) {
      setState({ error: messageOf(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Profile">
      <Field id="username" label="Username" value={username} onChange={setUsername} />
      <Field id="displayName" label="Display name" value={displayName} onChange={setDisplayName} />
      <Footer busy={busy} onSave={() => void save()} {...state} />
    </Card>
  );
}

function PasswordCard({ onUpdated }: { onUpdated: (user: PublicUser) => void }): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [state, setState] = useState<{ error?: string; status?: string }>({});
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setState({});
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      // Changing the password revoked every session; keep this one alive.
      session.start(result);
      onUpdated(result.user);
      setCurrentPassword('');
      setNewPassword('');
      setState({ status: 'Password changed. Other sessions were signed out.' });
    } catch (caught) {
      setState({ error: messageOf(caught) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Password">
      <Field
        id="current"
        label="Current password"
        type="password"
        value={currentPassword}
        onChange={setCurrentPassword}
      />
      <Field
        id="new"
        label="New password"
        type="password"
        value={newPassword}
        onChange={setNewPassword}
        hint="At least 8 characters, with a letter and a number."
      />
      <Footer busy={busy} onSave={() => void save()} {...state} />
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded-lg border border-surface-700 bg-surface-800 p-6">
      <h2 className="mb-4 text-lg font-semibold text-slate-50">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-sm rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-slate-100 focus:border-accent"
      />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Footer({
  busy,
  onSave,
  status,
  error,
}: {
  busy: boolean;
  onSave: () => void;
  status?: string;
  error?: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {status && <span className="text-sm text-emerald-300">{status}</span>}
      {error && (
        <span role="alert" className="text-sm text-red-300">
          {error}
        </span>
      )}
    </div>
  );
}
