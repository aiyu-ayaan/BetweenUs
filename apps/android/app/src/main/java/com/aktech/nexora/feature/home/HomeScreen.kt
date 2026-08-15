package com.aktech.nexora.feature.home

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aktech.nexora.core.data.Endpoint
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.data.Session
import com.aktech.nexora.ui.components.NexoraLogoTile
import com.aktech.nexora.ui.theme.Danger
import com.aktech.nexora.ui.theme.Edge
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.StatusOnline
import com.aktech.nexora.ui.theme.Surface900
import kotlinx.coroutines.launch

/**
 * Where a signed-in account lands.
 *
 * It is a placeholder on purpose: servers, channels and messages are phase 3
 * in development/ANDROID_TODO.md. What it does prove is the part phase 2 is
 * about - that the session survives, that it is the right account, and that it
 * came from the deployment this install is pointed at.
 */
@Composable
fun HomeScreen(user: PublicUser) {
    val scope = rememberCoroutineScope()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Ground)
            .systemBarsPadding()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, Edge, RoundedCornerShape(20.dp))
                .background(Surface900, RoundedCornerShape(20.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            NexoraLogoTile()
            Spacer(Modifier.height(16.dp))
            Text(
                text = "Signed in as ${user.displayName.ifBlank { user.username }}",
                style = MaterialTheme.typography.titleMedium,
                color = Slate50,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(4.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(Modifier.size(8.dp).background(StatusOnline, CircleShape))
                Text(
                    text = "@${user.username} on ${Endpoint.label()}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate400,
                )
            }

            Spacer(Modifier.height(20.dp))
            Text(
                text = "Servers, channels and messages land next. This screen is here to " +
                    "prove the session, not to be the app.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(8.dp))
            TextButton(
                onClick = { scope.launch { Session.signOut() } },
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Text(
                    text = "Sign out",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Danger,
                )
            }
        }
    }
}
