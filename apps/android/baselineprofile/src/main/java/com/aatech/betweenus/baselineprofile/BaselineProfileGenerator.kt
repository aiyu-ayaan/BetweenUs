package com.aatech.betweenus.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The journey the baseline profile is recorded from.
 *
 * It is a cold start and nothing past it, because that is all a fresh install
 * can reach without a server to sign in to: `BetweenUsApp.onCreate`'s whole
 * init chain, the activity, the theme, and the first Compose frame. That is
 * also the part every launch pays for, so it is the part worth compiling ahead
 * of time. Screens behind a session are not in it, and a profile claiming them
 * would be a guess.
 *
 * Run with `pnpm android:profile`.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun startup() = rule.collect(
        packageName = "com.aatech.betweenus",
        // The same methods go into the startup profile too, which R8 uses to lay
        // them out together in the DEX so a launch reads fewer pages.
        includeInStartupProfile = true,
    ) {
        pressHome()
        startActivityAndWait()
        device.waitForIdle()
    }
}
