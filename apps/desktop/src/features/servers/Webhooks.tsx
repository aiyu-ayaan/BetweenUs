/**
 * A server's webhooks: the URLs outside systems post into its channels with.
 *
 * One list across every channel rather than a panel buried inside each one.
 * "Which robots can write in this server, and where" is one question, and it is
 * the question somebody arrives here holding - a per-channel panel makes them
 * open eleven channels to answer it.
 *
 * Two things on this screen are unusual and both are deliberate.
 *
 * The URL is shown **once**, when it is created or rotated, because the server
 * keeps only a hash of the token. That is a worse first-run experience than
 * Discord's re-readable URLs and a much better one than a database dump handing
 * over every integration this deployment has. The way back from losing one is
 * the Rotate button, which is why it is not tucked away.
 *
 * And the panel says, in as many words, that a webhook's messages are not
 * encrypted. Everything else in this app is sealed on the client; a webhook
 * cannot be, because the sender holds no key. Somebody adding one is spending
 * that guarantee for that channel, and they should be told before they press
 * the button rather than by noticing a badge later.
 */
import { useEffect, useState } from 'react';
import {
  WEBHOOK_NAME_MAX_LENGTH,
  type Channel,
  type WebhookSummary,
  type WebhookWithToken,
} from '@betweenus/shared-types';
import { api } from '../../services/api';
import { useChatStore } from '../../stores/chat';
import { Avatar } from '../../components/Avatar';
import { PicturePicker } from '../../components/PicturePicker';
import { HashIcon, TrashIcon } from '../../components/icons';

export function Webhooks(): JSX.Element {
  const channels = useChatStore((state) => state.channels);
  // A voice channel has no message history to post into.
  const textChannels = channels.filter((channel) => channel.type === 'TEXT');

  const [hooks, setHooks] = useState<WebhookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The URL of whatever was just created or rotated. Shown once, then gone. */
  const [minted, setMinted] = useState<WebhookWithToken | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // One request per channel: there is no server-wide list endpoint, because
      // the permission that guards this is a channel permission and a
      // server-wide answer would have to be filtered back down to exactly this.
      const lists = await Promise.all(
        textChannels.map((channel) =>
          // A channel this account cannot manage answers 403; that is not an
          // error on this screen, it is a channel that contributes nothing to
          // the list.
          api.webhooks(channel.id).catch(() => [] as WebhookSummary[]),
        ),
      );
      setHooks(lists.flat());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Webhooks could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Keyed on the ids rather than the array, which is a new reference on every
    // store update and would refetch the whole list on every keystroke
    // elsewhere in the app.
  }, [textChannels.map((channel) => channel.id).join(',')]);

  useEffect(() => {
    if (!target && textChannels[0]) setTarget(textChannels[0].id);
  }, [textChannels, target]);

  const create = async (): Promise<void> => {
    if (!name.trim() || !target) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api.createWebhook({ channelId: target, name: name.trim() });
      setMinted(made);
      setCopied(false);
      setName('');
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That webhook could not be created');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (webhookId: string): Promise<void> => {
    setError(null);
    try {
      const rotated = await api.rotateWebhook(webhookId);
      setMinted(rotated);
      setCopied(false);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That URL could not be replaced');
    }
  };

  const remove = async (webhookId: string): Promise<void> => {
    setError(null);
    try {
      await api.deleteWebhook(webhookId);
      setHooks((current) => current.filter((hook) => hook.id !== webhookId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That webhook could not be removed');
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Webhooks</h1>
      <p className="mt-1 text-sm text-slate-400">
        A URL another system can post into a channel with — a build server, an alerting stack,
        anything that can make an HTTP request. It uses the same request shape Discord does, so an
        integration already pointed at Discord works by changing only the URL.
      </p>

      {/* Said before the button rather than discovered afterwards. */}
      {/* Amber, which is what every other notice in this app that says "this is
          not what you assume" already uses - BackupNotice, ClockNotice,
          VersionNotice. There is no `warning` colour token; those all reach
          for Tailwind's amber directly, so this does too rather than
          inventing a fifth spelling. */}
      <div className="mt-4 rounded-lg bg-amber-500/[0.12] p-4 text-amber-100">
        <p className="text-sm font-semibold">Webhook messages are not encrypted</p>
        <p className="mt-1 text-sm text-amber-200/90">
          Everything people write here is sealed on their own device, and this deployment cannot
          read it. A webhook has no key and cannot be given one — handing a channel key to a script
          would hand away the channel — so what it posts is stored in the clear and this deployment
          can read it. Every client marks those messages so nobody has to guess which is which.
        </p>
      </div>

      {minted && (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/[0.08] p-4">
          <p className="text-sm font-semibold text-slate-100">
            Copy this URL now — it is not shown again
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Only a hash of it is kept, so nobody, including this deployment, can read it back. If
            you lose it, rotate the webhook for a new one.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-surface-900 px-3 py-2 text-xs text-slate-200">
              {minted.url}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(minted.url).then(() => setCopied(true));
              }}
              className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setMinted(null)}
              className="cursor-pointer rounded px-3 py-2 text-sm text-slate-400 transition-colors duration-200 hover:text-slate-200"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <h2 className="mt-8 text-base font-semibold text-slate-50">New webhook</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400">
            Name
          </span>
          <input
            value={name}
            maxLength={WEBHOOK_NAME_MAX_LENGTH}
            placeholder="Deploys"
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded bg-surface-900 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-edge transition-shadow duration-200 focus:ring-2 focus:ring-accent"
          />
        </label>
        <label className="min-w-[180px] flex-1">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-400">
            Channel
          </span>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="w-full cursor-pointer rounded bg-surface-900 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-edge transition-shadow duration-200 focus:ring-2 focus:ring-accent"
          >
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !name.trim() || !target}
          onClick={() => void create()}
          className="cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <h2 className="mt-8 text-base font-semibold text-slate-50">
        {hooks.length === 1 ? '1 webhook' : `${hooks.length} webhooks`}
      </h2>
      {loading ? (
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : hooks.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          Nothing posts into this server from outside it.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {hooks.map((hook) => (
            <WebhookRow
              key={hook.id}
              hook={hook}
              channel={textChannels.find((channel) => channel.id === hook.channelId)}
              onRotate={() => void rotate(hook.id)}
              onRemove={() => void remove(hook.id)}
              onChanged={(next) =>
                setHooks((current) =>
                  current.map((item) => (item.id === next.id ? next : item)),
                )
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}

function WebhookRow({
  hook,
  channel,
  onRotate,
  onRemove,
  onChanged,
}: {
  hook: WebhookSummary;
  channel: Channel | undefined;
  onRotate: () => void;
  onRemove: () => void;
  onChanged: (next: WebhookSummary) => void;
}): JSX.Element {
  // Two presses to delete, in place, rather than a confirmation dialog: a
  // webhook that vanishes on one press takes a deploy pipeline with it, and
  // whoever set that pipeline up is not the person clicking.
  const [armed, setArmed] = useState(false);

  return (
    <li className="rounded-lg bg-surface-800 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={hook.name} avatarUrl={hook.avatarUrl} size="md" ringColour="border-surface-800" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-slate-100">{hook.name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-slate-400">
            <HashIcon className="h-3 w-3 shrink-0" />
            {channel?.name ?? 'a channel you cannot see'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Opened by {hook.createdBy.displayName} ·{' '}
            {/* The first thing anybody asks about a webhook that "isn't
                working": has it ever actually delivered anything. */}
            {hook.lastUsedAt
              ? `last used ${new Date(hook.lastUsedAt).toLocaleString()}`
              : 'never used'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRotate}
            title="Issue a new URL and invalidate the current one"
            className="cursor-pointer rounded bg-surface-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors duration-200 hover:bg-white/[0.08]"
          >
            Rotate URL
          </button>
          <button
            type="button"
            onClick={() => (armed ? onRemove() : setArmed(true))}
            onBlur={() => setArmed(false)}
            className={`flex cursor-pointer items-center gap-1 rounded px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
              armed
                ? 'bg-danger text-white'
                : 'bg-surface-700 text-slate-300 hover:bg-danger hover:text-white'
            }`}
          >
            <TrashIcon className="h-3 w-3" />
            {armed ? 'Really delete' : 'Delete'}
          </button>
        </div>
      </div>

      <div className="mt-3 border-t border-edge pt-3">
        <PicturePicker
          label="webhook picture"
          onChange={async (avatarUrl) => {
            onChanged(await api.updateWebhook(hook.id, { avatarUrl }));
          }}
          onClear={
            hook.avatarUrl
              ? async () => {
                  onChanged(await api.updateWebhook(hook.id, { avatarUrl: null }));
                }
              : undefined
          }
        />
      </div>
    </li>
  );
}
