/**
 * Self-check for how a Discord webhook payload becomes one plaintext body.
 *
 * Run with `pnpm --filter @betweenus/chat-service check`. Worth pinning because
 * the input is written by somebody else's integration against somebody else's
 * API: the interesting cases are all "a field arrived that this app does not
 * model", and the required behaviour is to keep the words and drop the
 * furniture rather than to refuse the request.
 */
import assert from 'node:assert/strict';
import { ignoredFields, renderBody } from './webhooks.service';

// --- the ordinary case: a bare content field ---------------------------------

assert.equal(renderBody({ content: 'Deploy finished' }), 'Deploy finished');
assert.equal(renderBody({ content: '  padded  ' }), 'padded', 'trimmed');

// --- nothing at all --------------------------------------------------------

// The service refuses these; what matters here is that they render empty
// rather than to whitespace, because whitespace would pass a length check.
assert.equal(renderBody({}), '');
assert.equal(renderBody({ content: '   ' }), '');
assert.equal(renderBody({ embeds: [] }), '');
assert.equal(renderBody({ embeds: [{}] }), '', 'an embed with no fields is not content');

// --- embeds become Markdown -------------------------------------------------

const embedded = renderBody({
  embeds: [{ title: 'Build #402', description: 'All checks passed' }],
});
assert.equal(embedded, '**Build #402**\nAll checks passed');

// A title with a URL is the one part of an embed anybody clicks.
assert.equal(
  renderBody({ embeds: [{ title: 'Build #402', url: 'https://ci.example.com/402' }] }),
  '**[Build #402](https://ci.example.com/402)**',
);

// Fields keep their names. Dropping them would leave a column of bare values
// with nothing saying what each one is.
assert.equal(
  renderBody({
    embeds: [{ fields: [{ name: 'Branch', value: 'master', inline: true }] }],
  }),
  '**Branch**\nmaster',
);

// A field with a value and no name is still worth printing.
assert.equal(renderBody({ embeds: [{ fields: [{ name: '', value: 'bare' }] }] }), 'bare');

// Content and embeds both, separated so they do not read as one paragraph.
assert.equal(
  renderBody({ content: 'Heads up', embeds: [{ description: 'disk 91% full' }] }),
  'Heads up\n\ndisk 91% full',
);

assert.equal(renderBody({ embeds: [{ footer: { text: 'ci-runner-3' } }] }), '_ci-runner-3_');

// --- hostile and malformed input --------------------------------------------

// These arrive from integrations written against Discord, so the renderer reads
// every value defensively rather than trusting the declared type. A payload
// that throws here would be a 500 on somebody's deploy notification.
assert.equal(renderBody({ content: 42 as never }), '', 'a non-string content is not content');
assert.equal(renderBody({ embeds: 'nope' as never }), '');
assert.equal(renderBody({ embeds: [{ fields: 'nope' as never }] }), '');
assert.equal(renderBody({ embeds: [{ title: null as never, description: 'kept' }] }), 'kept');

// --- the embed cap ----------------------------------------------------------

const many = renderBody({ embeds: Array.from({ length: 25 }, (_, i) => ({ title: `e${i}` })) });
assert.equal(many.split('\n\n').length, 10, 'at most WEBHOOK_EMBED_MAX embeds are rendered');
assert.ok(many.includes('**e9**') && !many.includes('**e10**'), 'and it keeps the first ten');

// --- what was accepted and then not used ------------------------------------

// Reported rather than swallowed: an integration whose picture or name is not
// showing up has no way to tell a policy from a bug, and would go looking for
// the bug.
assert.deepEqual(ignoredFields({ content: 'hi' }), [], 'a plain message ignores nothing');
assert.deepEqual(ignoredFields({ avatar_url: 'https://elsewhere.example/x.png' }), ['avatar_url']);
assert.deepEqual(ignoredFields({ username: 'Deploy Bot' }), ['username']);
assert.deepEqual(ignoredFields({ embeds: [{ color: 5814783 }] }), ['embed color']);
assert.ok(
  ignoredFields({ embeds: Array.from({ length: 25 }, () => ({})) }).includes('embeds beyond 10'),
);
// An empty string is not an override anybody made; saying it was ignored would
// be noise on every payload from a client that always sends the key.
assert.deepEqual(ignoredFields({ username: '', avatar_url: '' }), []);

console.log('webhook-body: ok');
