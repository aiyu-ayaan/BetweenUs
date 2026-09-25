package com.aatech.betweenus.core.store

import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/** Folded categories: per account, per server, kept across launches, gone at sign-out. */
class CollapsedCategoriesTest {

    private class MemoryStore : CollapsedCategories.Store {
        val values = mutableMapOf<String, String>()
        override fun read(key: String): String? = values[key]
        override fun write(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }
        override fun clear() = values.clear()
    }

    private lateinit var memory: MemoryStore

    @Before
    fun setUp() {
        memory = MemoryStore()
        CollapsedCategories.use(memory)
    }

    @Test
    fun `a fold is written down and read back`() {
        assertEquals(setOf("a"), CollapsedCategories.toggle("me", "s1", "a"))
        assertEquals(setOf("a", "b"), CollapsedCategories.toggle("me", "s1", "b"))
        assertEquals(setOf("a", "b"), CollapsedCategories.folded("me", "s1"))
        assertEquals(setOf("b"), CollapsedCategories.toggle("me", "s1", "a"))
    }

    @Test
    fun `folds are per server and per account`() {
        CollapsedCategories.toggle("me", "s1", "a")
        assertEquals(emptySet<String>(), CollapsedCategories.folded("me", "s2"))
        assertEquals(emptySet<String>(), CollapsedCategories.folded("someone-else", "s1"))
    }

    @Test
    fun `unfolding the last one removes the entry`() {
        CollapsedCategories.toggle("me", "s1", "a")
        CollapsedCategories.toggle("me", "s1", "a")
        assertEquals(emptyMap<String, String>(), memory.values)
    }

    @Test
    fun `sign-out forgets every fold`() {
        CollapsedCategories.toggle("me", "s1", "a")
        CollapsedCategories.toggle("me", "s2", "b")
        CollapsedCategories.forget()
        assertEquals(emptySet<String>(), CollapsedCategories.folded("me", "s1"))
        assertEquals(emptySet<String>(), CollapsedCategories.folded("me", "s2"))
    }

    @Test
    fun `a stored value that is not a list of ids reads as nothing folded`() {
        assertEquals(emptySet<String>(), CollapsedCategories.parse("{not json"))
        assertEquals(emptySet<String>(), CollapsedCategories.parse("{\"a\":1}"))
        assertEquals(setOf("a"), CollapsedCategories.parse("[\"a\", 3, null]"))
        assertEquals(emptySet<String>(), CollapsedCategories.parse(null))
    }
}
