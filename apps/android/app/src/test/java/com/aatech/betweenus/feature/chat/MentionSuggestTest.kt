package com.aatech.betweenus.feature.chat

import com.aatech.betweenus.core.data.ServerCustomRole
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.core.data.ServerRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MentionSuggestTest {

    private fun createMember(
        id: String,
        username: String,
        displayName: String = "",
    ) = ServerMember(
        userId = id,
        username = username,
        displayName = displayName,
        avatarUrl = null,
        role = ServerRole.MEMBER,
        permissions = emptyList(),
        grantedPermissions = emptyList(),
        deniedPermissions = emptyList(),
        roleIds = emptyList(),
    )

    @Test
    fun `empty term in server channel returns broadcasts and all members`() {
        val members = listOf(
            createMember("1", "bob", "Bob Smith"),
            createMember("2", "alice", "Alice Wonder"),
        )

        val result = filterMentions(term = "", members = members, isDirect = false)

        // 2 broadcasts + 2 members = 4 items
        assertEquals(4, result.size)
        // Broadcasts first
        assertTrue(result[0] is MentionOption.Broadcast)
        assertEquals("everyone", result[0].username)
        assertEquals("@everyone", result[0].displayName)
        assertEquals("Notify everyone in this channel", (result[0] as MentionOption.Broadcast).description)

        assertTrue(result[1] is MentionOption.Broadcast)
        assertEquals("here", result[1].username)
        assertEquals("@here", result[1].displayName)
        assertEquals("Notify active members", (result[1] as MentionOption.Broadcast).description)

        // Members sorted alphabetically by display name
        assertTrue(result[2] is MentionOption.Member)
        assertEquals("alice", result[2].username)
        assertEquals("Alice Wonder", result[2].displayName)

        assertTrue(result[3] is MentionOption.Member)
        assertEquals("bob", result[3].username)
        assertEquals("Bob Smith", result[3].displayName)
    }

    @Test
    fun `direct message channel suppresses broadcasts`() {
        val members = listOf(
            createMember("1", "alice", "Alice"),
            createMember("2", "bob", "Bob"),
        )

        val result = filterMentions(term = "", members = members, isDirect = true)

        // No broadcasts in direct message
        assertEquals(2, result.size)
        assertTrue(result.none { it is MentionOption.Broadcast })
        assertEquals("alice", result[0].username)
        assertEquals("bob", result[1].username)

        // Also suppressed when searching broadcast keyword in DM
        val searchEveryone = filterMentions(term = "everyone", members = members, isDirect = true)
        assertTrue(searchEveryone.none { it is MentionOption.Broadcast })
    }

    @Test
    fun `filtering matches username`() {
        val members = listOf(
            createMember("1", "alice_dev", "Alice Cooper"),
            createMember("2", "bob_ross", "Painter"),
            createMember("3", "charlie", "Charlie"),
        )

        val result = filterMentions(term = "alice", members = members, isDirect = false)

        assertEquals(1, result.size)
        assertEquals("alice_dev", result[0].username)
    }

    @Test
    fun `filtering matches display name`() {
        val members = listOf(
            createMember("1", "user123", "Alice Cooper"),
            createMember("2", "user456", "Bob Builder"),
        )

        val result = filterMentions(term = "builder", members = members, isDirect = false)

        assertEquals(1, result.size)
        assertEquals("user456", result[0].username)
        assertEquals("Bob Builder", result[0].displayName)
    }

    @Test
    fun `case insensitivity and leading at sign stripping`() {
        val members = listOf(
            createMember("1", "alice", "Alice"),
        )

        assertEquals(1, filterMentions("@alice", members, isDirect = true).size)
        assertEquals(1, filterMentions("@ALICE", members, isDirect = true).size)
        assertEquals(1, filterMentions("  @Alice  ", members, isDirect = true).size)
    }

    @Test
    fun `ranking order exact match first then prefix then substring`() {
        val members = listOf(
            createMember("1", "sponge_bob", "SpongeBob"),   // Substring match for "bob"
            createMember("2", "bobby", "Bobby"),            // Prefix match for "bob"
            createMember("3", "bob", "Bob The Builder"),    // Exact username match for "bob"
        )

        val result = filterMentions(term = "bob", members = members, isDirect = true)

        assertEquals(3, result.size)
        // Exact match first
        assertEquals("bob", result[0].username)
        // Prefix match second
        assertEquals("bobby", result[1].username)
        // Substring match third
        assertEquals("sponge_bob", result[2].username)
    }

    @Test
    fun `tie breaking alphabetically by display name within same rank tier`() {
        val members = listOf(
            createMember("1", "dan_2", "Dan"),
            createMember("2", "dave_1", "Dave"),
            createMember("3", "carol_d", "Carol Dan"),
        )

        val result = filterMentions(term = "da", members = members, isDirect = true)

        assertEquals(3, result.size)
        // Prefix matches: Dan and Dave. "Dan" < "Dave" alphabetically
        assertEquals("Dan", result[0].displayName)
        assertEquals("Dave", result[1].displayName)
        // Substring match: Carol Dan
        assertEquals("Carol Dan", result[2].displayName)
    }

    @Test
    fun `results are capped at 12 items`() {
        val members = (1..20).map { i ->
            createMember(id = "$i", username = "user_$i", displayName = "User $i")
        }

        val result = filterMentions(term = "", members = members, isDirect = false)

        // 2 broadcasts + 10 members = 12
        assertEquals(12, result.size)
        assertTrue(result[0] is MentionOption.Broadcast)
        assertTrue(result[1] is MentionOption.Broadcast)
    }

    private fun createRole(
        id: String,
        name: String,
        colour: String? = null,
        memberCount: Int = 2,
    ) = ServerCustomRole(
        id = id,
        serverId = "s1",
        name = name,
        colour = colour,
        rank = 0,
        permissions = emptyList(),
        memberCount = memberCount,
    )

    @Test
    fun `roles sit between the broadcasts and the members`() {
        val members = listOf(createMember("1", "alice", "Alice Wonder"))
        val roles = listOf(createRole("r1", "designers"), createRole("r2", "Core Team"))

        val result = filterMentions(term = "", members = members, isDirect = false, roles = roles)

        // 2 broadcasts + 2 roles + 1 member
        assertEquals(5, result.size)
        assertTrue(result[0] is MentionOption.Broadcast)
        assertTrue(result[1] is MentionOption.Broadcast)
        assertTrue(result[2] is MentionOption.Role)
        assertTrue(result[3] is MentionOption.Role)
        assertTrue(result[4] is MentionOption.Member)
        // Sorted by name rather than by rank, as the members are.
        assertEquals("Core Team", result[2].username)
        assertEquals("designers", result[3].username)
    }

    @Test
    fun `a role is matched on its name, case insensitively`() {
        val roles = listOf(createRole("r1", "designers"))

        val result = filterMentions(term = "DESIGN", members = emptyList(), isDirect = false, roles = roles)

        assertEquals(1, result.size)
        assertTrue(result[0] is MentionOption.Role)
        // What is written into the composer is the name itself, spaces and all.
        assertEquals("designers", result[0].username)
        assertEquals("@designers", result[0].displayName)
    }

    @Test
    fun `a role name with a space is offered whole`() {
        val roles = listOf(createRole("r1", "Core Team"))

        val result = filterMentions(term = "core", members = emptyList(), isDirect = false, roles = roles)

        assertEquals("Core Team", result[0].username)
    }

    @Test
    fun `a conversation offers neither a broadcast nor a role`() {
        val members = listOf(createMember("1", "alice", "Alice Wonder"))
        val roles = listOf(createRole("r1", "designers"))

        val result = filterMentions(term = "", members = members, isDirect = true, roles = roles)

        assertEquals(1, result.size)
        assertTrue(result[0] is MentionOption.Member)
    }

    @Test
    fun `omitting the roles is the behaviour as it stood`() {
        val members = listOf(createMember("1", "alice", "Alice Wonder"))

        assertEquals(
            filterMentions(term = "", members = members, isDirect = false),
            filterMentions(term = "", members = members, isDirect = false, roles = emptyList()),
        )
    }

    @Test
    fun `member displayName falls back to username when blank`() {
        val member = createMember("1", "testuser", "")
        val option = MentionOption.Member(member)

        assertEquals("testuser", option.username)
        assertEquals("testuser", option.displayName)
    }
}
