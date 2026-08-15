package com.aktech.nexora

import android.app.Application
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.Session

/**
 * Two prefs files and nothing else. There is no dependency-injection framework
 * here on purpose: nothing yet needs injecting that a constructor cannot hand
 * over, and a graph for three objects is scaffolding for its own sake.
 */
class NexoraApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Endpoint.init(this)
        Session.init(this)
    }
}
