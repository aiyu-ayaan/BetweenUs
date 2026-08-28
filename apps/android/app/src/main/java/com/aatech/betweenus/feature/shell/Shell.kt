package com.aatech.betweenus.feature.shell

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.foundation.systemGestureExclusion
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.crypto.IdentityStatus
import com.aatech.betweenus.core.data.ChannelType
import com.aatech.betweenus.core.data.Connectivity
import com.aatech.betweenus.core.data.PublicUser
import com.aatech.betweenus.core.store.LastPlace
import com.aatech.betweenus.core.store.Workspace
import com.aatech.betweenus.feature.auth.IdentityUnlockSheet
import com.aatech.betweenus.feature.chat.ChatScreen
import com.aatech.betweenus.feature.home.FriendsScreen
import com.aatech.betweenus.feature.members.MembersScreen
import com.aatech.betweenus.feature.remote.RemoteMachinesScreen
import com.aatech.betweenus.feature.remote.RemoteSessionScreen
import com.aatech.betweenus.core.store.PendingChannel
import com.aatech.betweenus.core.store.PendingInvite
import com.aatech.betweenus.core.store.PendingPlace
import com.aatech.betweenus.core.store.PendingShare
import com.aatech.betweenus.feature.servers.InviteSheet
import com.aatech.betweenus.feature.servers.ServerSettingsScreen
import com.aatech.betweenus.feature.settings.BetweenUsPermissions
import com.aatech.betweenus.feature.settings.CallUsageScreen
import com.aatech.betweenus.feature.settings.PermissionsScreen
import com.aatech.betweenus.feature.settings.SettingsScreen
import com.aatech.betweenus.feature.settings.PrivacyScreen
import com.aatech.betweenus.feature.settings.ThemesScreen
import com.aatech.betweenus.feature.update.AutoUpdateScreen
import com.aatech.betweenus.feature.update.UpdateSheet
import com.aatech.betweenus.feature.update.UpdateState
import com.aatech.betweenus.feature.update.UpdateWorker
import com.aatech.betweenus.feature.update.Updates
import com.aatech.betweenus.feature.voice.VoiceChannelScreen
import com.aatech.betweenus.ui.components.ShellPanes
import com.aatech.betweenus.ui.components.rememberShellFrame
import com.aatech.betweenus.ui.theme.BetweenUsMotion
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
        mutableStateOf(!BetweenUsPermissions.introduced(context))
    }
    if (introducing) {
        PermissionsScreen(onDone = { introducing = false })
        return
    }

    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val navigation = rememberNavController()

    /**
     * How much of the app fits on screen at once.
     *
     * A phone reaches the channel list through a drawer; a tablet, an unfolded
     * foldable or a phone turned sideways has room for the list *and* the
     * conversation, and hiding one behind a hamburger on a ten-inch screen is
     * throwing the screen away. It is read here rather than at each use so both
     * branches below are the same shell with one part moved, not two shells.
     */
    val frame = rememberShellFrame()
    val twoPane = frame.panes == ShellPanes.TWO

    /**
     * What the hamburger does, or null when there is nothing for it to do.
     *
     * A button that opens a panel already open is worse than no button: it is a
     * control that appears to do nothing. Every screen that draws one takes
     * this and omits it when it is null.
     */
    val openMenu: (() -> Unit)? = if (twoPane) null else ({ scope.launch { drawer.open() } })

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

    val invited by PendingInvite.code.collectAsState()

    /**
     * The update check, on every launch and only on launch.
     *
     * There is no store to notice a new build for a self-hosted app shipped as
     * an APK, so the app has to. Once per process: a check on every trip back
     * from the background would be a network call for a thing that changes
     * every few days. It is quiet unless there is something to offer, and it
     * honours the snooze - see `Updates`.
     */
    var offeringUpdate by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        offeringUpdate = Updates.check() is UpdateState.Available
        // Whatever the daily check left in the shade is about to be said on
        // screen, and saying it twice is one time too many.
        if (offeringUpdate) UpdateWorker.clearNotification(context)
    }

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

    /**
     * A notification that was tapped. It leaves a channel id behind rather than
     * navigating - an intent is not a navigation controller - and this is where
     * it becomes a screen. Taken once, so it does not reopen on every redraw.
     */
    val pendingChannel by PendingChannel.target.collectAsState()
    LaunchedEffect(pendingChannel) {
        val pending = pendingChannel ?: return@LaunchedEffect
        val target = pending.channelId
        PendingChannel.clear()
        val channel = Workspace.channel(target)
        // A call notification names a voice channel, and the chat route reads
        // the same value - opening one there is an empty conversation. It lands
        // on the call screen instead, with the join button rather than a join:
        // a notification tapped from a lock screen is not consent to open a
        // microphone.
        if (channel?.type == ChannelType.VOICE) {
            voiceChannelId = target
            serverId = channel.serverId
            // Only an answered ring joins on arrival. A tapped notification
            // lands on the join button instead.
            joinOnArrival = pending.join
            navigation.navigate(Route.Voice)
            return@LaunchedEffect
        }
        openChannel(target, channel?.serverId)
    }

    /**
     * A notification that leads somewhere that is not a conversation: a friend
     * request, or a server somebody was just added to. A server has no one
     * screen, so it opens the same thing picking it in the drawer does - its
     * first text channel.
     */
    val pendingPlace by PendingPlace.place.collectAsState()
    // Keyed on the server list as well: the push and the workspace refresh that
    // brings the new server in are a race, and losing it must mean "a moment
    // later", not "never".
    LaunchedEffect(pendingPlace, servers) {
        when (val target = pendingPlace) {
            null -> return@LaunchedEffect
            is PendingPlace.Place.Friends -> {
                PendingPlace.clear()
                serverId = null
                navigation.navigate(Route.Friends) { launchSingleTop = true }
            }
            is PendingPlace.Place.Remote -> {
                PendingPlace.clear()
                serverId = null
                navigation.navigate(Route.Remote) { launchSingleTop = true }
            }
            is PendingPlace.Place.AutoUpdate -> {
                PendingPlace.clear()
                // It has been acted on; leaving it in the shade would have it
                // tapped again tomorrow.
                UpdateWorker.clearNotification(context)
                navigation.navigate(Route.AutoUpdate) { launchSingleTop = true }
            }
            is PendingPlace.Place.Server -> {
                val landing = Workspace.channelsOf(target.serverId)
                    .firstOrNull { it.type == ChannelType.TEXT }
                    ?: return@LaunchedEffect
                PendingPlace.clear()
                openChannel(landing.id, target.serverId)
            }
        }
    }

    /**
     * Somebody shared files into BetweenUs from another app.
     *
     * A share names files and not a conversation, so it asks. It used to
     * answer itself - the last channel that happened to be open, or the drawer
     * if there was not one - which meant the files either landed somewhere
     * nobody chose or looked as though the app had swallowed them. The picker
     * is what the share sheet hands off to now; the files stay in
     * [PendingShare] across the trip and the chat screen takes them into the
     * send preview, which is still where sending happens.
     */
    val shareWaiting by PendingShare.uris.collectAsState()
    var choosingShareTarget by remember { mutableStateOf(false) }
    LaunchedEffect(shareWaiting.isNotEmpty()) {
        if (shareWaiting.isNotEmpty()) {
            choosingShareTarget = true
            drawer.close()
        }
    }

    /**
     * The channel list, wherever it happens to be living.
     *
     * Extracted so the two layouts share it rather than each carrying a copy:
     * a second copy is a second place to add a callback to, and the one that
     * gets forgotten is always the one on the device nobody is holding.
     */
    val workspacePane: @Composable () -> Unit = {
        WorkspaceDrawer(
            user = user,
            servers = servers,
            selectedServerId = serverId,
            selectedChannelId = channelId,
            // Picking a server opens the conversation in it, because that is
            // what picking a server is for. Its first text channel - #general
            // on a server nobody has renamed - is the one every client lands on.
            onSelectServer = { picked ->
                serverId = picked
                val landing = picked
                    ?.let { Workspace.channelsOf(it) }
                    ?.firstOrNull { it.type == ChannelType.TEXT }
                if (landing != null) openChannel(landing.id, picked)
            },
            onSelectChannel = { channel ->
                when (channel.type) {
                    // A voice channel does not become "the channel". It used
                    // to, and since the chat route reads the same value,
                    // leaving a call landed on a voice channel rendered as an
                    // empty conversation.
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

    /** Everything that is not the channel list: the screen stack and its overlays. */
    val body: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            /**
             * The left edge, asked for back from the system.
             *
             * On a gesture-navigation phone a swipe from the edge is Back, and
             * the app never sees it - which is why the drawer would not open by
             * swipe. `systemGestureExclusion` is the only way to ask for it,
             * and Android caps the answer at 200dp of height per edge, keeping
             * whatever is nearest the bottom of the screen. So the drawer opens
             * by swipe from the lower part of the edge, where a thumb rests,
             * and Back still works from the rest of it.
             *
             * Nothing is drawn and nothing is consumed here: the strip exists
             * to claim the area, and the drag it lets through is the drawer's.
             */
            if (!twoPane) {
                Box(
                    Modifier
                        .align(Alignment.CenterStart)
                        .width(24.dp)
                        .fillMaxHeight()
                        .systemGestureExclusion(),
                )
            }

            val connectivityState by Connectivity.state.collectAsState()
            val bannerVisible = connectivityState != Connectivity.State.ONLINE

            // Above everything rather than over it: a banner drawn on top of
            // the screen covers the one control - the menu button - somebody
            // reaching for it would want.
            Column(Modifier.fillMaxSize()) {
                ConnectionBanner()
                /**
                 * Screens arrive rather than appear.
                 *
                 * A forward move slides the new screen a short way in from the
                 * right while the old one gives way to the left; Back is the
                 * same movement reversed, so the stack has a direction you can
                 * feel. The spring is the theme's, and it is a *spring*: an
                 * interrupted transition - a second tap before the first has
                 * settled - carries its velocity forward instead of snapping
                 * back to the start.
                 *
                 * The slide is a quarter of the width, not the whole of it.
                 * Expressive moves things a small distance quickly rather than
                 * a long distance slowly.
                 */
                // Read here rather than inside the lambdas: a transition
                // builder is not a composable, so the springs have to be picked
                // up while the theme is still in scope.
                val travel = BetweenUsMotion.spatial<IntOffset>()
                val fade = BetweenUsMotion.effect<Float>()
                NavHost(
                    navigation,
                    startDestination = start,
                    modifier = Modifier
                        .weight(1f)
                        .then(
                            if (bannerVisible) Modifier.consumeWindowInsets(WindowInsets.statusBars)
                            else Modifier
                        ),
                    enterTransition = {
                        slideInHorizontally(travel) { it / 4 } + fadeIn(fade)
                    },
                    exitTransition = {
                        slideOutHorizontally(travel) { -it / 6 } + fadeOut(fade)
                    },
                    popEnterTransition = {
                        slideInHorizontally(travel) { -it / 6 } + fadeIn(fade)
                    },
                    popExitTransition = {
                        slideOutHorizontally(travel) { it / 4 } + fadeOut(fade)
                    },
                ) {
                    composable(Route.Friends) {
                        FriendsScreen(
                            onOpenMenu = openMenu,
                            onOpenChannel = { openChannel(it, null) },
                        )
                    }
                    composable(Route.Chat) {
                        val id = channelId
                        if (id == null) {
                            FriendsScreen(
                                onOpenMenu = openMenu,
                                onOpenChannel = { openChannel(it, null) },
                            )
                        } else {
                            ChatScreen(
                                channelId = id,
                                self = user,
                                onOpenMenu = openMenu,
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
                            onAutoUpdate = { navigation.navigate(Route.AutoUpdate) },
                            onCallUsage = { navigation.navigate(Route.CallUsage) },
                            onThemes = { navigation.navigate(Route.Themes) },
                            onPrivacy = { navigation.navigate(Route.Privacy) },
                        )
                    }
                    composable(
                        Route.Privacy,
                        enterTransition = {
                            slideInHorizontally(travel) { it } + fadeIn(fade)
                        },
                        exitTransition = {
                            slideOutHorizontally(travel) { -it / 3 } + fadeOut(fade)
                        },
                        popEnterTransition = {
                            slideInHorizontally(travel) { -it / 3 } + fadeIn(fade)
                        },
                        popExitTransition = {
                            slideOutHorizontally(travel) { it } + fadeOut(fade)
                        },
                    ) {
                        PrivacyScreen(onBack = { navigation.popBackStack() })
                    }
                    composable(
                        Route.Themes,
                        enterTransition = {
                            slideInHorizontally(travel) { it } + fadeIn(fade)
                        },
                        exitTransition = {
                            slideOutHorizontally(travel) { -it / 3 } + fadeOut(fade)
                        },
                        popEnterTransition = {
                            slideInHorizontally(travel) { -it / 3 } + fadeIn(fade)
                        },
                        popExitTransition = {
                            slideOutHorizontally(travel) { it } + fadeOut(fade)
                        },
                    ) {
                        ThemesScreen(onBack = { navigation.popBackStack() })
                    }
                    composable(Route.CallUsage) {
                        CallUsageScreen(onBack = { navigation.popBackStack() })
                    }
                    composable(Route.AutoUpdate) {
                        AutoUpdateScreen(onBack = { navigation.popBackStack() })
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
            }

            // A newer release, offered once the app is actually usable rather
            // than over the loading mark. Install or be left alone for a day.
            // Only the launch check opens this. A check started from the auto
            // update screen shows its result on that screen, and a sheet over
            // the top of it would be the same answer twice.
            if (offeringUpdate) {
                UpdateSheet(onDismiss = { offeringUpdate = false; Updates.dismiss() })
            }

            if (unlocking) {
                IdentityUnlockSheet(
                    kind = (identity as? IdentityStatus.Locked)?.kind ?: "password",
                    onDismiss = { unlocking = false },
                )
            }

            // An invite the app was opened by. The link left a code behind; the
            // card is what asks, and nothing is joined until it is accepted.
            // Where a share is going. Over everything, because it is the
            // only thing on screen that matters until it is answered, and an
            // overlay rather than a route so a call in progress is not torn
            // down to ask a question about a photo.
            if (choosingShareTarget && shareWaiting.isNotEmpty()) {
                ShareTargetScreen(
                    count = shareWaiting.size,
                    onPick = { picked, server ->
                        choosingShareTarget = false
                        openChannel(picked, server)
                    },
                    onCancel = {
                        choosingShareTarget = false
                        PendingShare.clear()
                    },
                )
            }

            invited?.let { code ->
                InviteSheet(
                    code = code,
                    onDismiss = { PendingInvite.clear() },
                    onDone = { server ->
                        PendingInvite.clear()
                        serverId = server.id
                        val landing = Workspace.channelsOf(server.id)
                            .firstOrNull { it.type == ChannelType.TEXT }
                        if (landing != null) openChannel(landing.id, server.id)
                    },
                )
            }
        }
    }

    // One shell, two shapes. The panes above are the same composables in both;
    // all that changes is whether the first one is over the second or beside
    // it - which is the whole of what "adaptive" is meant to mean here.
    if (twoPane) {
        Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            Box(
                Modifier
                    .width(frame.navPaneWidth)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.surfaceContainerLow),
            ) {
                workspacePane()
            }
            // The hinge, left empty. A folding screen is two panels with a
            // physical seam between them, and content drawn across it is
            // content drawn on a hinge. Zero on everything without one.
            if (frame.hingeGap > 0.dp) {
                Spacer(Modifier.width(frame.hingeGap).fillMaxHeight())
            }
            Box(Modifier.weight(1f).fillMaxHeight()) { body() }
        }
    } else {
        ModalNavigationDrawer(
            drawerState = drawer,
            drawerContent = {
                ModalDrawerSheet(
                    drawerContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                    modifier = Modifier.width(324.dp),
                ) {
                    workspacePane()
                }
            },
            content = body,
        )
    }
}

object Route {
    const val Friends = "friends"
    const val Chat = "chat"
    const val Members = "members"
    const val Voice = "voice"
    const val Settings = "settings"
    const val Themes = "themes"
    const val Privacy = "privacy"
    const val ServerSettings = "server-settings"
    const val Permissions = "permissions"
    const val AutoUpdate = "auto-update"
    const val CallUsage = "call-usage"
    const val Remote = "remote"
    const val RemoteSession = "remote-session"
}
