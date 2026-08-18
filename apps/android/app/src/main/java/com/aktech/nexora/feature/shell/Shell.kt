package com.aktech.nexora.feature.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aktech.nexora.core.crypto.E2ee
import com.aktech.nexora.core.crypto.IdentityStatus
import com.aktech.nexora.core.data.ChannelType
import com.aktech.nexora.core.data.PublicUser
import com.aktech.nexora.core.store.LastPlace
import com.aktech.nexora.core.store.Workspace
import com.aktech.nexora.feature.auth.IdentityUnlockSheet
import com.aktech.nexora.feature.chat.ChatScreen
import com.aktech.nexora.feature.home.FriendsScreen
import com.aktech.nexora.feature.members.MembersScreen
import com.aktech.nexora.feature.remote.RemoteMachinesScreen
import com.aktech.nexora.feature.remote.RemoteSessionScreen
import com.aktech.nexora.feature.servers.ServerSettingsScreen
import com.aktech.nexora.feature.settings.NexoraPermissions
import com.aktech.nexora.feature.settings.PermissionsScreen
import com.aktech.nexora.feature.settings.SettingsScreen
import com.aktech.nexora.feature.voice.VoiceChannelScreen
import com.aktech.nexora.ui.theme.Ground
import com.aktech.nexora.ui.theme.Surface950
import kotlinx.coroutines.launch

/**
 * The whole signed-in app.
 *
 * The desktop lays four panels side by side - rail, channel sidebar, main,
 * member list - because it has the width for it. A phone does not, so the two
 * left panels become one drawer and the member list becomes a screen. The
 * hierarchy is the same one; only the axis it is folded along changed.
 */
@Composable
fun Shell(user: PublicUser) {
    val context = LocalContext.current

    /**
     * The permission screen, once, on the way in.
     *
     * Not a gate - it can be walked past, and every permission on it is still
     * asked for at the moment it is needed. What it buys is that the whole list
     * is seen once with the reason beside each one, rather than each prompt
     * arriving cold. It is reachable from settings afterwards.
     */
    var introducing by rememberSaveable {
        mutableStateOf(!NexoraPermissions.introduced(context))
    }
    if (introducing) {
        PermissionsScreen(onDone = { introducing = false })
        return
    }

    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val navigation = rememberNavController()

    val servers by Workspace.servers.collectAsState()
    var serverId by rememberSaveable { mutableStateOf(LastPlace.serverId) }
    var channelId by rememberSaveable { mutableStateOf(LastPlace.channelId) }

    /**
     * The voice channel, kept apart from the text one. They are both "the
     * channel" from the drawer's point of view and neither is from the chat
     * screen's: sharing one slot meant leaving a call dropped you into a voice
     * channel drawn as a conversation with nothing in it.
     */
    var voiceChannelId by rememberSaveable { mutableStateOf<String?>(null) }

    /**
     * Whether the voice screen should join on arrival, rather than showing a
     * button that says so. Tapping a voice channel is the decision; asking
     * again on the next screen is asking twice.
     */
    var joinOnArrival by rememberSaveable { mutableStateOf(false) }

    // Read once. The start destination cannot change under a NavHost, and this
    // is the only moment it means anything anyway.
    val start = remember { if (LastPlace.channelId != null) Route.Chat else Route.Friends }

    LaunchedEffect(serverId, channelId) { LastPlace.remember(serverId, channelId) }

    val identity by E2ee.status.collectAsState()
    var unlocking by remember { mutableStateOf(false) }
    LaunchedEffect(identity) {
        // A locked identity is not an error to shrug at: without it every
        // message on the account reads as a padlock.
        unlocking = identity is IdentityStatus.Locked
    }

    fun openChannel(id: String, server: String?) {
        channelId = id
        serverId = server
        scope.launch { drawer.close() }
        navigation.navigate(Route.Chat) {
            popUpTo(Route.Chat) { inclusive = true }
            launchSingleTop = true
        }
    }

    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = Surface950,
                modifier = Modifier.width(320.dp),
            ) {
                WorkspaceDrawer(
                    user = user,
                    servers = servers,
                    selectedServerId = serverId,
                    selectedChannelId = channelId,
                    // Picking a server opens the conversation in it, because
                    // that is what picking a server is for. Its first text
                    // channel - #general on a server nobody has renamed - is
                    // the one every client lands on.
                    onSelectServer = { picked ->
                        serverId = picked
                        val landing = picked
                            ?.let { Workspace.channelsOf(it) }
                            ?.firstOrNull { it.type == ChannelType.TEXT }
                        if (landing != null) openChannel(landing.id, picked)
                    },
                    onSelectChannel = { channel ->
                        when (channel.type) {
                            // A voice channel does not become "the channel".
                            // It used to, and since the chat route reads the
                            // same value, leaving a call landed on a voice
                            // channel rendered as an empty conversation.
                            ChannelType.VOICE -> {
                                voiceChannelId = channel.id
                                serverId = channel.serverId
                                joinOnArrival = true
                                scope.launch { drawer.close() }
                                navigation.navigate(Route.Voice)
                            }
                            else -> openChannel(channel.id, channel.serverId)
                        }
                    },
                    onHome = {
                        serverId = null
                        scope.launch { drawer.close() }
                        navigation.navigate(Route.Friends) { launchSingleTop = true }
                    },
                    onSettings = {
                        scope.launch { drawer.close() }
                        navigation.navigate(Route.Settings)
                    },
                    onServerSettings = {
                        scope.launch { drawer.close() }
                        navigation.navigate(Route.ServerSettings)
                    },
                    onRemote = {
                        scope.launch { drawer.close() }
                        navigation.navigate(Route.Remote)
                    },
                )
            }
        },
    ) {
        Box(Modifier.fillMaxSize().background(Ground)) {
            NavHost(navigation, startDestination = start) {
                composable(Route.Friends) {
                    FriendsScreen(
                        onOpenMenu = { scope.launch { drawer.open() } },
                        onOpenChannel = { openChannel(it, null) },
                    )
                }
                composable(Route.Chat) {
                    val id = channelId
                    if (id == null) {
                        FriendsScreen(
                            onOpenMenu = { scope.launch { drawer.open() } },
                            onOpenChannel = { openChannel(it, null) },
                        )
                    } else {
                        ChatScreen(
                            channelId = id,
                            self = user,
                            onOpenMenu = { scope.launch { drawer.open() } },
                            onOpenMembers = { navigation.navigate(Route.Members) },
                            // The call button in a text channel means the voice
                            // channel of the server it is in - a text channel
                            // id is not something the call service will admit.
                            onStartCall = {
                                val voice = serverId
                                    ?.let { Workspace.channelsOf(it) }
                                    ?.firstOrNull { it.type == ChannelType.VOICE }
                                if (voice != null) {
                                    voiceChannelId = voice.id
                                    joinOnArrival = true
                                    navigation.navigate(Route.Voice)
                                }
                            },
                        )
                    }
                }
                composable(Route.Members) {
                    MembersScreen(
                        serverId = serverId,
                        channelId = channelId,
                        onBack = { navigation.popBackStack() },
                        onOpenDirect = { openChannel(it, null) },
                    )
                }
                composable(Route.Voice) {
                    VoiceChannelScreen(
                        channelId = voiceChannelId,
                        self = user,
                        joinOnArrival = joinOnArrival,
                        onJoined = { joinOnArrival = false },
                        onBack = { navigation.popBackStack() },
                    )
                }
                composable(Route.Settings) {
                    SettingsScreen(
                        user = user,
                        onBack = { navigation.popBackStack() },
                        onServerSettings = { navigation.navigate(Route.ServerSettings) },
                        onPermissions = { navigation.navigate(Route.Permissions) },
                    )
                }
                composable(Route.Permissions) {
                    PermissionsScreen(
                        onDone = { navigation.popBackStack() },
                        onBack = { navigation.popBackStack() },
                    )
                }
                composable(Route.ServerSettings) {
                    ServerSettingsScreen(
                        serverId = serverId,
                        onBack = { navigation.popBackStack() },
                    )
                }
                composable(Route.Remote) {
                    RemoteMachinesScreen(
                        onBack = { navigation.popBackStack() },
                        onOpenSession = { navigation.navigate("${Route.RemoteSession}/$it") },
                    )
                }
                composable("${Route.RemoteSession}/{machineId}") { entry ->
                    RemoteSessionScreen(
                        machineId = entry.arguments?.getString("machineId").orEmpty(),
                        onBack = { navigation.popBackStack() },
                    )
                }
            }

            if (unlocking) {
                IdentityUnlockSheet(
                    kind = (identity as? IdentityStatus.Locked)?.kind ?: "password",
                    onDismiss = { unlocking = false },
                )
            }
        }
    }
}

object Route {
    const val Friends = "friends"
    const val Chat = "chat"
    const val Members = "members"
    const val Voice = "voice"
    const val Settings = "settings"
    const val ServerSettings = "server-settings"
    const val Permissions = "permissions"
    const val Remote = "remote"
    const val RemoteSession = "remote-session"
}
