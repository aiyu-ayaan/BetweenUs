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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.toColorInt
import coil.compose.AsyncImage
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.ServerCustomRole
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

    /**
     * A custom role of this server.
     *
     * [username] is the role's own name, spaces and all: it is what gets
     * written into the composer, and `PushGate.mentions` matches a role name
     * exactly as it matches a display name. Deliberately not an id - an id in
     * the body would be unreadable on a client that had not fetched the roles,
     * and a message whose meaning needs a second fetch reads as gibberish
     * offline.
     */
    data class Role(
        val role: ServerCustomRole,
    ) : MentionOption {
        override val username: String get() = role.name
        override val displayName: String get() = "@${role.name}"
    }

    data class Member(
        val member: ServerMember,
    ) : MentionOption {
        override val username: String get() = member.username
        override val displayName: String get() = member.displayName.ifBlank { member.username }
    }
}

private val ServerMember.id: String get() = userId

private fun rankRole(option: MentionOption.Role, needle: String): Int {
    if (needle.isEmpty()) return 0
    val name = option.role.name.lowercase()
    return when {
        name == needle -> 0
        name.startsWith(needle) -> 1
        else -> 2
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

/**
 * Broadcasts first, then this server's roles, then its members.
 *
 * Roles sit above the members because a role is the rarer and more deliberate
 * choice, and typing four letters should not bury it under everybody whose name
 * happens to contain them. A conversation has neither a broadcast nor a role.
 */
fun filterMentions(
    term: String,
    members: List<ServerMember>,
    isDirect: Boolean,
    roles: List<ServerCustomRole> = emptyList(),
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

    val roleOptions = if (isDirect) {
        emptyList()
    } else {
        roles
            .map { MentionOption.Role(it) }
            .filter { needle.isEmpty() || it.role.name.lowercase().contains(needle) }
            .sortedWith(
                compareBy<MentionOption.Role> { rankRole(it, needle) }
                    .thenBy(String.CASE_INSENSITIVE_ORDER) { it.role.name }
            )
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

    return (broadcasts + roleOptions + memberOptions).take(12)
}

@Composable
fun MentionSuggestPopup(
    query: MentionQuery,
    members: List<ServerMember>,
    isDirect: Boolean,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
    roles: List<ServerCustomRole> = emptyList(),
) {
    val filtered = remember(query.term, members, isDirect, roles) {
        filterMentions(query.term, members, isDirect, roles)
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
            items(
                items = filtered,
                key = { option ->
                    when (option) {
                        is MentionOption.Broadcast -> "b:${option.username}"
                        is MentionOption.Role -> "r:${option.role.id}"
                        is MentionOption.Member -> "m:${option.member.id.ifBlank { option.member.userId }}"
                    }
                },
            ) { option ->
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

                        // The role's own colour, so the menu reads the way the
                        // member list does; a role with none falls back to the
                        // accent rather than to nothing.
                        is MentionOption.Role -> {
                            val tint = option.role.colour?.let { runCatching { Color(it.toColorInt()) }.getOrNull() }
                                ?: Accent
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(CircleShape)
                                    .background(tint.copy(alpha = 0.2f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                BetweenUsIcon(
                                    icon = BetweenUsIcons.Users,
                                    tint = tint,
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
                                is MentionOption.Role ->
                                    if (option.role.memberCount == 1) "Role · 1 member"
                                    else "Role · ${option.role.memberCount} members"
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
