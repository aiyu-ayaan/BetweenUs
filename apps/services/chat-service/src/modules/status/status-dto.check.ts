/**
 * The post body, put through the same pipe the running service uses.
 *
 * This file exists because of one bug and would have caught it in a second: a
 * custom `@Transform` on `keys` replaced the conversion `@Type` does, the wraps
 * arrived as plain objects, and the global pipe's `forbidNonWhitelisted` -
 * which sees a plain object as a class with no known properties - refused every
 * post with "keys.0.property recipientUserId should not exist". Nothing in a
 * typecheck can see that: the types were right and the runtime was not.
 *
 * So the options here are the ones `packages/nest-common` sets, and the body is
 * shaped the way multipart delivers one - every field a string, `keys` a JSON
 * blob - rather than the way a JSON client would.
 */
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { CreateStatusDto } from './status.controller';

/** What `packages/nest-common` passes to `ValidationPipe`. */
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true } as const;

const wrap = (recipientUserId: string) => ({
  recipientUserId,
  recipientDeviceId: 'laptop',
  senderPublicKey: '{"kty":"EC"}',
  wrappedKey: 'c2VhbGVk',
  iv: 'aXY=',
});

/**
 * Every complaint the pipe would make, flattened.
 *
 * Recursive, and that is the point: a refusal about a wrap is not on the `keys`
 * error, it is three levels down in `children` - `keys` -> `0` -> the property.
 * A first version of this file read only the top level, saw an empty
 * `constraints` there, and passed against the very bug it was written for.
 */
function complaints(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateStatusDto, body);
  return flatten(validateSync(dto, OPTIONS));
}

function flatten(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flatten(error.children ?? []),
  ]);
}

const ada = '11111111-1111-4111-8111-111111111111';
const grace = '22222222-2222-4222-8222-222222222222';

// A text post with two wraps: the shape every client sends, and the one that
// used to be refused. The messages are kept in the failure so a regression
// reads as itself rather than as "1 error".
const text = complaints({
  kind: 'TEXT',
  caption: '{"v":1,"epoch":0,"iv":"aXY=","ct":"Y3Q="}',
  background: '#0F172A',
  senderDeviceId: 'phone',
  keys: JSON.stringify([wrap(ada), wrap(grace)]),
});
assert.deepEqual(text, [], 'the shape every client sends is accepted');

// The wraps really are validated, rather than passing because nothing looked:
// a device id that is not there is a refusal, not a default.
const missing = complaints({
  kind: 'TEXT',
  caption: 'sealed',
  senderDeviceId: 'phone',
  keys: JSON.stringify([{ ...wrap(ada), recipientDeviceId: undefined }]),
});
assert.ok(
  missing.some((complaint) => complaint.includes('recipientDeviceId')),
  'a wrap with no device id is refused, and the refusal names the field',
);

// And a field nobody declared is still refused, which is the protection
// `forbidNonWhitelisted` is there for - the fix must not have turned it off.
const extra = complaints({
  kind: 'TEXT',
  caption: 'sealed',
  senderDeviceId: 'phone',
  keys: JSON.stringify([{ ...wrap(ada), plaintext: 'oops' }]),
});
assert.deepEqual(extra, ['property plaintext should not exist']);

// A `keys` field that is not JSON at all refuses in the ordinary shape rather
// than throwing a SyntaxError out of the pipe.
const rubbish = complaints({
  kind: 'TEXT',
  caption: 'sealed',
  senderDeviceId: 'phone',
  keys: 'not json',
});
assert.deepEqual(
  rubbish,
  [],
  'an unparseable bundle is an empty one, which is a post only its author can read',
);

// A video post carries the IV and the type beside the file, and neither is a
// property the pipe strips.
const video = complaints({
  kind: 'VIDEO',
  caption: 'sealed',
  durationMs: '4000',
  mediaIv: 'aXY=',
  mediaType: 'video/mp4',
  senderDeviceId: 'phone',
  keys: JSON.stringify([wrap(ada)]),
});
assert.deepEqual(video, [], 'the IV and the type travel beside the file');

console.log('status dto check ok');
