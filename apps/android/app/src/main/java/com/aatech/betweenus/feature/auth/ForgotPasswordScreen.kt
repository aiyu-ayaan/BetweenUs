package com.aatech.betweenus.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsLogoTile
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.StatusOnline

/**
 * The way back into an account nobody remembers the password for.
 *
 * Two screens wearing one, and which you get is decided by the deployment
 * rather than by anything typed here. Naming an account either sends a link,
 * says this deployment has no mail server and to ask an administrator, or -
 * when an administrator has already opened a reset window on it - goes straight
 * to the new-password form with the token carried across rather than shown.
 *
 * The port of `apps/desktop/src/features/auth/ForgotPassword.tsx`, and it keeps
 * that file's one rule: the three answers are deliberately not equally
 * informative. "A link is on its way" is what an account that does not exist
 * gets too, because anything else would make this form a way to find out who
 * has an account here.
 */
@Composable
fun ForgotPasswordScreen(viewModel: AuthViewModel, onBack: () -> Unit) {
    val form by viewModel.state.collectAsState()
    val choosing = form.recovery.step == RecoveryStep.CHOOSE

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
                    text = if (choosing) "Choose a new password" else "Forgot your password?",
                    style = MaterialTheme.typography.headlineSmallEmphasized,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = if (choosing) {
                        "This signs every other device out."
                    } else {
                        "Enter your username or email address."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(24.dp))

            if (!choosing) {
                BetweenUsField(
                    label = "Email or username",
                    value = form.recovery.identifier,
                    onValueChange = viewModel::setRecoveryIdentifier,
                    placeholder = "you@example.com or ayaan",
                    keyboardType = KeyboardType.Text,
                    imeAction = ImeAction.Done,
                    enabled = !form.busy,
                    onImeAction = viewModel::startRecovery,
                )
            } else {
                // Hidden when the token arrived from the administrator's
                // window: there is nothing to paste, and an empty box would
                // look like a step somebody has to complete.
                if (form.recovery.tokenNeeded) {
                    BetweenUsField(
                        label = "Code from the email",
                        value = form.recovery.token,
                        onValueChange = viewModel::setRecoveryToken,
                        placeholder = "Paste it here",
                        enabled = !form.busy,
                    )
                    Spacer(Modifier.height(16.dp))
                }
                BetweenUsField(
                    label = "New password",
                    value = form.recovery.password,
                    onValueChange = viewModel::setRecoveryPassword,
                    placeholder = "At least 8 characters",
                    keyboardType = KeyboardType.Password,
                    secret = true,
                    imeAction = ImeAction.Done,
                    enabled = !form.busy,
                    onImeAction = viewModel::finishRecovery,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Signing in on a new device after a reset gives you a fresh " +
                        "encryption key: it can read what arrives from then on, not what " +
                        "came before. Your identity backup was sealed with the old password.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            form.recovery.notice?.let {
                Spacer(Modifier.height(16.dp))
                Notice(it, StatusOnline)
            }
            form.error?.let {
                Spacer(Modifier.height(16.dp))
                Notice(it, MaterialTheme.colorScheme.error)
            }

            Spacer(Modifier.height(20.dp))

            BetweenUsButton(
                text = when {
                    form.busy -> "Please wait…"
                    choosing -> "Set password"
                    else -> "Continue"
                },
                onClick = if (choosing) viewModel::finishRecovery else viewModel::startRecovery,
                busy = form.busy,
            )

            TextButton(
                onClick = onBack,
                enabled = !form.busy,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                Text(
                    text = "Back to sign in",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}
