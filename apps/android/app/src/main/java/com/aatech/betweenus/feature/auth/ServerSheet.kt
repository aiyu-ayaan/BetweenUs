package com.aatech.betweenus.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.AuthPhase
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.ui.components.GlobeIcon
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.findActivity
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.StatusIdle
import com.aatech.betweenus.ui.theme.Surface900
import kotlinx.coroutines.launch

/**
 * Points this install at a different deployment.
 *
 * The port of `apps/desktop/src/features/auth/ServerPicker.tsx`. BetweenUs is
 * meant to be self-hosted, so the address the build shipped with is a default
 * and not a decision. The address is checked before it is stored - a typo
 * should be a line under the field, not an app that no longer starts.
 *
 * Switching signs this device out: tokens and every id in them belong to the
 * deployment that issued them and mean nothing on another one. The activity is
 * then recreated, which is the honest way to get every store and screen to let
 * go of the old server at once - the desktop client reloads its window for the
 * same reason.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerSheet(onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // Not a cast: a modal bottom sheet composes into its own window, so the
    // context here is wrapped and `as? Activity` is null. See findActivity.
    val activity = LocalContext.current.findActivity()

    var address by remember { mutableStateOf(Endpoint.current()) }
    var note by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    val phase by Session.state.collectAsState()
    val signedIn = phase is AuthPhase.SignedIn

    fun connect(raw: String) {
        busy = true
        note = null
        scope.launch {
            try {
                // What the probe answers on, not what was typed: a redirect to
                // another origin would strip the Authorization header off every
                // later request.
                val base = Endpoint.probe(Endpoint.normalize(raw))

                // Ends the session on the server being left, while it can still
                // be reached; a no-op when nobody is signed in.
                Session.signOut()
                // Another server is another account: the pictures decrypted
                // for this one do not follow it there.
                com.aatech.betweenus.feature.chat.MediaCache.clear()
                Endpoint.set(if (base == Endpoint.default()) null else base)
                activity?.recreate()
            } catch (error: Exception) {
                note = error.message ?: "That address did not work"
                busy = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Surface900,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp),
        ) {
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                GlobeIcon(tint = Accent, modifier = Modifier.padding(top = 4.dp))
                Column {
                    Text(
                        text = "Connect to a server",
                        style = MaterialTheme.typography.titleMedium,
                        color = Slate50,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "The address of the BetweenUs deployment this app talks to. " +
                            "Everything else - chat, voice, files - is behind it.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            BetweenUsField(
                label = "Server address",
                value = address,
                onValueChange = {
                    address = it
                    note = null
                },
                placeholder = "betweenus.example.com",
                keyboardType = KeyboardType.Uri,
                imeAction = ImeAction.Go,
                enabled = !busy,
                onImeAction = { connect(address) },
            )

            Spacer(Modifier.height(8.dp))
            Text(
                text = buildString {
                    append("No http:// means https://. This one is currently ")
                    append(Endpoint.current())
                    if (Endpoint.isDefault()) append(", the default this app was built with")
                    append(".")
                },
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
            )

            if (signedIn) {
                Spacer(Modifier.height(12.dp))
                Notice("Connecting somewhere else signs you out of this server.", StatusIdle)
            }

            note?.let {
                Spacer(Modifier.height(12.dp))
                Notice(it, Danger)
            }

            Spacer(Modifier.height(16.dp))
            BetweenUsButton(
                text = if (busy) "Checking…" else "Connect",
                onClick = { connect(address) },
                busy = busy,
            )

            if (!Endpoint.isDefault()) {
                TextButton(
                    onClick = { connect(Endpoint.default()) },
                    enabled = !busy,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                ) {
                    Text(
                        text = "Back to ${Endpoint.default()}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Slate400,
                    )
                }
            }
        }
    }
}
