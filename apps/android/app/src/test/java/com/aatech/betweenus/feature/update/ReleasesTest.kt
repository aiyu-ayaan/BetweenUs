package com.aatech.betweenus.feature.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The three things that decide what gets installed: what a version string
 * means, which releases a channel is allowed to see, and which APK belongs to
 * this device. Getting any of them wrong installs the wrong build, silently.
 */
class ReleasesTest {

    private fun release(tag: String, vararg assets: String) = Release(
        version = requireNotNull(Version.parse(tag)) { "unparseable tag $tag" },
        name = tag,
        notes = "",
        publishedAt = "",
        assets = assets.map { ReleaseAsset(it, "https://example.invalid/$it", 1) },
    )

    @Test
    fun `a stable release beats every pre-release of the same version`() {
        val alpha = requireNotNull(Version.parse("0.0.2-alpha.9"))
        val beta = requireNotNull(Version.parse("0.0.2-beta.1"))
        val stable = requireNotNull(Version.parse("v0.0.2"))

        assertTrue(alpha < beta)
        assertTrue(beta < stable)
        assertTrue(stable < requireNotNull(Version.parse("0.0.3-alpha.1")))
    }

    @Test
    fun `pre-release numbers are compared as numbers`() {
        val second = requireNotNull(Version.parse("0.0.1-alpha.2"))
        val tenth = requireNotNull(Version.parse("0.0.1-alpha.10"))
        assertTrue(second < tenth)
    }

    @Test
    fun `nonsense parses to null rather than to something`() {
        assertNull(Version.parse("nightly"))
        assertNull(Version.parse("1.2"))
        assertNull(Version.parse("1.2.3-rc.1"))
        assertNull(Version.parse(null))
    }

    @Test
    fun `a channel takes its own builds and everything steadier`() {
        val alpha = requireNotNull(Version.parse("1.0.0-alpha.1"))
        val beta = requireNotNull(Version.parse("1.0.0-beta.1"))
        val stable = requireNotNull(Version.parse("1.0.0"))

        assertTrue(UpdateChannel.ALPHA.accepts(alpha))
        assertTrue(UpdateChannel.ALPHA.accepts(stable))
        assertTrue(!UpdateChannel.BETA.accepts(alpha))
        assertTrue(UpdateChannel.BETA.accepts(beta))
        assertTrue(!UpdateChannel.STABLE.accepts(beta))
        assertTrue(UpdateChannel.STABLE.accepts(stable))
    }

    @Test
    fun `the newest release on the channel wins, and only if it is newer`() {
        val releases = listOf(
            release("v0.0.2-alpha.1"),
            release("v0.0.2-beta.2"),
            release("v0.0.1"),
        )
        val installed = Version.parse("0.0.1")

        assertEquals("v0.0.2-beta.2", Releases.pick(releases, installed, UpdateChannel.ALPHA)?.name)
        assertEquals("v0.0.2-beta.2", Releases.pick(releases, installed, UpdateChannel.BETA)?.name)
        assertNull(Releases.pick(releases, installed, UpdateChannel.STABLE))
    }

    @Test
    fun `a stable release cut after an alpha is not an upgrade for that alpha`() {
        val releases = listOf(release("v0.0.1"), release("v0.0.2-alpha.1"))
        val installed = Version.parse("0.0.2-alpha.1")
        assertNull(Releases.pick(releases, installed, UpdateChannel.STABLE))
    }

    @Test
    fun `the device's own ABI is preferred, in the device's own order`() {
        val build = release(
            "v1.0.0",
            "BetweenUs-1.0.0-armeabi-v7a.apk",
            "BetweenUs-1.0.0-arm64-v8a.apk",
            "BetweenUs-1.0.0-universal.apk",
            "BetweenUs-1.0.0.aab",
        )
        assertEquals(
            "BetweenUs-1.0.0-arm64-v8a.apk",
            Releases.apkFor(build, listOf("arm64-v8a", "armeabi-v7a"))?.name,
        )
    }

    @Test
    fun `x86 does not match the x86_64 build`() {
        val build = release("v1.0.0", "BetweenUs-1.0.0-x86_64.apk", "BetweenUs-1.0.0-universal.apk")
        assertEquals("BetweenUs-1.0.0-universal.apk", Releases.apkFor(build, listOf("x86"))?.name)
    }

    @Test
    fun `universal is the fallback, never the choice`() {
        val build = release("v1.0.0", "BetweenUs-1.0.0-universal.apk")
        assertEquals("BetweenUs-1.0.0-universal.apk", Releases.apkFor(build, listOf("arm64-v8a"))?.name)
        assertNull(Releases.apkFor(release("v1.0.0", "BetweenUs-1.0.0.aab"), listOf("arm64-v8a")))
    }

    @Test
    fun `the default channel is the one the installed build came from`() {
        assertEquals(UpdateChannel.ALPHA, UpdateChannel.forVersion("0.0.1-alpha.5"))
        assertEquals(UpdateChannel.BETA, UpdateChannel.forVersion("0.0.1-beta.1"))
        assertEquals(UpdateChannel.STABLE, UpdateChannel.forVersion("1.2.3"))
        assertEquals(UpdateChannel.STABLE, UpdateChannel.forVersion("0.0.0"))
    }
}
