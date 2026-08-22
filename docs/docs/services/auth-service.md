---
sidebar_position: 2
---

# auth-service

Registration, login, sessions, OAuth, account management, and the admin
panel's own auth. Details: [Auth & Permissions](/system-design/auth-and-permissions).

## `/api/v1/auth`

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/register` | Create an account |
| POST | `/login` | Password login → access + refresh token |
| POST | `/refresh` | Rotate a refresh token; reuse revokes the whole account's sessions |
| POST | `/logout` | Revoke the current refresh token |
| GET | `/me` | Current account |
| POST | `/account/password` | Change password |
| PATCH | `/account` | Update profile fields |

## `/api/v1/auth/oauth`

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/version` | Build/version probe |
| GET | `/providers` | Which providers are enabled |
| GET | `/:provider/start` | Begin the provider redirect |
| GET | `/:provider/callback` | Provider returns here; issues a one-time code |
| POST | `/exchange` | Trade the one-time code for a session |

## `/api/v1/admin`

Requires `GlobalRole.ADMIN`, checked by database lookup on every request
(not a token claim — a demotion has to take effect immediately).

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/status` | Whether any admin exists yet |
| GET | `/users` | List accounts |
| PATCH | `/users/:id` | Change role / disable / enable |
| DELETE | `/users/:id` | Delete an account |
| GET | `/audit` | Read `AdminAudit` |
| GET | `/oauth` | Read provider configs |
| PUT | `/oauth/:provider` | Set a provider's credentials |

The **first** administrator is never created through this API — `pnpm
admin:create` runs where the database already is, the one place that proves
the operator owns the deployment.
