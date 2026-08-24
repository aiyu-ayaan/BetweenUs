package com.aatech.betweenus.feature.auth

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
import com.aatech.betweenus.ui.components.GlobeIcon
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri
import com.aatech.betweenus.core.data.OAuthFlow
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsLogoTile
import com.aatech.betweenus.ui.components.BetweenUsSecondaryButton
import com.aatech.betweenus.ui.components.Notice

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
    val context = LocalContext.current
    var pickingServer by rememberSaveable { mutableStateOf(false) }
    val registering = form.mode == AuthMode.REGISTER

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
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
                // The one card on the one screen with nothing else on it, so
                // it gets the widest corner in the scale and no border at all.
                .background(
                    MaterialTheme.colorScheme.surfaceContainer,
                    MaterialTheme.shapes.extraLarge,
                )
                .padding(28.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BetweenUsLogoTile()
                Spacer(Modifier.height(20.dp))
                Text(
                    text = if (registering) "Create your account" else "Welcome back",
                    // Emphasized: this is the first line of the app and there
                    // is nothing else on screen for it to compete with.
                    style = MaterialTheme.typography.headlineSmallEmphasized,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = if (registering) {
                        "Pick a username your teammates will see"
                    } else {
                        "Sign in to continue to BetweenUs"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(24.dp))

            // Signing in takes an email or a username, and the server has
            // accepted either all along - an address contains an @ where a
            // username may not. The email keyboard is the part that did not:
            // it puts "@" and ".com" where the letters should be for somebody
            // typing a name. Registering still asks for an address, because
            // that one really is one.
            BetweenUsField(
                label = if (registering) "Email" else "Email or username",
                value = form.email,
                onValueChange = viewModel::setEmail,
                placeholder = if (registering) "you@example.com" else "you@example.com or ayaan",
                keyboardType = if (registering) KeyboardType.Email else KeyboardType.Text,
                enabled = !form.busy,
            )

            if (registering) {
                Spacer(Modifier.height(16.dp))
                BetweenUsField(
                    label = "Username",
                    value = form.username,
                    onValueChange = viewModel::setUsername,
                    placeholder = "ayaan",
                    enabled = !form.busy,
                )
            }

            Spacer(Modifier.height(16.dp))
            BetweenUsField(
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
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            (form.error ?: signedOutReason)?.let { message ->
                Spacer(Modifier.height(16.dp))
                Notice(message, MaterialTheme.colorScheme.error)
            }

            Spacer(Modifier.height(20.dp))

            BetweenUsButton(
                text = when {
                    form.busy -> "Please wait…"
                    registering -> "Create account"
                    else -> "Sign in"
                },
                onClick = viewModel::submit,
                busy = form.busy,
            )

            if (form.providers.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    HorizontalDivider(
                        Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.outlineVariant,
                    )
                    Text(
                        text = "or",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                    HorizontalDivider(
                        Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.outlineVariant,
                    )
                }
                Spacer(Modifier.height(16.dp))

                for (provider in form.providers) {
                    ProviderButton(
                        label = provider.label,
                        enabled = !form.busy,
                        onClick = {
                            // A real browser, not a WebView: this is somebody's
                            // Google account, they are probably already signed
                            // in to it there, and Google refuses an embedded
                            // WebView for exactly that reason.
                            CustomTabsIntent.Builder()
                                .setShowTitle(true)
                                .build()
                                .launchUrl(context, OAuthFlow.startUrl(provider.provider).toUri())
                        },
                    )
                    Spacer(Modifier.height(8.dp))
                }
            }

            TextButton(
                onClick = viewModel::toggleMode,
                enabled = !form.busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                Text(
                    text = if (registering) "Already registered? Sign in" else "Need an account? Register",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(8.dp))

            // Which deployment this is. BetweenUs is meant to be self-hosted, so
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
                    GlobeIcon(tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = "Connect to a self-hosted instance",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                text = "Signing in to ${form.serverLabel}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    if (pickingServer) {
        ServerSheet(onDismiss = { pickingServer = false })
    }
}

/**
 * One provider's button.
 *
 * Deliberately not the accent colour: creating an account is the primary thing
 * on this screen, and three filled buttons in a column say nothing about which
 * to press.
 */
@Composable
private fun ProviderButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    BetweenUsSecondaryButton(
        text = "Continue with $label",
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    )
}
