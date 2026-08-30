/** Run with `tsx src/components/ProfileCard.check.ts`. Where the hover card lands. */
import assert from 'node:assert/strict';
import { place } from './ProfileCard';

const screen = { width: 1440, height: 900 };
const CARD = { width: 288, height: 200 };

// --- the ordinary case: beside the row, on the left ---------------------------

// A member column sits at the right-hand edge, so the card opens leftwards.
const beside = place({ x: 1180, y: 300 }, CARD.width, CARD.height, screen);
assert.equal(beside.x, 1180 - 288 - 12, 'a card opens to the left of what it belongs to');
assert.equal(beside.y, 300, 'and starts level with it');

// --- and flips when there is no room on that side -----------------------------

// A name at the far left has nothing to its left, so the card goes the other way.
const flipped = place({ x: 20, y: 300 }, CARD.width, CARD.height, screen);
assert.equal(flipped.x, 32, 'no room on the left means opening to the right');

// A screen narrower than the card plus both gaps cannot satisfy either side;
// the card is pinned to the edge rather than pushed off it.
const narrow = place({ x: 10, y: 100 }, CARD.width, CARD.height, { width: 300, height: 900 });
assert.equal(narrow.x, 8, 'a card never starts off the left edge');
assert.ok(narrow.x >= 8, 'nor past it');

// --- and slides up rather than hanging off the bottom -------------------------

const low = place({ x: 1180, y: 860 }, CARD.width, CARD.height, screen);
assert.equal(low.y, 900 - 200 - 8, 'a row near the bottom slides the card up to fit');
assert.ok(low.y + CARD.height <= screen.height, 'and it is fully on screen');

// A card taller than the window is pinned to the top rather than centred off
// both edges - the top is the half worth reading.
const tall = place({ x: 600, y: 500 }, CARD.width, 2_000, screen);
assert.equal(tall.y, 8);

// --- height is measured, not assumed -----------------------------------------

// The same anchor with a taller card is placed differently. This is why the
// component measures itself instead of trusting the constant it guessed with.
const short = place({ x: 1180, y: 800 }, CARD.width, 160, screen);
const long = place({ x: 1180, y: 800 }, CARD.width, 320, screen);
assert.ok(long.y < short.y, 'a longer about line pushes the card further up');

console.log('ProfileCard: ok');
