package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A person is named once in a row, not twice.
 *
 * Every list of people draws [UserSummary.label] over the handle beneath it,
 * and an account that never set a display name has the two be the same string -
 * so the row read "test" over "@test", which looks like a rendering fault
 * rather than a name. [UserSummary.handle] is the rule that decides whether the
 * second line is worth drawing, and it is here rather than in each screen
 * because there are five of them.
 */
class PersonLabelTest {
    private fun user(username: String, displayName: String) =
        UserSummary(id = "u1", username = username, displayName = displayName, avatarUrl = null)

    @Test
    fun `a display name of its own is worth a second line`() {
        val ada = user("ada", "Ada Lovelace")
        assertEquals("Ada Lovelace", ada.label)
        assertEquals("@ada", ada.handle)
    }

    @Test
    fun `a display name that is the username is not repeated`() {
        assertNull(user("test", "test").handle)
        // The server lower-cases nothing, so the same name in another case is
        // still the same name.
        assertNull(user("test", "Test").handle)
    }

    @Test
    fun `an account with no display name is named by its username once`() {
        val blank = user("test", "")
        assertEquals("test", blank.label)
        assertNull(blank.handle)
    }

    @Test
    fun `a member follows the same rule as a search result`() {
        fun member(username: String, displayName: String) = ServerMember(
            userId = "u1",
            username = username,
            displayName = displayName,
            avatarUrl = null,
            role = ServerRole.MEMBER,
            permissions = emptyList(),
            grantedPermissions = emptyList(),
            deniedPermissions = emptyList(),
            roleIds = emptyList(),
        )
        assertEquals("@ada", member("ada", "Ada Lovelace").handle)
        assertNull(member("test", "test").handle)
        assertNull(member("test", "").handle)
    }
}
