---
sidebar_position: 9
---

# Webhooks

A webhook is a URL you give to some other system so it can say something in a
channel. A build finishing, a disk filling up, a form somebody submitted — if it
can make an HTTP request, it can post here.

It uses **the same request shape Discord does**. That is the whole design goal:
if you already have something pointing at a Discord webhook, you change the URL
and nothing else.

---

## Read this part first

> **Messages posted through a webhook are not end-to-end encrypted.**

Everything a *person* writes in BetweenUs is sealed on their own device with a
key the server never holds. A webhook cannot work that way: whatever is calling
it — a shell script, a CI runner, a monitoring agent — holds no channel key, and
it cannot be given one. Handing a channel key to a deploy script hands the whole
channel to everyone who can read that script, forever.

So webhook messages are stored in the clear, and the deployment can read them.
This is the only exception in the product, and it is deliberately made visible
rather than hidden:

- Every client draws those messages with a **`WEBHOOK · NOT ENCRYPTED`** badge,
  on every message rather than once per group.
- The settings panel says so before the Create button, not after it.

Adding a webhook to a channel means that channel's guarantee becomes *"everything
except what the robots say"*. That is a fine trade for a deploy log and a bad one
for a channel where the encryption is the point. Pick the channel accordingly.

**Do not send secrets through a webhook.** Not passwords, not tokens, not
customer data. If your CI prints an environment variable into a build log and
the build log goes through a webhook, it is now in a database in the clear.

---

## Making one

Server Settings → **Webhooks**. You need the **`MANAGE_WEBHOOK`** permission,
which Admins and Owners have by default and which can be granted to a custom
role.

Give it a name (`Deploys`, `Alerts`, `Staging CI`) and pick a channel. The name
is the label the messages appear under; it is not a username and does not have
to be unique.

You will get a URL that looks like this:

```
https://chat.example.com/api/v1/webhooks/1f2e3d4c-.../V8kQ2nR7wX...
```

### Copy it now

**The URL is shown exactly once.** Only a SHA-256 hash of the token half is
stored, so nobody — including whoever runs the deployment — can read it back out
of the database later. That is the same rule refresh tokens, remote-agent tokens
and password-reset tokens follow here.

If you lose it, press **Rotate URL**. You get a new one and the old one stops
working immediately. Rotating is also what you do if a URL leaks: anybody holding
that URL can post in that channel, because the URL *is* the authority. There is
no second factor and there is not meant to be — that is what makes it callable
from one line of a deploy script.

---

## Sending a message

`POST` to the URL with a JSON body:

```bash
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content": "Deploy finished — v2.4.1 is live"}'
```

That is the whole minimum. No authentication header, no account, no SDK.

### Formatting

The body is rendered as Markdown by every client, so the usual things work:

```bash
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content": "**Build failed** on `master`\n\nSee the [run log](https://ci.example.com/402)."}'
```

### Embeds

Discord's `embeds` array is accepted, and rendered into the message as Markdown:

```bash
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "embeds": [{
      "title": "Build #402",
      "url": "https://ci.example.com/402",
      "description": "All checks passed",
      "fields": [
        {"name": "Branch", "value": "master"},
        {"name": "Duration", "value": "3m 12s"}
      ],
      "footer": {"text": "ci-runner-3"}
    }]
  }'
```

which arrives as:

> **[Build #402](https://ci.example.com/402)**
> All checks passed
> **Branch**
> master
> **Duration**
> 3m 12s
> _ci-runner-3_

Embeds are flattened to Markdown rather than drawn as Discord's boxed cards.
Every client here already renders Markdown in a message; a structured embed
would need a new renderer in three clients plus a fallback for every build
already installed — and that fallback would have to be Markdown anyway. So
Markdown *is* the format. You lose the coloured bar down the left; you keep
every word, on every client, including the ones people have not updated.

---

## What is accepted and ignored

Integrations written against Discord send fields this app has no use for. Those
are **accepted and ignored rather than refused**, so an existing integration does
not break — and the response tells you which ones, so you are not left debugging
your own code:

```json
{ "message": { "...": "..." }, "ignored": ["username", "avatar_url"] }
```

| Field | What happens |
| --- | --- |
| `content` | Used. |
| `embeds` | Used, rendered to Markdown. First 10 only. |
| `username` | **Ignored.** Messages post under the webhook's own name. A per-message name would need a column on every message in the database; making a second webhook is a button. |
| `avatar_url` | **Ignored.** Fetching a URL somebody supplied would make every client that draws the message call out to that host — a beacon reporting who read the channel — and would make the server fetch it too. The webhook's own uploaded picture is used. |
| `embeds[].color` | Ignored. There is no coloured bar to colour. |
| `tts`, `allowed_mentions`, `components`, anything else | Ignored silently. |

## Limits

| Limit | Value | Why |
| --- | --- | --- |
| Rendered message length | 2000 characters | The same ceiling a person's message has. A person's client turns an overlong message into a text file; a webhook has no client to do that, so this is a refusal with the length named in the error. |
| Embeds per message | 10 | Discord's number. |
| Name length | 80 characters | Discord's number. |
| Request rate | 5/s per IP, burst 10 | Its own rate-limit zone at the gateway. This is the only unauthenticated route in the product that *writes*, and a runaway CI loop must not be able to fill a channel. |

---

## Recipes

### GitHub Actions

```yaml
- name: Tell the team
  if: always()
  run: |
    curl -sf -X POST "${{ secrets.BETWEENUS_WEBHOOK }}" \
      -H "Content-Type: application/json" \
      -d @- <<JSON
    {"content": "${{ job.status }} — \`${{ github.ref_name }}\` by ${{ github.actor }}"}
    JSON
```

Put the URL in an Actions secret, never in the workflow file. A webhook URL in a
public repository is a channel anybody on the internet can post to.

### Alertmanager

```yaml
receivers:
  - name: betweenus
    webhook_configs:
      - url: https://chat.example.com/api/v1/webhooks/<id>/<token>
```

Alertmanager's own payload shape is not Discord's, so put a small adapter in
front of it, or use its `http_config` with a templating proxy. A one-line
`content` field is all this endpoint needs.

### A cron job

```bash
#!/bin/sh
if ! systemctl is-active --quiet nginx; then
  curl -sf -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d '{"content": "⚠️ nginx is down on '"$(hostname)"'"}'
fi
```

---

## Troubleshooting

**Nothing arrives, and `curl` prints nothing.** Add `-i` and read the status.

| Status | Meaning |
| --- | --- |
| `404` | Wrong id, wrong token, or the webhook was deleted. These answer identically on purpose — the URL is the secret, and telling the two apart would let anybody with an id confirm one exists. |
| `400` | The body rendered to nothing (no `content`, no usable `embeds`), or it was over 2000 characters. The error message says which. |
| `429` | Rate limited. See the table above. |
| `405` | You used `GET`. It is `POST` only — a `GET` that posts a message is one that fires when a link-preview crawler follows the URL out of a chat window. |

**It returns 200 but the message is not in the channel.** Check the channel: a
webhook posts where it was created, and the settings list shows which channel
each one belongs to.

**"Has this thing ever worked?"** Every row in the settings list shows *last
used*, or `never used` if nothing has ever posted through it.

**The name is wrong.** You are probably sending `username`. See the ignored
fields above — rename the webhook, or make a second one.

---

## How it works underneath

- `POST /api/v1/webhooks/:id/:token` is served by
  [`chat-service`](chat-service.md) and is the one unauthenticated route there.
  It lives in its own controller with no auth guard at all, rather than one route
  poking a hole in a guarded controller — a hole somebody eventually widens by
  accident.
- The token is looked up by its SHA-256 digest against a unique index, so a wrong
  token is one indexed miss rather than a scan.
- The message is written with `kind = WEBHOOK` and a `webhookId`, then published
  on the Redis bus as `message.created` exactly like any other message. Clients
  receive it over `/ws/chat` and render it with the badge.
- `Message.authorId` is not nullable, so a webhook message is attributed in the
  database to the account that created the webhook. **No client draws that** —
  they all draw the webhook's own name — but it is what the audit trail has.
- Deleting a webhook does **not** delete what it already said. The foreign key is
  `ON DELETE SET NULL`: the messages stay, and fall back to the name frozen onto
  them. Deleting a webhook closes a door; it does not retract what came through
  it.

See [`E2EE`](../security/e2ee.md) for where this sits in the encryption model,
and [`Auth & permissions`](../system-design/auth-and-permissions.md) for
`MANAGE_WEBHOOK`.

## Management API

All of these need a Bearer token and `MANAGE_WEBHOOK` on the channel's server.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/v1/webhooks?channelId=<id>` | List a channel's webhooks. Never returns a token. |
| `POST` | `/api/v1/webhooks` | Create one. `{ channelId, name, avatarUrl? }`. Returns the URL, once. |
| `PATCH` | `/api/v1/webhooks/:id` | Rename, or set/clear the picture. |
| `POST` | `/api/v1/webhooks/:id/rotate` | New token; the old URL stops working. Returns the URL, once. |
| `DELETE` | `/api/v1/webhooks/:id` | Delete it. Its messages stay. |
| `POST` | `/api/v1/webhooks/:id/:token` | **Unauthenticated.** Post a message. |

Direct messages cannot have webhooks. A DM has no roles to hold the permission,
and a URL that posts into somebody's private conversation forever is not
something this product offers.
