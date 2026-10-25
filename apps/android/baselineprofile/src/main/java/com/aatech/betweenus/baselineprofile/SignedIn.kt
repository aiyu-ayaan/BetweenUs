package com.aatech.betweenus.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until

/**
 * The account the signed-in journeys run as, and how to get the app into it.
 *
 * A fresh install has no session, so every journey past the sign-in screen
 * starts by creating one. The account is a throwaway on a development stack
 * (`pnpm dev:backend` and `pnpm dev:gateway`, reached from the emulator on
 * 10.0.2.2:8090) and the credentials below mean nothing anywhere else. Create
 * it once with:
 *
 *   curl -X POST http://127.0.0.1:8090/api/v1/auth/register \
 *     -H 'content-type: application/json' \
 *     -d '{"email":"bench.temp@example.test","username":"bench_temp","password":"Bench-Temp-2026!"}'
 *
 * and give it one server, so there is a channel to open.
 */
internal object BenchAccount {
    const val PACKAGE = "com.aatech.betweenus"
    const val USERNAME = "bench_temp"
    const val PASSWORD = "Bench-Temp-2026!"

    /** What the top bar says once the shell has restored the last channel. */
    const val CHANNEL = "general"

    private const val WAIT_MS = 20_000L

    @Volatile
    private var signedIn = false

    /**
     * Signs in if this install has no session yet, and gets past the one-time
     * permissions introduction. Safe to call before every iteration.
     */
    fun ensure(scope: MacrobenchmarkScope) = with(scope) {
        if (signedIn) return@with
        for (permission in listOf("POST_NOTIFICATIONS", "RECORD_AUDIO", "CAMERA", "BLUETOOTH_CONNECT")) {
            device.executeShellCommand("pm grant $PACKAGE android.permission.$permission")
        }
        pressHome()
        startActivityAndWait()

        if (device.wait(Until.hasObject(By.text("Sign in")), 5_000)) {
            val fields = device.findObjects(By.clazz("android.widget.EditText"))
            check(fields.size >= 2) { "sign-in screen has ${fields.size} text fields" }
            fields[0].text = USERNAME
            fields[1].text = PASSWORD
            device.findObject(By.text("Sign in")).click()
        }

        // After a first sign-in the app stops at a permissions introduction.
        // Its button is under the list, so scroll to it.
        if (device.wait(Until.hasObject(By.text("Permissions Health")), 5_000)) {
            val width = device.displayWidth
            val height = device.displayHeight
            device.swipe(width / 2, height * 3 / 4, width / 2, height / 4, 20)
            device.wait(Until.findObject(By.text("Continue to BetweenUs")), 5_000)?.click()
        }

        check(device.wait(Until.hasObject(By.desc("Open the channel list")), WAIT_MS)) {
            "never reached the signed-in shell; is the dev backend up and is $USERNAME registered?"
        }
        signedIn = true
    }
}
