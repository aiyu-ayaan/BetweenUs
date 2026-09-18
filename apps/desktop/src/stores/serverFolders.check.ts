/**
 * Self-check for the server rail's folders: `tsx src/stores/serverFolders.check.ts`.
 *
 * `railEntries` is the whole feature - everything else is a localStorage write
 * and some JSX. What is worth pinning down is the set of states a rail that
 * has been in use for a while is genuinely in: a folder naming a server the
 * account has left, a server nobody filed, a folder that has emptied out, and
 * storage that two windows or a text editor got to. Each of those draws
 * something, and none of them may draw a server twice or throw.
 */
import assert from 'node:assert/strict';
import type { ServerWithRole } from '@betweenus/shared-types';
import { folderUnread, parseFolders, railEntries, type ServerFolder } from './serverFolders';

function server(id: string): ServerWithRole {
  return {
    id,
    name: id,
    slug: id,
    iconUrl: null,
    ownerId: 'u1',
    messageTtlSeconds: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'MEMBER',
    permissions: [],
  };
}

function folder(id: string, serverIds: string[], collapsed = false): ServerFolder {
  return { id, name: id, serverIds, collapsed };
}

const ids = (entries: ReturnType<typeof railEntries>): string[] =>
  entries.map((entry) => (entry.kind === 'server' ? entry.server.id : `[${entry.folder.id}]`));

// --- nothing filed ------------------------------------------------------------

// No folders is not a special case, it is the rail every account starts with.
assert.deepEqual(ids(railEntries([], [server('a'), server('b')])), ['a', 'b']);
assert.deepEqual(railEntries([folder('f', [])], []).length, 1);

// --- a folder sits where its first member sat --------------------------------

{
  const entries = railEntries([folder('f', ['b'])], [server('a'), server('b'), server('c')]);
  // `b` is folded away in place: `a` before it and `c` after it, exactly as
  // the server list had them.
  assert.deepEqual(ids(entries), ['a', '[f]', 'c']);
  const folded = entries[1];
  assert.equal(folded?.kind, 'folder');
  assert.deepEqual(folded?.kind === 'folder' ? folded.servers.map((s) => s.id) : [], ['b']);
}

// --- a server the account has left -------------------------------------------

{
  const stale = folder('f', ['gone', 'a']);
  const entries = railEntries([stale], [server('a')]);
  assert.deepEqual(ids(entries), ['[f]']);
  const folded = entries[0];
  assert.deepEqual(folded?.kind === 'folder' ? folded.servers.map((s) => s.id) : [], ['a']);
  // The ghost is not drawn, and the folder still remembers it - rejoining the
  // server puts it back where it was rather than loose at the end.
  assert.deepEqual(stale.serverIds, ['gone', 'a']);
  const rejoined = railEntries([stale], [server('gone'), server('a')])[0];
  assert.deepEqual(rejoined?.kind === 'folder' ? rejoined.servers.map((s) => s.id) : [], ['gone', 'a']);
}

// --- a folder whose servers have all gone -------------------------------------

{
  // Still drawn, empty, at the end: somebody named this folder, and a lapsed
  // membership is not permission to throw their work away.
  const entries = railEntries([folder('empty', ['gone'])], [server('a')]);
  assert.deepEqual(ids(entries), ['a', '[empty]']);
  const folded = entries[1];
  assert.deepEqual(folded?.kind === 'folder' ? folded.servers : null, []);
}

// --- the same server in two folders -------------------------------------------

{
  const entries = railEntries([folder('one', ['a']), folder('two', ['a', 'b'])], [server('a'), server('b')]);
  // Drawn exactly once, in the first folder that names it, and the second
  // folder is still drawn with what is left of it.
  assert.deepEqual(ids(entries), ['[one]', '[two]']);
  const members = entries.flatMap((entry) => (entry.kind === 'folder' ? entry.servers.map((s) => s.id) : []));
  assert.deepEqual(members, ['a', 'b']);
  assert.equal(new Set(members).size, members.length, 'no server may be drawn twice');
}

// Every live server reaches the rail exactly once, whatever the folders say.
{
  const live = [server('a'), server('b'), server('c'), server('d')];
  const entries = railEntries(
    [folder('one', ['d', 'ghost', 'b']), folder('two', ['b', 'd']), folder('three', [])],
    live,
  );
  const drawn = entries.flatMap((entry) =>
    entry.kind === 'server' ? [entry.server.id] : entry.servers.map((s) => s.id),
  );
  assert.deepEqual([...drawn].sort(), ['a', 'b', 'c', 'd']);
}

// --- a collapsed folder still has to show unread ------------------------------

{
  const unread: Record<string, number> = { a: 3, b: 1 };
  assert.equal(folderUnread([server('a'), server('b')], (id) => unread[id] ?? 0), 4);
  // A folder holding nothing unread shows no badge rather than a zero.
  assert.equal(folderUnread([server('c')], (id) => unread[id] ?? 0), 0);
  assert.equal(folderUnread([], () => 9), 0);
}

// --- malformed or absent storage ----------------------------------------------

assert.deepEqual(parseFolders(null), []);
assert.deepEqual(parseFolders(''), []);
assert.deepEqual(parseFolders('not json at all'), []);
assert.deepEqual(parseFolders('{"folders":[]}'), [], 'an object is not the list this ever wrote');
assert.deepEqual(parseFolders('[1,2,3]'), []);
assert.deepEqual(parseFolders('[{"id":"f"}]'), [], 'half a folder is not a folder');
assert.deepEqual(parseFolders('[{"id":"f","name":"n","serverIds":[1]}]'), []);
assert.deepEqual(parseFolders('[{"id":"f","name":"n","serverIds":["a"]}]'), [
  { id: 'f', name: 'n', serverIds: ['a'], collapsed: false },
]);
// An older write with no `collapsed` opens, which is the state that shows the
// most and so the safe one to guess.
assert.deepEqual(parseFolders('[{"id":"f","name":"n","serverIds":[],"collapsed":"yes"}]')[0]?.collapsed, false);
assert.deepEqual(parseFolders('[{"id":"f","name":"n","serverIds":[],"collapsed":true}]')[0]?.collapsed, true);

// Junk mixed with a real folder keeps the real one rather than dropping the lot.
assert.deepEqual(parseFolders('[null,{"id":"f","name":"n","serverIds":[]},7]').map((f) => f.id), ['f']);

// And whatever survives parsing has to be drawable.
assert.doesNotThrow(() => railEntries(parseFolders('[{"id":"f","name":"n","serverIds":["x"]}]'), []));

console.log('server-folders check ok');
