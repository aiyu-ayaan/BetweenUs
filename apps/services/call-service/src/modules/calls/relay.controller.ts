/**
 * The relay's state, for the admin panel.
 *
 * Not routed by the gateway. Nginx forwards the paths it names and
 * `/api/v1/internal` is not one of them, so this is reachable on the internal
 * Docker network and nowhere else - the same arrangement, and the same
 * reasoning, as `internal/presence` in presence-service. That is also why there
 * is no guard: there is no user here, only `auth-service` assembling a health
 * page.
 *
 * Nothing here returns `TURN_CREDENTIAL`. The username is shown because an
 * operator comparing the panel against `turnserver.conf` needs it; the secret
 * beside it is exactly what an admin API should never hand back, and the panel
 * has no use for it.
 */
import { Controller, Get } from '@nestjs/common';
import type { AdminRelayHealth } from '@betweenus/shared-types';
import { RelayHealthService } from './relay-health.service';

@Controller('internal/relay')
export class RelayController {
  constructor(private readonly relay: RelayHealthService) {}

  @Get()
  status(): Promise<AdminRelayHealth> {
    return this.relay.snapshot();
  }
}
