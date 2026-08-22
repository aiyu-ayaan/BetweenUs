---
sidebar_position: 3
---

# CI

Source: [`.github/workflows/ci.yml`](https://github.com/aiyu-ayaan/Nexora/blob/master/.github/workflows/ci.yml).
Runs on every push to `master` and every pull request.

## `verify`

Lint, typecheck, `turbo run build`, and `pnpm check` — self-checks inside
`@betweenus/auth`, `@betweenus/nest-common`, `@betweenus/permissions`,
`@betweenus/storage` and `auth-service`, each an assert-based check of a
security-relevant primitive (token algorithm pinning, rate-limit client
address resolution, permission resolution, storage allowlists, and login
end-to-end against an in-memory database).

## `integration`

Postgres and Redis as service containers, migrations applied, every backend
service started from its built `dist/main.js` and polled on `/health`, then
the real smoke scripts run against the live stack over REST and WebSocket:

```bash
node apps/services/chat-service/smoke.mjs
node apps/services/presence-service/smoke.mjs
node apps/services/notification-service/smoke.mjs
node apps/services/remote-gateway/smoke.mjs
```

This is deliberately not a second, parallel test suite — the smoke scripts
already walk the real surface end to end, so the cheapest useful CI is
giving them a real stack to run against. They had to be made to exit
non-zero on a failed assertion first; a failure used to print `ok false`
and exit 0.

## `android`

Debug unit tests, a debug APK build (the real check — it exercises the
manifest, every resource, and the Compose compiler, none of which a unit
test touches), and compiling (not running) the instrumented tests, so they
don't rot even though an emulator isn't run on every PR. No
`google-services.json` and no `local.properties` here on purpose — a pull
request has to build the way a fresh clone does.

## Docs

A separate workflow, `.github/workflows/docs.yml`, builds and deploys this
site — see [Docs Deployment](/deployment/docs-deployment).
