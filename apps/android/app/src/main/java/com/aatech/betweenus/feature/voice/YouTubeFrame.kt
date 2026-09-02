package com.aatech.betweenus.feature.voice

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * The YouTube embed, on a phone.
 *
 * A `WebView` running YouTube's own IFrame API, which is the same player the
 * desktop drives - and the only way to play a YouTube video that is not either
 * against their terms or a fork of a scraper that breaks every few months.
 *
 * ## Why a page of HTML rather than postMessage
 *
 * The desktop talks to its iframe with `postMessage`, because in a renderer the
 * frame is a sibling document it cannot reach into. Here the WebView *is* the
 * document, so the page can carry the API and expose plain functions, and the
 * bridge back is `@JavascriptInterface`. Fewer moving parts than replaying a
 * message protocol through a second layer.
 *
 * ## The two settings without which none of this works
 *
 * `mediaPlaybackRequiresUserGesture = false` is not an optimisation. Left at
 * its default, the player refuses to start until somebody taps the video
 * itself - which in a synchronised session means every track begins with each
 * person tapping, at a different moment, out of step by however long that took.
 * `javaScriptEnabled` is what the API is written in.
 *
 * The base URL matters as much: the IFrame API checks the origin it was loaded
 * from, and a page served from `about:blank` is refused. `loadDataWithBaseURL`
 * with a youtube.com base is what makes the embed answer at all.
 */
class YouTubeFrame(
    private val web: WebView,
    /** Called on the main thread whenever the player says something about itself. */
    private val onState: (PlayerState) -> Unit,
) {

    /**
     * What the embed says about itself.
     *
     * [positionMs] is this player's own position, which is the thing
     * [ListenSync.correction] compares against the call's. [ended] is separate
     * from `!playing` because a paused track and a finished one need opposite
     * answers: one is left alone, the other advances the queue.
     */
    data class PlayerState(
        val positionMs: Long,
        val durationMs: Long,
        val playing: Boolean,
        val ended: Boolean,
        val title: String,
    )

    private var loadedRef: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun attach() {
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        // See the note above: without this every track waits for a tap, and a
        // synchronised session in which everybody starts by tapping is a
        // session that starts out of step by however long the taps took.
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.addJavascriptInterface(Bridge(), "BetweenUs")
    }

    /**
     * Loads a video, or does nothing if it is already the one loaded.
     *
     * A different track is a fresh page rather than a `loadVideoById`. A frame
     * that has already been refused autoplay stays refused for its lifetime,
     * and a new one gets a new answer - the same reason the desktop rebuilds
     * its player rather than telling it to load another video.
     */
    fun load(ref: String) {
        if (loadedRef == ref) return
        loadedRef = ref
        web.loadDataWithBaseURL(BASE_URL, page(ref), "text/html", "utf-8", null)
    }

    fun play() = call("play()")

    fun pause() = call("pause()")

    fun seek(positionMs: Long) = call("seek(${positionMs / 1000.0})")

    /**
     * How loud, 0 to 100 - which is the ducking control.
     *
     * The embed's own volume rather than the phone's stream volume: turning the
     * media stream down would duck every other sound on the device, and the
     * call itself is on the voice stream and must not move at all.
     */
    fun volume(percent: Int) = call("setVolume(${percent.coerceIn(0, 100)})")

    /** Asks the page for a state message. The answer arrives through the bridge. */
    fun poll() = call("report()")

    fun release() {
        loadedRef = null
        runCatching { web.loadUrl("about:blank") }
    }

    private fun call(js: String) {
        runCatching { web.evaluateJavascript("try{$js}catch(e){}", null) }
    }

    private inner class Bridge {
        /**
         * The page's only way back.
         *
         * JSON rather than several methods, because a state is one observation
         * and delivering it as five calls means four of them can be read
         * against a sixth that arrived in between.
         */
        @JavascriptInterface
        fun state(json: String) {
            val parsed = runCatching { JSONObject(json) }.getOrNull() ?: return
            val state = PlayerState(
                positionMs = (parsed.optDouble("position", 0.0) * 1000).toLong(),
                durationMs = (parsed.optDouble("duration", 0.0) * 1000).toLong(),
                playing = parsed.optBoolean("playing"),
                ended = parsed.optBoolean("ended"),
                title = parsed.optString("title"),
            )
            web.post { onState(state) }
        }
    }

    private companion object {
        /**
         * The origin the page claims. The IFrame API checks it, and a document
         * with no origin at all is refused outright.
         */
        const val BASE_URL = "https://www.youtube.com"

        /**
         * The page.
         *
         * `playsinline=1` keeps it in the layout: without it Android hands the
         * video to the system's full-screen player, which is a second surface
         * this app cannot pause, seek or duck - and therefore cannot keep in
         * step with anybody.
         *
         * `controls=0` because the transport belongs to the call. A person
         * scrubbing their own copy would be a person out of step by however far
         * they scrubbed, silently, until the next correction dragged them back.
         */
        fun page(ref: String): String = """
            <!doctype html>
            <html>
              <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                  html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}
                  #player{width:100%;height:100%}
                </style>
              </head>
              <body>
                <div id="player"></div>
                <script src="https://www.youtube.com/iframe_api"></script>
                <script>
                  var player = null;
                  var ready = false;

                  function onYouTubeIframeAPIReady() {
                    player = new YT.Player('player', {
                      videoId: '$ref',
                      playerVars: {
                        playsinline: 1,
                        controls: 0,
                        rel: 0,
                        modestbranding: 1,
                        origin: '$BASE_URL'
                      },
                      events: {
                        onReady: function () { ready = true; report(); },
                        onStateChange: function () { report(); }
                      }
                    });
                  }

                  function play() { if (ready) player.playVideo(); }
                  function pause() { if (ready) player.pauseVideo(); }
                  function seek(seconds) { if (ready) player.seekTo(seconds, true); }
                  function setVolume(v) { if (ready) player.setVolume(v); }

                  function report() {
                    if (!ready) return;
                    var state = player.getPlayerState();
                    var data = {
                      position: player.getCurrentTime() || 0,
                      duration: player.getDuration() || 0,
                      // 1 is playing and 3 is buffering. Buffering counts as
                      // playing: it is a player on its way to sound, and
                      // reading it as stopped makes the call press play at it
                      // every few seconds while it tries to load.
                      playing: state === 1 || state === 3,
                      ended: state === 0,
                      title: (player.getVideoData() || {}).title || ''
                    };
                    BetweenUs.state(JSON.stringify(data));
                  }
                </script>
              </body>
            </html>
        """.trimIndent()
    }
}
