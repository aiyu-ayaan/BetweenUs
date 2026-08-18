/** Run with `tsx src/services/invite-link.check.ts`. Invite links, both ways. */
import assert from 'node:assert/strict';
import { inviteCodeFrom, inviteLink } from './invite-link';

assert.equal(
  inviteLink('https://betweenus.example.com', 'k3m9x2qp'),
  'https://betweenus.example.com/invite/k3m9x2qp',
);
// A base with a trailing slash must not produce a double one - `//invite` is a
// path Nginx will not match.
assert.equal(inviteLink('https://betweenus.example.com/', 'abc'), 'https://betweenus.example.com/invite/abc');

// What people actually paste.
assert.equal(inviteCodeFrom('https://betweenus.example.com/invite/k3m9x2qp'), 'k3m9x2qp');
assert.equal(inviteCodeFrom('  https://betweenus.example.com/invite/k3m9x2qp  '), 'k3m9x2qp');
assert.equal(inviteCodeFrom('https://betweenus.example.com/invite/k3m9x2qp?from=chat'), 'k3m9x2qp');
assert.equal(inviteCodeFrom('https://betweenus.example.com/invite/k3m9x2qp#top'), 'k3m9x2qp');
// A link that has been through a tracker or a chat preview.
assert.equal(inviteCodeFrom('https://betweenus.example.com/?invite=k3m9x2qp'), 'k3m9x2qp');
// Another deployment's link: the code is taken and the server refuses one it
// never issued, which is a clearer failure than pretending not to understand.
assert.equal(inviteCodeFrom('http://192.168.1.4:8080/invite/zz12'), 'zz12');
// The bare code, which is the other half of what gets pasted.
assert.equal(inviteCodeFrom('k3m9x2qp'), 'k3m9x2qp');

// And what must not become a code.
assert.equal(inviteCodeFrom(''), null);
assert.equal(inviteCodeFrom('   '), null);
assert.equal(inviteCodeFrom('come and join my invite please'), null);
assert.equal(inviteCodeFrom('ab'), null, 'too short to be a code');
assert.equal(inviteCodeFrom('https://betweenus.example.com/'), null, 'a link to no invite');

console.log('invite-link.check.ts ok');
