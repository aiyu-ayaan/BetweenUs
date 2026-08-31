---
sidebar_position: 6
---

# TURN relay (coturn)

Everything needed to add a relay to a deployment, in the order it has to be
done. Nothing here is required: a deployment with no relay works for most
pairs of networks, and this page exists for the pairs it does not work for.

## When you need one

A call between two networks that cannot form a direct path — symmetric NAT on
either side, or carrier-grade NAT, which is most mobile data — joins, shows
both people, and then carries no media. The client says so:

```text
NAME: could not be reached. Your networks may not be able to connect directly.
```

That message is the whole reason this page exists. See
[Media](/architecture/media) for what STUN-only does and does not cover. If
your calls connect, you do not need a relay.

## What a relay is, and what it is not

TURN forwards packets between two peers that cannot reach each other. It is
**not** a media server: it never decodes anything, and media stays DTLS-SRTP
end to end, so whoever runs the relay cannot listen to a call. That is what
keeps a relay compatible with this project's
[zero-media-server principle](/architecture/media) where an SFU would not be.

Both peers dial the relay **outbound**, exactly as they dial STUN. Nothing is
forwarded, opened or published on the machine running BetweenUs.

:::caution The relay cannot live behind your Cloudflare Tunnel
This is the first thing everyone tries. A tunnel publishes HTTP and WebSocket:
for a proxied hostname the edge terminates TLS on 443 and expects HTTP inside
it, and TURN over TLS is its own binary protocol, so a client dialling
`turns:` at the tunnel's hostname is refused before it reaches coturn.
cloudflared's `service: tcp://…` ingress needs cloudflared or WARP running on
the **client**, which a browser's WebRTC stack cannot do — that is a private
access path, not a public one. Arbitrary public TCP is Cloudflare Spectrum, an
Enterprise product.

A relay therefore needs a host with a public address of its own. A small VM is
enough: it forwards packets it has no key for.
:::

## What you need

- A VM with a public IPv4 address. The smallest tier of anything is enough —
  a relay is bandwidth, not CPU.
- A subdomain you control, e.g. `turn.example.com`.
- Ports on that VM: 3478 TCP+UDP, 443 TCP+UDP, and 49152–65535 UDP.

## 1. DNS

Point `turn.example.com` at the VM's public IP.

:::danger Grey cloud, not orange
On Cloudflare DNS the record must be **DNS only**. Proxying it puts
Cloudflare's HTTP edge in front of the relay and breaks it in exactly the way
described above — and the failure looks like a relay that installed fine and
relays nothing.
:::

Verify before going further:

```bash
dig +short turn.example.com
# must print your VM's IP, not a Cloudflare address (104.x, 172.67.x)
```

## 2. Install coturn and get a certificate

```bash
sudo apt update
sudo apt install -y coturn certbot
sudo certbot certonly --standalone -d turn.example.com
```

`--standalone` binds port 80 for the challenge, so nothing else may be
listening on it at that moment.

## 3. Configure

Replace `/etc/turnserver.conf` with this. Every line is load-bearing; the
comments say why.

```ini
# --- Listeners -------------------------------------------------------------
# 3478 is the fast path. 443 over TLS is what survives a network that allows
# nothing but HTTPS - which is the case a relay is usually being added for.
listening-port=3478
tls-listening-port=443

# --- Credentials -----------------------------------------------------------
# Long-term credentials. WITHOUT lt-cred-mech the user= line below is ignored
# and every allocation is refused.
lt-cred-mech
realm=turn.example.com
user=betweenus:PUT_A_LONG_RANDOM_SECRET_HERE

# --- TLS -------------------------------------------------------------------
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
no-tlsv1
no-tlsv1_1

# --- Relay ports -----------------------------------------------------------
# Allocations are handed out of this range. If it is not open in every
# firewall, allocations succeed and then carry nothing.
min-port=49152
max-port=65535

# --- Hygiene ---------------------------------------------------------------
fingerprint
stale-nonce
no-multicast-peers

# --- Abuse limits ----------------------------------------------------------
# The credential reaches every signed-in client (see "What a static credential
# means" below), so bound what a copied one can cost.
user-quota=12
total-quota=1200

# --- Never let a relayed session reach a private network -------------------
# An open relay with no peer restrictions is a port scanner aimed at the
# network it is sitting in.
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=::1
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
```

### If the VM is behind 1:1 NAT

Oracle Cloud, AWS, GCP and most others give the VM a *private* address and map
a public one to it. Check:

```bash
ip -4 addr show | grep inet
```

If that shows `10.x`, `172.16-31.x` or `192.168.x` rather than your public IP,
add:

```ini
external-ip=PUBLIC_IP/PRIVATE_IP
```

:::tip This is the most common cause of a relay that installs cleanly and relays nothing
Without it coturn advertises the private address it can see, and no client can
reach that. Everything looks healthy from the VM.
:::

## 4. Firewall — both layers

On the VM:

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 49152:65535/udp
```

On the provider (security list / security group / VPC firewall), open the same
set. On Oracle Cloud images the local `iptables` rules also block by default
even after the security list is correct:

```bash
sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 49152:65535 -j ACCEPT
sudo netfilter-persistent save
```

## 5. Start it, and keep the certificate fresh

```bash
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
sudo systemctl status coturn --no-pager
```

coturn reads its certificate once at start, so a renewal that does not restart
it serves an expired certificate until something else does:

```bash
printf '#!/bin/sh\nsystemctl restart coturn\n' \
  | sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

## 6. Tell BetweenUs about it

In the deployment's `.env`:

```bash
TURN_URLS="turns:turn.example.com:443?transport=tcp,turn:turn.example.com:3478"
TURN_USERNAME="betweenus"
TURN_CREDENTIAL="PUT_A_LONG_RANDOM_SECRET_HERE"
```

Name both listeners. UDP 3478 is what most relayed calls will use; the TLS
listener on 443 is the fallback for networks that drop everything else.

Then restart the two services that hand out ICE:

```bash
docker compose -f infrastructure/docker/docker-compose.yml \
  up -d --force-recreate call-service remote-gateway
```

All three variables are needed together. With any of them missing the relay is
logged once and ignored, and the deployment stays STUN-only — deliberately: a
`turn:` URL with no credentials makes `RTCPeerConnection` throw, which would
break every call rather than only the relayed ones.

If `CLOUDFLARE_TURN_KEY_ID` is also set, Cloudflare's service wins. Unset it
to use your own.

## 7. Verify

**First, without BetweenUs in the picture.** Open
[Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/),
remove the default server, add `turns:turn.example.com:443?transport=tcp` with
the username and credential, and gather.

| What you see | What it means |
| --- | --- |
| A row of type `relay` | Working. Continue. |
| Only `host` / `srflx` rows | The relay was not reached: DNS proxied, firewall, or `external-ip`. |
| No rows, an error | Credentials or TLS. Check `journalctl -u coturn -f` while gathering. |

Do not skip this. Testing through the app first means debugging two systems at
once.

**Then a real call**, on the pair of networks that used to fail. In
`chrome://webrtc-internals`, the selected candidate pair should now show
`relay`. The deployment's own
[`GET /api/v1/calls/analytics`](/services/call-service) reports the
direct/relay split as well.

Most calls will still be **direct**, and that is correct — a relay only carries
the pairs that had no path.

## What a static credential means

Cloudflare's TURN credentials are minted per call and expire. A self-run
relay's do not: `TURN_CREDENTIAL` is handed to every client that calls
`POST /api/v1/calls/ice`, so anybody with an account can read it out of that
response and use the relay for their own traffic until it changes. A client
has to hold the credential to allocate with it, so this is bounded rather than
prevented — that is what `user-quota`, `total-quota` and the `denied-peer-ip`
lines above are for.

Rotate by changing `user=` in `turnserver.conf` and `TURN_CREDENTIAL`
together, then restarting coturn and both services.

None of this touches call privacy. The relay forwards DTLS-SRTP it has no key
for, so whoever runs it — or steals its credential — still cannot read a call.

## Troubleshooting

| Symptom | Cause to check first |
| --- | --- |
| Trickle ICE shows no `relay` row | DNS record proxied (orange cloud), or `external-ip` missing on a 1:1-NAT VM |
| `journalctl -u coturn` shows allocations, calls still fail | 49152–65535 UDP not open in the provider firewall |
| Every allocation refused, 401 | `lt-cred-mech` missing, or `realm` not matching |
| Worked, then stopped after ~90 days | Certificate renewed without restarting coturn |
| Log says "Running STUN-only" after configuring | One of the three variables empty, or the services were not restarted |
| Log says TURN_URLS is set but a credential is not | Exactly that — the relay was dropped rather than handed out broken |

## Cost

A relay only carries calls with no direct path, and it forwards rather than
transcodes. A voice call is roughly 50 kbps each way; video 1–2 Mbps. Bill by
the relayed minute, not by the call: on most deployments the majority of calls
never touch it.
