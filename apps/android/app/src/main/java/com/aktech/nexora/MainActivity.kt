package com.aktech.nexora

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
import androidx.lifecycle.lifecycleScope
import com.aktech.nexora.core.data.AuthPhase
import com.aktech.nexora.core.data.InviteLink
import com.aktech.nexora.core.data.OAuthFlow
import com.aktech.nexora.core.data.Session
import com.aktech.nexora.core.store.PendingInvite
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.feature.auth.LoginScreen
import com.aktech.nexora.feature.shell.Shell
import com.aktech.nexora.ui.components.NexoraLogoTile
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.NexoraTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // A stored refresh token is spent once per process, here, rather than
        // by whichever screen happens to make the first request.
        lifecycleScope.launch { Session.restore() }

        // A link may be what started this process at all.
        handleLink(intent?.data)

        setContent {
            NexoraTheme {
                NexoraRoot()
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
    }

    /**
     * What a `nexora://` link means: a finished sign-in, or an invite.
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
private fun NexoraRoot() {
    val phase by Session.state.collectAsState()

    when (val current = phase) {
        // Nothing but the mark: this lasts one refresh round-trip and a splash
        // that says "Loading…" for 200ms is worse than one that says nothing.
        AuthPhase.Restoring -> Box(
            modifier = Modifier.fillMaxSize().background(Ground),
            contentAlignment = Alignment.Center,
        ) {
            NexoraLogoTile(size = 56)
        }

        is AuthPhase.SignedOut -> LoginScreen(signedOutReason = current.reason)
        is AuthPhase.SignedIn -> Shell(current.user)
    }
}
