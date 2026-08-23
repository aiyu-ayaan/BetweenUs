/**
 * The service worker: what is left of BetweenUs when the tab is closed.
 *
 * Its whole job is push. There is no offline caching here and no fetch handler
 * on purpose - a cached shell of an end-to-end encrypted app that cannot reach
 * its server is a login screen that does not work, which is worse than the
 * browser's own offline page.
 *
 * ## What it can and cannot say
 *
 * A message body is sealed with the channel key. That key is unwrapped with the
 * account's identity key, which lives in the *page*, and the wrapped copies are
 * behind an authenticated API call. None of that is reachable from here, and
 * building it here would mean a second copy of the key ladder running in a
 * context the user cannot see.
 *
 * So this worker never shows the words. A message becomes "Ayaan sent a
 * message"; opening it hands over to the app, which has the keys and shows what
 * was actually said. Everything that carries no sealed content - a friend
 * request, being added to a server, who is in a call - is shown in full,
 * because there is nothing to hide.
 *
 * That is a real difference from Android, where the app itself is woken and
 * decrypts in a cold process. It is written down in `docs/architecture/
 * notifications.md` rather than left to be discovered.
 *
 * ## The open tab wins
 *
 * If a client is already running, the push is handed to it and no notification
 * is drawn here. That client can decrypt, and it knows what is on screen. The
 * worker only draws when nobody is there to do it better.
 */

/* eslint-env serviceworker */
/* global clients */

/** One notification per channel, replaced rather than stacked. */
const tagFor = (data) => {
  switch (data.type) {
    case 'message.created':
    case 'message.deleted':
    case 'channel.read':
      return `channel:${data.channelId}`;
    case 'call.roster':
      return `call:${data.channelId}`;
    case 'remote.session':
      return `remote:${data.sessionId}`;
    case 'friend.request':
    case 'friend.accepted':
      return `friend:${data.actorId}`;
    case 'server.member.added':
      return `server:${data.serverId}`;
    default:
      return 'betweenus';
  }
};

/**
 * What to show, or null for a push whose only job is to take something away.
 *
 * `message.created` is the one that has to lie by omission: the body is
 * ciphertext and this worker holds no key, so it says that something was said
 * rather than what.
 */
function present(data) {
  switch (data.type) {
    case 'message.created':
      return {
        title: data.authorName || 'New message',
        body: 'Sent a message',
        icon: data.authorAvatarUrl || '/icon.png',
      };
    case 'friend.request':
      return { title: data.actorName, body: 'Sent you a friend request', icon: data.actorAvatarUrl || '/icon.png' };
    case 'friend.accepted':
      return { title: data.actorName, body: 'Accepted your friend request', icon: data.actorAvatarUrl || '/icon.png' };
    case 'server.member.added':
      return { title: data.serverName, body: 'You were added to this server', icon: data.serverIconUrl || '/icon.png' };
    case 'call.roster':
      // An empty roster is the call ending, and the notification for it is
      // cancelled rather than rewritten - see below.
      return data.count === '0'
        ? null
        : {
            title: `Call in ${data.channelName}`,
            body: data.participants ? `${data.participants} in the call` : 'Somebody is in the call',
            icon: '/icon.png',
            requireInteraction: true,
          };
    case 'remote.session':
      return data.state === 'ended'
        ? null
        : {
            title: 'Remote session',
            body: `${data.actorName} connected to ${data.machineName}`,
            icon: '/icon.png',
            requireInteraction: true,
          };
    // Both of these exist only to close something.
    case 'message.deleted':
    case 'channel.read':
      return null;
    default:
      return null;
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || typeof data.type !== 'string') return;

  event.waitUntil(
    (async () => {
      // A running client can decrypt and knows what is on screen. Handing the
      // push over rather than drawing here is what stops a notification
      // appearing beside the conversation it is about.
      const running = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (running.length > 0) {
        for (const client of running) client.postMessage({ betweenus: 'push', data });
        return;
      }

      const shown = present(data);
      if (!shown) {
        // Nothing to draw: this push exists to take a notification away.
        const open = await self.registration.getNotifications({ tag: tagFor(data) });
        for (const notification of open) notification.close();
        return;
      }

      await self.registration.showNotification(shown.title, {
        body: shown.body,
        icon: shown.icon,
        badge: '/icon.png',
        tag: tagFor(data),
        renotify: true,
        requireInteraction: shown.requireInteraction === true,
        data,
      });
    })(),
  );
});

/**
 * Tap-through: what opening a notification is supposed to do.
 *
 * A notification nobody can act on is a notification people turn off. Focusing
 * a tab that is already open beats opening a second one, and either way the
 * app is told where to go rather than being dropped at the front door.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const route = routeFor(data);

  event.waitUntil(
    (async () => {
      const running = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of running) {
        if ('focus' in client) {
          client.postMessage({ betweenus: 'open', route });
          await client.focus();
          return;
        }
      }
      // Nothing running. The route travels in the URL instead, which is the
      // only channel a page that does not exist yet can be told anything on.
      await clients.openWindow(route.url);
    })(),
  );
});

/** Where a push points. One shape, whether it is delivered by URL or message. */
function routeFor(data) {
  switch (data.type) {
    case 'message.created':
      return { kind: 'channel', channelId: data.channelId, url: `/?channel=${encodeURIComponent(data.channelId)}` };
    case 'call.roster':
      return { kind: 'call', channelId: data.channelId, url: `/?call=${encodeURIComponent(data.channelId)}` };
    case 'remote.session':
      return { kind: 'remote', machineId: data.machineId, url: `/?remote=${encodeURIComponent(data.machineId)}` };
    case 'friend.request':
    case 'friend.accepted':
      return { kind: 'friends', url: '/?view=friends' };
    case 'server.member.added':
      return { kind: 'server', serverId: data.serverId, url: `/?server=${encodeURIComponent(data.serverId)}` };
    default:
      return { kind: 'home', url: '/' };
  }
}
