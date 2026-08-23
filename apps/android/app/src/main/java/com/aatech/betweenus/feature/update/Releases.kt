package com.aatech.betweenus.feature.update

/**
 * What a GitHub release is, and which one of them this device should install.
 *
 * All of it is pure: no Android, no network, no clock. The release workflow
 * names versions `0.0.2-alpha.1`, `0.0.2-beta.1` and `0.0.2`, and names the
 * APKs `BetweenUs-<version>-<abi>.apk` with a `universal` one alongside them -
 * so picking the right build is entirely a matter of parsing two strings, and
 * the parsing is the part worth testing. See `.github/workflows/release.yml`.
 */

/** Which builds a device is willing to be offered. */
enum class UpdateChannel(val label: String, val detail: String, val stage: Int) {
    STABLE("Stable", "Finished releases only.", Version.STABLE),
    BETA("Beta", "Release candidates, plus every stable release.", Version.BETA),
    ALPHA("Alpha", "Everything, the moment it is built.", Version.ALPHA);

    /**
     * A channel takes its own builds and everything steadier. Somebody on beta
     * who is offered nothing but betas would never be offered the stable
     * release that supersedes the one they are running.
     */
    fun accepts(version: Version): Boolean = version.stage >= stage

    companion object {
        fun of(name: String?): UpdateChannel =
            entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: STABLE

        /**
         * The channel a build belongs to, used as the default: somebody who
         * installed an alpha wants alphas, and defaulting them to stable would
         * strand them until the version they are running is released.
         */
        fun forVersion(versionName: String): UpdateChannel = when (Version.parse(versionName)?.stage) {
            Version.ALPHA -> ALPHA
            Version.BETA -> BETA
            else -> STABLE
        }
    }
}

/**
 * A semantic version, ordered.
 *
 * Only the shapes the release workflow can produce are understood -
 * `1.2.3`, `1.2.3-alpha.4`, `1.2.3-beta.4`, with or without a leading `v`.
 * Anything else parses to null and is skipped rather than guessed at, because
 * a guess here installs the wrong APK.
 */
data class Version(
    val major: Int,
    val minor: Int,
    val patch: Int,
    val stage: Int,
    val stageNumber: Int,
) : Comparable<Version> {

    override fun compareTo(other: Version): Int =
        compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch }, { it.stage }, { it.stageNumber })

    companion object {
        const val ALPHA = 0
        const val BETA = 1
        const val STABLE = 2

        private val PATTERN =
            Regex("""^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$""", RegexOption.IGNORE_CASE)

        fun parse(text: String?): Version? {
            val match = PATTERN.matchEntire(text?.trim().orEmpty()) ?: return null
            val (major, minor, patch, label, number) = match.destructured
            return Version(
                major = major.toInt(),
                minor = minor.toInt(),
                patch = patch.toInt(),
                stage = when (label.lowercase()) {
                    "alpha" -> ALPHA
                    "beta" -> BETA
                    // No pre-release part at all: the finished release, which
                    // sorts above every pre-release of the same numbers.
                    else -> STABLE
                },
                // A stable release has no pre-release number, and must still
                // beat `-beta.9` of the same version.
                stageNumber = number.toIntOrNull() ?: Int.MAX_VALUE,
            )
        }
    }
}

data class ReleaseAsset(val name: String, val url: String, val size: Long)

data class Release(
    val version: Version,
    val name: String,
    val notes: String,
    val publishedAt: String,
    val assets: List<ReleaseAsset>,
)

object Releases {
    /**
     * Where the APKs come from. A constant rather than a setting: this is the
     * project that signs the builds, and an APK from anywhere else would not
     * install over this one anyway - Android refuses an update signed by a
     * different key.
     */
    const val REPOSITORY = "aiyu-ayaan/BetweenUs"

    const val API = "https://api.github.com/repos/$REPOSITORY/releases?per_page=30"

    /**
     * The newest release on [channel] that is newer than what is installed, or
     * null when there is nothing to offer.
     *
     * "Newer" is by version, never by publish date: a stable release cut after
     * an alpha is still not an upgrade for the person running that alpha.
     */
    fun pick(releases: List<Release>, installed: Version?, channel: UpdateChannel): Release? =
        releases
            .filter { channel.accepts(it.version) }
            .filter { installed == null || it.version > installed }
            .maxByOrNull { it.version }

    /**
     * The APK built for this device, not the universal one.
     *
     * `Build.SUPPORTED_ABIS` is in the device's own order of preference - a
     * 64-bit phone lists `arm64-v8a` before `armeabi-v7a` - so the first match
     * wins. The universal APK carries every ABI's native libraries and is
     * roughly three times the download, which is why it is the fallback and
     * never the choice.
     */
    fun apkFor(release: Release, abis: List<String>): ReleaseAsset? {
        val apks = release.assets.filter { it.name.endsWith(".apk", ignoreCase = true) }
        // Suffix matching, not `contains`: `-x86.apk` must not match
        // `BetweenUs-1.0.0-x86_64.apk`.
        abis.forEach { abi ->
            apks.firstOrNull { it.name.endsWith("-$abi.apk", ignoreCase = true) }?.let { return it }
        }
        return apks.firstOrNull { it.name.endsWith("-universal.apk", ignoreCase = true) }
    }
}
