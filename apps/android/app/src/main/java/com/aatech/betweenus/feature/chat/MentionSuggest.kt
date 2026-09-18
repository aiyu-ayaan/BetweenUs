package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface900

sealed interface MentionOption {
    val username: String
    val displayName: String

    data class Broadcast(
        override val username: String,
        override val displayName: String,
        val description: String,
    ) : MentionOption

    data class Member(
        val member: ServerMember,
    ) : MentionOption {
        override val username: String get() = member.username
        override val displayName: String get() = member.displayName.ifBlank { member.username }
    }
}

private fun rankMember(option: MentionOption.Member, needle: String): Int {
    if (needle.isEmpty()) return 0
    val u = option.username.lowercase()
    val d = option.displayName.lowercase()
    return when {
        u == needle || d == needle -> 0
        u.startsWith(needle) || d.startsWith(needle) -> 1
        else -> 2
    }
}

fun filterMentions(
    term: String,
    members: List<ServerMember>,
    isDirect: Boolean,
): List<MentionOption> {
    val needle = term.trim().trimStart('@').lowercase()

    val broadcasts = if (isDirect) {
        emptyList()
    } else {
        listOf(
            MentionOption.Broadcast("everyone", "@everyone", "Notify everyone in this channel"),
            MentionOption.Broadcast("here", "@here", "Notify active members"),
        ).filter { it.username.contains(needle) || needle.isEmpty() }
    }

    val memberOptions = members
        .map { MentionOption.Member(it) }
        .filter {
            needle.isEmpty() ||
                it.username.lowercase().contains(needle) ||
                it.displayName.lowercase().contains(needle)
        }
        .sortedWith(
            compareBy<MentionOption.Member> { rankMember(it, needle) }
                .thenBy(String.CASE_INSENSITIVE_ORDER) { it.displayName }
                .thenBy(String.CASE_INSENSITIVE_ORDER) { it.username }
        )

    return (broadcasts + memberOptions).take(12)
}

@Composable
fun MentionSuggestPopup(
    query: MentionQuery,
    members: List<ServerMember>,
    isDirect: Boolean,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val filtered = remember(query.term, members, isDirect) {
        filterMentions(query.term, members, isDirect)
    }

    if (filtered.isEmpty()) return

    Surface(
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        color = Surface900,
        shadowElevation = 8.dp,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(max = 240.dp),
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
        ) {
            items(filtered, key = { it.username }) { option ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(option.username) }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    when (option) {
                        is MentionOption.Broadcast -> {
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(CircleShape)
                                    .background(Accent.copy(alpha = 0.2f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                BetweenUsIcon(
                                    icon = BetweenUsIcons.Users,
                                    tint = Accent,
                                    size = 20.dp,
                                    contentDescription = option.displayName,
                                )
                            }
                        }

                        is MentionOption.Member -> {
                            val avatarUrl = option.member.avatarUrl?.let { Endpoint.absolute(it) }
                            if (avatarUrl != null) {
                                AsyncImage(
                                    model = avatarUrl,
                                    contentDescription = option.displayName,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .size(38.dp)
                                        .clip(CircleShape),
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(38.dp)
                                        .clip(CircleShape)
                                        .background(Surface800),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        text = option.displayName.take(1).uppercase(),
                                        color = Slate100,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp,
                                    )
                                }
                            }
                        }
                    }

                    Spacer(Modifier.width(12.dp))

                    Column(Modifier.weight(1f)) {
                        Text(
                            text = option.displayName,
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = Slate100,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = when (option) {
                                is MentionOption.Broadcast -> option.description
                                is MentionOption.Member -> "@${option.username}"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate400,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
