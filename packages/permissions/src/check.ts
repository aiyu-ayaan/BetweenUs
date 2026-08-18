/**
 * Self-check: `pnpm --filter @betweenus/permissions check`.
 *
 * The interesting part is the override arithmetic - a grant that adds, a deny
 * that wins, and unknown strings that are ignored rather than trusted.
 */
import assert from 'node:assert/strict';
import {
  ASSIGNABLE_PERMISSIONS,
  PERMISSIONS,
  REMOTE_PERMISSIONS,
  SERVER_ROLES,
  isRemotePermission,
  effectivePermissions,
  hasPermission,
  isPermission,
  memberHasPermission,
  permissionsForRole,
} from './index';

// The role defaults still stand on their own.
assert.ok(hasPermission('MEMBER', PERMISSIONS.SEND_MESSAGE));
assert.ok(!hasPermission('MEMBER', PERMISSIONS.MANAGE_CHANNEL));
assert.ok(hasPermission('OWNER', PERMISSIONS.MANAGE_SERVER));

// A grant adds one capability without changing the role.
assert.ok(
  memberHasPermission('MEMBER', PERMISSIONS.MANAGE_CHANNEL, [PERMISSIONS.MANAGE_CHANNEL]),
  'a granted permission must be held',
);
assert.ok(
  !memberHasPermission('MEMBER', PERMISSIONS.MANAGE_MEMBER, [PERMISSIONS.MANAGE_CHANNEL]),
  'granting one permission must not grant another',
);

// Deny wins, whichever role the member holds.
assert.ok(
  !memberHasPermission('ADMIN', PERMISSIONS.DELETE_MESSAGE, [], [PERMISSIONS.DELETE_MESSAGE]),
  'a denial must beat the role default',
);
assert.ok(
  !memberHasPermission(
    'MEMBER',
    PERMISSIONS.MANAGE_CHANNEL,
    [PERMISSIONS.MANAGE_CHANNEL],
    [PERMISSIONS.MANAGE_CHANNEL],
  ),
  'a denial must beat an explicit grant',
);

// A database written by a newer build must not break this one.
assert.deepEqual(
  effectivePermissions('GUEST', ['NOT_A_PERMISSION'], ['ALSO_NOT_ONE']),
  permissionsForRole('GUEST'),
  'unknown permission names must be ignored',
);
assert.ok(!isPermission('MANAGE_EVERYTHING'));
assert.ok(isPermission(PERMISSIONS.VIEW_CHANNEL));

// No duplicates when a grant repeats what the role already gave.
const doubled = effectivePermissions('ADMIN', [PERMISSIONS.SEND_MESSAGE, PERMISSIONS.SEND_MESSAGE]);
assert.equal(new Set(doubled).size, doubled.length, 'effective permissions must be unique');

// Ownership and remote access are never handed out through the member editor.
assert.ok(!ASSIGNABLE_PERMISSIONS.includes(PERMISSIONS.MANAGE_SERVER));
assert.ok(!ASSIGNABLE_PERMISSIONS.includes(PERMISSIONS.REMOTE_CONTROL));

// Remote permissions are held per machine: no role implies one, and the member
// editor cannot hand one out either.
for (const role of SERVER_ROLES) {
  for (const remote of REMOTE_PERMISSIONS) {
    assert.ok(!permissionsForRole(role).includes(remote), `${role} must not imply ${remote}`);
    assert.ok(!ASSIGNABLE_PERMISSIONS.includes(remote), `${remote} must not be assignable`);
  }
}
assert.ok(isRemotePermission(PERMISSIONS.REMOTE_CONTROL));
assert.ok(!isRemotePermission(PERMISSIONS.SEND_MESSAGE));

// --- Custom roles ---
//
// A custom role adds; a denial still wins over it. That last one is the whole
// safety property: a member can collect any number of roles, and taking a
// capability away from them has to work anyway, or every revocation turns into
// a hunt for which role put it back.
assert.ok(
  memberHasPermission('MEMBER', PERMISSIONS.MANAGE_CHANNEL, [], [], [PERMISSIONS.MANAGE_CHANNEL]),
  'a custom role must grant its permissions',
);
assert.ok(
  !memberHasPermission(
    'MEMBER',
    PERMISSIONS.MANAGE_CHANNEL,
    [],
    [PERMISSIONS.MANAGE_CHANNEL],
    [PERMISSIONS.MANAGE_CHANNEL],
  ),
  'a denial must beat a custom role',
);
// And beat a grant and a role at once, from either direction.
assert.ok(
  !memberHasPermission(
    'ADMIN',
    PERMISSIONS.MANAGE_MEMBER,
    [PERMISSIONS.MANAGE_MEMBER],
    [PERMISSIONS.MANAGE_MEMBER],
    [PERMISSIONS.MANAGE_MEMBER],
  ),
  'a denial must beat every source at once',
);
// Two roles carrying the same permission is still one permission.
const fromRoles = effectivePermissions(
  'GUEST',
  [],
  [],
  [PERMISSIONS.SEND_MESSAGE, PERMISSIONS.SEND_MESSAGE, 'NOT_A_PERMISSION'],
);
assert.equal(new Set(fromRoles).size, fromRoles.length);
assert.ok(fromRoles.includes(PERMISSIONS.SEND_MESSAGE));
// Holding no custom role changes nothing.
assert.deepEqual(effectivePermissions('MEMBER', [], [], []), permissionsForRole('MEMBER'));

console.log('permissions self-check ok');
