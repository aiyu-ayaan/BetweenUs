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
  position           Int               @default(0)
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  server             Server?           @relation(fields: [serverId], references: [id], onDelete: Cascade)
  messages           Message[]
  members            ChannelMember[]
  overrides          ChannelOverride[]
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
model DeviceKey {
  id                 String    @id @default(uuid())
  userId             String
  deviceId           String
  /// Long-term identity public key (Curve25519 / ECDH P-256).
  identityKey        String
  /// Ephemeral signed pre-key.
  signedPreKey       String
  signature          String
  createdAt          DateTime  @default(now())

  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, deviceId])
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
}
```
