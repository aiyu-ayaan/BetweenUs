package com.aatech.betweenus

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.IntentCompat
import androidx.lifecycle.lifecycleScope
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.InviteLink
import com.aatech.betweenus.core.data.OAuthFlow
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.store.PendingChannel
import com.aatech.betweenus.core.store.PendingInvite
import com.aatech.betweenus.core.store.PendingPlace
import com.aatech.betweenus.core.store.PendingShare
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.feature.auth.LoginScreen
import com.aatech.betweenus.feature.shell.Shell
import com.aatech.betweenus.ui.components.BetweenUsLogoTile
import com.aatech.betweenus.ui.theme.Ground
import com.aatech.betweenus.ui.theme.BetweenUsTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // A stored refresh token is spent once per process, here, rather than
        // by whichever screen happens to make the first request.
        lifecycleScope.launch { Session.restore() }

        // A link - or a share from another app - may be what started this
        // process at all.
        handleLink(intent?.data)
        handleShare(intent)

        setContent {
            BetweenUsTheme {
                BetweenUsRoot()
            }
        }
    }

    /**
     * The app was already running when the link arrived.
     *
     * `singleTask` means a second launch is delivered here rather than building
     * a second activity, so this is where a provider callback lands in every
     * case that matters - the Custom Tab is in front of a live process.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent.data)
        handleShare(intent)
    }

    /**
     * Files another app sent here through the system share sheet.
     *
     * Read off the intent and left in [PendingShare]; nothing is opened,
     * decided about or uploaded here. A share names files, not a conversation,
     * and choosing the conversation is the shell's job - so this ends at the
     * send preview with a Send button somebody still has to press.
     *
     * The read permission on these URIs is this activity's, for as long as it
     * lives. That is why the list is memory-only and why the preview is the
     * next thing on screen rather than something to come back to later.
     */
    private fun handleShare(intent: Intent?) {
        if (intent == null) return
        val shared = when (intent.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE ->
                IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                    .orEmpty()
                    .filterNotNull()
            else -> emptyList()
        }
        // Handled once. `singleTask` redelivers the intent that started the
        // task on every later launch, which would re-share the same photo
        // every time the app is reopened from the launcher.
        if (shared.isNotEmpty()) {
            intent.removeExtra(Intent.EXTRA_STREAM)
            PendingShare.offer(shared)
        }
    }

    /**
     * What a `betweenus://` link means: a finished sign-in, or an invite.
     *
     * Neither is acted on blindly. The sign-in is only completed by trading the
     * code for a session with the verifier this app kept, and the invite is
     * only remembered - the card that shows what it leads to is the shell's,
     * and nothing is joined until somebody accepts it.
     */
    private fun handleLink(uri: Uri?) {
        if (uri == null) return

        val code = OAuthFlow.codeIn(uri)
        if (code != null) {
            lifecycleScope.launch {
                runCatching { OAuthFlow.complete(code) }
                    .onFailure { Session.reportSignInFailure(Session.messageOf(it)) }
            }
            return
        }

        // A notification that was tapped: betweenus://channel/<id>. The same
        // scheme an invite uses, because there should be one way into a channel
        // from outside the app rather than a second one only pushes know about.
        if (uri.host == "channel") {
            uri.pathSegments.firstOrNull()?.let { PendingChannel.offer(it) }
            return
        }

        // Answered from a ringing call: the same channel, and a join on
        // arrival, which is the one difference between this and the link
        // above.
        if (uri.host == "call") {
            uri.pathSegments.firstOrNull()?.let { PendingChannel.offer(it, join = true) }
            return
        }

        // The two places a notification can lead that are not a conversation.
        if (uri.host == "friends") {
            PendingPlace.offer(PendingPlace.Place.Friends)
            return
        }
        // The daily update check found something while the app was closed.
        if (uri.host == "update") {
            PendingPlace.offer(PendingPlace.Place.AutoUpdate)
            return
        }
        if (uri.host == "server") {
            uri.pathSegments.firstOrNull()?.let {
                PendingPlace.offer(PendingPlace.Place.Server(it))
            }
            return
        }

        InviteLink.codeIn(uri.toString())?.let { PendingInvite.offer(it) }
    }

    /**
     * A phone spends most of its life with the app in the background, where
     * Android is free to drop a socket without telling anybody. Coming back is
     * therefore the other moment - besides a reconnect - when what is on screen
     * may be stale, so it is re-read.
     */
    override fun onStart() {
        super.onStart()
        if (Session.state.value is AuthPhase.SignedIn) {
            lifecycleScope.launch { Workspace.refresh() }
        }
    }
}

/**
 * The whole navigation graph, for now.
 *
 * Two destinations do not need a navigation library: the session decides which
 * one is on screen, and there is nothing to put on a back stack. That changes
 * with phase 3, and that is when a nav host earns its place.
 */
@Composable
private fun BetweenUsRoot() {
    val phase by Session.state.collectAsState()

    when (val current = phase) {
        // Nothing but the mark: this lasts one refresh round-trip and a splash
        // that says "Loading…" for 200ms is worse than one that says nothing.
        AuthPhase.Restoring -> Box(
            modifier = Modifier.fillMaxSize().background(Ground),
            contentAlignment = Alignment.Center,
        ) {
            BetweenUsLogoTile(size = 56)
        }

        is AuthPhase.SignedOut -> LoginScreen(signedOutReason = current.reason)
        is AuthPhase.SignedIn -> Shell(current.user)
    }
}
