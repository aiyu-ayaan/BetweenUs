package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aatech.betweenus.core.store.GameSession
import com.aatech.betweenus.core.store.Games
import com.aatech.betweenus.core.store.Play
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.components.IconAction
import com.aatech.betweenus.ui.components.ListRow

/**
 * The game the call is playing, on the phone.
 *
 * The referee is `call-service` and the board arrives whole on every change, so
 * this draws what came and sends taps back. Nothing here decides a rule.
 *
 * Three of the six are tappable from a phone and three are watched, and the
 * line between them is not effort - it is whether a legal move can be read off
 * the board. Reversi's cannot without walking eight directions from every empty
 * square, and Ludo's and Carrom's boards live in numbers only their own rules
 * module understands. Porting those to Kotlin would be a second implementation
 * of rules that have exactly one, and the first time the two disagreed it would
 * be two people looking at different games.
 */
@Composable
fun PlayStage(selfId: String, modifier: Modifier = Modifier) {
    val session by Play.session.collectAsStateWithLifecycle()
    val live = session ?: return
    PlayStageContent(live, selfId, modifier)
}

@Composable
private fun PlayStageContent(
    session: GameSession,
    selfId: String,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val info = Games.of(session.gameId) ?: return
    val state = session.state
    val mySeat = session.seatOf(selfId)
    val myTurn = mySeat >= 0 && mySeat == state.turn && !state.over

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.large)
            .background(scheme.surfaceContainerHigh)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = info.name,
                    style = MaterialTheme.typography.titleSmall,
                    color = scheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = statusLine(session, info.seatNames, mySeat),
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconAction(
                icon = BetweenUsIcons.X,
                contentDescription = "Close the game for everybody",
                onClick = { Play.close() },
            )
        }

        // --- the chairs ---
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            info.seatNames.forEachIndexed { seat, name ->
                val sitter = session.seats.getOrNull(seat)
                val colour = info.seatColours.getOrNull(seat)?.let { Color(it) } ?: scheme.primary
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clip(MaterialTheme.shapes.small)
                        .background(
                            if (seat == state.turn && !state.over) {
                                colour.copy(alpha = 0.28f)
                            } else {
                                scheme.surfaceContainerHighest
                            },
                        )
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    BetweenUsIcon(
                        icon = BetweenUsIcons.User,
                        size = 14.dp,
                        tint = colour,
                        contentDescription = null,
                    )
                    Text(
                        text = sitter?.username ?: name,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (sitter == null) scheme.onSurfaceVariant else scheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = "${session.wins.getOrNull(seat) ?: 0}",
                        style = MaterialTheme.typography.labelMedium,
                        color = scheme.onSurfaceVariant,
                    )
                }
            }
        }

        GameBoard(
            info = info,
            state = state,
            // Tappable only when it is genuinely this person's move. A board
            // that accepts taps out of turn sends moves the referee refuses,
            // which reads as a board that ignores you.
            onMove = if (myTurn && info.playableHere) {
                { move -> Play.move(move) }
            } else {
                null
            },
        )

        // Said, rather than left as a board that does not respond.
        if (!info.playableHere) {
            Text(
                text = "${info.name} is played from a desktop. This phone shows the board, " +
                    "the chairs and the score.",
                style = MaterialTheme.typography.bodySmall,
                color = scheme.onSurfaceVariant,
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (mySeat >= 0) {
                BetweenUsButton(
                    text = "Stand up",
                    onClick = { Play.sit(-1) },
                    modifier = Modifier.weight(1f),
                )
            } else {
                val free = session.seats.indexOfFirst { it == null }
                if (free >= 0) {
                    BetweenUsButton(
                        text = "Take a chair",
                        onClick = { Play.sit(free) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            if (state.over) {
                BetweenUsButton(
                    text = "Play again",
                    onClick = { Play.rematch() },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/**
 * The one line under the game's name: what just happened, or whose move it is.
 *
 * A finished game says so first. Whose turn it is matters only while there is
 * one, and a board that still says "Your move" after somebody won is the most
 * confusing thing this can say.
 */
fun statusLine(session: GameSession, seatNames: List<String>, mySeat: Int): String {
    val state = session.state
    val winner = state.winner
    if (winner != null) {
        return when {
            winner == -1 -> "A draw."
            winner == mySeat -> "You won."
            else -> "${session.seats.getOrNull(winner)?.username ?: seatNames.getOrNull(winner) ?: "They"} won."
        }
    }
    if (mySeat < 0) {
        val up = session.seats.getOrNull(state.turn)?.username
            ?: seatNames.getOrNull(state.turn)
            ?: "Somebody"
        return "Watching · $up to move"
    }
    return if (state.turn == mySeat) "Your move." else "Their move."
}

/**
 * The library, for starting one.
 *
 * Every game is offered, including the three this phone can only watch: a
 * person on a phone in a call with two desktops is a reasonable person to start
 * a game of Carrom, and refusing to let them would be the phone deciding what
 * the room may play.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GameLibrarySheet(onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scheme = MaterialTheme.colorScheme

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            Text(
                text = "Play together",
                style = MaterialTheme.typography.titleMedium,
                color = scheme.onSurface,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            LazyColumn(Modifier.padding(bottom = 16.dp)) {
                items(Games.ALL, key = { it.id }) { game ->
                    ListRow(
                        title = game.name,
                        subtitle = if (game.playableHere) {
                            game.blurb
                        } else {
                            "${game.blurb} · Played from a desktop"
                        },
                        leading = { BetweenUsIcon(BetweenUsIcons.Activity) },
                        onClick = {
                            Play.open(game.id)
                            onDismiss()
                        },
                    )
                }
            }
        }
    }
}
