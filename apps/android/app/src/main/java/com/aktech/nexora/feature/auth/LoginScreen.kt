package com.aktech.nexora.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.aktech.nexora.ui.components.GlobeIcon
import com.aktech.nexora.ui.components.NexoraButton
import com.aktech.nexora.ui.components.NexoraField
import com.aktech.nexora.ui.components.NexoraLogoTile
import com.aktech.nexora.ui.components.Notice
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface900

/**
 * Sign in, or register, against whichever deployment this install is pointed
 * at. `apps/desktop/src/features/auth/LoginScreen.tsx` is the reference: same
 * copy, same order, same panel-on-a-dark-ground shape, redrawn for a phone.
 */
@Composable
fun LoginScreen(
    /** Why the last session ended, when it was not simply a sign-out. */
    signedOutReason: String? = null,
    viewModel: AuthViewModel = viewModel(),
) {
    val form by viewModel.state.collectAsState()
    var pickingServer by rememberSaveable { mutableStateOf(false) }
    val registering = form.mode == AuthMode.REGISTER

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Ground)
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 420.dp)
                .border(1.dp, Edge, RoundedCornerShape(20.dp))
                .background(Surface900, RoundedCornerShape(20.dp))
                .padding(24.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                NexoraLogoTile()
                Spacer(Modifier.height(16.dp))
                Text(
                    text = if (registering) "Create your account" else "Welcome back",
                    style = MaterialTheme.typography.headlineSmall,
                    color = Slate50,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = if (registering) {
                        "Pick a username your teammates will see"
                    } else {
                        "Sign in to continue to Nexora"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate400,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(24.dp))

            NexoraField(
                label = "Email",
                value = form.email,
                onValueChange = viewModel::setEmail,
                placeholder = "you@example.com",
                keyboardType = KeyboardType.Email,
                enabled = !form.busy,
            )

            if (registering) {
                Spacer(Modifier.height(16.dp))
                NexoraField(
                    label = "Username",
                    value = form.username,
                    onValueChange = viewModel::setUsername,
                    placeholder = "ayaan",
                    enabled = !form.busy,
                )
            }

            Spacer(Modifier.height(16.dp))
            NexoraField(
                label = "Password",
                value = form.password,
                onValueChange = viewModel::setPassword,
                placeholder = "At least 8 characters",
                keyboardType = KeyboardType.Password,
                secret = true,
                imeAction = ImeAction.Done,
                enabled = !form.busy,
                onImeAction = viewModel::submit,
            )
            if (registering) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Must contain a letter and a number.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                )
            }

            (form.error ?: signedOutReason)?.let { message ->
                Spacer(Modifier.height(16.dp))
                Notice(message, Danger)
            }

            Spacer(Modifier.height(20.dp))

            NexoraButton(
                text = when {
                    form.busy -> "Please wait…"
                    registering -> "Create account"
                    else -> "Sign in"
                },
                onClick = viewModel::submit,
                busy = form.busy,
            )

            TextButton(
                onClick = viewModel::toggleMode,
                enabled = !form.busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                Text(
                    text = if (registering) "Already registered? Sign in" else "Need an account? Register",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate400,
                )
            }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = Edge)
            Spacer(Modifier.height(8.dp))

            // Which deployment this is. Nexora is meant to be self-hosted, so
            // the address is worth showing even when nobody wants to change it.
            TextButton(
                onClick = { pickingServer = true },
                enabled = !form.busy,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .heightIn(min = 48.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    GlobeIcon(tint = Slate400)
                    Text(
                        text = "Connect to a self-hosted instance",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                    )
                }
            }
            Text(
                text = "Signing in to ${form.serverLabel}",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    if (pickingServer) {
        ServerSheet(onDismiss = { pickingServer = false })
    }
}
