package com.aatech.betweenus.feature.voice

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.store.Boards
import com.aatech.betweenus.core.store.GameInfo
import com.aatech.betweenus.core.store.GameState
import kotlin.math.floor
import kotlin.math.min

/**
 * The boards, drawn from `cells` and nothing else.
 *
 * Every renderer here reads the state the referee sent and turns a tap back
 * into the move index that referee expects. None of them decides whether a move
 * is legal beyond what is visible on the board - an empty square, a column with
 * room, a line not yet drawn - because the rules have exactly one implementation
 * and it is not in Kotlin. An illegal tap is refused by the gateway and simply
 * does nothing, which is the correct outcome and the honest one.
 *
 * `Canvas` rather than a grid of composables: a Reversi board is sixty-four
 * cells and a Dots and Boxes board is forty lines plus sixteen squares plus
 * twenty-five dots, and a composable each is a recomposition each on every
 * move.
 */

/** Seat colour, or a neutral for -1 and for anything out of range. */
private fun seatColour(info: GameInfo, seat: Int, empty: Color): Color =
    info.seatColours.getOrNull(seat)?.let { Color(it) } ?: empty

@Composable
fun GameBoard(
    info: GameInfo,
    state: GameState,
    /** Null when this client is watching: the board is drawn and not tappable. */
    onMove: ((Int) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    when (info.id) {
        "tic-tac-toe" -> SquareGrid(info, state, Boards.TIC_TAC_TOE_SIZE, onMove, modifier)
        "reversi" -> SquareGrid(info, state, Boards.REVERSI_SIZE, null, modifier)
        "connect-four" -> ConnectFourBoard(info, state, onMove, modifier)
        "dots-and-boxes" -> DotsAndBoxesBoard(info, state, onMove, modifier)
        else -> Unit
    }
}

/**
 * Tic-tac-toe and Reversi: `size` by `size`, one cell per move index.
 *
 * Reversi is drawn by this and never tappable. Its legal moves are a walk in
 * eight directions from each empty square, and a phone that offered every empty
 * square would offer mostly illegal taps - so it watches rather than guesses,
 * and rather than carrying a second copy of the rules to find out.
 */
@Composable
private fun SquareGrid(
    info: GameInfo,
    state: GameState,
    size: Int,
    onMove: ((Int) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val empty = Color(0x14FFFFFF)
    val line = Color(0x33FFFFFF)

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .then(
                if (onMove == null) {
                    Modifier
                } else {
                    Modifier.pointerInput(size, state) {
                        detectTapGestures { at ->
                            val step = min(this.size.width, this.size.height) / size.toFloat()
                            val c = floor(at.x / step).toInt().coerceIn(0, size - 1)
                            val r = floor(at.y / step).toInt().coerceIn(0, size - 1)
                            val cell = r * size + c
                            // Only an empty square. That is reading the board,
                            // not knowing the rules - the distinction this file
                            // is built on.
                            if (state.cells.getOrNull(cell) == -1) onMove(cell)
                        }
                    }
                },
            ),
    ) {
        val step = min(this.size.width, this.size.height) / size
        val radius = step * 0.36f

        for (r in 0 until size) {
            for (c in 0 until size) {
                val cell = r * size + c
                val centre = Offset(c * step + step / 2, r * step + step / 2)
                drawRect(
                    color = empty,
                    topLeft = Offset(c * step + 1, r * step + 1),
                    size = Size(step - 2, step - 2),
                )
                val owner = state.cells.getOrNull(cell) ?: -1
                if (owner >= 0) {
                    drawCircle(seatColour(info, owner, empty), radius, centre)
                }
                // The last move, ringed. A board that only shows the position
                // does not show what just happened, and on a phone somebody
                // looking up from a conversation has missed it.
                if (state.lastMove == cell) {
                    drawCircle(line, radius * 1.25f, centre, style = Stroke(width = 3f))
                }
            }
        }
        grid(size, step, line)
    }
}

/** Connect Four: a tap is a *column*, which is what the referee expects. */
@Composable
private fun ConnectFourBoard(
    info: GameInfo,
    state: GameState,
    onMove: ((Int) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val columns = Boards.CONNECT_COLUMNS
    val rows = Boards.CONNECT_ROWS
    val empty = Color(0x14FFFFFF)
    val line = Color(0x33FFFFFF)

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(columns.toFloat() / rows)
            .then(
                if (onMove == null) {
                    Modifier
                } else {
                    Modifier.pointerInput(state) {
                        detectTapGestures { at ->
                            val step = this.size.width / columns.toFloat()
                            val column = floor(at.x / step).toInt().coerceIn(0, columns - 1)
                            // A full column is visibly full, so refusing it here
                            // is reading the board rather than knowing the rules.
                            if (Boards.landing(state.cells, column) != -1) onMove(column)
                        }
                    }
                },
            ),
    ) {
        val step = min(this.size.width / columns, this.size.height / rows)
        val radius = step * 0.4f
        for (r in 0 until rows) {
            for (c in 0 until columns) {
                val centre = Offset(c * step + step / 2, r * step + step / 2)
                val owner = state.cells.getOrNull(r * columns + c) ?: -1
                drawCircle(seatColour(info, owner, empty), radius, centre)
                if (state.lastMove == r * columns + c) {
                    drawCircle(line, radius * 1.2f, centre, style = Stroke(width = 3f))
                }
            }
        }
    }
}

/**
 * Dots and Boxes: twenty-five dots, forty lines, sixteen squares.
 *
 * A tap picks the nearest undrawn line rather than requiring one to be hit
 * exactly. A line is a few pixels wide and a fingertip is not, and a board that
 * needs precision is a board that gets played on a desktop.
 */
@Composable
private fun DotsAndBoxesBoard(
    info: GameInfo,
    state: GameState,
    onMove: ((Int) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val dots = Boards.DOTS
    val cells = Boards.BOX_CELLS
    val faint = Color(0x22FFFFFF)
    val dotColour = Color(0x66FFFFFF)

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .then(
                if (onMove == null) {
                    Modifier
                } else {
                    Modifier.pointerInput(state) {
                        detectTapGestures { at ->
                            val step = min(this.size.width, this.size.height) / cells.toFloat()
                            nearestLine(at, step, state)?.let(onMove)
                        }
                    }
                },
            ),
    ) {
        val step = min(this.size.width, this.size.height) / cells

        // Claimed squares first, so the lines sit on top of them.
        for (r in 0 until cells) {
            for (c in 0 until cells) {
                val owner = state.boxes.getOrNull(r * cells + c) ?: -1
                if (owner >= 0) {
                    drawRect(
                        color = seatColour(info, owner, faint).copy(alpha = 0.35f),
                        topLeft = Offset(c * step + 2, r * step + 2),
                        size = Size(step - 4, step - 4),
                    )
                }
            }
        }

        for (r in 0 until dots) {
            for (c in 0 until cells) {
                val owner = state.cells.getOrNull(Boards.horizontal(r, c)) ?: -1
                drawLine(
                    color = seatColour(info, owner, faint),
                    start = Offset(c * step, r * step),
                    end = Offset((c + 1) * step, r * step),
                    strokeWidth = if (owner >= 0) 6f else 2f,
                )
            }
        }
        for (r in 0 until cells) {
            for (c in 0 until dots) {
                val owner = state.cells.getOrNull(Boards.vertical(r, c)) ?: -1
                drawLine(
                    color = seatColour(info, owner, faint),
                    start = Offset(c * step, r * step),
                    end = Offset(c * step, (r + 1) * step),
                    strokeWidth = if (owner >= 0) 6f else 2f,
                )
            }
        }

        for (r in 0 until dots) {
            for (c in 0 until dots) {
                drawCircle(dotColour, 5f, Offset(c * step, r * step))
            }
        }
    }
}

/**
 * The undrawn line closest to a tap, or null when the nearest is already drawn.
 *
 * Distance to the midpoint of each candidate rather than to the segment: the
 * lines form a lattice, so the midpoints are far enough apart that the simpler
 * measure picks the same one, and it is a quarter of the arithmetic.
 */
private fun nearestLine(at: Offset, step: Float, state: GameState): Int? {
    var best: Int? = null
    var bestDistance = Float.MAX_VALUE

    fun consider(index: Int, midpoint: Offset) {
        if (state.cells.getOrNull(index) != -1) return
        val dx = at.x - midpoint.x
        val dy = at.y - midpoint.y
        val distance = dx * dx + dy * dy
        if (distance < bestDistance) {
            bestDistance = distance
            best = index
        }
    }

    for (r in 0 until Boards.DOTS) {
        for (c in 0 until Boards.BOX_CELLS) {
            consider(Boards.horizontal(r, c), Offset((c + 0.5f) * step, r * step))
        }
    }
    for (r in 0 until Boards.BOX_CELLS) {
        for (c in 0 until Boards.DOTS) {
            consider(Boards.vertical(r, c), Offset(c * step, (r + 0.5f) * step))
        }
    }
    return best
}

private fun DrawScope.grid(size: Int, step: Float, colour: Color) {
    for (i in 1 until size) {
        drawLine(colour, Offset(i * step, 0f), Offset(i * step, step * size), strokeWidth = 2f)
        drawLine(colour, Offset(0f, i * step), Offset(step * size, i * step), strokeWidth = 2f)
    }
}
