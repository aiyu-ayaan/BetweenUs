package com.aatech.betweenus.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.TextButton
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import com.aatech.betweenus.core.data.ChannelCategory
import com.aatech.betweenus.core.data.ChannelSection
import com.aatech.betweenus.core.data.layoutFrom
import com.aatech.betweenus.core.data.sameLayout
import com.aatech.betweenus.core.data.stepCategory
import com.aatech.betweenus.core.data.stepChannel
import com.aatech.betweenus.core.store.CollapsedCategories
import com.aatech.betweenus.ui.components.Notice
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Channel
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.channelSections
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.data.Session
import com.aatech.betweenus.core.data.ServerWithRole
import com.aatech.betweenus.core.data.PresenceStatus
import com.aatech.betweenus.core.store.Drafts
import com.aatech.betweenus.core.store.Presence
import com.aatech.betweenus.core.store.Statuses
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.feature.servers.CategoryNameSheet
import com.aatech.betweenus.feature.servers.CreateChannelSheet
import com.aatech.betweenus.feature.servers.JoinOrCreateServerSheet
import com.aatech.betweenus.ui.components.AvatarWithStatus
import com.aatech.betweenus.ui.components.Badge
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.components.ListRow
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.SectionLabel
import com.aatech.betweenus.ui.components.ServerTile

/**
 * The two left panels of the desktop, folded into one drawer: the server rail
 * down the side, and the channels of whichever server is selected beside it.
 */
@Composable
fun WorkspaceDrawer(
    user: PublicUser,
    servers: List<ServerWithRole>,
    selectedServerId: String?,
    selectedChannelId: String?,
    onSelectServer: (String?) -> Unit,
    onSelectChannel: (Channel) -> Unit,
    onOpenSwitcher: () -> Unit,
    onHome: () -> Unit,
    onSettings: () -> Unit,
    onServerSettings: () -> Unit,
    onStatus: () -> Unit,
    onRemote: () -> Unit,
    onActivities: () -> Unit,
) {
    var addingServer by remember { mutableStateOf(false) }
    /** The create-channel sheet: null closed, false starting on Text, true on Voice. */
    var addingChannel by remember { mutableStateOf<Boolean?>(null) }
    /** The category the create-channel sheet files into; null for the loose list. */
    var addingChannelIn by remember { mutableStateOf<ChannelCategory?>(null) }
    /** The category-name sheet: closed, making one, or renaming this one. */
    var namingCategory by remember { mutableStateOf<CategoryNaming?>(null) }
    var deletingCategory by remember { mutableStateOf<ChannelCategory?>(null) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var deleteBusy by remember { mutableStateOf(false) }
    var createMenu by remember { mutableStateOf(false) }

    val channels by Workspace.channels.collectAsState()
    val categories by Workspace.categories.collectAsState()
    // Which categories this account has folded in this server, on this device.
    // Kept across launches and forgotten at sign-out - see `CollapsedCategories`.
    var collapsed by remember(user.id, selectedServerId) {
        mutableStateOf(selectedServerId?.let { CollapsedCategories.folded(user.id, it) }.orEmpty())
    }
    val scope = rememberCoroutineScope()
    /** Why the last rearrangement was refused. It has been put back already. */
    var arrangeError by remember(selectedServerId) { mutableStateOf<String?>(null) }
    val unread by Workspace.unread.collectAsState()
    val drafted by Drafts.drafted.collectAsState()
    LaunchedEffect(Unit) { Drafts.load() }
    val self by Presence.self.collectAsState()
    val statusRuns by Statuses.runs.collectAsState()

    val server = servers.firstOrNull { it.id == selectedServerId }
    val canArrange = server?.can("MANAGE_CHANNEL") == true
    val sections = server?.let {
        channelSections(categories[it.id].orEmpty(), channels[it.id].orEmpty())
    }.orEmpty()

    /**
     * Saves a rearrangement. Drawn at once (see `Workspace.arrangeChannels`);
     * a refusal puts the list back and says why above it.
     */
    fun arrange(next: List<ChannelSection>) {
        val serverId = server?.id ?: return
        if (sameLayout(sections, next)) return
        arrangeError = null
        scope.launch {
            runCatching { Workspace.arrangeChannels(serverId, layoutFrom(next)) }
                .onFailure { arrangeError = it.message ?: "The channels could not be rearranged" }
        }
    }

    /** Up and down for one channel, each null where the step would change nothing. */
    fun channelMoves(channel: Channel): Moves? {
        if (!canArrange) return null
        val up = stepChannel(sections, channel.id, -1)
        val down = stepChannel(sections, channel.id, 1)
        return Moves(
            up = if (sameLayout(sections, up)) null else { { arrange(up) } },
            down = if (sameLayout(sections, down)) null else { { arrange(down) } },
        )
    }

    fun categoryMoves(category: ChannelCategory): Moves? {
        if (!canArrange) return null
        val up = stepCategory(sections, category.id, -1)
        val down = stepCategory(sections, category.id, 1)
        return Moves(
            up = if (sameLayout(sections, up)) null else { { arrange(up) } },
            down = if (sameLayout(sections, down)) null else { { arrange(down) } },
            more = listOf(
                MenuEntry("Add text channel") { addingChannelIn = category; addingChannel = false },
                MenuEntry("Add voice channel") { addingChannelIn = category; addingChannel = true },
                MenuEntry("Rename category") { namingCategory = CategoryNaming(category) },
                MenuEntry("Delete category") { deleteError = null; deletingCategory = category },
            ),
        )
    }

    LaunchedEffect(selectedServerId) {
        selectedServerId?.let {
            Workspace.loadChannels(it)
            // Names for whoever is sitting in a voice channel.
            Workspace.loadMembers(it)
        }
    }

    Row(Modifier.fillMaxSize().systemBarsPadding()) {
        // --- the rail ---
        Column(
            modifier = Modifier
                .width(68.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.surfaceContainerLowest)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Home is the rail's first tile and reads as one: filled when it
            // is where you are, quiet when it is not, so "which of these am I
            // in" is answered the same way for the DM list as for a server.
            IconAction(
                icon = BetweenUsIcons.Message,
                contentDescription = "Direct messages",
                onClick = onHome,
                prominent = selectedServerId == null,
            )
            HorizontalDivider(
                Modifier.width(28.dp),
                color = MaterialTheme.colorScheme.outlineVariant,
            )

            servers.forEach { entry ->
                ServerTile(
                    id = entry.id,
                    name = entry.name,
                    iconUrl = entry.iconUrl?.let { com.aatech.betweenus.core.data.Endpoint.absolute(it) },
                    selected = entry.id == selectedServerId,
                    unread = Workspace.unreadOfServer(entry.id),
                    onClick = { onSelectServer(entry.id) },
                )
            }

            IconAction(
                icon = BetweenUsIcons.Plus,
                contentDescription = "Add a server",
                onClick = { addingServer = true },
            )
            // Statuses sit on the rail rather than in the conversation list:
            // they are a place to go, not a conversation, and a row that came
            // and went as people posted would move the list under a thumb. The
            // dot is the same count the rings say - how many people have
            // something unwatched, not how many pictures there are.
            Box {
                IconAction(
                    icon = BetweenUsIcons.Activity,
                    contentDescription = "Moments",
                    onClick = onStatus,
                )
                val unwatched = statusRuns.count { it.unseen }
                if (unwatched > 0) {
                    Badge(count = unwatched, modifier = Modifier.align(Alignment.TopEnd))
                }
            }
            // Activities (Calls & Data) used to be three taps deep in
            // Settings. It sits beside Moments now for the same reason
            // Moments is here rather than in a menu: both are places you go,
            // not settings you set.
            IconAction(
                icon = BetweenUsIcons.Phone,
                contentDescription = "Calls & Data",
                onClick = onActivities,
            )
            IconAction(
                icon = BetweenUsIcons.Monitor,
                contentDescription = "Remote machines",
                onClick = onRemote,
            )
        }

        // --- channels of the selected server, or the DM list ---
        Column(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.surfaceContainerLow),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = server?.name ?: "Direct messages",
                    style = MaterialTheme.typography.titleLargeEmphasized,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                // Always here, on the DM list as well as on a server: it is
                // the one control in this drawer that reaches somewhere the
                // drawer is not currently showing, which is the whole of what
                // it is for.
                IconAction(
                    icon = BetweenUsIcons.Search,
                    contentDescription = "Go to a conversation, channel or server",
                    onClick = onOpenSwitcher,
                )
                // Invites used to live two screens away - the drawer, then
                // account settings, then server settings - which is a long way
                // to walk to answer "how do I add somebody". It is one tap from
                // the server whose invite it would be.
                if (server != null && server.can("MANAGE_MEMBER")) {
                    IconAction(
                        icon = BetweenUsIcons.UserPlus,
                        contentDescription = "Invite people",
                        onClick = onServerSettings,
                    )
                }
                if (server != null && server.can("MANAGE_CHANNEL")) {
                    Box {
                        IconAction(
                            icon = BetweenUsIcons.Plus,
                            contentDescription = "Create a channel or category",
                            onClick = { createMenu = true },
                        )
                        DropdownMenu(expanded = createMenu, onDismissRequest = { createMenu = false }) {
                            DropdownMenuItem(
                                text = { Text("Create a channel") },
                                onClick = {
                                    createMenu = false
                                    addingChannelIn = null
                                    addingChannel = false
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Create a category") },
                                onClick = {
                                    createMenu = false
                                    namingCategory = CategoryNaming(null)
                                },
                            )
                        }
                    }
                }
            }
            arrangeError?.let {
                Notice(it, MaterialTheme.colorScheme.error, Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            }
            LazyColumn(Modifier.weight(1f)) {
                if (server == null) {
                    item { DirectMessageList(onSelectChannel = { onSelectChannel(it) }) }
                } else {
                    /** One channel, text or voice, with its moves for a manager. */
                    val row: @Composable (Channel) -> Unit = { channel ->
                        val moves = channelMoves(channel)
                        if (channel.type == ChannelType.VOICE) {
                            VoiceChannelBlock(channel, channel.id == selectedChannelId, moves) {
                                onSelectChannel(channel)
                            }
                        } else {
                            ChannelRow(
                                channel,
                                channel.id == selectedChannelId,
                                unread[channel.id] ?: 0,
                                drafted = channel.id != selectedChannelId && channel.id in drafted,
                                moves = moves,
                            ) {
                                onSelectChannel(channel)
                            }
                        }
                    }
                    val hasCategories = sections.any { it.category != null }

                    for (section in sections) {
                        val category = section.category

                        if (category == null) {
                            // The loose channels, drawn the way the list was
                            // before categories and the way the desktop draws
                            // them: a text list and a voice list under their
                            // own headings, the categories after both.
                            val (voice, text) = section.channels.partition { it.type == ChannelType.VOICE }
                            item(key = "heading-text") {
                                LooseHeading(
                                    label = "Text channels",
                                    createLabel = "Create text channel".takeIf { canArrange },
                                    onCreate = { addingChannelIn = null; addingChannel = false },
                                )
                            }
                            items(text, key = { it.id }) { row(it) }
                            if (text.isEmpty() && !hasCategories) {
                                item(key = "empty-text") { EmptyLine("No text channels yet") }
                            }
                            item(key = "heading-voice") {
                                LooseHeading(
                                    label = "Voice channels",
                                    createLabel = "Create voice channel".takeIf { canArrange },
                                    onCreate = { addingChannelIn = null; addingChannel = true },
                                )
                            }
                            items(voice, key = { it.id }) { row(it) }
                            if (voice.isEmpty() && !hasCategories) {
                                item(key = "empty-voice") { EmptyLine("No voice channels yet") }
                            }
                            continue
                        }

                        val folded = category.id in collapsed
                        item(key = "category-${category.id}") {
                            CategoryHeader(
                                name = category.name,
                                folded = folded,
                                // A folded heading still says something
                                // happened, and that you are inside it.
                                unread = if (folded) section.channels.sumOf { unread[it.id] ?: 0 } else 0,
                                containsSelected = folded && section.channels.any { it.id == selectedChannelId },
                                moves = categoryMoves(category),
                                onToggle = {
                                    collapsed = CollapsedCategories.toggle(user.id, server.id, category.id)
                                },
                            )
                        }

                        // A folded category still shows the channel you are in.
                        val visible = if (folded) {
                            section.channels.filter { it.id == selectedChannelId }
                        } else {
                            section.channels
                        }
                        items(visible, key = { it.id }) { row(it) }
                    }
                }
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ListRow(
                title = user.label,
                subtitle = listOfNotNull(user.handle, self.wire).joinToString(" · "),
                leading = {
                    AvatarWithStatus(
                        id = user.id,
                        label = user.label,
                        url = user.avatarUrl?.let { com.aatech.betweenus.core.data.Endpoint.absolute(it) },
                        status = self.wire,
                        size = 34.dp,
                    )
                },
                trailing = {
                    IconAction(
                        icon = BetweenUsIcons.Settings,
                        contentDescription = "Settings",
                        onClick = onSettings,
                    )
                },
                onClick = onSettings,
            )
        }
    }

    if (addingServer) {
        JoinOrCreateServerSheet(
            onDismiss = { addingServer = false },
            onDone = { onSelectServer(it.id) },
        )
    }
    val voice = addingChannel
    if (voice != null && server != null) {
        CreateChannelSheet(
            server = server,
            onDismiss = { addingChannel = null; addingChannelIn = null },
            initialVoice = voice,
            category = addingChannelIn,
        )
    }
    val naming = namingCategory
    if (naming != null && server != null) {
        CategoryNameSheet(server = server, category = naming.category, onDismiss = { namingCategory = null })
    }
    val doomed = deletingCategory
    if (doomed != null && server != null) {
        // Says what happens to the channels: the fear with "delete" is losing them.
        AlertDialog(
            onDismissRequest = { if (!deleteBusy) deletingCategory = null },
            title = { Text("Delete ${doomed.name}?") },
            text = {
                Text(
                    "Its channels are not deleted. They move to the uncategorized channels, " +
                        "outside any category." + (deleteError?.let { "\n\n$it" } ?: ""),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !deleteBusy,
                    onClick = {
                        deleteBusy = true
                        scope.launch {
                            val failure = runCatching { Workspace.deleteCategory(server.id, doomed.id) }
                                .exceptionOrNull()
                            deleteBusy = false
                            if (failure == null) deletingCategory = null else deleteError = Session.messageOf(failure)
                        }
                    },
                ) { Text("Delete category") }
            },
            dismissButton = {
                TextButton(enabled = !deleteBusy, onClick = { deletingCategory = null }) { Text("Cancel") }
            },
        )
    }
}

/**
 * A manager's two steps for one row, each null where it would change nothing.
 * Offered twice: as the long-press menu, and as screen-reader actions on the
 * row itself, so moving never depends on seeing or holding anything.
 */
private class Moves(
    val up: (() -> Unit)?,
    val down: (() -> Unit)?,
    /** More entries after the two moves - a category heading's rename, delete and add-channel. */
    val more: List<MenuEntry> = emptyList(),
) {
    fun accessibilityActions(): List<CustomAccessibilityAction> = listOfNotNull(
        up?.let { move -> CustomAccessibilityAction("Move up") { move(); true } },
        down?.let { move -> CustomAccessibilityAction("Move down") { move(); true } },
    ) + more.map { entry -> CustomAccessibilityAction(entry.label) { entry.run(); true } }
}

private class MenuEntry(val label: String, val run: () -> Unit)

/** What the category-name sheet is for: [category] null makes one, otherwise renames it. */
private class CategoryNaming(val category: ChannelCategory?)

/** The long-press menu: Move up, Move down, then any [Moves.more]. */
@Composable
private fun MoveMenu(expanded: Boolean, moves: Moves, onDismiss: () -> Unit) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text("Move up") },
            enabled = moves.up != null,
            onClick = {
                onDismiss()
                moves.up?.invoke()
            },
        )
        DropdownMenuItem(
            text = { Text("Move down") },
            enabled = moves.down != null,
            onClick = {
                onDismiss()
                moves.down?.invoke()
            },
        )
        moves.more.forEach { entry ->
            DropdownMenuItem(
                text = { Text(entry.label) },
                onClick = {
                    onDismiss()
                    entry.run()
                },
            )
        }
    }
}

/** TEXT CHANNELS / VOICE CHANNELS over the loose lists, with a create button for a manager. */
@Composable
private fun LooseHeading(label: String, createLabel: String?, onCreate: () -> Unit) {
    SectionLabel(
        text = label,
        trailing = createLabel?.let {
            {
                IconAction(
                    icon = BetweenUsIcons.Plus,
                    contentDescription = it,
                    onClick = onCreate,
                    compact = true,
                )
            }
        },
    )
}

@Composable
private fun EmptyLine(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 22.dp, vertical = 6.dp),
    )
}

/**
 * One person sitting in a voice channel, under its row.
 *
 * The count alone was no use: "1 in the room" does not say whether the room is
 * worth joining, and the web has said who all along. Indented to the width of
 * the channel icon, so the list reads as belonging to the channel above it.
 */
/**
 * A voice channel row with its occupants underneath. Presence gives user ids;
 * the member list of the server is what turns them into people. Without that a
 * voice channel could only say how many were in it, which is the one thing you
 * can already see.
 */
@Composable
private fun VoiceChannelBlock(channel: Channel, selected: Boolean, moves: Moves?, onOpen: () -> Unit) {
    // Collected, not read: `Presence.voiceMembers()` returns the value at the
    // moment it is called, so a room that fills up after this was drawn never
    // redrew it.
    val voiceRooms by Presence.voice.collectAsState()
    val members by Workspace.members.collectAsState()
    val inRoom = voiceRooms[channel.id].orEmpty()
    val roster = members[channel.serverId].orEmpty()
    val occupants = inRoom.map { id -> id to roster.firstOrNull { it.userId == id } }
    val occupied = occupants.isNotEmpty()

    // A card, tinted, only while somebody is actually here - an empty channel
    // stays a plain row.
    Column(
        modifier = if (occupied) {
            Modifier
                .padding(horizontal = 4.dp, vertical = 2.dp)
                .background(
                    MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.35f),
                    RoundedCornerShape(12.dp),
                )
                .padding(vertical = 2.dp)
        } else {
            Modifier
        },
    ) {
        ChannelRow(
            channel = channel,
            selected = selected,
            unread = 0,
            subtitle = if (inRoom.isEmpty()) null else "${inRoom.size} in the room",
            moves = moves,
        ) { onOpen() }

        for ((id, member) in occupants) VoiceMember(id, member)
    }
}

/** A category heading that folds. Announced as a button with its state. */
@Composable
private fun CategoryHeader(
    name: String,
    folded: Boolean,
    unread: Int,
    containsSelected: Boolean,
    moves: Moves?,
    onToggle: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .semantics { if (moves != null) customActions = moves.accessibilityActions() }
            .combinedClickable(
                onClickLabel = if (folded) "Expand $name" else "Collapse $name",
                onLongClickLabel = if (moves != null) "Manage $name" else null,
                onLongClick = if (moves != null) { { menu = true } } else null,
                onClick = onToggle,
            )
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (moves != null) MoveMenu(menu, moves) { menu = false }
        Text(
            text = (if (folded) "\u25B8 " else "\u25BE ") + name.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (unread > 0) Badge(unread)
        else if (containsSelected) Text("\u2022", color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun VoiceMember(userId: String, member: com.aatech.betweenus.core.data.ServerMember?) {
    val name = member?.label ?: "Someone"
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 44.dp, end = 12.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Avatar(
            id = userId,
            label = name,
            url = member?.avatarUrl?.let { com.aatech.betweenus.core.data.Endpoint.absolute(it) },
            size = 20.dp,
            viewable = false,
        )
        Text(
            text = name,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ChannelRow(
    channel: Channel,
    selected: Boolean,
    unread: Int,
    subtitle: String? = null,
    drafted: Boolean = false,
    /** Set for somebody who may rearrange the list: long-press, or a screen reader's actions. */
    moves: Moves? = null,
    onClick: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Box {
        ListRow(
            title = channel.name,
            modifier = if (moves != null) {
                Modifier.semantics { customActions = moves.accessibilityActions() }
            } else {
                Modifier
            },
            onLongClick = if (moves != null) { { menu = true } } else null,
            onLongClickLabel = if (moves != null) "Move ${channel.name}" else null,
            subtitle = subtitle,
            selected = selected,
            leading = {
                BetweenUsIcon(
                    icon = when {
                        channel.isPrivate -> BetweenUsIcons.Lock
                        channel.type == ChannelType.VOICE -> BetweenUsIcons.Speaker
                        else -> BetweenUsIcons.Hash
                    },
                    tint = if (selected) {
                        MaterialTheme.colorScheme.onSecondaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    size = 20.dp,
                )
            },
            trailing = {
                if (unread > 0) Badge(unread) else if (drafted) DraftLabel()
            },
            onClick = onClick,
        )
        // Anchored to the row: the menu opens over the channel it moves.
        if (moves != null) MoveMenu(menu, moves) { menu = false }
    }
}

/** The quiet "Draft" beside a conversation with unsent text - smaller and greyer than a badge. */
@Composable
private fun DraftLabel() {
    Text(
        text = "Draft",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun DirectMessageList(onSelectChannel: (Channel) -> Unit) {
    val directs by Workspace.directChannels.collectAsState()
    val unread by Workspace.unread.collectAsState()
    val drafted by Drafts.drafted.collectAsState()
    LaunchedEffect(Unit) { Drafts.load() }
    // Collected, not read through `Presence.statusOf`: that returns the value
    // at the moment it is called, so the dot next to a conversation kept the
    // colour it had when the drawer was first drawn and never went green.
    val statuses by Presence.statuses.collectAsState()

    Column {
        SectionLabel("Direct messages")
        if (directs.isEmpty()) {
            Text(
                text = "No conversations yet. Open one from the friends screen.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }
        directs.forEach { direct ->
            val status = (statuses[direct.participant.id] ?: PresenceStatus.OFFLINE).wire
            ListRow(
                title = direct.participant.label,
                leading = {
                    AvatarWithStatus(
                        id = direct.participant.id,
                        label = direct.participant.label,
                        url = direct.participant.avatarUrl?.let {
                            com.aatech.betweenus.core.data.Endpoint.absolute(it)
                        },
                        status = status,
                        size = 32.dp,
                    )
                },
                trailing = {
                    val count = unread[direct.channelId] ?: 0
                    if (count > 0) Badge(count) else if (direct.channelId in drafted) DraftLabel()
                },
                onClick = {
                    onSelectChannel(
                        Channel(
                            id = direct.channelId,
                            serverId = null,
                            name = direct.participant.label,
                            type = ChannelType.DM,
                            topic = null,
                            isPrivate = true,
                        ),
                    )
                },
            )
        }
        Spacer(Modifier.height(8.dp))
    }
}
