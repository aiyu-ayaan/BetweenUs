package com.aatech.betweenus

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aatech.betweenus.core.crypto.SecureStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Keystore, on a device, which is the only place it exists.
 *
 * The refresh token moved out of plain preferences and into a key generated
 * inside the hardware-backed keystore, and none of that can be checked by a
 * JVM unit test: `AndroidKeyStore` is not a provider there. What is asserted
 * is the two properties the move was for - the value comes back, and what sits
 * on disk is not the value.
 */
@RunWith(AndroidJUnit4::class)
class SecureSessionTest {

    private lateinit var store: SecureStore

    @Before
    fun setUp() {
        store = SecureStore(InstrumentationRegistry.getInstrumentation().targetContext)
        store.remove(NAME)
        store.remove(OTHER)
    }

    @Test
    fun aSealedValueComesBack() {
        store.put(NAME, "refresh-token-one")
        assertEquals("refresh-token-one", store.get(NAME))
    }

    @Test
    fun whatIsOnDiskIsNotWhatWasPutIn() {
        store.put(NAME, "refresh-token-one")
        val raw = InstrumentationRegistry.getInstrumentation().targetContext
            .getSharedPreferences("betweenus.secure", android.content.Context.MODE_PRIVATE)
            .getString(NAME, null)
        assertNotEquals("refresh-token-one", raw)
    }

    @Test
    fun oneDeploymentsTokenIsNotAnothers() {
        // The reason the key carries the deployment: a phone that has signed
        // into two servers must never present one server's token to the other.
        store.put(NAME, "token-a")
        store.put(OTHER, "token-b")
        assertEquals("token-a", store.get(NAME))
        assertEquals("token-b", store.get(OTHER))
    }

    @Test
    fun signingOutLeavesNothing() {
        store.put(NAME, "token-a")
        store.remove(NAME)
        assertNull(store.get(NAME))
    }

    private companion object {
        const val NAME = "refreshToken:https://one.example"
        const val OTHER = "refreshToken:https://two.example"
    }
}
