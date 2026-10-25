package com.aatech.betweenus.baselineprofile

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.ExperimentalMetricApi
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.TraceSectionMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The same A/B as [StartupBenchmarks], past the sign-in screen: a cold start
 * that has to restore a session and a channel, and a journey through the shell.
 * See [BenchAccount] for what the account needs.
 *
 * Read each `...NoCompilation` against the `...WithProfile` beside it.
 */
@OptIn(ExperimentalMetricApi::class)
@RunWith(AndroidJUnit4::class)
class SignedInBenchmarks {
    @get:Rule
    val rule = MacrobenchmarkRule()

    @Test
    fun coldToChannelNoCompilation() = coldToChannel(CompilationMode.None())

    @Test
    fun coldToChannelWithProfile() = coldToChannel(CompilationMode.Partial(BaselineProfileMode.Require))

    @Test
    fun shellJourneyNoCompilation() = shellJourney(CompilationMode.None())

    @Test
    fun shellJourneyWithProfile() = shellJourney(CompilationMode.Partial(BaselineProfileMode.Require))

    /** Launch until the last channel is on screen, which is the time a person waits. */
    private fun coldToChannel(mode: CompilationMode) = rule.measureRepeated(
        packageName = BenchAccount.PACKAGE,
        metrics = listOf(StartupTimingMetric(), TraceSectionMetric(CONTENT_SECTION, targetPackageOnly = false)),
        compilationMode = mode,
        startupMode = StartupMode.COLD,
        iterations = 20,
        setupBlock = {
            BenchAccount.ensure(this)
            pressHome()
        },
    ) {
        androidx.tracing.trace(CONTENT_SECTION) {
            startActivityAndWait()
            device.wait(Until.hasObject(By.text(BenchAccount.CHANNEL)), 20_000)
        }
    }

    /** Drawer, settings, a scroll and back: the screens a session actually moves between. */
    private fun shellJourney(mode: CompilationMode) = rule.measureRepeated(
        packageName = BenchAccount.PACKAGE,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = mode,
        startupMode = StartupMode.WARM,
        iterations = 10,
        setupBlock = {
            BenchAccount.ensure(this)
            pressHome()
            startActivityAndWait()
            device.wait(Until.hasObject(By.desc("Open the channel list")), 10_000)
        },
    ) {
        repeat(3) {
            device.findObject(By.desc("Open the channel list"))?.click()
            device.wait(Until.hasObject(By.desc("Settings")), 5_000)
            device.findObject(By.desc("Settings"))?.click()
            device.waitForIdle()
            scrollDown()
            scrollDown()
            device.pressBack()
            device.waitForIdle()
        }
    }

    private fun MacrobenchmarkScope.scrollDown() {
        val width = device.displayWidth
        val height = device.displayHeight
        device.swipe(width / 2, height * 3 / 4, width / 2, height / 4, 30)
        device.waitForIdle()
    }

    private companion object {
        const val CONTENT_SECTION = "launchToChannel"
    }
}
