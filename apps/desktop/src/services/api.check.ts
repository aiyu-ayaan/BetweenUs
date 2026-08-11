/**
 * The API client's token handling, checked without a server.
 *
 * The bug this pins down: two calls behind one screen go out together, the
 * window has no access token yet, and only the first waits for the refresh -
 * the second used to be sent anonymously and came back "Missing bearer token".
 *
 * Run with: pnpm --filter @nexora/desktop check
 */
import assert from 'node:assert/strict';
import { api, configureApi } from './api';

interface Call {
  url: string;
  authorization: string | null;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), authorization: headers.Authorization ?? null });
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: headers.Authorization ? 200 : 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return calls;
}

async function parallelCallsShareOneRefresh(): Promise<void> {
  const calls = stubFetch();

  let token: string | null = null;
  let refreshes = 0;
  configureApi(
    () => token,
    async () => {
      refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      token = 'minted';
      return token;
    },
  );

  await Promise.all([api.friends(), api.directChannels()]);

  assert.equal(refreshes, 1, 'concurrent calls must share one refresh, not rotate twice');
  assert.equal(calls.length, 2, 'no request should have needed a retry');
  for (const call of calls) {
    assert.equal(call.authorization, 'Bearer minted', `${call.url} went out without a token`);
  }
}

async function refreshItselfNeverWaitsOnAToken(): Promise<void> {
  const calls = stubFetch();

  // A refresher that hangs: if the public routes waited on it, this deadlocks.
  configureApi(
    () => null,
    () => new Promise(() => undefined),
  );

  await api.refresh('stored-refresh-token').catch(() => undefined);

  assert.equal(calls.length, 1, 'the refresh call must go straight out');
  assert.equal(calls[0]?.authorization, null, 'the refresh call carries no bearer token');
}

async function main(): Promise<void> {
  await parallelCallsShareOneRefresh();
  await refreshItselfNeverWaitsOnAToken();
  console.log('api.check.ts: ok');
}

void main();
