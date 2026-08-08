-- Per-member permission overrides layered on the role's defaults. An empty
-- array on both columns is the existing behaviour, so no backfill is needed.

ALTER TABLE "server_members" ADD COLUMN "grantedPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "server_members" ADD COLUMN "deniedPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
