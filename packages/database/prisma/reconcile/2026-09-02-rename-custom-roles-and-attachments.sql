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
BEGIN;

UPDATE "_prisma_migrations"
   SET migration_name = '20260816150000_custom_roles'
 WHERE migration_name = '20260810100000_custom_roles';

UPDATE "_prisma_migrations"
   SET migration_name = '20260816160000_attachments'
 WHERE migration_name = '20260810110000_attachments';

COMMIT;
