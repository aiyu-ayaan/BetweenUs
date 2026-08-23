/**
 * Web Push, browser side: staying reachable with the tab closed.
 *
 * The Electron app needs none of this - it is a running process with a tray
 * icon, and it raises its own notifications. A browser tab is not: close it and
 * the account is unreachable until somebody opens it again. That is the gap
 * this closes, and it is the only reason a service worker exists in this repo.
 *
 * No Firebase, and no SDK. `PushManager.subscribe` is a browser API, VAPID is
 * the standard that lets a deployment identify itself to whichever push service
 * that browser uses, and the whole client half is the fifty lines below. The
 * server has the other half in `notification-service/src/push/webpush.ts`.
 *
 * The subscription registers into the same device registry a phone's FCM token
 * does, keyed on the same client-minted device id the key directory uses. One
 * browser profile is one row for as long as its site data lives.
 */
import type { PushData, WebPushSubscription } from '@betweenus/shared-types';
import { api } from './api';
import { deviceId } from './e2ee';
import { isDesktopRuntime } from './platform';

const SERVICE_WORKER_URL = '/sw.js';

/** Where a notification points, as the worker describes it. */
export interface PushRoute {
  kind: 'channel' | 'call' | 'remote' | 'friends' | 'server' | 'home';
  channelId?: string;
  serverId?: string;
  machineId?: string;
  url: string;
}

type WorkerMessage =
  | { betweenus: 'push'; data: PushData }
  | { betweenus: 'open'; route: PushRoute };

/** True where all three pieces exist. Safari before 16.4 has none of them. */
function supported(): boolean {
  return (
    !isDesktopRuntime() &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Registers the worker and subscribes this browser, if it can and may.
 *
 * Called after sign-in, and safe to call again: `subscribe` returns the
 * existing subscription rather than minting a second, and the registry upsert
 * on the other end is keyed on the device id.
 *
 * Every reason to stop is a normal outcome rather than an error. No worker
 * support, no VAPID keys on the deployment, permission not granted - each of
 * those is a browser that gets notifications while its tab is open and nothing
 * when it is closed, which is what this app did before any of this existed.
 */
export async function startWebPush(): Promise<void> {
  if (!supported()) return;

  try {
    // Asked before the permission prompt, so a deployment that cannot push
    // never prompts. A prompt that leads nowhere is a prompt people deny, and
    // a denied prompt is not offered again by the browser.
    const { vapidPublicKey } = await api.pushKey();
    if (!vapidPublicKey) return;

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    await navigator.serviceWorker.ready;

    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') return;
    }

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Without this every push would be visible to the user or the browser
        // drops the subscription; the spec has no silent option any more.
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(vapidPublicKey),
      }));

    await api.registerPushDevice({
      token: JSON.stringify(toStored(subscription)),
      platform: 'web',
      deviceId: deviceId(),
      label: browserLabel(),
    });
  } catch {
    // A browser that will not subscribe is a browser without push. It is not a
    // browser that should fail to sign in, which is what throwing here would
    // make it.
  }
}

/**
 * Unsubscribes and forgets the row. Called on sign-out.
 *
 * The registry row goes first, because it is the one that matters: a row left
 * behind pushes this account's messages at whoever uses this browser next.
 * The local subscription is torn down afterwards and its failure is ignored -
 * a subscription nothing will ever send to is harmless.
 */
export async function stopWebPush(): Promise<void> {
  if (!supported()) return;
  try {
    await api.unregisterPushDevice(deviceId());
  } catch {
    // Signed out already, or offline. The next sign-in re-registers.
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to undo.
  }
}

/**
 * Listens for what the worker hands over: a push while a tab is open, and a
 * notification somebody tapped.
 *
 * Returns an unsubscribe, like every other listener in this app.
 */
export function onPushMessage(handle: (message: WorkerMessage) => void): () => void {
  if (!supported()) return () => undefined;

  const listener = (event: MessageEvent): void => {
    const message = event.data as WorkerMessage | undefined;
    if (!message || typeof message.betweenus !== 'string') return;
    handle(message);
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

/**
 * The route a cold start was opened with, taken off the URL.
 *
 * A worker that finds no running client opens one with the destination in the
 * query string, because that is the only channel a page which does not exist
 * yet can be told anything on. Read once and cleared, so a refresh does not
 * jump somewhere the person has since navigated away from.
 */
export function takeStartupRoute(): PushRoute | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);

  const found: PushRoute | null =
    read(params, 'channel', (id) => ({ kind: 'channel', channelId: id, url: '' })) ??
    read(params, 'call', (id) => ({ kind: 'call', channelId: id, url: '' })) ??
    read(params, 'remote', (id) => ({ kind: 'remote', machineId: id, url: '' })) ??
    read(params, 'server', (id) => ({ kind: 'server', serverId: id, url: '' })) ??
    (params.get('view') === 'friends' ? { kind: 'friends', url: '' } : null);

  if (found) {
    // The query string has done its job. Leaving it there means a reload takes
    // somebody back to a message they read ten minutes ago.
    window.history.replaceState({}, '', window.location.pathname);
  }
  return found;
}

function read(
  params: URLSearchParams,
  name: string,
  build: (id: string) => PushRoute,
): PushRoute | null {
  const value = params.get(name);
  return value ? build(value) : null;
}

/** The shape the registry stores. `toJSON` is the only portable way to get it. */
function toStored(subscription: PushSubscription): WebPushSubscription {
  const raw = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  return {
    endpoint: raw.endpoint ?? subscription.endpoint,
    keys: { p256dh: raw.keys?.p256dh ?? '', auth: raw.keys?.auth ?? '' },
  };
}

/**
 * A name for the row in somebody's device list. The user agent string is a
 * lie by design, so this only looks for the few names worth telling apart and
 * says "Browser" for everything else rather than guessing wrongly in detail.
 */
function browserLabel(): string {
  const agent = navigator.userAgent;
  if (/Edg\//.test(agent)) return 'Edge';
  if (/OPR\//.test(agent)) return 'Opera';
  if (/Firefox\//.test(agent)) return 'Firefox';
  if (/Chrome\//.test(agent)) return 'Chrome';
  if (/Safari\//.test(agent)) return 'Safari';
  return 'Browser';
}

/**
 * The VAPID key arrives base64url and `subscribe` wants bytes.
 *
 * Padding has to be put back before `atob`, and the two url-safe characters
 * swapped for the standard ones. Getting this wrong produces an
 * `InvalidCharacterError` at subscribe time and nothing else, which is why it
 * is one function with the reason written on it.
 */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
