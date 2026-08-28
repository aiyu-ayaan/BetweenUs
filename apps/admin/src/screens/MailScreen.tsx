import { useEffect, useState, type FormEvent } from 'react';
import type { AdminSmtpSettings } from '@betweenus/shared-types';
import { api } from '../api';
import { messageOf } from '../App';

/**
 * The deployment's outgoing mail server.
 *
 * It is what decides whether anybody on this deployment can reset a forgotten
 * password on their own. With nothing here every client's forgot-password
 * screen says "ask your administrator" instead of offering to send anything -
 * which is the honest answer for a self-hosted deployment that has no mail
 * server and does not want one, and is why this screen is optional rather than
 * a step in setup.
 */
export function MailScreen(): JSX.Element {
  const [settings, setSettings] = useState<AdminSmtpSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .smtp()
      .then(setSettings)
      .catch((caught: unknown) => setError(messageOf(caught)));
  }, []);

  if (error) {
    return (
      <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (!settings) return <p className="text-sm text-slate-500">Loading…</p>;

  return <MailForm settings={settings} onSaved={setSettings} />;
}

function MailForm({
  settings,
  onSaved,
}: {
  settings: AdminSmtpSettings;
  onSaved: (settings: AdminSmtpSettings) => void;
}): JSX.Element {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [host, setHost] = useState(settings.host);
  const [port, setPort] = useState(String(settings.port));
  const [secure, setSecure] = useState(settings.secure);
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState(settings.fromAddress);
  const [fromName, setFromName] = useState(settings.fromName);
  const [testTo, setTestTo] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // An empty password field means "keep the stored one" - it can never be
      // shown back, so the form has to be savable without retyping it.
      const saved = await api.updateSmtp({
        enabled,
        host: host.trim(),
        port: Number(port) || 587,
        secure,
        username: username.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
        fromAddress: fromAddress.trim(),
        fromName: fromName.trim(),
      });
      setPassword('');
      setStatus('Saved.');
      onSaved(saved);
    } catch (caught) {
      setError(messageOf(caught));
      setEnabled(settings.enabled);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The transport's own refusal is shown verbatim rather than flattened into
   * "failed". "535 authentication failed" and "getaddrinfo ENOTFOUND" are two
   * different afternoons, and this is the only screen anybody reads the
   * difference on.
   */
  const test = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await api.testSmtp(testTo.trim() || undefined);
      if (result.ok) setStatus('Test message sent.');
      else setError(result.error ?? 'The mail server refused it.');
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-6">
      <article className="rounded-lg border border-surface-700 bg-surface-800 p-6">
        <header className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-50">Outgoing mail (SMTP)</h2>
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              settings.enabled
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-surface-700 text-slate-400'
            }`}
          >
            {settings.enabled ? 'enabled' : 'disabled'}
          </span>
        </header>

        <p className="mb-5 text-sm text-slate-400">
          With no mail server configured, the forgot-password screen tells people to ask an
          administrator, and you reset an account from the Users tab instead. Nothing else on
          BetweenUs sends email.
        </p>

        <form onSubmit={(event) => void save(event)} className="grid gap-4 sm:grid-cols-2">
          <Field id="smtp-host" label="Host" value={host} onChange={setHost} placeholder="smtp.example.com" />
          <Field id="smtp-port" label="Port" value={port} onChange={setPort} placeholder="587" />
          <Field
            id="smtp-username"
            label="Username"
            value={username}
            onChange={setUsername}
            placeholder="Blank for an unauthenticated relay"
          />
          <Field
            id="smtp-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={settings.hasPassword ? 'Stored - leave blank to keep' : 'Optional'}
          />
          <Field
            id="smtp-from"
            label="From address"
            value={fromAddress}
            onChange={setFromAddress}
            placeholder="betweenus@example.com"
          />
          <Field id="smtp-from-name" label="From name" value={fromName} onChange={setFromName} />

          <div className="sm:col-span-2 flex flex-wrap items-center gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={secure}
                onChange={(event) => setSecure(event.target.checked)}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
              Implicit TLS (port 465)
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
              Send password reset emails
            </label>

            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>

        <div className="mt-6 border-t border-surface-700 pt-5">
          <p className="mb-3 text-sm text-slate-400">
            Send one message, so the settings are proved before somebody needs them.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={testTo}
              onChange={(event) => setTestTo(event.target.value)}
              aria-label="Send the test to"
              placeholder="Your own address by default"
              className="w-72 rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void test()}
              disabled={busy}
              className="cursor-pointer rounded-md border border-surface-700 px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              Send test
            </button>

            {status && <span className="text-sm text-emerald-300">{status}</span>}
            {error && (
              <span role="alert" className="text-sm text-red-300">
                {error}
              </span>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}): JSX.Element {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-accent"
      />
    </div>
  );
}
