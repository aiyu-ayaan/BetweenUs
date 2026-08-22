package com.aatech.betweenus

import android.app.Application
import android.os.Build
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
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
import com.aatech.betweenus.feature.settings.CrashReports
import com.aatech.betweenus.feature.update.Updates
import com.aatech.betweenus.feature.voice.AudioPrefs
import com.aatech.betweenus.feature.voice.CallTones

/**
 * A few prefs files and the local cache, and nothing else. There is no
 * dependency-injection framework
 * here on purpose: nothing yet needs injecting that a constructor cannot hand
 * over, and a graph for three objects is scaffolding for its own sake.
 */
class BetweenUsApp : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()
        // First, so a crash in anything below it is the one that gets recorded.
        CrashReports.init(this)
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
        // What channel this device follows, and whether it has been asked
        // recently. Read on every launch by the shell.
        Updates.init(this)
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

    /**
     * Coil, with a GIF decoder in it.
     *
     * An animated custom emoji is a GIF, and without a decoder Coil draws its
     * first frame - which is how a `:party_parrot:` arrives as a still parrot.
     * The platform's own `ImageDecoder` does it from API 28; below that Coil's
     * own decoder is the fallback, and it is the reason `minSdk 24` is not a
     * reason to skip this.
     */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .components {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) add(ImageDecoderDecoder.Factory())
            else add(GifDecoder.Factory())
        }
        .build()
}
