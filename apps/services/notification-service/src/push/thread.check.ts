/**
 * Who a thread reply wakes. Wrong in one direction it is every member of a
 * busy channel buzzed for a side conversation; wrong in the other it is the
 * person who started the thread never hearing that anybody answered.
 */
import assert from 'node:assert/strict';
import { threadMentionsOnly, threadParticipants } from './thread';

const root = 'root-author';
const ada = 'ada';
const grace = 'grace';
const lurker = 'lurker';

// The root's author is in the thread before anybody has replied.
assert.deepEqual([...threadParticipants(root, [], ada)], [root]);
// Earlier repliers are in it too, once each.
assert.deepEqual(
  [...threadParticipants(root, [ada, grace, ada], lurker)].sort(),
  [ada, grace, root].sort(),
);
// Whoever wrote this reply is never told about it - including the root's
// author answering in their own thread.
assert.ok(!threadParticipants(root, [ada], root).has(root));
assert.ok(!threadParticipants(root, [ada], ada).has(ada));
// A root that is gone still leaves the repliers in the thread.
assert.deepEqual([...threadParticipants(null, [grace], ada)], [grace]);

const people = threadParticipants(root, [grace], ada);
// A participant hears about every reply...
assert.equal(threadMentionsOnly(grace, false, people), false);
assert.equal(threadMentionsOnly(root, false, people), false);
// ...unless the channel is mentions-only for them, which a thread does not undo.
assert.equal(threadMentionsOnly(grace, true, people), true);
// Anybody else in the channel only hears about it when they are mentioned.
assert.equal(threadMentionsOnly(lurker, false, people), true);

console.log('thread push: ok');
