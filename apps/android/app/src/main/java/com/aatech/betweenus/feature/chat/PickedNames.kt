package com.aatech.betweenus.feature.chat

/**
 * What a picked file is called, and what kind of thing it is.
 *
 * Pure arithmetic over strings, in its own file so it can be tested without a
 * device. Everything that needs a `ContentResolver` lives in `MediaLibrary.kt`
 * and calls in here for the parts that are only string handling.
 *
 * This exists because an audio file picked on a phone arrived on every other
 * client called `attachment`, with no extension and a content type of
 * `application/octet-stream` - so it drew as an anonymous document rather than
 * as something with a play button. Two things had to be wrong at once for
 * that, and both were: the name fallback could not name anything that was not
 * a photo or a video, and nothing ever guessed a type from an extension.
 */

/**
 * The types this app names by hand, in both directions.
 *
 * A short explicit table rather than leaning on `MimeTypeMap` for everything,
 * for two reasons. It is the same list the upload route keeps in
 * `uploads.controller.ts`, and the two are meant to agree. And it is testable:
 * `MimeTypeMap` is an Android class that answers null in a JVM unit test, so a
 * table that only existed there could not be asserted on at all.
 *
 * `MimeTypeMap` is still consulted for anything not here - see the callers -
 * so this does not have to be exhaustive, only right about the common cases.
 */
private val TYPE_EXTENSIONS: Map<String, String> = mapOf(
    // Audio, which is what this file exists for.
    "audio/mpeg" to "mp3",
    "audio/mp3" to "mp3",
    "audio/mp4" to "m4a",
    "audio/x-m4a" to "m4a",
    "audio/aac" to "aac",
    "audio/ogg" to "ogg",
    "audio/opus" to "opus",
    "audio/webm" to "webm",
    "audio/wav" to "wav",
    "audio/x-wav" to "wav",
    "audio/flac" to "flac",
    "audio/amr" to "amr",
    "audio/3gpp" to "3gp",
    "audio/midi" to "mid",
    // Everything else the app routinely carries.
    "image/jpeg" to "jpg",
    "image/png" to "png",
    "image/gif" to "gif",
    "image/webp" to "webp",
    "image/heic" to "heic",
    "image/heif" to "heif",
    "image/svg+xml" to "svg",
    "video/mp4" to "mp4",
    "video/quicktime" to "mov",
    "video/webm" to "webm",
    "video/3gpp" to "3gp",
    "video/x-matroska" to "mkv",
    "application/pdf" to "pdf",
    "application/zip" to "zip",
    "application/json" to "json",
    "text/plain" to "txt",
    "text/csv" to "csv",
)

/** The reverse, first spelling wins - `mp3` names `audio/mpeg`, not `audio/mp3`. */
private val EXTENSION_TYPES: Map<String, String> =
    TYPE_EXTENSIONS.entries.reversed().associate { (type, extension) -> extension to type }

/** What the server and every client treat as "bytes, and nothing claimed about them". */
const val OPAQUE_TYPE = "application/octet-stream"

/**
 * The extension a file of this type should carry, with the leading dot, or an
 * empty string when nothing sensible can be said.
 *
 * The bug this fixes: the old version answered only for `image/` and `video/`,
 * by splitting the type on its slash. Everything else - every audio file,
 * every document - got an empty string, so a file that had to fall back to a
 * generated name was called `attachment` with no extension at all. An
 * extensionless file is one the receiving operating system cannot open and no
 * client can identify.
 */
fun extensionForType(contentType: String): String {
    val type = contentType.substringBefore(';').trim().lowercase()
    val known = TYPE_EXTENSIONS[type]
    if (known != null) return ".$known"
    // Not in the table, but still shaped like a type with a usable subtype:
    // `image/avif` is a real answer even though nothing here has heard of it.
    // `+xml` and friends are stripped, and a wildcard names nothing.
    val subtype = type.substringAfter('/', "").substringBefore('+')
    if (type.contains('/') && subtype.isNotEmpty() && subtype != "*" && subtype.all { it.isLetterOrDigit() }) {
        return ".$subtype"
    }
    return ""
}

/**
 * The type a file with this name most likely holds, or null when its name says
 * nothing useful.
 *
 * Only ever a fallback. A provider that states a type is believed; this is for
 * the ones that answer nothing - a `file://` URI has no provider to ask at
 * all, which is exactly the case that made a recording sent from this phone
 * arrive as an anonymous blob.
 */
fun typeForName(name: String): String? {
    val extension = name.substringAfterLast('.', "").lowercase()
    if (extension.isEmpty() || extension == name.lowercase()) return null
    return EXTENSION_TYPES[extension]
}

/**
 * Whether a content type actually says anything.
 *
 * `application/octet-stream` is what a provider returns when it does not know,
 * and treating it as an answer is how a song became a document. Blank is the
 * same non-answer spelled differently.
 */
fun typeIsUseful(contentType: String?): Boolean =
    !contentType.isNullOrBlank() && contentType.substringBefore(';').trim() != OPAQUE_TYPE

/**
 * A filename out of a URI's last path segment, when it looks like one.
 *
 * The last segment is not a filename for anything the document browser or the
 * photo picker hands back - those are opaque ids like `image:1000012345` or
 * `msf:42`, which is why `DISPLAY_NAME` is asked first and this is only the
 * fallback. But for a `file://` URI it *is* the filename, and a `file://` URI
 * has no provider to answer a query - so without this, every file this app
 * writes itself and then sends, its own voice recordings included, lost its
 * name on the way out.
 *
 * The test is an extension: `voice_20260830_011311.ogg` is a name, `msf:42`
 * and `1000012345` are not.
 */
fun nameFromSegment(segment: String?): String? {
    val candidate = segment?.substringAfterLast('/')?.trim().orEmpty()
    if (candidate.isEmpty() || candidate.contains(':')) return null
    val extension = candidate.substringAfterLast('.', "")
    val named = extension.isNotEmpty() && extension.length <= 5 && extension.all { it.isLetterOrDigit() }
    return if (named) candidate else null
}

/**
 * The name to send a file under, given everything that could be known about it.
 *
 * In order of how much each source is worth: what the provider calls it, what
 * the URI looks like it is called, and finally a generated name that at least
 * carries the right extension so the far end can open it.
 */
fun pickedName(displayName: String?, uriSegment: String?, contentType: String): String {
    displayName?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    nameFromSegment(uriSegment)?.let { return it }
    return "attachment${extensionForType(contentType)}"
}

/**
 * The type to send a file under.
 *
 * The provider's answer wins when it is one. Otherwise the name is asked, and
 * only if that says nothing does this fall back to "bytes" - which is honest,
 * and is what the far end will draw a plain document card for.
 */
fun pickedType(providerType: String?, name: String): String {
    if (typeIsUseful(providerType)) return providerType!!.substringBefore(';').trim()
    return typeForName(name) ?: OPAQUE_TYPE
}
