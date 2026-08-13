/**
 * The development SFU, reachable from a second machine - without configuring
 * anything outside this repo.
 *
 * `pnpm dev:web:lan` serves the app to the network, and everything the app asks
 * for afterwards goes through that one origin: every REST route, both
 * WebSockets, and LiveKit's signalling through the `/livekit` proxy. Media is
 * the one thing that cannot, because WebRTC negotiates its own path to the SFU -
 * and that is where a join from the other machine died with "Connection to
 * voice server timed out".
 *
 * Two things were missing, and this plugin is both of them:
 *
 *   1. The candidates named `127.0.0.1`, so the other machine dialled itself.
 *      `lan-ice.ts`, injected into the page below, rewrites them to the address
 *      the page was loaded from.
 *   2. Nothing answered on that address. This relays the SFU's ICE-TCP port
 *      from every address this host has on the network to the loopback port
 *      docker publishes it on.
 *
 * The relay is an ordinary listener in an ordinary Node process, so it costs
 * one ordinary Windows Firewall prompt, exactly like the dev server's own port.
 * That is the whole point: a port published inside a WSL VM is bound on the VM,
 * and opening it to the LAN needs mirrored networking plus a Hyper-V firewall
 * rule - neither of which is this repo's to hand out, and neither of which is
 * needed now. Nothing is reconfigured and nothing has to be put back: the SFU
 * keeps advertising `127.0.0.1`, which stays correct for a browser on this host.
 *
 * Media rides the TCP candidate. The UDP range (50000-50019) is untouched and
 * simply loses the ICE race wherever it is unreachable, which costs a test call
 * a few milliseconds. Relaying that range too would keep media on UDP, at the
 * price of a per-source socket table - worth writing only if a call ever looks
 * bad for this reason.
 */
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Plugin } from 'vite';

/** `rtc.tcp_port` in infrastructure/livekit/livekit.yaml. */
const TCP_PORT = 7881;

/** Where the dev compose file publishes that port. */
const LOOPBACK = '127.0.0.1';

/**
 * Every address this host answers on that is not loopback.
 *
 * All of them, rather than a guess at which one is "the" LAN address: the page
 * rewrites candidates to whatever address it was loaded from, so the relay has
 * to be listening wherever that turns out to be - Wi-Fi, Ethernet, or a docker
 * bridge somebody is testing through.
 */
function networkAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

/** Accepts ICE-TCP on one address and pipes it to the published loopback port. */
function relayFrom(address: string): net.Server {
  const server = net.createServer((client) => {
    const upstream = net.connect(TCP_PORT, LOOPBACK);
    const drop = (): void => {
      client.destroy();
      upstream.destroy();
    };
    // A candidate the browser probes and abandons is a normal reset, not an
    // event worth logging - and an unhandled 'error' on either socket would
    // take the dev server down with it.
    client.on('error', drop);
    upstream.on('error', drop);
    client.pipe(upstream).pipe(client);
  });
  server.listen(TCP_PORT, address);
  return server;
}

export function lanSfu(): Plugin {
  return {
    name: 'nexora:lan-sfu',
    apply: 'serve',

    configureServer(server) {
      const { logger } = server.config;
      const addresses = networkAddresses();
      const relays = addresses.map(relayFrom);

      for (const [index, relay] of relays.entries()) {
        relay.on('error', (error: NodeJS.ErrnoException) => {
          // EADDRINUSE means something already answers there - a stack whose
          // SFU is published beyond loopback, which is this relay's job already
          // done - so it is worth one line, not a failed startup.
          logger.warn(
            `  ➜  Voice:   no media relay on ${addresses[index]}:${TCP_PORT} (${error.code ?? error.message})`,
          );
        });
      }

      server.httpServer?.once('close', () => {
        for (const relay of relays) relay.close();
      });

      logger.info(`  ➜  Voice:   SFU media relayed on tcp/${TCP_PORT} from ${addresses.join(', ')}`);
    },

    // Before the app's own module graph, so the patch is in place by the time
    // anything can construct an RTCPeerConnection.
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/lan-ice.ts' }, injectTo: 'head-prepend' }];
    },
  };
}
