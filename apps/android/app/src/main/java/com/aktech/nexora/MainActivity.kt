package com.aktech.nexora

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
import com.aktech.nexora.core.data.Session
import com.aktech.nexora.feature.auth.LoginScreen
import com.aktech.nexora.feature.home.HomeScreen
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

        setContent {
            NexoraTheme {
                NexoraRoot()
            }
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
        is AuthPhase.SignedIn -> HomeScreen(current.user)
    }
}
