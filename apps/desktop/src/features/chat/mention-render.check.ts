/** Run with `tsx src/features/chat/mention-render.check.ts`. */
import assert from 'node:assert/strict';
import React from 'react';
import { MENTION_REGEX, messageBubbleClasses, renderTextWithLinks } from './ChatView';
import { mentionsMe, type MentionTarget } from '../../services/mentions';

// =============================================================================
// 1. MENTION_REGEX Pattern & Splitting Tests
// =============================================================================

// Matches single standard usernames
const testMentions = ['@mobile', '@everyone', '@here', '@user.name', '@user_123', '@user-name', '@a'];
for (const mention of testMentions) {
  const matches = mention.match(MENTION_REGEX);
  assert.ok(matches, `Expected ${mention} to match MENTION_REGEX`);
  assert.equal(matches[0], mention, `Expected match to equal full mention ${mention}`);
}

// Does not match bare '@'
assert.equal('@'.match(MENTION_REGEX), null, 'Bare "@" should not match MENTION_REGEX');
assert.equal('hello @ world'.match(MENTION_REGEX), null, 'Standalone "@" with whitespace should not match');

// Splitting text with MENTION_REGEX preserves delimiters due to capturing group
const sampleText = 'Hello @mobile and @everyone!';
const splitResult = sampleText.split(MENTION_REGEX);
assert.deepEqual(
  splitResult,
  ['Hello ', '@mobile', ' and ', '@everyone', '!'],
  'Splitting should preserve text before, between, and after mention tokens',
);

// Mention at the start and end of string
const edgeText = '@mobile hi @here';
assert.deepEqual(
  edgeText.split(MENTION_REGEX),
  ['', '@mobile', ' hi ', '@here', ''],
  'Splitting should handle mentions at string boundaries',
);

// Consecutive mentions
const consecutiveText = '@alice @bob';
assert.deepEqual(
  consecutiveText.split(MENTION_REGEX),
  ['', '@alice', ' ', '@bob', ''],
  'Splitting should handle consecutive mentions separated by space',
);

// =============================================================================
// 2. mentionsMe Address Resolution Tests
// =============================================================================

const userMe: MentionTarget = {
  username: 'mobile',
  displayName: 'Mobile User',
};

// Mentioned by exact username
assert.equal(mentionsMe('hey @mobile check this', userMe), true);
assert.equal(mentionsMe('@mobile', userMe), true);
assert.equal(mentionsMe('@mobile:', userMe), true);
assert.equal(mentionsMe('(@mobile)', userMe), true);

// Case-insensitivity
assert.equal(mentionsMe('@MOBILE check this', userMe), true);
assert.equal(mentionsMe('@Mobile check this', userMe), true);

// Mentioned by displayName
assert.equal(mentionsMe('calling @Mobile User please', userMe), true);
assert.equal(mentionsMe('hey @mobile user!', userMe), true);

// Room broadcasts address everyone
assert.equal(mentionsMe('alert @everyone please join', userMe), true);
assert.equal(mentionsMe('quick question @here', userMe), true);

// Negative cases - boundary violations & different users
assert.equal(mentionsMe('hey @mobilephone', userMe), false, 'Prefix extension should not match');
assert.equal(mentionsMe('hey @bob', userMe), false, 'Different username should not match');
assert.equal(mentionsMe('email us at support@mobile.com', userMe), false, 'Email address should not trigger mention');
assert.equal(mentionsMe('no mentions here', userMe), false, 'Text without mentions should not match');
assert.equal(mentionsMe('', userMe), false, 'Empty string should return false');
assert.equal(mentionsMe(null, userMe), false, 'Null content should return false');
assert.equal(mentionsMe(undefined, userMe), false, 'Undefined content should return false');

// =============================================================================
// 3. Message Bubble Alert Highlight Style (messageBubbleClasses)
// =============================================================================

// When mentioned by another user, bubble must have leading accent border and accent tint
const mentionedAlertClass = messageBubbleClasses({
  isSelf: false,
  isMentioned: true,
  deleted: false,
});
assert.ok(
  mentionedAlertClass.includes('border-s-2 border-accent'),
  'Mentioned bubble must contain border-s-2 border-accent',
);
assert.ok(
  mentionedAlertClass.includes('bg-accent/15'),
  'Mentioned bubble must contain bg-accent/15 background tint',
);
assert.ok(
  !mentionedAlertClass.includes('bg-surface-800'),
  'Mentioned bubble must replace standard bg-surface-800',
);

// Ordinary incoming message (not mentioned) gets standard bg-surface-800
const standardClass = messageBubbleClasses({
  isSelf: false,
  isMentioned: false,
  deleted: false,
});
assert.equal(standardClass, 'bg-surface-800', 'Unmentioned incoming message gets standard surface background');

// Own message always gets self styling (bg-accent/25) even if content contains user mention
const selfMentionedClass = messageBubbleClasses({
  isSelf: true,
  isMentioned: true,
  deleted: false,
});
assert.equal(selfMentionedClass, 'bg-accent/25', 'Self message always gets self bubble styling');

// Deleted message always gets tombstone styling (bg-surface-800/60) regardless of mention
const deletedClass = messageBubbleClasses({
  isSelf: false,
  isMentioned: true,
  deleted: true,
});
assert.equal(deletedClass, 'bg-surface-800/60', 'Deleted message always gets tombstone styling');

// =============================================================================
// 4. renderTextWithLinks Pill Rendering
// =============================================================================

const vdom = renderTextWithLinks('@mobile Hi dost');
assert.ok(React.isValidElement(vdom), 'renderTextWithLinks should return a valid React element');

// Inspect rendered children
const outerFragment = vdom as React.ReactElement<{ children: React.ReactNode[] }>;
assert.ok(Array.isArray(outerFragment.props.children), 'Outer fragment should have array children');

const firstPart = outerFragment.props.children[0] as React.ReactElement<{ children: React.ReactNode[] }>;
const subparts = firstPart.props.children;

// Subparts should contain a mention pill span with '@mobile'
const pillSpan = subparts.find(
  (child): child is React.ReactElement<{ className?: string; children?: React.ReactNode }> => {
    return (
      React.isValidElement(child) &&
      child.type === 'span' &&
      typeof (child.props as { className?: string }).className === 'string' &&
      Boolean((child.props as { className?: string }).className?.includes('bg-accent/20'))
    );
  },
);

assert.ok(pillSpan, 'Should render an inline span with bg-accent/20 for @mobile');
assert.equal(pillSpan.props.children, '@mobile', 'Mention pill text should equal @mobile');
assert.ok(pillSpan.props.className?.includes('text-accent'), 'Pill should have text-accent');
assert.ok(pillSpan.props.className?.includes('rounded'), 'Pill should have rounded styling');

// URL with @ sign should remain an <a> link and not be split into mention pills
const urlVdom = renderTextWithLinks('Visit https://example.com/@alice for info');
const urlOuter = urlVdom as React.ReactElement<{ children: React.ReactNode[] }>;
const urlAnchor = urlOuter.props.children.find(
  (child): child is React.ReactElement<{ href?: string }> => {
    return React.isValidElement(child) && child.type === 'a';
  },
);
assert.ok(urlAnchor, 'URL containing @ must render as an <a> anchor tag');
assert.equal(urlAnchor.props.href, 'https://example.com/@alice', 'Anchor href should match original URL intact');

console.log('mention-render.check.ts ok');
