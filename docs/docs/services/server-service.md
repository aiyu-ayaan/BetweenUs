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
| GET | `/:serverId/channels` | List a server's channels, in sidebar order (`position`, then age); each carries `categoryId` and `position` |
| GET | `/:serverId/categories` | List a server's channel categories (membership) |
| POST | `/:serverId/categories` | Create a category `{ name }`, appended at the bottom (`MANAGE_CHANNEL`) |
| PATCH | `/:serverId/categories/:categoryId` | Rename a category (`MANAGE_CHANNEL`) |
| DELETE | `/:serverId/categories/:categoryId` | Delete a category; its channels move to uncategorized, none is deleted (`MANAGE_CHANNEL`) |
| PUT | `/:serverId/channel-layout` | Reorder categories and move channels within/between them in one transaction (`MANAGE_CHANNEL`) |
| GET | `/:serverId/audit` | Moderation audit trail: role/permission changes, removals, role create/update/delete, server settings (`MANAGE_SERVER`) |

## `/api/v1/channels`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/` | List a channel (query-scoped) |
| POST | `/` | Create a channel |
| PATCH | `/:channelId` | Update a channel (name, topic, privacy) |
| DELETE | `/:channelId` | Delete a channel |
| GET | `/:channelId/members` | List a private channel's allowlist |
| PUT | `/:channelId/members` | Replace a private channel's allowlist |

`PUT /:serverId/channel-layout` takes `{ categoryIds?: string[], channels?:
{ id, categoryId | null }[] }` and answers with `{ categories, channels }` as the
caller sees them. Both lists are "in the order they should be drawn"; a
channel's `position` is its index among the entries sharing its category.
Anything the request leaves out keeps its category and follows what it names,
which is what lets a manager who cannot see a private channel still send a
layout. Every id is checked against the server, and a channel must also be one
the caller can see - `MANAGE_CHANNEL` does not open a private channel. Errors
use the standard shape: `CATEGORY_NOT_FOUND` (404), `CHANNEL_NOT_FOUND` (404),
`DUPLICATE_LAYOUT_ENTRY` (400), `MISSING_PERMISSION` (403). Every change is
written to the server audit trail (`category.created`, `category.updated`,
`category.deleted`, `channels.reordered`) and publishes `channel.list.changed`.

An invite is previewed (`GET /invites/:code`) before it's accepted — the
preview is deliberately thin (name, icon, member count, online count from
presence-service), because anyone holding a code can ask for it.
