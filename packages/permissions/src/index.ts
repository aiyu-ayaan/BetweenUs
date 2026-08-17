/**
 * Role and permission vocabulary. Constants and pure helpers only - no service
 * business logic, no database access.
 */
import type { ServerRole } from '@nexora/shared-types';

export const SERVER_ROLES = ['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER', 'GUEST'] as const;

export const PERMISSIONS = {
  VIEW_CHANNEL: 'VIEW_CHANNEL',
  SEND_MESSAGE: 'SEND_MESSAGE',
  DELETE_MESSAGE: 'DELETE_MESSAGE',
  /** Pinning and unpinning in a channel; a direct message needs no permission. */
  MANAGE_MESSAGE: 'MANAGE_MESSAGE',
  MANAGE_CHANNEL: 'MANAGE_CHANNEL',
  MANAGE_MEMBER: 'MANAGE_MEMBER',
  MANAGE_ROLE: 'MANAGE_ROLE',
  MANAGE_SERVER: 'MANAGE_SERVER',
  /**
   * Uploading and removing a server's own emoji.
   *
   * Its own permission rather than a corner of MANAGE_SERVER, because the
   * people a server actually wants doing this - whoever makes the pictures -
   * are rarely the people it wants renaming it or deleting channels. Discord
   * split it for the same reason.
   */
  MANAGE_EMOJI: 'MANAGE_EMOJI',
  START_CALL: 'START_CALL',
  MANAGE_CALL: 'MANAGE_CALL',
  REMOTE_VIEW: 'REMOTE_VIEW',
  REMOTE_CONTROL: 'REMOTE_CONTROL',
  REMOTE_FILE_TRANSFER: 'REMOTE_FILE_TRANSFER',
  REMOTE_CLIPBOARD: 'REMOTE_CLIPBOARD',
  REMOTE_AUDIO: 'REMOTE_AUDIO',
  REMOTE_ADMIN: 'REMOTE_ADMIN',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];


const MEMBER_PERMISSIONS: Permission[] = [
  PERMISSIONS.VIEW_CHANNEL,
  PERMISSIONS.SEND_MESSAGE,
  PERMISSIONS.START_CALL,
];

const MODERATOR_PERMISSIONS: Permission[] = [
  ...MEMBER_PERMISSIONS,
  PERMISSIONS.DELETE_MESSAGE,
  PERMISSIONS.MANAGE_MESSAGE,
  PERMISSIONS.MANAGE_CALL,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...MODERATOR_PERMISSIONS,
  PERMISSIONS.MANAGE_CHANNEL,
  PERMISSIONS.MANAGE_MEMBER,
  PERMISSIONS.MANAGE_ROLE,
  PERMISSIONS.MANAGE_EMOJI,
];

/** Role -> permission map. Remote permissions are granted per machine, never by role. */
export const ROLE_PERMISSIONS: Record<ServerRole, Permission[]> = {
  OWNER: [...ADMIN_PERMISSIONS, PERMISSIONS.MANAGE_SERVER],
  ADMIN: ADMIN_PERMISSIONS,
  MODERATOR: MODERATOR_PERMISSIONS,
  MEMBER: MEMBER_PERMISSIONS,
  GUEST: [PERMISSIONS.VIEW_CHANNEL],
};

export function permissionsForRole(role: ServerRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: ServerRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** True for a string that names a permission this build knows about. */
export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/**
 * What a member may actually do: the built-in role's defaults, plus whatever the
 * custom roles they hold carry, plus what was granted to them individually,
 * minus what was denied.
 *
 * Deny is applied last and beats all three sources. That is the property worth
 * protecting: taking a capability away from one person has to work whatever
 * role they hold and however many custom roles they collect, or every revocation
 * becomes a hunt for which of them put it back.
 *
 * Unknown strings are ignored rather than rejected - a database written by a
 * newer build must not break an older one.
 */
export function effectivePermissions(
  role: ServerRole,
  granted: readonly string[] = [],
  denied: readonly string[] = [],
  fromCustomRoles: readonly string[] = [],
): Permission[] {
  const denySet = new Set(denied.filter(isPermission));
  const allowed = new Set<Permission>(permissionsForRole(role));
  for (const value of fromCustomRoles) if (isPermission(value)) allowed.add(value);
  for (const value of granted) if (isPermission(value)) allowed.add(value);
  return [...allowed].filter((permission) => !denySet.has(permission));
}

export function memberHasPermission(
  role: ServerRole,
  permission: Permission,
  granted: readonly string[] = [],
  denied: readonly string[] = [],
  fromCustomRoles: readonly string[] = [],
): boolean {
  return effectivePermissions(role, granted, denied, fromCustomRoles).includes(permission);
}

/**
 * Permissions an administrator may hand out or take away. Server ownership is
 * not delegable, so `MANAGE_SERVER` is not on the list - it comes with the role.
 */
export const ASSIGNABLE_PERMISSIONS: Permission[] = [
  PERMISSIONS.VIEW_CHANNEL,
  PERMISSIONS.SEND_MESSAGE,
  PERMISSIONS.DELETE_MESSAGE,
  PERMISSIONS.MANAGE_MESSAGE,
  PERMISSIONS.MANAGE_CHANNEL,
  PERMISSIONS.MANAGE_MEMBER,
  PERMISSIONS.MANAGE_ROLE,
  PERMISSIONS.MANAGE_EMOJI,
  PERMISSIONS.START_CALL,
  PERMISSIONS.MANAGE_CALL,
];

/** Remote-access permissions, granted per user per machine with optional expiry. */
export const REMOTE_PERMISSIONS = [
  PERMISSIONS.REMOTE_VIEW,
  PERMISSIONS.REMOTE_CONTROL,
  PERMISSIONS.REMOTE_FILE_TRANSFER,
  PERMISSIONS.REMOTE_CLIPBOARD,
  PERMISSIONS.REMOTE_AUDIO,
  PERMISSIONS.REMOTE_ADMIN,
] as const;

export type RemotePermission = (typeof REMOTE_PERMISSIONS)[number];

export interface RemoteGrant {
  permission: RemotePermission;
  /** ISO timestamp. Null means the grant does not expire. */
  expiresAt: string | null;
}

export function isRemoteGrantActive(grant: RemoteGrant, now: Date = new Date()): boolean {
  return grant.expiresAt === null || new Date(grant.expiresAt).getTime() > now.getTime();
}

/**
 * True for a string that names a remote permission this build knows about.
 * Remote access is never implied by a server role, so this is the only gate:
 * a name that is not here grants nothing.
 */
export function isRemotePermission(value: string): value is RemotePermission {
  return (REMOTE_PERMISSIONS as readonly string[]).includes(value);
}
