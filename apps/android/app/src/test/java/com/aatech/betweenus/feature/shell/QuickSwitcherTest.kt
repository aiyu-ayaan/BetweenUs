package com.aatech.betweenus.feature.shell

import com.aatech.betweenus.core.data.Channel
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.DirectChannel
import com.aatech.betweenus.core.data.ServerRole
import com.aatech.betweenus.core.data.ServerWithRole
import com.aatech.betweenus.core.data.UserSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the switcher offers, and in what order.
 *
 * The order is the interesting part and the part that fails quietly: a switcher
 * that lists servers first still works, still filters, and is still wrong -
 * the coarsest destination sits above the specific ones somebody was typing a
 * name to reach.
 */
class QuickSwitcherTest {

    private fun server(id: String, name: String) = ServerWithRole(
        id = id,
        name = name,
        slug = id,
        iconUrl = null,
        ownerId = "me",
        messageTtlSeconds = null,
        role = ServerRole.MEMBER,
        permissions = emptyList(),
    )

    private fun channel(id: String, serverId: String, name: String, type: ChannelType) = Channel(
        id = id,
        serverId = serverId,
        name = name,
        type = type,
        topic = null,
        isPrivate = false,
    )

    private fun direct(id: String, name: String) = DirectChannel(
        channelId = id,
        participant = UserSummary(name, name, name, null),
    )

    private val servers = listOf(server("s1", "Workshop"), server("s2", "Garden"))

    private val channels = mapOf(
        "s1" to listOf(
            channel("c1", "s1", "general", ChannelType.TEXT),
            channel("c2", "s1", "Lounge", ChannelType.VOICE),
        ),
        "s2" to listOf(channel("c3", "s2", "general", ChannelType.TEXT)),
    )

    private val directs = listOf(direct("d1", "Ana"))

    @Test
    fun `conversations first, then channels, then servers`() {
        assertEquals(
            listOf("d1", "c1", "c2", "c3", "s1", "s2"),
            switchTargets(servers, channels, directs, "").map { it.id },
        )
    }

    @Test
    fun `every server's channels are offered, not only one server's`() {
        // The one place this deliberately differs from the desktop, and the
        // reason it can: the phone has already loaded them all.
        val ids = switchTargets(servers, channels, directs, "general").map { it.id }
        assertEquals(listOf("c1", "c3"), ids)
    }

    @Test
    fun `two channels with the same name are told apart by their server`() {
        val hints = switchTargets(servers, channels, directs, "general").map { it.hint }
        assertEquals(listOf("Workshop", "Garden"), hints)
    }

    @Test
    fun `a voice channel says so, and carries its own kind`() {
        val lounge = switchTargets(servers, channels, directs, "lounge").single()
        assertEquals(SwitchKind.VOICE_CHANNEL, lounge.kind)
        assertEquals("Voice · Workshop", lounge.hint)
    }

    @Test
    fun `matching is case-insensitive and on any part of the name`() {
        assertEquals(listOf("s1"), switchTargets(servers, channels, directs, "WORKSH").map { it.id })
        assertEquals(listOf("d1"), switchTargets(servers, channels, directs, "an").map { it.id })
    }

    @Test
    fun `a blank term lists everywhere rather than nowhere`() {
        // The sheet opens onto the whole map: with nothing typed there is no
        // reason to show an empty list of places somebody could go.
        assertEquals(6, switchTargets(servers, channels, directs, "   ").size)
    }

    @Test
    fun `a channel carries the server the shell has to select with it`() {
        val target = switchTargets(servers, channels, directs, "lounge").single()
        assertEquals("s1", target.serverId)
        // A conversation belongs to no server, and saying otherwise would put
        // the rail on a server the person is not in.
        assertTrue(switchTargets(servers, channels, directs, "ana").single().serverId == null)
    }

    @Test
    fun `keys are unique across kinds`() {
        val keys = switchTargets(servers, channels, directs, "").map { it.key }
        assertEquals(keys.size, keys.toSet().size)
    }
}
