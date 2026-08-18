/** Self-check: `pnpm --filter @betweenus/logger check`. Fails loudly if redaction breaks. */
import assert from 'node:assert/strict';
import { Logger } from './index';

const captured: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string) => {
  captured.push(String(chunk));
  return true;
}) as typeof process.stdout.write;

const log = new Logger('check', 'debug').child({ requestId: 'req-1' });
log.info('login attempt', {
  password: 'hunter2',
  nested: { refreshToken: 'abc', safe: 'keep' },
  list: [{ authorization: 'Bearer x' }],
});
log.debug('below threshold check');

process.stdout.write = originalWrite;

const line = JSON.parse(captured[0] ?? '{}') as Record<string, unknown>;
assert.equal(line.password, '[redacted]');
assert.deepEqual(line.nested, { refreshToken: '[redacted]', safe: 'keep' });
assert.deepEqual(line.list, [{ authorization: '[redacted]' }]);
assert.equal(line.requestId, 'req-1');
assert.equal(line.service, 'check');

// A logger above the message level must emit nothing.
const quiet = new Logger('check', 'error');
const before = captured.length;
process.stdout.write = ((chunk: string) => {
  captured.push(String(chunk));
  return true;
}) as typeof process.stdout.write;
quiet.info('should not appear');
process.stdout.write = originalWrite;
assert.equal(captured.length, before);

console.log('logger check ok');
