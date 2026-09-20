/**
 * What the bucket walk will and will not delete.
 *
 * This is the one sweep in the codebase that can destroy data nothing else
 * would have touched, because it decides from the *absence* of a reference
 * rather than from the presence of a row. Three things therefore have to be
 * true and are asserted here rather than trusted: a referenced key is never
 * collected, a young key is never collected however unreferenced, and a key
 * inside the multipart scratch space is never collected at all.
 *
 * `keyOf` gets the same treatment, for a duller reason with the same
 * consequence: a picture is referenced by URL and collected by key, so a URL
 * shape this cannot parse is somebody's avatar being deleted.
 */
import assert from 'node:assert/strict';
import { MULTIPART_PREFIX } from '@betweenus/storage';
import { collectable, keyOf } from './storage-reconciler';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-20T12:00:00.000Z');
const grace = 7 * DAY;

const old = new Date(now.getTime() - 30 * DAY);
const young = new Date(now.getTime() - 1 * DAY);

const referenced = new Set(['pictures/ada/picture.png', 'attachments/ada/live']);

// The whole point: an object nothing names, old enough to be sure, goes.
assert.equal(collectable({ key: 'pictures/ada/old.png', modifiedAt: old }, referenced, now, grace), true);

// A referenced object is never collected, however old. This is the assertion
// that stands between the pass and every avatar in the deployment.
assert.equal(
  collectable({ key: 'pictures/ada/picture.png', modifiedAt: old }, referenced, now, grace),
  false,
);

// An unreferenced object younger than the grace survives. An object is written
// before the row that names it, so a young orphan is usually an upload two
// seconds from being claimed - collecting it would be this sweep causing the
// exact loss it exists to prevent.
assert.equal(
  collectable({ key: 'attachments/ada/fresh', modifiedAt: young }, referenced, now, grace),
  false,
);

// Parts in flight are not objects. They have their own sweep with a much
// shorter clock, and deleting them here would break an upload that is running.
assert.equal(
  collectable({ key: `${MULTIPART_PREFIX}/abc/00001`, modifiedAt: old }, referenced, now, grace),
  false,
);

// --- keyOf ------------------------------------------------------------------

// A local deployment stores the service path.
assert.equal(keyOf('/api/v1/uploads/pictures/ada/picture.png'), 'pictures/ada/picture.png');
// An S3 deployment stores an absolute URL, and the key is the same string.
assert.equal(keyOf('https://bucket.example/pictures/ada/picture.png'), 'pictures/ada/picture.png');
// A bare key, which is what `statuses.mediaKey` and `attachments.key` hold.
assert.equal(keyOf('pictures/ada/picture.png'), 'pictures/ada/picture.png');
// Nothing to collect, and nothing to guess at.
assert.equal(keyOf(null), null);
assert.equal(keyOf(''), null);

console.log('storage-reconciler: ok');
