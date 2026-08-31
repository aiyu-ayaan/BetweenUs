/**
 * "Is the relay this deployment hands out actually working?"
 *
 * Answered here, in `call-service`, because this is the service that answers
 * `POST /api/v1/calls/ice`. The admin panel could read `TURN_URLS` itself and
 * probe from there, and it deliberately does not: a second reader of the same
 * setting can disagree with the first, and a panel showing a healthy relay
 * while clients are handed a different one is worse than no panel. This asks
 * the exact list `iceServers()` would give a client, so what is drawn is what
 * is served.
 *
 * The probe itself is a real TURN allocation - see `turn-probe.ts` for why
 * nothing weaker is worth showing an operator.
 */
import { Injectable } from '@nestjs/common';
import { iceServers } from '@betweenus/config';
import type { AdminRelayHealth, RelayProbeResult } from '@betweenus/shared-types';
import { probeRelay } from './turn-probe';

/**
 * How long one relay gets to answer.
 *
 * Two round trips over UDP to a VM that is usually in another country. Generous
 * enough that a slow path is reported as slow rather than as down, short enough
 * that a health page with a dead relay still draws promptly.
 */
const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class RelayHealthService {
  async snapshot(): Promise<AdminRelayHealth> {
    // The same call a joining client makes, so this cannot drift from it.
    const servers = await iceServers();
    const relays = servers.filter((server) =>
      server.urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:')),
    );

    if (relays.length === 0) {
      return { configured: false, username: null, probes: [], state: 'up', error: null };
    }

    // One entry carries every relay URL and one credential pair, which is the
    // shape `ice.ts` builds. Flattened here so each URL gets its own card.
    const probes: RelayProbeResult[] = (
      await Promise.all(
        relays.flatMap((relay) =>
          relay.urls.map((url) =>
            probeRelay(url, relay.username ?? '', relay.credential ?? '', PROBE_TIMEOUT_MS),
          ),
        ),
      )
    ).flat();

    return {
      configured: true,
      username: relays[0]?.username ?? null,
      probes,
      // A relay that could not be probed at all (TLS, TCP) is not a failure;
      // one that refused or never answered is.
      state: probes.some((probe) => probe.state === 'down' || probe.state === 'invalid')
        ? 'down'
        : 'up',
      error: null,
    };
  }
}
