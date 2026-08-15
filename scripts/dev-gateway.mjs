/**
 * The gateway, for clients that cannot use a Vite proxy.
 *
 * `pnpm dev` gives the desktop and web clients a proxy table inside their own
 * dev servers, which stands in for Nginx. The Android client has no such thing:
 * it is a native app pointed at one address, so in development it needs
 * something real listening on one port that routes the same way.
 *
 * This is that, and nothing more - no TLS, no rate limiting, no auth. It
 * mirrors the route table in infrastructure/nginx/nginx.conf, which is the
 * thing it is standing in for; when that file changes, this one changes.
 *
  *   pnpm dev:gateway            # http://0.0.0.0:8090
 *
 * It binds every interface on purpose: an emulator reaches it on 10.0.2.2 and a
 * physical phone on the machine's LAN address, and neither can see loopback.
 * Production is Nginx in a container behind a Cloudflare Tunnel; this file is
 * never part of that.
 */
import http from 'node:http';
import net from 'node:net';

/**
 * 8090 rather than 8080, which is what the Nginx container listens on. Two
 * reasons: `pnpm dev:infra` can be running at the same time as this, and on
 * Windows 8080 often falls inside a Hyper-V reserved port range and simply
 * cannot be bound - a failure that reads as "address already in use" with
 * nothing visibly listening.
 */
const PORT = Number(process.env.GATEWAY_PORT ?? 8090);

const AUTH = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3001';
const SERVER = process.env.SERVER_SERVICE_URL ?? 'http://127.0.0.1:3003';
const CHAT = process.env.CHAT_SERVICE_URL ?? 'http://127.0.0.1:3004';
const PRESENCE = process.env.PRESENCE_SERVICE_URL ?? 'http://127.0.0.1:3005';
const NOTIFICATION = process.env.NOTIFICATION_SERVICE_URL ?? 'http://127.0.0.1:3006';
const CALL = process.env.CALL_SERVICE_URL ?? 'http://127.0.0.1:3007';
const REMOTE = process.env.REMOTE_GATEWAY_URL ?? 'http://127.0.0.1:3008';

/** Longest prefix wins, so `/api/v1/servers` cannot swallow `/api/v1/servers/x`. */
const ROUTES = [
  ['/api/v1/auth', AUTH],
  ['/api/v1/admin', AUTH],
  ['/api/v1/servers', SERVER],
  ['/api/v1/channels', SERVER],
  ['/api/v1/messages', CHAT],
  ['/api/v1/friends', CHAT],
  ['/api/v1/users', CHAT],
  ['/api/v1/dm', CHAT],
  ['/api/v1/uploads', CHAT],
  ['/api/v1/e2ee', CHAT],
  ['/api/v1/calls', CALL],
  ['/api/v1/notifications', NOTIFICATION],
  ['/api/v1/remote', REMOTE],
  ['/ws/chat', CHAT],
  ['/ws/presence', PRESENCE],
  ['/ws/call', CALL],
  ['/ws/remote', REMOTE],
].sort((a, b) => b[0].length - a[0].length);

const upstreamFor = (url) => {
  const path = url.split('?')[0];
  const match = ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return match?.[1] ?? null;
};

const server = http.createServer((request, response) => {
  const upstream = upstreamFor(request.url ?? '/');
  if (!upstream) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'NO_ROUTE', message: `No route for ${request.url}` } }));
    return;
  }

  const target = new URL(upstream);
  const proxied = http.request(
    {
      host: target.hostname,
      port: target.port,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: target.host },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  proxied.on('error', (error) => {
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({ error: { code: 'UPSTREAM_DOWN', message: `${upstream}: ${error.message}` } }),
    );
  });

  request.pipe(proxied);
});

// WebSocket upgrades are the whole reason this exists rather than a one-liner:
// /ws/chat, /ws/presence, /ws/call and /ws/remote all arrive this way.
server.on('upgrade', (request, socket, head) => {
  const upstream = upstreamFor(request.url ?? '/');
  if (!upstream) {
    socket.destroy();
    return;
  }

  const target = new URL(upstream);
  const outbound = net.connect(Number(target.port), target.hostname, () => {
    const lines = [
      `GET ${request.url} HTTP/1.1`,
      ...Object.entries(request.headers).flatMap(([key, value]) =>
        Array.isArray(value) ? value.map((v) => `${key}: ${v}`) : [`${key}: ${value}`],
      ),
      '',
      '',
    ];
    outbound.write(lines.join('\r\n'));
    if (head?.length) outbound.write(head);
    outbound.pipe(socket);
    socket.pipe(outbound);
  });

  outbound.on('error', () => socket.destroy());
  socket.on('error', () => outbound.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`dev gateway on http://0.0.0.0:${PORT}`);
  console.log('  emulator: http://10.0.2.2:%d', PORT);
  console.log('  routes:   %s', ROUTES.map(([prefix]) => prefix).join(' '));
});
