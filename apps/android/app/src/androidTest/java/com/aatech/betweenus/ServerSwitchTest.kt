package com.aatech.betweenus

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.feature.chat.PendingReplies
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The two things that outlive the process, checked where they actually live.
 *
 * Switching deployments and an unsent reply are both "did it survive", and a
 * JVM test of either would be a test of a fake: `SharedPreferences` is an
 * Android class and the whole question is whether the file is written.
 */
@RunWith(AndroidJUnit4::class)
class ServerSwitchTest {

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun setUp() {
        Endpoint.init(context)
        PendingReplies.init(context)
        PendingReplies.clear()
    }

    @After
    fun tearDown() {
        Endpoint.set(null)
        PendingReplies.clear()
    }

    @Test
    fun aChosenServerIsTheOneEveryRequestUses() {
        Endpoint.set(Endpoint.normalize("betweenus.example.test"))
        assertEquals("https://betweenus.example.test", Endpoint.current())
        assertTrue(!Endpoint.isDefault())
    }

    @Test
    fun goingBackToTheDefaultIsAnOption() {
        Endpoint.set(Endpoint.normalize("betweenus.example.test"))
        Endpoint.set(null)
        assertEquals(Endpoint.default(), Endpoint.current())
        assertTrue(Endpoint.isDefault())
    }

    @Test
    fun anUnsentReplyIsStillThereAfterTheProcessThatTookItIsGone() {
        // The receiver that takes a reply from the shade is killed the moment
        // it returns, which is why this is on disk rather than in the queue.
        val pending = PendingReplies.add("chan-1", "on my way")
        assertEquals(listOf(pending), PendingReplies.all())

        PendingReplies.remove(pending.id)
        assertTrue(PendingReplies.all().isEmpty())
    }

    @Test
    fun signingOutThrowsUnsentWordsAway() {
        PendingReplies.add("chan-1", "on my way")
        PendingReplies.clear()
        assertTrue(PendingReplies.all().isEmpty())
    }
}
