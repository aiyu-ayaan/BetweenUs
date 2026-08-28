package com.aatech.betweenus.feature.update

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.core.data.Markup
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate300
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface950

/**
 * A GitHub release body, drawn.
 *
 * The notes are markdown - `### Features` and a list under it, `**bold**`, a
 * fenced block of shell - and until this they were dropped into a single [Text]
 * with the hashes, asterisks and backticks still in them. Which is exactly the
 * shape that makes somebody stop reading the thing telling them what changed.
 *
 * It is the message parser, not a second one: [Markup.parseNotes] is
 * [Markup.parse] with headings switched on, because a heading in a chat line is
 * shouting and a release note is nothing but headings. What is not shared is
 * the drawing - `MessageRow` lays custom emoji and tappable links over its
 * blocks, and none of that belongs in a changelog.
 *
 * The desktop client draws the same blocks in `components/ReleaseNotes.tsx`.
 * Changing one changes both, or the same release reads differently on two
 * screens.
 */
@Composable
fun ReleaseNotes(notes: String, modifier: Modifier = Modifier) {
    val blocks = remember(notes) {
        // A blank line comes back as an empty Body block, which is what a blank
        // line in a *message* is. A release note is mostly blank lines - one
        // under every heading - and drawing each as an empty row on top of the
        // spacing this already has makes the whole thing drift apart.
        Markup.parseNotes(notes.trim())
            .filter { it.kind != Markup.Kind.Body || it.text.isNotBlank() }
    }
    if (blocks.isEmpty()) return

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        blocks.forEach { block ->
            when (block.kind) {
                Markup.Kind.Heading -> Text(
                    text = annotate(block),
                    // Two sizes, not six. A release note's own `##` and `###`
                    // are the only levels that appear, and a changelog in a
                    // sheet needs its sections findable, not an outline.
                    style = if (block.ordinal <= 2) {
                        MaterialTheme.typography.titleSmall
                    } else {
                        MaterialTheme.typography.labelLarge
                    },
                    color = Slate100,
                    modifier = Modifier.padding(top = 6.dp),
                )

                Markup.Kind.Bullet, Markup.Kind.Number -> Row(Modifier.fillMaxWidth()) {
                    // The marker sits in a gutter of its own rather than
                    // inline, so a wrapped item lines up under its own first
                    // word instead of under the bullet.
                    Text(
                        text = if (block.kind == Markup.Kind.Number) "${block.ordinal}." else "\u2022",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                        modifier = Modifier.width(18.dp),
                    )
                    Text(
                        text = annotate(block),
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate300,
                    )
                }

                Markup.Kind.Code -> Text(
                    text = block.text,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = Slate300,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(Surface950)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                )

                Markup.Kind.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(
                        modifier = Modifier
                            .width(3.dp)
                            .fillMaxHeight()
                            .clip(RoundedCornerShape(2.dp))
                            .background(Edge),
                    )
                    Text(
                        text = annotate(block),
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate400,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }

                Markup.Kind.Body -> Text(
                    text = annotate(block),
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate300,
                )
            }
        }
    }
}

/** A block's words, with its styles laid over them. */
private fun annotate(block: Markup.Block) = buildAnnotatedString {
    append(block.text)
    block.spans.forEach { span ->
        // Clamped, because a style is only as trustworthy as the string it was
        // measured against.
        val from = span.start.coerceIn(0, length)
        val to = span.end.coerceIn(from, length)
        if (to > from) addStyle(span.style.span(), from, to)
    }
}

private fun Markup.Style.span(): SpanStyle = when (this) {
    Markup.Style.Bold -> SpanStyle(fontWeight = FontWeight.Bold, color = Slate100)
    Markup.Style.Italic -> SpanStyle(fontStyle = FontStyle.Italic)
    Markup.Style.Strike -> SpanStyle(textDecoration = TextDecoration.LineThrough)
    Markup.Style.Code -> SpanStyle(fontFamily = FontFamily.Monospace, background = Surface950)
}
