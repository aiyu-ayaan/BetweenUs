/**
 * The other transport: a browser with the tab closed.
 *
 * FCM reaches phones. Web Push reaches browsers, and it is a different protocol
 * with a different address, a different authentication scheme and a different
 * way of saying a subscription is dead. What it is not is a different *design*:
 * the payload is the same data-only envelope, the client still writes the
 * notification because the body is still sealed with the channel key, and the
 * whole filtering half of `push.service.ts` is shared.
 *
 * **No Firebase in this path.** A deployment with VAPID keys and no Firebase
 * project pushes to browsers and not to phones; one with Firebase and no VAPID
 * keys does the opposite. Neither is broken, and neither needs the other.
 *
 * VAPID is what identifies this deployment to a push service. The keys are an
 * ordinary P-256 pair: the public half is handed to browsers so they can bind a
 * subscription to it, and the private half signs a short-lived JWT per send.
 * Generate a pair with `npx web-push generate-vapid-keys`.
 */
import webpush, { WebPushError } from 'web-push';
import { env, envOr } from '@betweenus/config';
import type { PushData, WebPushSubscription } from '@betweenus/shared-types';

/**
 * How long a push service should hold the message for a browser that is not
 * there. The same day the FCM path uses, for the same reason: past that the
 * message is old news and the badge on next launch says it better.
 */
const TIME_TO_LIVE_SECONDS = 60 * 60 * 24;

let configured: boolean | null = null;

/**
 * True when this deployment can push to a browser at all.
 *
 * Resolved once. A missing key is a deployment without web push rather than an
 * error, and saying so per message would be noise on every message.
 */
export function webPushReady(): boolean {
  if (configured !== null) return configured;

  const publicKey = env('VAPID_PUBLIC_KEY');
  const privateKey = env('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  // The subject tells a push service who to complain to about this sender. A
  // mailto is what the spec suggests and what the services actually accept.
  webpush.setVapidDetails(
    envOr('VAPID_SUBJECT', 'mailto:admin@betweenus.local'),
    publicKey,
    privateKey,
  );
  configured = true;
  return true;
}

/** The half a browser is allowed to see, or null when there is none. */
export function vapidPublicKey(): string | null {
  return webPushReady() ? (env('VAPID_PUBLIC_KEY') ?? null) : null;
}

/**
 * Reads a stored address back into a subscription.
 *
 * Anything that is not one - an FCM token that reached this path by mistake,
 * a row written by an older client, a truncated string - is null rather than a
 * throw. One malformed row must not take a fan-out down with it.
 */
export function parseSubscription(stored: string): WebPushSubscription | null {
  if (!stored.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<WebPushSubscription>;
    if (typeof parsed.endpoint !== 'string' || !parsed.endpoint) return null;
    if (typeof parsed.keys?.p256dh !== 'string' || typeof parsed.keys?.auth !== 'string') {
      return null;
    }
    return { endpoint: parsed.endpoint, keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth } };
  } catch {
    return null;
  }
}

/** What a send did, so the caller can drop the addresses that are gone. */
export interface WebPushOutcome {
  delivered: number;
  /** Stored addresses the push service says will never work again. */
  dead: string[];
}

/**
 * Sends one payload to a list of browsers.
 *
 * Sequential rather than batched because there is no batch: Web Push is one
 * HTTP request per subscription, to whichever service that browser uses. They
 * are fired together and settled together, so one slow push service does not
 * hold up the rest.
 *
 * **404 and 410 are the only fatal answers.** They mean the subscription is
 * gone - the tab's site data was cleared, permission was revoked, the browser
 * expired it - and keeping it is a failed request per message forever. Anything
 * else (a 429, a 500, a timeout) is the push service having a moment, and
 * dropping a working subscription over one is how somebody silently stops
 * getting notifications.
 */
export async function sendWebPush(
  addresses: { stored: string; data: PushData }[],
  options: { urgent?: boolean } = {},
): Promise<WebPushOutcome> {
  if (!webPushReady() || addresses.length === 0) return { delivered: 0, dead: [] };

  const results = await Promise.allSettled(
    addresses.map(async (address) => {
      const subscription = parseSubscription(address.stored);
      if (!subscription) throw new Error('not a subscription');
      await webpush.sendNotification(subscription, JSON.stringify(address.data), {
        TTL: TIME_TO_LIVE_SECONDS,
        // `high` wakes a service worker promptly; `normal` lets the browser
        // batch it with whatever else it was going to do. The distinction is
        // the same one the Android path makes with Doze.
        urgency: options.urgent === false ? 'normal' : 'high',
      });
    }),
  );

  const dead: string[] = [];
  let delivered = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      delivered += 1;
      return;
    }
    const stored = addresses[index]?.stored;
    if (stored && isGone(result.reason)) dead.push(stored);
  });

  return { delivered, dead };
}

function isGone(reason: unknown): boolean {
  if (reason instanceof WebPushError) return reason.statusCode === 404 || reason.statusCode === 410;
  // A row that will not parse is never going to parse. It is as dead as a
  // subscription the service has forgotten, and is dropped for the same reason.
  return reason instanceof Error && reason.message === 'not a subscription';
}
