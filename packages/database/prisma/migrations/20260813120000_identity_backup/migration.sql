-- Encrypted identity backup: one row per user, holding the device identity key
-- sealed with a key derived from a secret the server never sees.
--
-- Before this, an identity existed only in one machine's keychain, so wiping
-- the app - or signing in somewhere else - minted a new one and every channel
-- key already sealed for the old one became unopenable. The blob below is what
-- makes an account portable; the server stores it and can read none of it.

CREATE TABLE "identity_backups" (
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "kdf" TEXT NOT NULL,
    "iterations" INTEGER NOT NULL,
    "salt" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_backups_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "identity_backups" ADD CONSTRAINT "identity_backups_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
