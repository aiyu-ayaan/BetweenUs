package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraLookTest {

    @Test
    fun `all 6 filters exist and match expected names`() {
        val expectedNames = listOf("none", "warm", "cool", "vivid", "mono", "soft")
        assertEquals(6, CameraLook.FILTERS.size)
        assertEquals(expectedNames, CameraLook.FILTERS.map { it.name })
    }

    @Test
    fun `each filter matrix has exactly 16 floats`() {
        for (filter in CameraLook.FILTERS) {
            assertEquals("Filter ${filter.name} matrix should have 16 floats", 16, filter.matrix.size)
        }
    }

    @Test
    fun `filterFor null and unknown defaults to none`() {
        assertEquals("none", CameraLook.filterFor(null).name)
        assertEquals("none", CameraLook.filterFor("unknown").name)
    }

    @Test
    fun `filterFor warm returns Warm filter`() {
        val warm = CameraLook.filterFor("warm")
        assertEquals("warm", warm.name)
        assertEquals("Warm", warm.label)
    }

    @Test
    fun `isPassThrough for none or null is true`() {
        assertTrue(CameraLook.isPassThrough("none"))
        assertTrue(CameraLook.isPassThrough(null))
        assertTrue(CameraLook.isPassThrough("unknown"))
    }

    @Test
    fun `isPassThrough is false when filter is active`() {
        assertFalse(CameraLook.isPassThrough("warm"))
        assertFalse(CameraLook.isPassThrough("cool"))
        assertFalse(CameraLook.isPassThrough("vivid"))
        assertFalse(CameraLook.isPassThrough("mono"))
        assertFalse(CameraLook.isPassThrough("soft"))
    }

    @Test
    fun `filter equality is based on name`() {
        val filter1 = CameraLook.Filter("warm", "Other", floatArrayOf())
        val filter2 = CameraLook.Filter("warm", "Warm", floatArrayOf())
        val filter3 = CameraLook.Filter("cool", "Other", floatArrayOf())

        assertEquals(filter1, filter2)
        assertEquals(filter1.hashCode(), filter2.hashCode())
        assertNotEquals(filter1, filter3)
    }
}
