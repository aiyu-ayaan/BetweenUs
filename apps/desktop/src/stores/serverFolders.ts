/**
 * How one person groups their own server rail, on this machine.
 *
 * A rail with three servers needs no folders and a rail with thirty is
 * unusable without them. The grouping is nobody's business but the person
 * looking at it - two members of the same server have no reason to agree on
 * where it sits, or on what the folder holding it is called - so this is a
 * local preference like `peerAudio.ts` and `theme.ts`, not a row on the
 * server. That also means no migration, no permission, and no way for a
 * folder somebody else made to appear in your rail.
 *
 * The store holds only the exceptions: a server nobody has filed is in no
 * folder and appears nowhere in here. The rail is drawn from the live server
 * list every time, and folders only say how to fold it, which is what keeps a
 * stale folder from inventing a server that is gone or hiding one that is new.
 */
import type { ServerWithRole } from '@betweenus/shared-types';
import { create } from 'zustand';

const STORAGE_KEY = 'betweenus.server-folders';

export interface ServerFolder {
  id: string;
  name: string;
  /**
   * The servers filed here, in the order they should be drawn inside it.
   *
   * Ids and not servers, and deliberately never pruned: leaving a server is
   * usually temporary, and a rejoin that dropped you back into the folder you
   * had put it in is the behaviour nobody notices, which is the good kind. An
   * id in here that the account is no longer a member of is simply not drawn.
   */
  serverIds: string[];
  collapsed: boolean;
}

/** One row of the rail: a loose server, or a folder with its live members. */
export type RailEntry =
  | { kind: 'server'; server: ServerWithRole }
  | { kind: 'folder'; folder: ServerFolder; servers: ServerWithRole[] };

/**
 * What the rail should draw, in order.
 *
 * Pure, and free of zustand and the DOM, because the interesting part of
 * folders is not the storage - it is the four states a rail is actually in
 * once somebody has been using it for a year, and those are worth asserting
 * in `serverFolders.check.ts` rather than clicking through.
 *
 * The rules:
 *
 * - A folder is drawn where its first live member sits in the server list, so
 *   filing a server does not teleport it across the rail. Loose servers keep
 *   their own positions for the same reason - the server list's order is the
 *   one the person already learned.
 * - A server filed in two folders (hand-edited storage, or two windows racing
 *   a write) is drawn once, in the first folder that names it. First wins is
 *   arbitrary but it is *stable*: the same storage always draws the same rail,
 *   which matters more than which of the two folders is the "right" one.
 * - A folder with nothing live left is still drawn, empty. It is somebody's
 *   folder - they named it - and dropping it would delete their work over a
 *   server going quiet or a membership lapsing. Empty folders sort to the end
 *   because they have no member to anchor them.
 */
export function railEntries(folders: ServerFolder[], servers: ServerWithRole[]): RailEntry[] {
  const byId = new Map(servers.map((server) => [server.id, server] as const));

  // serverId -> the folder that gets to keep it. Built first so that a
  // duplicate is resolved before anything is drawn, rather than by whichever
  // loop happens to reach it first.
  const owner = new Map<string, string>();
  for (const folder of folders) {
    for (const serverId of folder.serverIds) {
      if (!owner.has(serverId)) owner.set(serverId, folder.id);
    }
  }

  const entries: RailEntry[] = [];
  const drawn = new Set<string>();

  const pushFolder = (folder: ServerFolder): void => {
    drawn.add(folder.id);
    entries.push({
      kind: 'folder',
      folder,
      servers: folder.serverIds
        .filter((serverId) => owner.get(serverId) === folder.id)
        .map((serverId) => byId.get(serverId))
        .filter((server): server is ServerWithRole => server !== undefined),
    });
  };

  for (const server of servers) {
    const folderId = owner.get(server.id);
    if (folderId === undefined) {
      entries.push({ kind: 'server', server });
      continue;
    }
    if (drawn.has(folderId)) continue;
    const folder = folders.find((candidate) => candidate.id === folderId);
    if (folder) pushFolder(folder);
  }

  for (const folder of folders) {
    if (!drawn.has(folder.id)) pushFolder(folder);
  }

  return entries;
}

/** The unread count a collapsed folder has to surface for the rail. */
export function folderUnread(servers: ServerWithRole[], unreadFor: (id: string) => number): number {
  return servers.reduce((sum, server) => sum + unreadFor(server.id), 0);
}

function isFolder(value: unknown): value is ServerFolder {
  if (typeof value !== 'object' || value === null) return false;
  const folder = value as Partial<ServerFolder>;
  return (
    typeof folder.id === 'string' &&
    typeof folder.name === 'string' &&
    Array.isArray(folder.serverIds) &&
    folder.serverIds.every((id) => typeof id === 'string')
  );
}

/**
 * Storage is a text field anybody can edit and an older build may have
 * written, so anything that is not recognisably a list of folders means "no
 * folders" rather than a rail that fails to render. Losing a grouping is a
 * shrug; losing the servers is not.
 */
export function parseFolders(raw: string | null): ServerFolder[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFolder).map((folder) => ({ ...folder, collapsed: folder.collapsed === true }));
  } catch {
    return [];
  }
}

function load(): ServerFolder[] {
  try {
    return parseFolders(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

interface ServerFoldersState {
  folders: ServerFolder[];
  /** Makes a folder and returns its id, so a caller can file a server into it. */
  createFolder: (name: string) => string;
  /** Drops the folder; every server it held falls loose again. */
  removeFolder: (folderId: string) => void;
  /** `null` takes the server out of whatever folder it is in. */
  fileServer: (serverId: string, folderId: string | null) => void;
  toggleCollapsed: (folderId: string) => void;
}

export const useServerFolders = create<ServerFoldersState>((set, get) => ({
  folders: load(),

  createFolder: (name) => {
    const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    write(set, [...get().folders, { id, name: name.trim() || 'Folder', serverIds: [], collapsed: false }]);
    return id;
  },

  removeFolder: (folderId) => write(set, get().folders.filter((folder) => folder.id !== folderId)),

  fileServer: (serverId, folderId) =>
    write(
      set,
      get().folders.map((folder) => {
        // Taken out of every folder first, so filing is a move and a duplicate
        // cannot be created by the one action that could create one.
        const serverIds = folder.serverIds.filter((id) => id !== serverId);
        return folder.id === folderId
          ? { ...folder, serverIds: [...serverIds, serverId] }
          : { ...folder, serverIds };
      }),
    ),

  toggleCollapsed: (folderId) =>
    write(
      set,
      get().folders.map((folder) =>
        folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder,
      ),
    ),
}));

function write(set: (partial: Partial<ServerFoldersState>) => void, folders: ServerFolder[]): void {
  set({ folders });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
  } catch {
    // No storage: the grouping still holds for this session.
  }
}
