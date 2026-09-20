-- E2EE v2: the account vault.
--
-- Nothing here destroys or rewrites key material. The v1 `channel_keys` rows
-- stay exactly as they are, because they are the only copy of history that
-- exists and the server holds nothing that could re-address them. What this
-- migration does is make room for account-scoped wraps beside them, and give
-- every stored object a life stage the sweep can read.
--
-- The promotion of v1 rows to v2 happens on the clients, which are the only
-- things that can open one. See `promotable` in ChannelKeysResponse.

-- CreateEnum
CREATE TYPE "AttachmentState" AS ENUM ('PENDING', 'LINKED', 'ORPHANED');

-- CreateTable
CREATE TABLE "account_vaults" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "keyringIv" TEXT NOT NULL,
    "keyringCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_vaults_userId_key" ON "account_vaults"("userId");

-- CreateTable
CREATE TABLE "account_vault_factors" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL DEFAULT '',
    "kdf" TEXT NOT NULL,
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "salt" TEXT NOT NULL DEFAULT '',
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "senderPublicKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_vault_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_vault_factors_vaultId_idx" ON "account_vault_factors"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "account_vault_factors_userId_kind_deviceId_key" ON "account_vault_factors"("userId", "kind", "deviceId");

-- CreateTable
CREATE TABLE "vault_grant_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "label" TEXT,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedAt" TIMESTAMP(3),

    CONSTRAINT "vault_grant_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_grant_requests_userId_deviceId_key" ON "vault_grant_requests"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "vault_grant_requests_userId_grantedAt_idx" ON "vault_grant_requests"("userId", "grantedAt");

-- AddForeignKey
ALTER TABLE "account_vaults" ADD CONSTRAINT "account_vaults_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_vault_factors" ADD CONSTRAINT "account_vault_factors_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "account_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: a machine now records when it was let in, rather than assuming
-- it may mint an identity of its own when it was not.
ALTER TABLE "device_keys" ADD COLUMN "grantedAt" TIMESTAMP(3);

-- Every machine already in the directory predates the vault and already holds
-- whatever v1 sealed for it, so it is not "waiting to be let in": marking it
-- otherwise would lock working installations out of their own history on the
-- next launch. It is stamped as granted, and the vault adoption a v2 client
-- performs is what actually moves it onto the account identity.
UPDATE "device_keys" SET "grantedAt" = "createdAt" WHERE "revokedAt" IS NULL;

-- AlterTable: stored objects get a life stage.
ALTER TABLE "attachments" ADD COLUMN "state" "AttachmentState" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "attachments" ADD COLUMN "stateAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Back-fill from what the old expression would have said, so the first sweep
-- after this migration collects exactly what the previous one would have and
-- not one object more.
UPDATE "attachments" a
   SET "state" = 'LINKED', "stateAt" = a."createdAt"
  FROM "messages" m
 WHERE a."messageId" = m."id" AND m."deletedAt" IS NULL;

UPDATE "attachments" a
   SET "state" = 'ORPHANED', "stateAt" = COALESCE(m."deletedAt", a."createdAt")
  FROM "messages" m
 WHERE a."messageId" = m."id" AND m."deletedAt" IS NOT NULL;

UPDATE "attachments"
   SET "stateAt" = "createdAt"
 WHERE "messageId" IS NULL;

-- CreateIndex
CREATE INDEX "attachments_state_stateAt_idx" ON "attachments"("state", "stateAt");
