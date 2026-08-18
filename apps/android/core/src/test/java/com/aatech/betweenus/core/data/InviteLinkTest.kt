package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The same cases as `apps/desktop/src/services/invite-link.check.ts`.
 *
 * Both clients read what somebody pasted, and a code the phone accepts and the
 * desktop refuses - or the other way round - is a link that works for one
 * person and not for the person they sent it to.
 */
class InviteLinkTest {
    @Test
    fun `builds a link against a deployment`() {
        assertEquals(
            "https://betweenus.example.com/invite/k3m9x2qp",
            InviteLink.of("https://betweenus.example.com", "k3m9x2qp"),
        )
        assertEquals(
            "https://betweenus.example.com/invite/k3m9x2qp",
            InviteLink.of("https://betweenus.example.com/", "k3m9x2qp"),
        )
    }

    @Test
    fun `reads the code out of a link`() {
        assertEquals("k3m9x2qp", InviteLink.codeIn("https://betweenus.example.com/invite/k3m9x2qp"))
        assertEquals("k3m9x2qp", InviteLink.codeIn("  https://betweenus.example.com/invite/k3m9x2qp  "))
        assertEquals("k3m9x2qp", InviteLink.codeIn("https://betweenus.example.com/invite/k3m9x2qp?from=chat"))
        assertEquals("k3m9x2qp", InviteLink.codeIn("https://betweenus.example.com/invite/k3m9x2qp#top"))
        assertEquals("k3m9x2qp", InviteLink.codeIn("https://betweenus.example.com/?invite=k3m9x2qp"))
        // Another deployment's link: the code is still the code.
        assertEquals("zz12", InviteLink.codeIn("http://192.168.1.4:8080/invite/zz12"))
    }

    @Test
    fun `reads a bare code`() {
        assertEquals("k3m9x2qp", InviteLink.codeIn("k3m9x2qp"))
        assertEquals("k3m9x2qp", InviteLink.codeIn("  k3m9x2qp "))
    }

    @Test
    fun `refuses anything that is not one`() {
        assertNull(InviteLink.codeIn(""))
        assertNull(InviteLink.codeIn("   "))
        assertNull(InviteLink.codeIn("come and join my invite please"))
        assertNull(InviteLink.codeIn("ab"))
    }
}
