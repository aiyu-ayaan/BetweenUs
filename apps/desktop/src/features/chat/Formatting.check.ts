/**
 * Run with `tsx src/features/chat/Formatting.check.ts`.
 *
 * What a spoiler and a code block put on the page, rendered to markup the way
 * the message list would draw them. The reveal itself is a click and is not
 * exercised here; what is, is that nothing hidden reaches the page's text in a
 * form a screen reader or a stray `user-select` would hand over.
 */
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeBlock, Spoiler, SpoilerScope, TOKEN_CLASS } from './Formatting';

// A hidden spoiler is a labelled button whose words are invisible and
// hidden from assistive tech.
{
  const html = renderToStaticMarkup(createElement(Spoiler, null, 'the butler'));
  assert.match(html, /role="button"/);
  assert.match(html, /aria-label="Spoiler, press to reveal"/);
  assert.match(html, /<span aria-hidden="true" class="invisible">the butler<\/span>/);
}

// Inside a message that has not been opened, the same.
{
  const html = renderToStaticMarkup(
    createElement(SpoilerScope, { messageId: 'never-opened' }, createElement(Spoiler, null, 'x')),
  );
  assert.match(html, /class="invisible"/);
}

// A code block with a known language is coloured token by token, and every
// character of the code is still there, in order.
{
  const html = renderToStaticMarkup(createElement(CodeBlock, { code: 'const a = "b";', lang: 'ts' }));
  assert.match(html, /data-lang="ts"/);
  assert.match(html, new RegExp(`<span class="${TOKEN_CLASS.keyword}">const</span>`));
  assert.match(html, new RegExp(`<span class="${TOKEN_CLASS.string}">&quot;b&quot;</span>`));
  assert.equal(html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'), 'const a = "b";');
}

// No language: monospace and uncoloured, with no language attribute.
{
  const html = renderToStaticMarkup(createElement(CodeBlock, { code: "it's", lang: '' }));
  assert.equal(html.includes('syntax-'), false);
  assert.equal(html.includes('data-lang'), false);
  assert.match(html, /<code>it&#x27;s<\/code>/);
}

console.log('Formatting.check.ts ok');
