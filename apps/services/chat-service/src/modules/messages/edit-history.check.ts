/**
 * Self-check: which messages keep their earlier versions, and how a version is
 * dated. The promises being pinned: a disappearing or one-time message keeps
 * nothing, and a version is timed from the edit before it, not the send.
 */
import assert from 'node:assert/strict';
import { keepsEditHistory, toEditVersion, writtenAtOf, type EditHistoryCandidate } from './edit-history';

const sent = new Date('2026-09-01T10:00:00.000Z');
const edited = new Date('2026-09-01T11:00:00.000Z');
const base: EditHistoryCandidate = {
  content: 'sealed',
  createdAt: sent,
  editedAt: null,
  expiresAt: null,
  viewOnce: false,
};

assert.equal(keepsEditHistory(base), true);
assert.equal(keepsEditHistory({ ...base, expiresAt: new Date('2026-09-02T00:00:00.000Z') }), false);
assert.equal(keepsEditHistory({ ...base, viewOnce: true }), false);
assert.equal(keepsEditHistory({ ...base, content: '' }), false);

assert.equal(writtenAtOf(base), sent);
assert.equal(writtenAtOf({ ...base, editedAt: edited }), edited);

const version = toEditVersion({ id: 'e1', content: 'sealed', writtenAt: sent, createdAt: edited });
assert.deepEqual(version, {
  id: 'e1',
  content: 'sealed',
  writtenAt: sent.toISOString(),
  replacedAt: edited.toISOString(),
});
console.log('edit-history.check ok');
