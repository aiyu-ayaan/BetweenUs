---
sidebar_position: 7
---

# coturn on Oracle Cloud: a worked example

The [TURN relay](/deployment/turn-server) page is the general runbook. This one
follows a single real deployment start to finish — an Oracle Cloud Always Free
VM relaying for a BetweenUs stack that runs on a Raspberry Pi behind a
Cloudflare Tunnel — because three of the steps behave differently on Oracle
than the general instructions suggest, and each of them produces a relay that
looks installed and relays nothing.

Substitute your own values for `<PUBLIC_IP>`, `<PRIVATE_IP>` and the
credential throughout.

## The topology, which surprises people

The Pi and the relay never talk to each other. There is no link to configure
between them, no tunnel, no firewall rule at home.

```text
 Raspberry Pi (the whole app, behind a Cloudflare Tunnel)     Oracle VM
        |                                                    <PUBLIC_IP>
        |  names the relay in POST /api/v1/calls/ice               ^
        v                                                          |
    Client A -----------------------------------------------------+  media,
    Client B -----------------------------------------------------+  only when
                                                                     no direct
                                                                     path exists
```

The Pi hands clients a string. The clients dial the relay. The only thing
connecting the two machines is the same secret written in both places.

## What the VM looked like

```bash
ssh -i ./ssh-key.key ubuntu@<PUBLIC_IP>
```

```text
Ubuntu 22.04.5 LTS, x86_64, 2 vCPU, 956 MB RAM
ip -4 addr  ->  10.x.x.x  (private; the public address is mapped onto it)
ufw         ->  inactive
iptables    ->  ends in: -A INPUT -j REJECT --reject-with icmp-host-prohibited
```

Every one of those four lines matters below.

## 1. Install

```bash
sudo apt-get update
sudo apt-get install -y coturn iptables-persistent
```

`iptables-persistent` is not optional on this image: `ufw` is inactive, so the
firewall is raw iptables, and without it every rule is lost on reboot.

## 2. Configure

`/etc/turnserver.conf`, mode `640`, owned `root:turnserver` — it holds the
credential:

```ini
listening-port=3478
# Bind the interface that carries public traffic. Without this coturn also
# listens on docker0 if Docker is installed, which is pure attack surface.
listening-ip=<PRIVATE_IP>

# --- The Oracle line -------------------------------------------------------
external-ip=<PUBLIC_IP>/<PRIVATE_IP>

lt-cred-mech
realm=betweenus
user=betweenus:<LONG_RANDOM_SECRET>

min-port=49152
max-port=65535

fingerprint
stale-nonce
no-multicast-peers
no-tcp-relay
no-cli

# One shared username, so this is a deployment-wide cap, not a per-person one.
user-quota=100
total-quota=300

denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=::1
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
```

```bash
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
```

:::danger `external-ip` is mandatory on Oracle
Oracle (like AWS and GCP) gives the VM a private address and maps a public one
onto it. `ip -4 addr` shows `10.x.x.x`. Without `external-ip` coturn advertises
that private address in its candidates, every client tries to reach `10.x.x.x`,
and nothing connects — while the service, the logs and `ss -lnu` all look
perfectly healthy.

`denied-peer-ip=169.254.0.0-169.254.255.255` matters for the same family of
reasons: `169.254.169.254` is the cloud metadata endpoint, and an open relay
that can be aimed at it is a way to read instance metadata.
:::

## 3. Firewall — three layers, and Oracle needs all three

**Layer 1, iptables.** This image's `INPUT` chain ends in a blanket `REJECT`,
so rules must be *inserted*, not appended — an appended rule sits after the
reject and does nothing:

```bash
sudo iptables -I INPUT 1 -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 49152:65535 -j ACCEPT
sudo netfilter-persistent save
```

**Layer 2, ufw.** Inactive on this image, so nothing to do. If you enable it
later, mirror the same three rules.

**Layer 3, the VCN security list.** In the Oracle Console:

*Networking → Virtual Cloud Networks → your VCN → Security Lists → the subnet's
list → Add Ingress Rules.* Three stateless-off (stateful) rules, source
`0.0.0.0/0`:

| Protocol | Destination port range | Why |
| --- | --- | --- |
| UDP | 3478 | STUN/TURN signalling |
| TCP | 3478 | TURN over TCP for networks that drop UDP |
| UDP | 49152–65535 | The relay port range media actually flows over |

:::caution This is the layer that is always forgotten
The host is wide open and coturn is answering, and the port is still shut,
because the block is upstream of the VM entirely. Symptom: everything below in
"verify locally" passes, and every test from outside times out.
:::

## 4. Verify, in the order that isolates faults

**On the VM first.** These two prove coturn, the credential and `external-ip`
without involving any firewall:

```bash
turnutils_stunclient -p 3478 <PRIVATE_IP>
# -> "UDP reflexive addr: <PUBLIC_IP>:xxxxx"
#    It must print the PUBLIC address. Printing the private one means
#    external-ip is missing or wrong.

SECRET=$(sudo grep '^user=' /etc/turnserver.conf | cut -d: -f2-)
turnutils_uclient -t -u betweenus -w "$SECRET" -n 1 -y <PRIVATE_IP>
# -> "Total lost packets 0 (0.000000%)"
#    A real allocation succeeded, so lt-cred-mech and user= are right.
```

**Then from anywhere else**, which is the only test that covers the security
list. Either [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
with `turn:<PUBLIC_IP>:3478` and the credentials — you want a row of type
`relay` — or a plain STUN binding request:

```js
// node stun-check.js <PUBLIC_IP> 3478
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const req = Buffer.alloc(20);
req.writeUInt16BE(0x0001, 0);
req.writeUInt32BE(0x2112a442, 4);
crypto.randomBytes(12).copy(req, 8);
const sock = dgram.createSocket('udp4');
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 6000);
sock.on('message', (m) => { console.log('ANSWERED', m.length, 'bytes'); process.exit(0); });
sock.send(req, Number(process.argv[3]), process.argv[2]);
```

`TIMEOUT` here while both VM-local checks pass means exactly one thing: the
VCN security list.

## 5. Point the deployment at it

On the Pi, in `.env`:

```bash
TURN_URLS="turn:<PUBLIC_IP>:3478"
TURN_USERNAME="betweenus"
TURN_CREDENTIAL="<LONG_RANDOM_SECRET>"
```

Then rebuild the two services that hand out ICE, because the change lives
inside their images and restarting an old image will not have it:

```bash
docker compose -f infrastructure/docker/docker-compose.build.yml build call-service remote-gateway
docker compose -f infrastructure/docker/docker-compose.build.yml up -d call-service remote-gateway
```

The `Running STUN-only: no TURN relay is configured` line should stop appearing
in the logs. Nothing changes on the Cloudflare Tunnel: no new hostname, no new
ingress rule. The relay is dialled outbound by the clients.

## 6. Later: TLS on 443

Plain `turn:` on an IP needs no domain and no certificate, and it is the right
place to start because it removes DNS and TLS from the list of things that
could be wrong. It does not, however, get through a network that allows only
HTTPS — which is part of why a relay was added.

When ready: point `turn.yourdomain.com` at the VM as a **DNS-only (grey cloud)**
record, run `certbot certonly --standalone`, add `tls-listening-port=443` with
`cert`/`pkey`, open 443 TCP in all three firewall layers, install the certbot
deploy hook that restarts coturn, and list both URLs:

```bash
TURN_URLS="turns:turn.yourdomain.com:443?transport=tcp,turn:<PUBLIC_IP>:3478"
```

Full detail on the general page: [TURN relay (coturn)](/deployment/turn-server).

## Cost on an Always Free VM

The shape is fine for this: a relay forwards packets rather than transcoding
them, so 2 vCPU and under a gigabyte of RAM is not the constraint. Bandwidth is
— roughly 50 kbps each way for voice, 1–2 Mbps for video, per relayed call, and
only for calls that had no direct path. Oracle's Always Free egress allowance
absorbs a small deployment comfortably; watch it rather than assume it if
relayed video becomes common.
