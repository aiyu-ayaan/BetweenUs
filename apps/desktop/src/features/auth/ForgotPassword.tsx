import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../services/api';

/**
 * The way back into an account nobody remembers the password for.
 *
 * It is two screens wearing one, and which one you get is decided by the
 * deployment rather than by anything you type. Naming an account either sends a
 * link, says the deployment has no mail server and to ask an administrator, or -
 * when an administrator has already opened a reset window on that account -
 * takes you straight to the new-password form with the token in hand.
 *
 * The three answers are deliberately not equally informative about the account.
 * "A link is on its way" is what an account that does not exist gets too,
 * because anything else would make this form a way to find out who has an
 * account here.
 */
export function ForgotPassword({ onDone }: { onDone: () => void }): JSX.Element {
  /** `ask` names the account; `reset` chooses the new password. */
  const [step, setStep] = useState<'ask' | 'reset'>('ask');
  const [identifier, setIdentifier] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetPassword = useAuthStore((state) => state.resetPassword);

  const ask = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const answer = await api.forgotPassword(identifier.trim());
      if (answer.outcome === 'reset' && answer.resetToken) {
        // An administrator authorised this one. Straight to the form, with the
        // token carried across rather than shown - nobody has to copy it.
        setToken(answer.resetToken);
        setStep('reset');
        setNotice('Your administrator has authorised a reset. Choose a new password.');
        return;
      }
      if (answer.outcome === 'unavailable') {
        setError(answer.message ?? 'This server cannot send email. Ask your administrator.');
        return;
      }
      setNotice(
        'If that account exists, a reset link is on its way. Paste the code from the email below.',
      );
      setStep('reset');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (password !== confirmation) {
      setError('Those two passwords are not the same.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token.trim(), password);
      // A successful reset signs in; the shell takes over from here.
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center bg-ground px-4">
      <div className="drag-region absolute inset-x-0 top-0 h-10" />
      <div className="w-full max-w-md animate-pop rounded-2xl border border-edge bg-surface-900 p-8 shadow-pop">
        <h1 className="mb-1 text-2xl font-semibold text-slate-50">
          {step === 'ask' ? 'Forgot your password?' : 'Choose a new password'}
        </h1>
        <p className="mb-6 text-sm text-slate-400">
          {step === 'ask'
            ? 'Enter your username or email address.'
            : 'This signs every other device out.'}
        </p>

        {step === 'ask' ? (
          <form onSubmit={(event) => void ask(event)} className="space-y-4" noValidate>
            <Field
              id="forgot-identifier"
              label="Email or username"
              value={identifier}
              onChange={setIdentifier}
              placeholder="you@example.com or ayaan"
              autoComplete="username"
            />
            <Submit busy={busy} label="Continue" />
          </form>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            {/* Hidden when it arrived from the administrator's window: there is
                nothing to paste, and an empty box would look like a step. */}
            {!token && (
              <Field
                id="reset-token"
                label="Code from the email"
                value={token}
                onChange={setToken}
                placeholder="Paste it here"
              />
            )}
            <Field
              id="reset-password"
              label="New password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <Field
              id="reset-confirm"
              label="Repeat it"
              type="password"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
            />
            <Submit busy={busy} label="Set password" />
          </form>
        )}

        {notice && (
          <p className="mt-4 rounded-md bg-accent/10 px-3 py-2 text-sm text-slate-300">{notice}</p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onDone}
          className="mt-6 w-full cursor-pointer text-sm text-slate-400 transition-colors duration-200 hover:text-slate-200"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
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
        required
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 transition-colors duration-200 focus:border-accent"
      />
    </div>
  );
}

function Submit({ busy, label }: { busy: boolean; label: string }): JSX.Element {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? 'Please wait…' : label}
    </button>
  );
}
