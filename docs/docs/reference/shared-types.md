---
sidebar_position: 2
title: Shared Types & DTO Contracts
description: Complete TypeScript interfaces, DTOs, and protocol contracts from packages/shared-types with source documentation comments.
---

# Shared Types & DTO Contracts

Source of truth: [`packages/shared-types/src/index.ts`](https://github.com/aiyu-ayaan/BetweenUs/blob/master/packages/shared-types/src/index.ts).

This package contains the universal data transfer objects (DTOs), event payloads, and cryptographic envelopes shared by all NestJS backend services, the Electron desktop client, Vite web client, and Android bridges.

---

## 1. Common Types

```typescript
/**
 * Standard API error payload returned on HTTP 4xx and 5xx responses.
 */
export interface ApiErrorBody {
  error: {
    /** Machine-readable error code (e.g. 'UNAUTHORIZED', 'INVALID_CREDENTIALS'). */
    code: string;
    /** Human-readable explanation suitable for client display. */
    message: string;
    /** Correlated request ID traced across microservice logs. */
    requestId: string;
  };
}

/**
 * Keyset cursor pagination wrapper.
 */
export interface Paginated<T> {
  items: T[];
  /** Cursor to pass as `before` for the next (older) page. Null when exhausted. */
  nextCursor: string | null;
}

/**
 * OpenGraph and metadata unfurling result for embedded links.
 */
export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}
```

---

## 2. Authentication & Identity Contracts

```typescript
export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Platform role, distinct from ServerRole. ADMIN grants access to the admin panel. */
export type GlobalRole = 'USER' | 'ADMIN';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /**
   * The wide picture behind the name at the top of a profile, or null for the
   * flat accent band drawn before there was one.
   *
   * Not derivable from `avatarUrl` and therefore stored beside it: an avatar is
   * a square read at 32px in a member list, a cover is a 4:1 band read at
   * several hundred. Scaling one into the other gives a blurred crop of
   * somebody's face as a backdrop. See `COVER_ASPECT`.
   */
  coverUrl: string | null;
  /** Platform role, not server membership. ADMIN unlocks the admin panel. */
  role: GlobalRole;
  /** True for an account issued a generated password; it can do nothing else. */
  mustChangePassword: boolean;
  /** The line under the name on a profile card. See `ABOUT_MAX_LENGTH`. */
  about: string;
  /** Who may see when this account was last here. See `LastSeenVisibility`. */
  lastSeenVisibility: LastSeenVisibility;
  /**
   * This account's own disappearing-message window, in seconds, or null for
   * "keep everything".
   *
   * One-sided and personal: history older than the window is not returned to
   * this account on any of its devices, and every other participant's copy is
   * untouched. A server's own window outranks it, because that one deletes the
   * row rather than hiding it. See `DISAPPEARING_WINDOWS`.
   */
  messageTtlSeconds: number | null;
  createdAt: string;
}

export type LastSeenVisibility = 'everyone' | 'friends' | 'nobody';
```

---

## 3. Server, Channel & Role Contracts

```typescript
export type ServerRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER' | 'GUEST';

export interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerWithRole extends Server {
  role: ServerRole;
}

export type ChannelType = 'TEXT' | 'VOICE' | 'DM';

export interface Channel {
  id: string;
  serverId: string | null;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServerMember {
  id: string;
  serverId: string;
  userId: string;
  role: ServerRole;
  nickname: string | null;
  user: PublicUser;
  roles: ServerCustomRole[];
  joinedAt: string;
}

export interface ServerCustomRole {
  id: string;
  serverId: string;
  name: string;
  color: string | null;
  position: number;
  hoist: boolean;
  permissions: number;
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. End-to-End Encryption & Messaging Contracts

```typescript
/**
 * Cryptographic envelope wrapping client-sealed ciphertexts.
 * Stored as opaque blobs in chat-service; the backend never sees plaintext.
 */
export interface EncryptedEnvelope {
  /** Ephemeral sender public key for ECDH session derivation (hex encoded). */
  ephemeralPublicKey: string;
  /** Initialization vector (12 bytes AES-GCM IV, base64 encoded). */
  iv: string;
  /** Encrypted ciphertext payload (base64 encoded). */
  ciphertext: string;
  /** Authenticated GCM tag (16 bytes, base64 encoded). */
  tag: string;
  /** Epoch counter used for ratchet key rotation. */
  epoch: number;
}

/**
 * Message payload structure passed over REST and WebSocket gateways.
 */
export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  author: MessageAuthor;
  kind: MessageKind;
  /** Plaintext body for unencrypted system notices, or null for encrypted user messages. */
  content: string | null;
  /** Sealed envelope containing encrypted message text and metadata. */
  encryptedEnvelope: EncryptedEnvelope | null;
  attachments: MessageAttachment[];
  reactions: MessageReactionSummary[];
  replyTo: MessageReply | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  encryptedKey: string | null;
  iv: string | null;
  thumbnailUrl: string | null;
}
```

---

## 5. WebRTC Peer-to-Peer Media & Signaling

```typescript
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface CallPeer {
  userId: string;
  peerId: string;
  hasAudio: boolean;
  hasVideo: boolean;
  hasScreen: boolean;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/**
 * Peer-to-peer signaling envelopes transmitted over /ws/call.
 */
export type CallSignal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: IceCandidatePayload }
  | { type: 'renegotiate' };

/**
 * Client-to-server call events.
 */
export type ClientCallEvent =
  | { op: 'call.join'; channelId: string; hasAudio: boolean; hasVideo: boolean }
  | { op: 'call.leave' }
  | { op: 'call.signal'; targetPeerId: string; signal: CallSignal }
  | { op: 'call.media_state'; hasAudio: boolean; hasVideo: boolean; hasScreen: boolean }
  | { op: 'call.game_action'; action: unknown }
  | { op: 'call.listen_action'; action: unknown };

/**
 * Server-to-client call events.
 */
export type ServerCallEvent =
  | { op: 'call.roster'; peers: CallPeer[] }
  | { op: 'call.peer_joined'; peer: CallPeer }
  | { op: 'call.peer_left'; peerId: string }
  | { op: 'call.signal'; fromPeerId: string; signal: CallSignal }
  | { op: 'call.media_state'; peerId: string; hasAudio: boolean; hasVideo: boolean; hasScreen: boolean }
  | { op: 'call.game_state'; state: unknown }
  | { op: 'call.listen_state'; state: ListenSession };
```

---

## 6. Remote Desktop Contracts

```typescript
export type RemotePermission = 'VIEW_ONLY' | 'CONTROL' | 'FILE_TRANSFER' | 'CLIPBOARD';

export interface RemoteMachineSummary {
  id: string;
  name: string;
  os: 'windows' | 'macos' | 'linux';
  isOnline: boolean;
  enrolledAt: string;
  lastSeenAt: string;
}

export interface RemoteGrantSummary {
  id: string;
  machineId: string;
  granteeId: string;
  permissions: RemotePermission[];
  expiresAt: string | null;
  createdAt: string;
}

export interface StartRemoteSessionRequest {
  machineId: string;
}

export interface RemoteSessionResponse {
  sessionId: string;
  targetMachineId: string;
  controllerUserId: string;
  webrtcToken: string;
  iceServers: IceServer[];
}
```
