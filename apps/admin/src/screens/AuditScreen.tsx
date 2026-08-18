/**
 * What administrators have done: who disabled or deleted whom, and when.
 *
 * Read-only by construction - the API has no write route and no delete route,
 * because a log an administrator can edit answers nothing.
 */
import { useEffect, useState } from 'react';
import type { AdminAuditEntry } from '@betweenus/shared-types';
import { api } from '../api';
import { messageOf } from '../App';

/** Actions worth a sentence rather than a dotted identifier. */
const SENTENCES: Record<string, string> = {
  'user.role.changed': 'changed the platform role of',
  'user.disabled': 'disabled',
  'user.enabled': 'enabled',
  'user.deleted': 'deleted',
  'oauth.updated': 'changed sign-in provider',
};

export function AuditScreen(): JSX.Element {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (from?: string): Promise<void> => {
    setLoading(true);
    try {
      const page = await api.audit(from);
      setEntries((current) => (from ? [...current, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-3">When</th>
              <th scope="col" className="px-4 py-3">Who</th>
              <th scope="col" className="px-4 py-3">Did</th>
              <th scope="col" className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-surface-700/60">
                <td className="px-4 py-3 text-slate-400">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-slate-200">
                  {/* Null once that administrator's own account is deleted. */}
                  {entry.actorLabel ?? 'a deleted account'}
                </td>
                <td className="px-4 py-3 text-slate-200">
                  {SENTENCES[entry.action] ?? entry.action}{' '}
                  <span className="text-slate-400">{entry.targetLabel ?? ''}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">
                  {entry.detail ? JSON.stringify(entry.detail) : ''}
                </td>
              </tr>
            ))}

            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Nothing has been done from this panel yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {cursor && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(cursor)}
          className="mt-4 w-full cursor-pointer rounded-md border border-surface-700 px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
