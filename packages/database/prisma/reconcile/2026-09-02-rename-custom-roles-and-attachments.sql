-- One-off, for a database that applied `20260810100000_custom_roles` or
-- `20260810110000_attachments` before they were renamed.
--
-- Both were stamped 10 August while the migrations around them are stamped the
-- 16th, so they sorted into the middle of history that had already been applied
-- without them. Renaming the directories fixes the order for every database that
-- has not seen them; a database that has seen them now holds a
-- `_prisma_migrations` row naming a directory that no longer exists, which
-- `prisma migrate status` reports as two migrations missing locally and two
-- waiting to be applied. Applying them is what must not happen: the DDL is
-- `CREATE TABLE`, and the tables are already there.
--
-- So rename the rows to match the directories. `checksum` is over the file
-- contents, which did not change, and `migration_name` is the only thing prisma
-- matches on.
--
--   docker exec -i <postgres> psql -U postgres -d betweenus \
--     < packages/database/prisma/reconcile/2026-09-02-rename-custom-roles-and-attachments.sql
--
-- Idempotent: a database that never applied the old names updates nothing, and a
-- database already reconciled updates nothing either.
--
-- THIS IS A ONE-WAY DOOR, AND THAT WAS FOUND THE HARD WAY
--
-- An image built before the rename carries the old directory names. Pointed at a
-- database this has been run against, its `migrate deploy` finds two migrations
-- it has never applied, applies the first, and dies on
-- `relation "server_custom_roles" already exists` - and prisma then records a
-- *failed* migration, which makes every later `migrate deploy` refuse with P3009
-- until somebody removes the row by hand.
--
-- That is not hypothetical. It is what `infrastructure/docker/deploy.sh` did on
-- its first real run, rolling back to the released `alpha` images on a database
-- the current checkout had migrated. The rollback failed for the same reason the
-- deploy did, which is exactly the case the script's loudest message is for.
--
-- So: once a deployment has run this, it cannot be served by an image published
-- before the rename without running the block at the bottom of this file first.
-- Uncomment it, run it, and the rows go back to the names that image expects.
BEGIN;

UPDATE "_prisma_migrations"
   SET migration_name = '20260816150000_custom_roles'
 WHERE migration_name = '20260810100000_custom_roles';

UPDATE "_prisma_migrations"
   SET migration_name = '20260816160000_attachments'
 WHERE migration_name = '20260810110000_attachments';

COMMIT;

-- GOING BACK, for a rollback to an image published before the rename.
--
-- The `DELETE` is not optional. If the old image already tried and failed, its
-- half-applied attempt is sitting there with `finished_at IS NULL`, and prisma
-- refuses to do anything else while it is - including the migrations of whatever
-- version is deployed next.
--
-- BEGIN;
--
-- DELETE FROM "_prisma_migrations"
--  WHERE migration_name IN ('20260810100000_custom_roles', '20260810110000_attachments')
--    AND finished_at IS NULL;
--
-- UPDATE "_prisma_migrations"
--    SET migration_name = '20260810100000_custom_roles'
--  WHERE migration_name = '20260816150000_custom_roles';
--
-- UPDATE "_prisma_migrations"
--    SET migration_name = '20260810110000_attachments'
--  WHERE migration_name = '20260816160000_attachments';
--
-- COMMIT;
