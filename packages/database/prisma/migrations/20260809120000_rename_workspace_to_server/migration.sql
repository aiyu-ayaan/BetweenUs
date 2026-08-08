-- Workspace is renamed to server, in the schema as well as in the UI. Every
-- object is renamed in place rather than dropped and recreated, so an existing
-- deployment keeps its data. Index and constraint names are renamed too,
-- because Prisma derives them from the table and would otherwise report drift.

ALTER TYPE "WorkspaceRole" RENAME TO "ServerRole";

ALTER TABLE "workspaces" RENAME TO "servers";
ALTER TABLE "workspace_members" RENAME TO "server_members";

ALTER TABLE "server_members" RENAME COLUMN "workspaceId" TO "serverId";
ALTER TABLE "channels" RENAME COLUMN "workspaceId" TO "serverId";

ALTER INDEX "workspaces_pkey" RENAME TO "servers_pkey";
ALTER INDEX "workspaces_slug_key" RENAME TO "servers_slug_key";
ALTER INDEX "workspaces_ownerId_idx" RENAME TO "servers_ownerId_idx";
ALTER INDEX "workspace_members_pkey" RENAME TO "server_members_pkey";
ALTER INDEX "workspace_members_userId_idx" RENAME TO "server_members_userId_idx";
ALTER INDEX "workspace_members_workspaceId_userId_key" RENAME TO "server_members_serverId_userId_key";
ALTER INDEX "channels_workspaceId_name_key" RENAME TO "channels_serverId_name_key";

ALTER TABLE "servers" RENAME CONSTRAINT "workspaces_ownerId_fkey" TO "servers_ownerId_fkey";
ALTER TABLE "server_members" RENAME CONSTRAINT "workspace_members_workspaceId_fkey" TO "server_members_serverId_fkey";
ALTER TABLE "server_members" RENAME CONSTRAINT "workspace_members_userId_fkey" TO "server_members_userId_fkey";
ALTER TABLE "channels" RENAME CONSTRAINT "channels_workspaceId_fkey" TO "channels_serverId_fkey";
