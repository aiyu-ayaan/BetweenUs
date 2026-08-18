package com.aktech.nexora

import android.app.Application
import com.aktech.nexora.core.crypto.DeviceIdentity
import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.NetworkWatch
import com.aktech.nexora.core.data.OAuthFlow
import com.aktech.nexora.core.data.Session
import com.aktech.nexora.core.store.Cache
import com.aktech.nexora.core.store.LastPlace
import com.aktech.nexora.feature.voice.AudioPrefs
import com.aktech.nexora.feature.voice.CallTones

/**
 * A few prefs files and the local cache, and nothing else. There is no
 * dependency-injection framework
 * here on purpose: nothing yet needs injecting that a constructor cannot hand
 * over, and a graph for three objects is scaffolding for its own sake.
 */
class NexoraApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Endpoint.init(this)
        NetworkWatch.init(this)
        Session.init(this)
        OAuthFlow.init(this)
        DeviceIdentity.init(this)
        E2ee.init(this)
        LastPlace.init(this)
        Cache.init(this)
        CallTones.init(this)
        AudioPrefs.init(this)
    }
}
