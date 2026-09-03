package com.aatech.betweenus.feature.servers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.Webhook
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.ui.components.BetweenUsField
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.Chip
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate500
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * A server's webhooks: the URLs outside systems post into its channels with.
 *
 * One list across every channel rather than a panel inside each - "which robots
 * can write in this server, and where" is one question, and a per-channel panel
 * makes somebody open eleven channels to answer it. The desktop's Webhooks page
 * makes the same choice for the same reason.
 *
 * Two things here are unusual, and both are deliberate.
 *
 * The URL is shown **once**, when it is created or rotated, because the server
 * keeps only a hash of the token. That is a worse first run than Discord's
 * re-readable URLs and a much better one than a database dump handing over
 * every integration a deployment has. The way back is Rotate, which is why it
 * sits on every row rather than behind a menu.
 *
 * And this panel says, in as many words, that a webhook's messages are not
 * encrypted - before the button rather than after it. Everything else in this
 * app is sealed on the device that wrote it; a webhook cannot be, because
 * whatever posts through it holds no key. Somebody adding one is spending that
 * guarantee for that channel, and being told by noticing a badge a week later
 * is not being told.
 */
@Composable
fun WebhookSection(
    serverId: String,
    mayManage: Boolean,
    onNote: (String?) -> Unit,
) {
    // Nothing to show and nothing to offer: the endpoints would refuse anyway,
    // and a section of disabled controls is a worse answer than no section.
    if (!mayManage) return

    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val channelsByServer by Workspace.channels.collectAsState()

    // A voice channel has no message history to post into.
    val channels = remember(channelsByServer, serverId) {
        channelsByServer[serverId].orEmpty().filter { it.type == ChannelType.TEXT }
    }

    var hooks by remember { mutableStateOf<List<Webhook>?>(null) }
    var name by remember { mutableStateOf("") }
    var target by remember(channels) { mutableStateOf(channels.firstOrNull()?.id) }
    var busy by remember { mutableStateOf(false) }

    /** The URL of whatever was just created or rotated. Shown once, then gone. */
    var minted by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        // One request per channel: the permission guarding this is a channel
        // permission, so a server-wide answer would have to be filtered back
        // down to exactly this. A channel this account cannot manage answers
        // 403, which is not an error here - it is a channel contributing
        // nothing to the list.
        hooks = channels.flatMap { channel ->
            runCatching { BetweenUsApi.webhooks(channel.id) }.getOrDefault(emptyList())
        }
    }

    LaunchedEffect(channels.map { it.id }) { reload() }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            onNote(runCatching { block() }.exceptionOrNull()?.message)
            busy = false
        }
    }

    SectionLabel("Webhooks")

    Column(Modifier.padding(horizontal = 16.dp)) {
        Text(
            text = "A URL another system can post into a channel with — a build server, an " +
                "alerting stack, anything that can make an HTTP request. It uses the same " +
                "request shape Discord does, so an integration already pointed at Discord " +
                "works by changing only the URL.",
            style = MaterialTheme.typography.bodyMedium,
            color = Slate500,
        )

        Spacer(Modifier.height(12.dp))

        // Said before the button rather than discovered afterwards.
        Column(
            Modifier
                .fillMaxWidth()
                .background(Danger.copy(alpha = 0.10f), RoundedCornerShape(12.dp))
                .padding(12.dp),
        ) {
            Text(
                text = "Webhook messages are not encrypted",
                style = MaterialTheme.typography.labelLarge,
                color = Slate100,
            )
            Text(
                text = "Everything people write here is sealed on their own device and this " +
                    "deployment cannot read it. A webhook has no key and cannot be given one — " +
                    "handing a channel key to a script would hand away the channel — so what " +
                    "it posts is stored in the clear. Every client marks those messages.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        minted?.let { url ->
            Spacer(Modifier.height(12.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                        RoundedCornerShape(12.dp),
                    )
                    .padding(12.dp),
            ) {
                Text(
                    text = "Copy this URL now — it is not shown again",
                    style = MaterialTheme.typography.labelLarge,
                    color = Slate100,
                )
                Text(
                    text = url,
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate500,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip(
                        text = "Copy",
                        onClick = { clipboard.setText(AnnotatedString(url)) },
                    )
                    Chip(text = "Done", onClick = { minted = null })
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        BetweenUsField(
            label = "New webhook name",
            value = name,
            onValueChange = { name = it },
            placeholder = "Deploys",
            enabled = !busy,
        )

        if (channels.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                channels.take(6).forEach { channel ->
                    Chip(
                        text = "#${channel.name}",
                        selected = channel.id == target,
                        onClick = { target = channel.id },
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        Chip(
            text = if (busy) "Working…" else "Create webhook",
            onClick = {
                val channelId = target ?: return@Chip
                if (busy || name.isBlank()) return@Chip
                act {
                    minted = BetweenUsApi.createWebhook(channelId, name.trim()).url
                    name = ""
                    reload()
                }
            },
        )
    }

    val list = hooks
    if (list == null) {
        ListRow(title = "Loading webhooks", leading = { BetweenUsIcon(BetweenUsIcons.Globe) })
    } else if (list.isEmpty()) {
        ListRow(
            title = "No webhooks",
            subtitle = "Nothing posts into this server from outside it",
            leading = { BetweenUsIcon(BetweenUsIcons.Globe) },
        )
    } else {
        list.forEach { hook ->
            val channel = channels.firstOrNull { it.id == hook.channelId }
            ListRow(
                title = hook.name,
                subtitle = "#${channel?.name ?: "a channel you cannot see"} · ${lastUsed(hook)}",
                leading = { BetweenUsIcon(BetweenUsIcons.Globe) },
                trailing = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip(
                            text = "Rotate",
                            onClick = {
                                act {
                                    minted = BetweenUsApi.rotateWebhook(hook.id).url
                                    reload()
                                }
                            },
                        )
                        Chip(
                            text = "Delete",
                            tone = Danger,
                            onClick = {
                                act {
                                    BetweenUsApi.deleteWebhook(hook.id)
                                    reload()
                                }
                            },
                        )
                    }
                },
            )
        }
    }
}

/** The first thing anybody asks about a webhook that "isn't working". */
private fun lastUsed(hook: Webhook): String {
    val at = hook.lastUsedAt ?: return "never used"
    return runCatching {
        val when0 = Instant.parse(at).atZone(ZoneId.systemDefault())
        "last used " + DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).format(when0)
    }.getOrDefault("used")
}
