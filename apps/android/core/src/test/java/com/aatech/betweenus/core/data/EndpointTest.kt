package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The address parsing behind the server picker, which is the part that fails
 * silently: a base URL that is subtly wrong does not throw, it just sends every
 * later request somewhere that answers 404 or drops the bearer token.
 *
 * These are the same cases as `apps/desktop/src/services/endpoint.check.ts`,
 * so the two clients can be shown to agree.
 */
class EndpointTest {

    @Test
    fun `what a person types becomes a base URL`() {
        assertEquals("https://betweenus.example.com", Endpoint.normalize("betweenus.example.com"))
        assertEquals("https://betweenus.example.com", Endpoint.normalize("  betweenus.example.com/  "))
        assertEquals("http://192.168.1.4:8080", Endpoint.normalize("http://192.168.1.4:8080"))
        assertEquals("https://example.com:8443", Endpoint.normalize("https://example.com:8443///"))
    }

    @Test
    fun `a path is part of a base and a query is not`() {
        assertEquals("https://example.com/betweenus", Endpoint.normalize("https://example.com/betweenus"))
        assertEquals("https://example.com/betweenus", Endpoint.normalize("https://example.com/betweenus/?a=1#b"))
    }

    @Test
    fun `nonsense is refused rather than stored`() {
        for (bad in listOf("", "   ", "ftp://example.com", "https://")) {
            assertThrows(bad, IllegalArgumentException::class.java) { Endpoint.normalize(bad) }
        }
    }

    /**
     * Where the probe ended is what gets stored: a redirect to another origin
     * would otherwise strip the Authorization header off every authenticated
     * request, and the server would answer "Missing bearer token" under every
     * screen.
     */
    @Test
    fun `the stored base is where the probe landed`() {
        val probe = "/api/v1/auth/oauth/providers"
        assertEquals(
            "https://betweenus.example.com",
            Endpoint.baseFromProbeUrl("https://betweenus.example.com$probe", "http://betweenus.example.com"),
        )
        assertEquals(
            "https://example.com/betweenus",
            Endpoint.baseFromProbeUrl("https://example.com/betweenus$probe", "https://example.com/betweenus"),
        )
        // Redirected somewhere that is not the probe path: keep what was asked for.
        assertEquals(
            "https://example.com",
            Endpoint.baseFromProbeUrl("https://example.com/login", "https://example.com/"),
        )
    }
}
