package com.aatech.betweenus.feature.voice

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.MainActivity
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.feature.notifications.SocialNotifications
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.BetweenUsTheme
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The screen a ringing call puts in front of somebody.
 *
 * This is what a notification's full-screen intent opens, and it is a separate
 * activity for one reason: showing over a locked phone and turning the screen
 * on are properties of an activity, and giving them to `MainActivity` would
 * give them to every launch of the app rather than to a call.
 *
 * It answers and declines and does nothing else. Answering hands the channel to
 * `MainActivity` as `betweenus://call/<id>`, which is the same path a tapped
 * notification takes with one difference - it joins on arrival, because
 * pressing Answer is consent to open a microphone in a way tapping a
 * notification is not.
 */
class IncomingCallActivity : ComponentActivity() {

    /**
     * Deliberately not `lifecycleScope`: this activity finishes on the same
     * tap, and a decline cancelled by its own screen closing would be a
     * decline that never left the phone.
     */
    private val declineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        showOverLockScreen()

        val channelId = intent?.getStringExtra(EXTRA_CHANNEL_ID).orEmpty()
        val caller = intent?.getStringExtra(EXTRA_CALLER).orEmpty().ifBlank { "Somebody" }

        // No channel is nothing to answer. It can happen: a notification that
        // outlived the call it was for is tapped from the shade.
        if (channelId.isEmpty()) {
            finish()
            return
        }

        // Answered on another device, declined from the shade, or rung out.
        // Cancelling the notification does not close this: a full-screen ringer
        // is an activity, and without this it sat over the lock screen ringing
        // at somebody who was already talking on their laptop.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Only once it has been *seen* ringing. The flow lives in this
                // process, and a process started fresh by the full-screen
                // intent can reach here a moment before the notification that
                // opened it is recorded - finishing on that empty first value
                // would close the ringer instead of showing it.
                var seen = false
                SocialNotifications.ringing.collect { channels ->
                    if (channelId in channels) seen = true else if (seen) finish()
                }
            }
        }

        setContent {
            BetweenUsTheme {
                IncomingCall(
                    caller = caller,
                    onAnswer = {
                        SocialNotifications.clearRinging(this, channelId)
                        startActivity(
                            Intent(this, MainActivity::class.java)
                                .setAction(Intent.ACTION_VIEW)
                                .setData(Uri.parse("betweenus://call/$channelId"))
                                .addFlags(
                                    Intent.FLAG_ACTIVITY_NEW_TASK or
                                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                                ),
                        )
                        finish()
                    },
                    onDecline = {
                        SocialNotifications.declineCall(this, channelId)
                        // A decision for the account, not for this phone: the
                        // ring landed on every device signed in, and saying no
                        // only here leaves a laptop ringing at somebody who has
                        // already decided. Fire and forget - the ringer here is
                        // already down, and the rest ring out on their own
                        // timer if this never lands.
                        declineScope.launch {
                            runCatching { BetweenUsApi.declineCall(channelId) }
                        }
                        finish()
                    },
                )
            }
        }
    }

    /**
     * Over the lock screen, with the screen on.
     *
     * The flags are the pre-27 spelling of the same thing and are still what
     * works below it; `minSdk 24` is why both are here. Dismissing the keyguard
     * is deliberately *not* asked for - answering a call does not unlock a
     * phone, and what happens after Answer is `MainActivity`, which is behind
     * the lock like everything else.
     */
    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            getSystemService(KeyguardManager::class.java)?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            )
        }
    }

    companion object {
        const val EXTRA_CHANNEL_ID = "channelId"
        const val EXTRA_CALLER = "caller"

        fun intent(context: Context, channelId: String, caller: String): Intent =
            Intent(context, IncomingCallActivity::class.java)
                .putExtra(EXTRA_CHANNEL_ID, channelId)
                .putExtra(EXTRA_CALLER, caller)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
}

@Composable
private fun IncomingCall(caller: String, onAnswer: () -> Unit, onDecline: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Ground)
            .systemBarsPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(72.dp))

        Avatar(id = caller, label = caller, url = null, size = 96.dp)

        Spacer(Modifier.height(20.dp))

        Text(
            text = caller,
            style = MaterialTheme.typography.headlineSmall,
            color = Slate50,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "is calling",
            style = MaterialTheme.typography.bodyMedium,
            color = Slate400,
        )

        Spacer(Modifier.weight(1f))

        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 32.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            CallButton(BetweenUsIcons.Phone, "Decline", Danger, onDecline)
            CallButton(BetweenUsIcons.Phone, "Answer", com.aatech.betweenus.ui.theme.Accent, onAnswer)
        }
    }
}

@Composable
private fun CallButton(
    icon: Int,
    label: String,
    colour: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(colour)
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            BetweenUsIcon(icon, tint = androidx.compose.ui.graphics.Color.White, size = 28.dp)
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = MaterialTheme.typography.labelLarge, color = Slate400)
    }
}
