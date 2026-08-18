package com.aatech.betweenus.feature.auth

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.crypto.BackupSecret
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsLogoTile
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface900
import kotlinx.coroutines.launch

/**
 * This device holds no identity key and the account's backup is sealed with
 * something nobody has typed yet.
 *
 * The port of `apps/desktop/src/features/auth/IdentityUnlock.tsx`. It is not a
 * blocking screen: an account with a locked identity can still be signed in,
 * see its servers and send *new* messages once a key is minted. What it cannot
 * do is read anything sealed for the old identity, which is most of the point,
 * so the sheet keeps coming back until it is answered or explicitly dismissed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IdentityUnlockSheet(kind: String, onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var secret by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    val isPassword = kind == "password"

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = Surface900) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(20.dp)) {
            BetweenUsLogoTile(size = 44)
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Unlock your messages",
                style = MaterialTheme.typography.titleMedium,
                color = Slate100,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = if (isPassword) {
                    "Your identity key is backed up on the account, sealed with your password. " +
                        "Type it once and this device can read your history."
                } else {
                    "Your identity key is sealed with the recovery passphrase you set. It was " +
                        "never sent anywhere, so nobody but you can supply it."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Slate400,
            )

            Spacer(Modifier.height(16.dp))
            BetweenUsField(
                label = if (isPassword) "Password" else "Recovery passphrase",
                value = secret,
                onValueChange = { secret = it; note = null },
                placeholder = if (isPassword) "Your account password" else "Your passphrase",
                secret = true,
                imeAction = ImeAction.Done,
                enabled = !busy,
                onImeAction = { },
            )

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            BetweenUsButton(
                text = "Unlock",
                busy = busy,
                enabled = secret.isNotBlank(),
                onClick = {
                    scope.launch {
                        busy = true
                        note = runCatching {
                            E2ee.unlock(
                                if (isPassword) {
                                    BackupSecret.password(secret)
                                } else {
                                    BackupSecret.passphrase(secret)
                                },
                            )
                            secret = ""
                            onDismiss()
                        }.exceptionOrNull()?.message
                        busy = false
                    }
                },
            )

            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Not now",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate500,
                )
            }
        }
    }
}
