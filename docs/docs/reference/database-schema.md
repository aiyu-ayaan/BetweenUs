---
sidebar_position: 5
title: Database Schema & Prisma Models
description: Full PostgreSQL entity-relationship definitions, field constraints, zero-knowledge storage columns, and Prisma models.
---

# Database Schema & Prisma Models

Source of truth: [`packages/database/prisma/schema.prisma`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/packages/database/prisma/schema.prisma).

BetweenUs uses **PostgreSQL 16** managed via **Prisma ORM**. All 22 models are shared across the microservices with strict ownership boundaries.

---

## 1. Core Identity & User Models

```prisma
enum GlobalRole {
  USER
  ADMIN
}

enum LastSeenVisibility {
  EVERYONE
  FRIENDS
  NOBODY
}

model User {
  id                 String             @id @default(uuid())
  email              String             @unique
  username           String             @unique
  displayName        String
  passwordHash       String
  avatarUrl          String?
  /// The wide picture behind the name at the top of a profile.
  coverUrl           String?
  /// A line about yourself, shown on the profile card (max 140 chars).
  about              String             @default("Hey, I’m on Between Us.")
  /// The last moment presence-service saw this account connected and visible.
  lastSeenAt         DateTime?
  /// Who may read lastSeenAt. Enforced reciprocally server-side.
  lastSeenVisibility LastSeenVisibility @default(EVERYONE)
  role               GlobalRole         @default(USER)
  mustChangePassword Boolean            @default(false)
  disabledAt         DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  // Relations
  servers            ServerMember[]
  refreshTokens      RefreshToken[]
  deviceKeys         DeviceKey[]
  identityBackups    IdentityBackup[]
  vault              AccountVault?
  friendshipsInitiated Friendship[]     @relation("FriendshipInitiator")
  friendshipsReceived  Friendship[]     @relation("FriendshipReceiver")
}
```

---

## 2. Server, Channel & Member Models

```prisma
enum ServerRole {
  OWNER
  ADMIN
  MODERATOR
  MEMBER
  GUEST
}

enum ChannelType {
  TEXT
  VOICE
  /// A direct message between two users (channel without a server).
  DM
}

model Server {
  id                 String         @id @default(uuid())
  name               String
  iconUrl            String?
  ownerId            String
  /// Disappearing message TTL in seconds for all channels in this server.
  messageTtlSeconds  Int?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt

  channels           Channel[]
  channelCategories  ChannelCategory[]
  members            ServerMember[]
  roles              ServerRoleDefinition[]
  invites            ServerInvite[]
  emojis             ServerEmoji[]
}

model Channel {
  id                 String            @id @default(uuid())
  serverId           String?
  name               String
  type               ChannelType
  /// Null for the loose channels drawn above every category.
  categoryId         String?
  /// Order inside its category (or among the uncategorized); ties fall back to createdAt.
  position           Int               @default(0)
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  server             Server?           @relation(fields: [serverId], references: [id], onDelete: Cascade)
  category           ChannelCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  messages           Message[]
  members            ChannelMember[]
  overrides          ChannelOverride[]

  @@index([categoryId])
}

/// A heading in a server's channel sidebar. Deleting one moves its channels
/// to uncategorized; it never deletes them.
model ChannelCategory {
  id                 String            @id @default(uuid())
  serverId           String
  name               String
  position           Int               @default(0)
  createdAt          DateTime          @default(now())

  server             Server            @relation(fields: [serverId], references: [id], onDelete: Cascade)
  channels           Channel[]

  @@index([serverId])
}
```

---

## 3. End-to-End Encrypted Messaging Models

```prisma
model Message {
  id                 String             @id @default(uuid())
  channelId          String
  authorId           String
  /// Plaintext content for system announcements, null for encrypted user messages.
  content            String?
  /// Ephemeral public key for ECDH shared key derivation.
  ephemeralPublicKey String?
  /// AES-256-GCM initialization vector.
  iv                 String?
  /// Sealed ciphertext payload.
  ciphertext         String?
  /// Authenticated 16-byte GCM tag.
  tag                String?
  /// Ratchet key epoch.
  epoch              Int                @default(1)
  deletedAt          DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  channel            Channel            @relation(fields: [channelId], references: [id], onDelete: Cascade)
  attachments        MessageAttachment[]
  reactions          MessageReaction[]
  pinned             PinnedMessage?

  @@index([channelId, createdAt(sort: Desc)])
}

model MessageAttachment {
  id                 String    @id @default(uuid())
  messageId          String
  filename           String
  contentType        String
  sizeBytes          Int
  url                String
  encryptedKey       String?
  iv                 String?
  createdAt          DateTime  @default(now())

  message            Message   @relation(fields: [messageId], references: [id], onDelete: Cascade)
}
```

---

## 4. Cryptographic Key Registry

```prisma
model AccountVault {
  id                String               @id @default(uuid())
  userId            String               @unique
  publicKey         String
  generation        Int                  @default(1)
  keyringIv         String
  keyringCiphertext String
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt

  user              User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  factors           AccountVaultFactor[]

  @@map("account_vaults")
}

model AccountVaultFactor {
  id         String       @id @default(uuid())
  vaultId    String
  userId     String
  kind       String
  deviceId   String       @default("")
  kdf        String
  iterations Int          @default(0)
  salt       String       @default("")
  iv         String
  ciphertext String
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  vault      AccountVault @relation(fields: [vaultId], references: [id], onDelete: Cascade)

  @@unique([vaultId, kind, deviceId])
  @@index([userId, kind])
  @@map("account_vault_factors")
}

model VaultGrantRequest {
  id          String    @id @default(uuid())
  userId      String
  deviceId    String
  publicKey   String
  fingerprint String
  grantedAt   DateTime?
  createdAt   DateTime  @default(now())

  @@unique([userId, deviceId])
  @@map("vault_grant_requests")
}

model DeviceKey {
  id                 String    @id @default(uuid())
  userId             String
  deviceId           String
  /// ECDH P-256 public key as serialized JWK.
  publicKey          String
  label              String?
  revokedAt          DateTime?
  grantedAt          DateTime?
  lastSeenAt         DateTime  @default(now())
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, deviceId])
  @@map("device_keys")
}

model ChannelKey {
  id                 String   @id @default(uuid())
  channelId          String
  epoch              Int
  recipientUserId    String
  /// Set to '@account' for v2 account-scoped wraps.
  recipientDeviceId  String
  senderPublicKey    String
  wrappedKey         String
  iv                 String
  createdAt          DateTime @default(now())

  @@unique([channelId, epoch, recipientUserId, recipientDeviceId])
  @@index([channelId, recipientUserId])
  @@map("channel_keys")
}

model IdentityBackup {
  id                 String    @id @default(uuid())
  userId             String
  /// 'password' for account credential wrapping, or 'passphrase' for manual recovery.
  secretKind         String
  encryptedBundle    String
  salt               String
  iterations         Int
  createdAt          DateTime  @default(now())

  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, secretKind])
  @@map("identity_backups")
}
```
