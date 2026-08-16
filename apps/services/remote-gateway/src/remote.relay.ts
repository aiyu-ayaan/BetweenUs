/**
 * The part of a remote session that has to cross a process boundary.
 *
 * A session is two sockets: an agent that dialled out from the machine, and a
 * controller that dialled in from somebody's client. Nothing makes them land on
 * the same replica - the agent connected hours ago and the controller connected
 * just now, through a load balancer that has no idea they belong together - so
 * with more than one `remote-gateway` running, a session whose two halves are on
 * different instances used to be a session where nothing happened at all.
 *
 * Two small things fix it, and both are Redis:
 *
 * - **A relay.** Every message is delivered to a local socket if this instance
 *   holds it, and published otherwise. Each instance ignores its own
 *   publications, so a message is never delivered twice.
 * - **A registry.** Which machines have an agent connected *anywhere*, so
 *   "that machine is not connected" is an answer about the deployment rather
 *   than about whichever instance happened to be asked. Keys expire, so an
 *   instance that dies does not leave its agents looking online for ever.
 *
 * The screen never comes near any of this. It is a peer connection between the
 * two machines; what crosses here is the signalling, the input events and the
 * teardown - small, textual, and already going over a WebSocket.
 */
import Redis from 'ioredis';
import type { ServerRemoteEvent } from '@nexora/shared-types';

/** The socket a message is for, named by what identifies it rather than by address. */
export type RelayTarget =
  | { kind: 'agent'; machineId: string }
  | { kind: 'controller'; sessionId: string };

export interface RelayMessage {
  /** Which instance published it; its own subscriber drops it. */
  origin: string;
  target: RelayTarget;
  /** Null when the point is only to close the socket - a replaced agent. */
  event: ServerRemoteEvent | null;
  /** Close the socket after delivering. A teardown has to reach both ends. */
  close?: { code: number; reason: string };
}

const CHANNEL = 'remote.relay';

/**
 * How long an agent stays in the registry without being renewed. Three times
 * the gateway's heartbeat, so two missed renewals are survivable and a killed
 * instance's agents disappear inside a minute and a half.
 */
const AGENT_TTL_SECONDS = 90;

const agentKey = (machineId: string): string => `remote:agent:${machineId}`;

export class RemoteRelay {
  private readonly publisher: Redis;
  private subscriber: Redis | null = null;

  constructor(
    private readonly redisUrl: string,
    private readonly origin: string,
  ) {
    this.publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  /** Starts listening. `deliver` is called for messages from other instances only. */
  async start(deliver: (message: RelayMessage) => void): Promise<void> {
    this.subscriber = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.subscriber.on('message', (_channel: string, raw: string) => {
      let message: RelayMessage;
      try {
        message = JSON.parse(raw) as RelayMessage;
      } catch {
        return; // Not ours to make sense of.
      }
      // Our own publication coming back: the local socket was already served.
      if (message.origin === this.origin) return;
      deliver(message);
    });
    await this.subscriber.subscribe(CHANNEL);
  }

  /** Hands a message to whichever instance holds the socket. */
  async forward(
    target: RelayTarget,
    event: ServerRemoteEvent | null,
    close?: { code: number; reason: string },
  ): Promise<void> {
    const message: RelayMessage = { origin: this.origin, target, event, ...(close ? { close } : {}) };
    await this.publisher.publish(CHANNEL, JSON.stringify(message)).catch(() => undefined);
  }

  // --- Agent registry -------------------------------------------------------

  /** Records that this instance holds the agent for a machine, and renews it. */
  async announceAgent(machineId: string): Promise<void> {
    await this.publisher
      .set(agentKey(machineId), this.origin, 'EX', AGENT_TTL_SECONDS)
      .catch(() => undefined);
  }

  /**
   * Drops a machine from the registry when its agent disconnects here.
   *
   * Only if the entry is still ours: an agent that dropped and reconnected to
   * another instance is already registered there, and the close event for the
   * old socket arriving afterwards must not delete the new registration.
   *
   * ponytail: read-then-delete rather than a Lua compare-and-delete, so the
   * reconnect-in-between case can still lose a registration. It costs at most
   * one heartbeat of a machine reading offline, and the agent renews it.
   */
  async forgetAgent(machineId: string): Promise<void> {
    const holder = await this.publisher.get(agentKey(machineId)).catch(() => null);
    if (holder === this.origin) await this.publisher.del(agentKey(machineId)).catch(() => undefined);
  }

  /** Is this machine's agent connected to any instance? */
  async isAgentOnline(machineId: string): Promise<boolean> {
    return (await this.publisher.exists(agentKey(machineId)).catch(() => 0)) === 1;
  }

  /** The subset of these machines with an agent connected somewhere. One round trip. */
  async onlineAgents(machineIds: string[]): Promise<Set<string>> {
    if (machineIds.length === 0) return new Set();
    const values = await this.publisher.mget(machineIds.map(agentKey)).catch(() => []);
    return new Set(machineIds.filter((_, index) => values[index] != null));
  }

  async close(): Promise<void> {
    await this.publisher.quit().catch(() => undefined);
    if (this.subscriber) await this.subscriber.quit().catch(() => undefined);
  }
}
