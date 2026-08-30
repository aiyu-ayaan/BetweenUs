package com.aatech.betweenus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage

/**
 * The picture behind an avatar, full size, with the name under it.
 *
 * One holder for the whole app rather than a dialog per avatar: every [Avatar]
 * that stands for a person asks this to open, and [ProfileDialogHost] - mounted
 * once at the root - is what answers. Somebody with no picture never gets here;
 * the avatar says so with a toast instead of opening a dialog showing the same
 * initial that was just tapped.
 */
object ProfileViewer {
    data class Profile(val name: String, val url: String)

    var shown: Profile? by mutableStateOf(null)
        private set

    fun open(name: String, url: String) {
        shown = Profile(name, url)
    }

    fun close() {
        shown = null
    }
}

@Composable
fun ProfileDialogHost() {
    val profile = ProfileViewer.shown ?: return
    Dialog(onDismissRequest = { ProfileViewer.close() }) {
        Column(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AsyncImage(
                model = profile.url,
                contentDescription = "${profile.name}'s profile photo",
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(16.dp)),
            )
            Text(
                text = profile.name,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 16.dp),
            )
            TextButton(onClick = { ProfileViewer.close() }) { Text("Close") }
        }
    }
}
