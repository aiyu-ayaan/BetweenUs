---
sidebar_position: 3
---

# server-service

Servers, membership, roles, invites, custom emoji, and channels. Owns the
effective-permission resolver every other service calls into.

## `/api/v1/servers`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/` | List servers the caller is in |
| POST | `/` | Create a server |
| POST | `/join` | Join by invite code |
| GET | `/invites/:code` | Preview an invite (name, icon, member count) before joining |
| GET | `/:serverId/invites` | List a server's invites |
| POST | `/:serverId/invites` | Create an invite |
| DELETE | `/:serverId/invites/:code` | Revoke an invite |
| PATCH | `/:serverId` | Update server settings |
| DELETE | `/:serverId` | Delete a server |
| POST | `/:serverId/leave` | Leave a server |
| GET | `/:serverId/members` | List members |
| POST | `/:serverId/members` | Add a member by username |
| PATCH | `/:serverId/members/:userId` | Change role / permission overrides |
| DELETE | `/:serverId/members/:userId` | Remove / kick a member |
| GET | `/:serverId/roles` | List custom roles |
| POST | `/:serverId/roles` | Create a custom role |
| PATCH | `/:serverId/roles/:roleId` | Update a custom role |
| DELETE | `/:serverId/roles/:roleId` | Delete a custom role |
| GET | `/:serverId/emoji` | List custom emoji |
| POST | `/:serverId/emoji` | Upload a custom emoji |
| DELETE | `/:serverId/emoji/:emojiId` | Delete a custom emoji |
| GET | `/:serverId/channels` | List a server's channels |

## `/api/v1/channels`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/` | List a channel (query-scoped) |
| POST | `/` | Create a channel |
| PATCH | `/:channelId` | Update a channel (name, topic, privacy) |
| DELETE | `/:channelId` | Delete a channel |
| GET | `/:channelId/members` | List a private channel's allowlist |
| PUT | `/:channelId/members` | Replace a private channel's allowlist |

An invite is previewed (`GET /invites/:code`) before it's accepted — the
preview is deliberately thin (name, icon, member count, online count from
presence-service), because anyone holding a code can ask for it.
