/**
 * The Firebase credentials, out of the environment and never off disk.
 *
 * A service account JSON file in the repository is one `git add .` away from
 * being a private key in a public history, and the file is not what a container
 * has anyway - it has an environment. So the same three fields the file carries
 * are read from three variables, and `scripts/firebase-env.mjs` turns a
 * downloaded key into the lines to paste. Nothing here ever opens a path.
 *
 * `FIREBASE_SERVICE_ACCOUNT` is the same JSON, base64 or raw, in one variable -
 * which is what a secrets manager tends to hand out. It wins when both are set.
 *
 * With none of them set push is simply off: `messaging()` returns null, the
 * fan-out logs once and does nothing, and every other part of this service
 * carries on. A deployment that has not configured Firebase is not a broken
 * deployment.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { env } from '@betweenus/config';

export interface FirebaseCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * A private key survives an environment variable as `\n` rather than as a
 * newline - that is what `.env` files, Compose and every secrets UI do to it -
 * and OpenSSL rejects the result with an error about the PEM header. Undoing it
 * here is the one line that stops that being a half-hour every time.
 */
function normalisePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n').trim();
}

function fromSingleVariable(raw: string): FirebaseCredentials | null {
  // Base64 or raw JSON: both arrive in the same variable depending on who
  // filled it in, and telling them apart is cheaper than making people care.
  const text = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const projectId = typeof parsed.project_id === 'string' ? parsed.project_id : '';
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : '';
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey: normalisePrivateKey(privateKey) };
}

export function firebaseCredentials(): FirebaseCredentials | null {
  const single = env('FIREBASE_SERVICE_ACCOUNT');
  if (single) return fromSingleVariable(single);

  const projectId = env('FIREBASE_PROJECT_ID');
  const clientEmail = env('FIREBASE_CLIENT_EMAIL');
  const privateKey = env('FIREBASE_PRIVATE_KEY');
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey: normalisePrivateKey(privateKey) };
}

let app: App | null = null;
let resolved = false;

/**
 * The one Firebase app this service has, or null when it is not configured.
 * Both the sender and the device registry hang off it - see `firestore.ts`.
 */
export function firebaseApp(): App | null {
  if (!resolved) {
    resolved = true;
    const credentials = firebaseCredentials();
    if (credentials) {
      app =
        getApps().find((existing) => existing.name === 'betweenus') ??
        initializeApp({ credential: cert(credentials), projectId: credentials.projectId }, 'betweenus');
    }
  }
  return app;
}

/** Null when Firebase is not configured. Built once, on first use. */
export function messaging(): Messaging | null {
  const current = firebaseApp();
  return current ? getMessaging(current) : null;
}
