---
sidebar_position: 3
title: REST API Endpoints
description: Comprehensive HTTP REST API endpoint reference across all BetweenUs microservices with headers, request/response DTOs, and status codes.
---

# REST API Endpoints

All HTTP REST requests pass through the central ingress gateway (`dev:gateway` on `:8090` locally, or Nginx on port `443` in production) and are routed internally to their owning microservices.

### Standard Request Headers
```http
Authorization: Bearer <jwt-access-token>
Content-Type: application/json
X-Request-Id: <uuid-v4>
```

---

## 1. Authentication Service (`auth-service` / `:3001`)

Base Route: `/api/v1/auth`

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/register` | No | Creates a new user account and mints auth tokens. |
| `POST` | `/login` | No | Authenticates via email/username and password. |
| `POST` | `/refresh` | No | Rotates refresh token and issues a new access token. |
| `GET` | `/me` | Yes | Retrieves the caller's `PublicUser` account profile. |
| `PATCH` | `/me` | Yes | Updates display name, avatar URL, cover photo, or about line. |
| `POST` | `/change-password` | Yes | Changes account password and invalidates active refresh tokens. |
| `POST` | `/forgot-password` | No | Initiates password recovery request via SMTP or admin reset token. |
| `POST` | `/reset-password` | No | Consumes a one-time password reset token to set a new password. |

#### Example: `POST /api/v1/auth/login`
```json
// Request Body
{
  "email": "demo@betweenus.local",
  "password": "Password123!"
}

// Response (HTTP 200 OK)
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
  "refreshToken": "7c8e9f0a-1b2c-3d4e-5f6a-7b8c9d0e1f2a",
  "expiresIn": 900
}
```

---

## 2. Server & Membership Service (`server-service` / `:3003`)

Base Route: `/api/v1/servers`

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/` | Yes | Lists all servers where the caller is an active member. |
| `POST` | `/` | Yes | Creates a new server workspace and sets caller as `OWNER`. |
| `GET` | `/:serverId` | Yes | Fetches server metadata, channels, roles, and member count. |
| `PATCH` | `/:serverId` | Yes | Updates server name, icon, banner, or default role settings. |
| `DELETE` | `/:serverId` | Yes | Permanently deletes server (requires `OWNER` role). |
| `GET` | `/:serverId/channels` | Yes | Lists text and voice channels within the server. |
| `POST` | `/:serverId/channels` | Yes | Creates a new channel (`TEXT` or `VOICE`). |
| `GET` | `/:serverId/members` | Yes | Lists enrolled members with assigned roles and joined timestamps. |
| `POST` | `/:serverId/invites` | Yes | Creates a shareable invite code with max uses and TTL. |
| `POST` | `/invites/:code/join` | Yes | Joins a server using an active invite link. |

---

## 3. Chat & Messaging Service (`chat-service` / `:3004`)

Base Route: `/api/v1`

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/channels/:channelId/messages` | Yes | Cursor-paginated message history (sorted newest to oldest). |
| `POST` | `/channels/:channelId/messages` | Yes | Publishes an encrypted or system message. |
| `PATCH` | `/messages/:messageId` | Yes | Edits message ciphertext or content. |
| `DELETE` | `/messages/:messageId` | Yes | Soft-deletes a message (renders tombstone). |
| `POST` | `/messages/:messageId/reactions` | Yes | Adds an emoji reaction to a message. |
| `DELETE` | `/messages/:messageId/reactions` | Yes | Removes the caller's emoji reaction. |
| `POST` | `/messages/:messageId/pin` | Yes | Pins a message to the channel's pinned list. |
| `POST` | `/channels/:channelId/attachments/upload` | Yes | Initiates single or multipart encrypted file upload. |

#### Example: `POST /api/v1/channels/:channelId/messages`
```json
// Request Body (Encrypted User Message)
{
  "kind": "USER",
  "encryptedEnvelope": {
    "ephemeralPublicKey": "04c8f2a1...",
    "iv": "dGVzdGl2MTIzNA==",
    "ciphertext": "W2VuY3J5cHRlZCBtZXNzYWdlIGNvbnRlbnRd",
    "tag": "ZXhhbXBsZXRhZzEyMw==",
    "epoch": 1
  }
}

// Response (HTTP 201 Created)
{
  "id": "e8a9b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "channelId": "f28391a8-73b9-422b-8a46-5b1f863d45b3",
  "authorId": "440dbb3b-071f-4567-b4db-095ca4bc22b6",
  "kind": "USER",
  "encryptedEnvelope": { ... },
  "attachments": [],
  "reactions": [],
  "createdAt": "2026-09-04T02:00:00.000Z"
}
```

---

## 4. Presence & Social Service (`presence-service` / `:3005`)

Base Route: `/api/v1/presence`

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/users/:userId` | Yes | Returns user presence (`online`, `idle`, `dnd`, `offline`) and last seen. |
| `PUT` | `/status` | Yes | Updates caller's presence status and custom activity string. |
| `GET` | `/friends` | Yes | Lists accepted friends and pending incoming/outgoing requests. |
| `POST` | `/friends/requests` | Yes | Sends a friend request via username (`username#0000`). |
| `POST` | `/friends/requests/:id/accept` | Yes | Accepts an incoming friend request. |

---

## 5. Notification Service (`notification-service` / `:3006`)

Base Route: `/api/v1/notifications`

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/unread` | Yes | Returns unread message count and mention flags across all channels. |
| `POST` | `/read` | Yes | Marks a channel as read up to a specified message ID. |
| `GET` | `/preferences` | Yes | Fetches global and per-channel notification preferences. |
| `PUT` | `/preferences` | Yes | Updates notification level (`all`, `mentions`, `nothing`). |
| `POST` | `/devices` | Yes | Enrolls an FCM push token or Web Push subscription. |
| `DELETE` | `/devices/:deviceId` | Yes | Revokes push token on sign-out. |

---

## 6. Voice & Call Switchboard (`call-service` / `:3007`)

Base Route: `/api/v1/calls`

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/ice-servers` | Yes | Returns STUN/TURN relay credentials with time-limited HMAC auth. |
| `GET` | `/channels/:channelId/roster` | Yes | Lists active peers currently connected to a voice stage. |
| `POST` | `/direct/ring` | Yes | Triggers an incoming 1-to-1 direct call to another user's devices. |
| `POST` | `/direct/decline` | Yes | Dismisses a ring across all connected devices. |

---

## 7. Remote Desktop Gateway (`remote-gateway` / `:3008`)

Base Route: `/api/v1/remote`

| Method | Path | Auth Required | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/machines` | Yes | Lists enrolled remote desktop target machines. |
| `POST` | `/machines/enrol` | Yes | Generates machine enrolment token and machine key. |
| `GET` | `/machines/:machineId/grants`| Yes | Lists user access permissions for a machine. |
| `POST` | `/machines/:machineId/grants`| Yes | Grants or revokes remote control / view permissions. |
| `POST` | `/sessions/start` | Yes | Negotiates peer-to-peer WebRTC data channels for remote control. |
