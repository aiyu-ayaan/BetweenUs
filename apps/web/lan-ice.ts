/**
 * Loaded only by `pnpm dev:web:lan`, and only into a browser that is not on the
 * machine running the stack. It points the SFU's loopback ICE-TCP candidate at
 * the relay `lan-sfu.ts` is running, so media has somewhere to go.
 *
 * The dev SFU advertises `127.0.0.1`, and it is right to: that is the address a
 * browser on this host has to dial. A browser on a *second* machine takes it
 * literally and negotiates with itself, which is what "Connection to voice
 * server timed out" was - signalling succeeded through the `/livekit` proxy,
 * media had nowhere to go, and the client's own 15s race was the only thing
 * that ever spoke up.
 *
 * The page already knows the right address: it was served from the one the
 * other machine reaches this host on, so `location.hostname` is what those
 * candidates should have said. The port moves as well, because the relay could
 * not take 7881 - see lan-sfu.ts, which is also where the number comes from.
 *
 * Only loopback TCP candidates are touched. The UDP ones are left exactly as
 * they are: from another machine they lose the ICE race, which is what should
 * happen, and from this one they are still the fastest path.
 *
 * Nothing here survives into a build. The plugin injects this file only when
 * the dev server is in `lan` mode, and a deployment never meets the case - it
 * is one hostname behind the gateway, with the SFU advertising a real address.
 */

const LOOPBACK = /^(?:127\.0\.0\.1|::1|localhost)$/i;

/**
 * `candidate:<foundation> <component> <transport> <priority> <address> <port>`,
 * with or without SDP's `a=` prefix - a trickled candidate arrives without it.
 * Everything from `typ` onwards is the SFU's business and is left alone.
 */
export function rewriteCandidate(candidate: string, host: string, relayPort: number): string {
  return candidate.replace(
    /^((?:a=)?candidate:\S+ \d+ (\S+) \d+ )(\S+) (\d+)/i,
    (whole: string, head: string, transport: string, address: string) =>
      transport.toLowerCase() === 'tcp' && LOOPBACK.test(address)
        ? `${head}${host} ${relayPort}`
        : whole,
  );
}

/** The same, for candidates that came bundled in an offer or an answer. */
export function rewriteSdp(sdp: string, host: string, relayPort: number): string {
  return sdp.replace(/^a=candidate:.*$/gim, (line: string) =>
    rewriteCandidate(line, host, relayPort),
  );
}

/**
 * The two prototype methods, minus their deprecated callback overloads - which
 * nothing has called this century and which `.call()` would otherwise resolve
 * against.
 */
type Patch<T> = (this: RTCPeerConnection, argument: T) => Promise<void>;

function install(host: string, relayPort: number): void {
  const setRemoteDescription = RTCPeerConnection.prototype
    .setRemoteDescription as Patch<RTCSessionDescriptionInit>;
  RTCPeerConnection.prototype.setRemoteDescription = function (
    this: RTCPeerConnection,
    description: RTCSessionDescriptionInit,
  ) {
    const sdp = description?.sdp;
    return setRemoteDescription.call(
      this,
      sdp ? { ...description, sdp: rewriteSdp(sdp, host, relayPort) } : description,
    );
  } as typeof RTCPeerConnection.prototype.setRemoteDescription;

  const addIceCandidate = RTCPeerConnection.prototype.addIceCandidate as Patch<
    RTCIceCandidateInit | RTCIceCandidate | undefined
  >;
  RTCPeerConnection.prototype.addIceCandidate = function (
    this: RTCPeerConnection,
    candidate?: RTCIceCandidateInit | RTCIceCandidate | null,
  ) {
    if (!candidate?.candidate) return addIceCandidate.call(this, candidate ?? undefined);
    // Rebuilt field by field rather than spread: an RTCIceCandidate keeps its
    // values on the prototype, so a copy of the object is an empty one.
    return addIceCandidate.call(this, {
      candidate: rewriteCandidate(candidate.candidate, host, relayPort),
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment,
    });
  } as typeof RTCPeerConnection.prototype.addIceCandidate;

  console.info(`[lan-ice] the SFU's TCP candidate will be dialled at ${host}:${relayPort}`);
}

/** Set by the plugin in an inline script, which the module graph runs after. */
declare global {
  interface Window {
    __NEXORA_ICE_RELAY_PORT__?: number;
  }
}

const host = typeof location === 'undefined' ? '' : location.hostname;
const relayPort = typeof window === 'undefined' ? 0 : (window.__NEXORA_ICE_RELAY_PORT__ ?? 0);
if (host && relayPort && !LOOPBACK.test(host) && typeof RTCPeerConnection !== 'undefined') {
  install(host, relayPort);
}
