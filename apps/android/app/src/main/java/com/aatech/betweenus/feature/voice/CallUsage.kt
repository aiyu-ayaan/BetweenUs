package com.aatech.betweenus.feature.voice

import org.json.JSONArray
import org.json.JSONObject

/**
 * What a call moved, as the only thing that can know it.
 *
 * Media is peer to peer, so no server is in the path to count a byte: the call
 * log's data figures come from the clients on the way out, or they do not
 * exist. This is the arithmetic and the wire shape of that report, kept apart
 * from [VoiceEngine] because the engine is the only thing holding a peer
 * connection and this is the only thing that has to agree with a server.
 *
 * The shape is `CallLinkReport` in `packages/shared-types` and the leave event
 * in `ClientCallEvent` - a port, the same way [CallStats] is a port, so that the
 * phone and the desktop write the same rows into the same log.
 */
data class LinkUsage(
    /** Who the connection was with. A peer id would mean nothing a month later. */
    val userId: String,
    val username: String,
    val bytesSent: Long,
    val bytesReceived: Long,
    val roundTripMs: Int?,
    val packetsLost: Long,
    val packetsReceived: Long,
    /** "direct", "relay", or null when ICE never settled anywhere. */
    val transport: String?,
)

object CallUsage {

    /** The last reading of one link, as the log stores it. */
    fun of(userId: String, username: String, sample: LinkSample): LinkUsage = LinkUsage(
        userId = userId,
        username = username,
        bytesSent = sample.outboundAudioBytes + sample.outboundVideoBytes,
        bytesReceived = sample.inboundAudioBytes + sample.inboundVideoBytes,
        roundTripMs = sample.roundTripSeconds?.let { (it * 1000).toInt() },
        packetsLost = sample.packetsLost,
        packetsReceived = sample.packetsReceived,
        transport = sample.transport,
    )

    /**
     * The goodbye, with everything this client measured on it.
     *
     * The totals are summed from the links rather than counted separately, so
     * the page that shows a call's total and the page that shows its links
     * cannot disagree about the same call.
     */
    fun leaveEvent(links: List<LinkUsage>): JSONObject {
        val sent = links.sumOf { it.bytesSent }
        val received = links.sumOf { it.bytesReceived }

        val array = JSONArray()
        for (link in links) {
            array.put(
                JSONObject()
                    .put("userId", link.userId)
                    .put("username", link.username)
                    .put("bytesSent", link.bytesSent)
                    .put("bytesReceived", link.bytesReceived)
                    .put("roundTripMs", link.roundTripMs ?: JSONObject.NULL)
                    .put("packetsLost", link.packetsLost)
                    .put("packetsReceived", link.packetsReceived)
                    .put("transport", link.transport ?: JSONObject.NULL),
            )
        }

        return JSONObject()
            .put("type", "leave")
            .put("bytes", sent + received)
            .put("bytesSent", sent)
            .put("bytesReceived", received)
            .put("links", array)
    }

    /**
     * Whether the media went straight to the other machine or through a relay.
     *
     * Either end being a relay candidate means TURN is in the path, whichever
     * side put it there. Null rather than "direct" when a candidate type is
     * missing: not knowing and knowing it was direct are different answers, and
     * a relay bill is what the difference is worth.
     */
    fun transportOf(localCandidateType: String?, remoteCandidateType: String?): String? {
        if (localCandidateType.isNullOrBlank() || remoteCandidateType.isNullOrBlank()) return null
        return if (localCandidateType == "relay" || remoteCandidateType == "relay") {
            "relay"
        } else {
            "direct"
        }
    }
}
