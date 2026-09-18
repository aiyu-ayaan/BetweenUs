/** Run with `tsx src/features/chat/mention-query.check.ts`. Mention query extractor tests. */
import assert from 'node:assert/strict';
import { mentionQueryAt } from './mention-query';

// Caret immediately after `@`
assert.deepEqual(mentionQueryAt('@', 1), { term: '', start: 0 });

// Caret after complete username without prefix
assert.deepEqual(mentionQueryAt('@ali', 4), { term: 'ali', start: 0 });

// Caret after username with prefix text
assert.deepEqual(mentionQueryAt('hello @ali', 10), { term: 'ali', start: 6 });
assert.deepEqual(mentionQueryAt('hello @ali and more', 10), { term: 'ali', start: 6 });
assert.deepEqual(mentionQueryAt('hey @', 5), { term: '', start: 4 });

// Email address should not trigger mention
assert.equal(mentionQueryAt('test@example.com', 16), null);
assert.equal(mentionQueryAt('test@example.com', 5), null);

// Mid-word `@` should not trigger mention
assert.equal(mentionQueryAt('hello@world', 11), null);
assert.equal(mentionQueryAt('hello@world', 6), null);

// Space inside term should return null
assert.equal(mentionQueryAt('@ali smith', 10), null);

// Empty string or no `@`
assert.equal(mentionQueryAt('', 0), null);
assert.equal(mentionQueryAt('hello world', 5), null);
assert.equal(mentionQueryAt('hello world', 11), null);

// Caret before `@`
assert.equal(mentionQueryAt('@ali', 0), null);

// Caret out of bounds
assert.equal(mentionQueryAt('@ali', -1), null);
assert.equal(mentionQueryAt('@ali', 100), null);

// Mention right after newline
assert.deepEqual(mentionQueryAt('line1\n@bob', 10), { term: 'bob', start: 6 });

// Autocomplete right after typing `@` with leading space
assert.deepEqual(mentionQueryAt('hello @', 7), { term: '', start: 6 });

// Mention with allowed characters: dots, underscores, dashes, numbers
assert.deepEqual(mentionQueryAt('@user.name_1-2', 14), { term: 'user.name_1-2', start: 0 });

// Disallowed characters in term (e.g. exclamation, question mark)
assert.equal(mentionQueryAt('@user!', 6), null);
assert.equal(mentionQueryAt('@user?', 6), null);

// Multiple mentions - cursor in second mention
assert.deepEqual(mentionQueryAt('@first and @second', 18), { term: 'second', start: 11 });
// Multiple mentions - cursor in first mention
assert.deepEqual(mentionQueryAt('@first and @second', 6), { term: 'first', start: 0 });

console.log('mention-query.check.ts ok');
