import assert from 'node:assert/strict';
import { NotificationRegistry } from './notification-registry';

/** A notification that records having been closed. */
function fake(): { close(): void; closed: boolean } {
  const it = {
    closed: false,
    close(): void {
      it.closed = true;
    },
  };
  return it;
}

// --- one per channel ---------------------------------------------------------

{
  const registry = new NotificationRegistry();
  const first = fake();
  const second = fake();

  registry.post('c1', first);
  registry.post('c1', second);

  assert.equal(first.closed, true, 'a replaced notification is closed, not left beside the new one');
  assert.equal(second.closed, false, 'the new one stays up');
  assert.equal(registry.size, 1, 'one channel holds one notification');
}

// --- dismissing --------------------------------------------------------------

{
  const registry = new NotificationRegistry();
  const note = fake();
  registry.post('c1', note);

  registry.close('c1');
  assert.equal(note.closed, true, 'closing a channel closes what is standing for it');
  assert.equal(registry.size, 0, 'and stops holding it');

  // The common case by far: the read marker moves constantly, and almost none
  // of those channels have anything on screen.
  registry.close('c1');
  registry.close('never-seen');
}

// --- the identity check, which is the bug this file exists for ---------------

{
  const registry = new NotificationRegistry();
  const first = fake();
  const second = fake();

  registry.post('c1', first);
  registry.post('c1', second);
  // `first` was closed by the replacement above, and its close event arrives
  // now - after `second` is already the one standing. Forgetting by key alone
  // would drop `second` and leave the app unable to dismiss what is on screen.
  registry.forget('c1', first);

  assert.equal(registry.size, 1, 'a late close event must not evict the live notification');
  registry.close('c1');
  assert.equal(second.closed, true, 'and the live one is still dismissable');
}

{
  const registry = new NotificationRegistry();
  const note = fake();
  registry.post('c1', note);
  // The person dismissed it themselves. Nothing is left held, or the map grows
  // for the life of the app.
  registry.forget('c1', note);
  assert.equal(registry.size, 0, 'a notification closed by the OS stops being held');
}

// --- channels do not collide -------------------------------------------------

{
  const registry = new NotificationRegistry();
  const a = fake();
  const b = fake();
  registry.post('c1', a);
  registry.post('c2', b);
  registry.close('c1');
  assert.equal(a.closed, true);
  assert.equal(b.closed, false, 'reading one conversation leaves another conversation alone');
  assert.equal(registry.size, 1);
}

console.log('notification-registry.check.ts ok');
