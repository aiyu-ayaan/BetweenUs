package com.aatech.betweenus

import android.app.Application
import com.aatech.betweenus.core.crypto.DeviceIdentity
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.NetworkWatch
import com.aatech.betweenus.core.data.OAuthFlow
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.Cache
import com.aatech.betweenus.core.store.AppForeground
import com.aatech.betweenus.core.store.LastPlace
import com.aatech.betweenus.feature.chat.Outbox
import com.aatech.betweenus.feature.notifications.Push
import com.aatech.betweenus.feature.voice.AudioPrefs
import com.aatech.betweenus.feature.voice.CallTones

/**
 * A few prefs files and the local cache, and nothing else. There is no
 * dependency-injection framework
 * here on purpose: nothing yet needs injecting that a constructor cannot hand
 * over, and a graph for three objects is scaffolding for its own sake.
 */
class BetweenUsApp : Application() {
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
        // The queue that carries a message with files in it. Started here so a
        // send survives the screen it was started from - which is the whole
        // reason it exists.
        Outbox.init(this)
        // Whether anybody is looking, and where a push token comes from. Both
        // have to exist before the first push, which can arrive before any
        // activity does.
        AppForeground.init(this)
        Push.init(this)
    }
}
