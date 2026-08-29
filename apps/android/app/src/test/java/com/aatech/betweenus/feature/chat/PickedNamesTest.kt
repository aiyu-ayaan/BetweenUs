package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Naming and typing a picked file.
 *
 * The bug these pin: an audio file picked on a phone reached every other
 * client called `attachment`, with no extension and a type of
 * `application/octet-stream`, so it drew as an anonymous document rather than
 * as something with a play button. Nothing failed, nothing was logged, and
 * every type in the codebase was satisfied - the only symptom was a card with
 * the wrong words on it.
 */
class PickedNamesTest {

    @Test
    fun `every kind of file gets an extension, not only photos and videos`() {
        // The whole of the original defect: this answered for image and video
        // by splitting the type on its slash, and empty for everything else.
        assertEquals(".mp3", extensionForType("audio/mpeg"))
        assertEquals(".m4a", extensionForType("audio/mp4"))
        assertEquals(".ogg", extensionForType("audio/ogg"))
        assertEquals(".wav", extensionForType("audio/x-wav"))
        assertEquals(".pdf", extensionForType("application/pdf"))

        // And the two it did answer for still answer the same.
        assertEquals(".jpg", extensionForType("image/jpeg"))
        assertEquals(".mp4", extensionForType("video/mp4"))
    }

    @Test
    fun `a type the table has never heard of still yields its subtype`() {
        assertEquals(".avif", extensionForType("image/avif"))
        // Parameters and structured suffixes are not part of an extension.
        assertEquals(".jpg", extensionForType("image/jpeg; charset=binary"))
        assertEquals(".svg", extensionForType("image/svg+xml"))
    }

    @Test
    fun `a type that says nothing yields nothing rather than a nonsense extension`() {
        assertEquals("", extensionForType(OPAQUE_TYPE))
        assertEquals("", extensionForType(""))
        assertEquals("", extensionForType("audio/*"))
        assertEquals("", extensionForType("nonsense"))
    }

    @Test
    fun `a name is read back as a type when nothing else will say`() {
        assertEquals("audio/mpeg", typeForName("song.mp3"))
        assertEquals("audio/ogg", typeForName("voice_20260830_011311.ogg"))
        // Case is not part of an extension.
        assertEquals("image/jpeg", typeForName("HOLIDAY.JPG"))

        assertNull("a name with no extension says nothing", typeForName("attachment"))
        assertNull("an extension nobody knows says nothing", typeForName("archive.sevenzip"))
    }

    @Test
    fun `octet-stream is a non-answer, not an answer`() {
        // Treating it as an answer is how a song became a document: the
        // provider said "I do not know" and it was written down as a fact.
        assertFalse(typeIsUseful(OPAQUE_TYPE))
        assertFalse(typeIsUseful("application/octet-stream; charset=binary"))
        assertFalse(typeIsUseful(null))
        assertFalse(typeIsUseful("  "))

        assertTrue(typeIsUseful("audio/mpeg"))
    }

    @Test
    fun `a URI segment is a name only when it looks like one`() {
        // A `file://` URI's last segment IS the filename, and a file URI has no
        // provider to query - which is how this app's own voice recordings
        // lost their names on the way out.
        assertEquals("voice_20260830_011311.ogg", nameFromSegment("voice_20260830_011311.ogg"))
        assertEquals("holiday.jpg", nameFromSegment("/storage/emulated/0/DCIM/holiday.jpg"))

        // What the document browser and the photo picker actually hand back,
        // and none of it is a filename.
        assertNull(nameFromSegment("msf:42"))
        assertNull(nameFromSegment("image:1000012345"))
        assertNull(nameFromSegment("1000012345"))
        assertNull(nameFromSegment(null))
        assertNull(nameFromSegment(""))
    }

    @Test
    fun `the name falls back in the order the sources are worth trusting`() {
        // What the provider calls it always wins.
        assertEquals(
            "Interview take 2.mp3",
            pickedName("Interview take 2.mp3", "msf:42", "audio/mpeg"),
        )
        // Then the URI, when it looks like a name.
        assertEquals("voice_1.ogg", pickedName(null, "voice_1.ogg", "audio/ogg"))
        assertEquals("voice_1.ogg", pickedName("   ", "voice_1.ogg", "audio/ogg"))
        // Then a generated name that at least carries the right extension, so
        // the far end has something it can open.
        assertEquals("attachment.mp3", pickedName(null, "msf:42", "audio/mpeg"))
        // The old behaviour, and the reason the bug was visible: with nothing
        // to go on and no extension for audio, this was bare "attachment".
        assertEquals("attachment", pickedName(null, "msf:42", OPAQUE_TYPE))
    }

    @Test
    fun `the type falls back to the name before it gives up`() {
        assertEquals("audio/mpeg", pickedType("audio/mpeg", "whatever.bin"))
        // The provider knows nothing, so the name is asked - this is the step
        // that was missing, and the one that makes a picked song playable.
        assertEquals("audio/mpeg", pickedType(null, "song.mp3"))
        assertEquals("audio/mpeg", pickedType(OPAQUE_TYPE, "song.mp3"))
        assertEquals("audio/ogg", pickedType("", "voice_20260830_011311.ogg"))
        // Nothing says anything: honest bytes, and a plain document card.
        assertEquals(OPAQUE_TYPE, pickedType(null, "attachment"))
    }

    @Test
    fun `a picked audio file survives the whole chain`() {
        // The reported bug, end to end: a provider that answers neither, which
        // is what a `file://` URI does.
        val name = pickedName(displayName = null, uriSegment = "ringtone.mp3", contentType = OPAQUE_TYPE)
        val type = pickedType(providerType = null, name = name)

        assertEquals("ringtone.mp3", name)
        assertEquals("audio/mpeg", type)
        assertTrue("it has to be recognisable as audio", type.startsWith("audio/"))
    }
}
