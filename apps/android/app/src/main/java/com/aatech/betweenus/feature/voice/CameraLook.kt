package com.aatech.betweenus.feature.voice

/**
 * What the camera looks like: a colour filter, and how hard the background is
 * blurred.
 *
 * The phone's half of `camera-effects.ts` on the desktop, and the names are the
 * desktop's names on purpose - the same rule the noise-suppression levels and
 * the camera resolutions already follow. "Turn on Warm" has to mean one thing
 * in a support conversation whichever client somebody is holding.
 *
 * The values themselves cannot be shared, because the two platforms express
 * them differently: a canvas filter string on the desktop, a colour matrix in a
 * fragment shader here. What is shared is the intent and the strength, so the
 * two look like the same feature rather than two features with one name.
 */
object CameraLook {

    /**
     * A filter as a 4x4 colour matrix, column-major, the way OpenGL wants it.
     *
     * A matrix rather than a list of named operations because that is what a
     * shader can apply in one multiply: saturation, warmth and contrast all
     * collapse into the same sixteen numbers, so the cost of a filter is
     * identical to the cost of no filter and there is no reason to branch.
     */
    data class Filter(val name: String, val label: String, val matrix: FloatArray) {
        // Kotlin generates identity by reference for arrays in a data class, so
        // the name - which is what is stored and compared - decides it instead.
        override fun equals(other: Any?): Boolean = other is Filter && other.name == name
        override fun hashCode(): Int = name.hashCode()
    }

    /** Luminance weights, the same ones every image pipeline uses. */
    private const val LR = 0.2126f
    private const val LG = 0.7152f
    private const val LB = 0.0722f

    /**
     * A saturation matrix: 1 leaves colour alone, 0 is greyscale, above 1 pushes.
     *
     * Written out rather than hard-coded per filter so the numbers below say
     * what they mean - `saturation(1.4f)` is legible in a way sixteen floats
     * are not.
     */
    private fun saturation(amount: Float): FloatArray {
        val i = 1f - amount
        return floatArrayOf(
            i * LR + amount, i * LR, i * LR, 0f,
            i * LG, i * LG + amount, i * LG, 0f,
            i * LB, i * LB, i * LB + amount, 0f,
            0f, 0f, 0f, 1f,
        )
    }

    /** Scales each channel and lifts it: contrast around mid-grey, plus a tint. */
    private fun tint(r: Float, g: Float, b: Float, lift: Float = 0f): FloatArray = floatArrayOf(
        r, 0f, 0f, 0f,
        0f, g, 0f, 0f,
        0f, 0f, b, 0f,
        lift, lift, lift, 1f,
    )

    private fun multiply(a: FloatArray, b: FloatArray): FloatArray {
        val out = FloatArray(16)
        for (col in 0..3) {
            for (row in 0..3) {
                var sum = 0f
                for (k in 0..3) {
                    sum += a[k * 4 + row] * b[col * 4 + k]
                }
                out[col * 4 + row] = sum
            }
        }
        return out
    }

    val IDENTITY: FloatArray = floatArrayOf(
        1f, 0f, 0f, 0f,
        0f, 1f, 0f, 0f,
        0f, 0f, 1f, 0f,
        0f, 0f, 0f, 1f,
    )

    /**
     * The filters on offer.
     *
     * Gentle on purpose, and matched to the desktop's: a filter somebody
     * notices is a filter they turn off. The strongest of them is still a face.
     */
    val FILTERS: List<Filter> = listOf(
        Filter("none", "None", IDENTITY),
        // A cheap sensor under an indoor light renders skin grey. Warm is the
        // correction rather than a look.
        Filter("warm", "Warm", multiply(tint(1.06f, 1.0f, 0.94f), saturation(1.15f))),
        Filter("cool", "Cool", multiply(tint(0.96f, 1.0f, 1.07f, 0.02f), saturation(1.08f))),
        Filter("vivid", "Vivid", multiply(tint(1.05f, 1.05f, 1.05f, -0.02f), saturation(1.4f))),
        Filter("mono", "Mono", saturation(0f)),
        Filter("soft", "Soft", multiply(tint(0.94f, 0.94f, 0.94f, 0.04f), saturation(1.05f))),
    )

    fun filterFor(name: String?): Filter =
        FILTERS.firstOrNull { it.name == name } ?: FILTERS.first()

    /**
     * How hard the background is blurred, as a radius in source pixels.
     *
     * Two steps rather than a slider, and the desktop's two: the honest range is
     * narrow - below a certain point nothing looks blurred, and above it the
     * edge of somebody's hair matters more than the blur does - so a slider
     * would be a hundred positions across a choice with two useful answers.
     */
    enum class Portrait(val level: String, val label: String, val radius: Float) {
        OFF("off", "Off", 0f),
        LIGHT("light", "Light", 6f),
        STRONG("strong", "Strong", 13f),
    }

    fun portraitFor(level: String?): Portrait =
        Portrait.entries.firstOrNull { it.level == level } ?: Portrait.OFF

    /**
     * Whether anything at all has been asked for.
     *
     * "No effect" must not mean "an identity shader": a pass-through still costs
     * a full render of every frame, at capture resolution and frame rate, on a
     * phone that is already encoding video. It means the processor hands the
     * frame straight to the sink and no GL runs at all.
     */
    fun isPassThrough(filter: String?, portrait: String?): Boolean =
        filterFor(filter).name == "none" && portraitFor(portrait) == Portrait.OFF
}
