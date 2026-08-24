package com.aatech.betweenus.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroup
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.theme.BetweenUsMotion

/**
 * The handful of controls every BetweenUs screen is built out of, in Material 3
 * Expressive.
 *
 * They exist so a feature never re-specifies the palette: a field that picks
 * its own border colour is how three screens end up looking like three apps.
 *
 * Expressive adds a second reason. Its controls change *shape* as you touch
 * them - a button squashes towards a squarer corner while pressed and springs
 * back - and that only happens if the control is handed a `ButtonShapes` rather
 * than a single `Shape`. Getting that right once here is worth more than
 * getting it right in forty call sites.
 */

/**
 * One text field: a label above, a filled well, and the accent only on focus.
 *
 * The 56dp floor is a touch target, not a look.
 */
@Composable
fun BetweenUsField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    secret: Boolean = false,
    enabled: Boolean = true,
    onImeAction: (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmallEmphasized,
            color = scheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            singleLine = true,
            // `large` rather than a hand-picked radius: the field belongs to the
            // same shape scale as everything else on the screen.
            shape = MaterialTheme.shapes.large,
            placeholder = {
                Text(
                    placeholder,
                    style = MaterialTheme.typography.bodyLarge,
                    color = scheme.onSurfaceVariant,
                )
            },
            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(
                onDone = { onImeAction?.invoke() },
                onGo = { onImeAction?.invoke() },
            ),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = scheme.surfaceContainerLow,
                unfocusedContainerColor = scheme.surfaceContainerLow,
                disabledContainerColor = scheme.surfaceContainerLow,
                focusedBorderColor = scheme.primary,
                unfocusedBorderColor = scheme.outlineVariant,
                disabledBorderColor = scheme.outlineVariant,
                focusedTextColor = scheme.onSurface,
                unfocusedTextColor = scheme.onSurface,
                disabledTextColor = scheme.onSurfaceVariant,
                cursorColor = scheme.primary,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp),
        )
    }
}

/**
 * The primary button.
 *
 * It carries its own spinner because a button that stays pressable while a
 * request is in flight submits the request twice - and the spinner is the
 * expressive [LoadingIndicator], a morphing polygon rather than a ring, which
 * is the one place in the app where "working" is drawn at all.
 *
 * The label makes room for it rather than being pushed off-centre: the width
 * animates, so a button that starts working does not jump.
 */
@Composable
fun BetweenUsButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        // The expressive set: a rounded resting shape and a squarer pressed one,
        // sprung between by the theme's motion scheme.
        shapes = ButtonDefaults.shapes(),
        enabled = enabled && !busy,
        contentPadding = ButtonDefaults.MediumContentPadding,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = ButtonDefaults.MediumContainerHeight),
    ) {
        AnimatedVisibility(
            visible = busy,
            enter = fadeIn(BetweenUsMotion.effect()) + expandHorizontally(clip = false),
            exit = fadeOut(BetweenUsMotion.effect()) + shrinkHorizontally(clip = false),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LoadingIndicator(
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(ButtonDefaults.MediumIconSize),
                )
                Spacer(Modifier.width(ButtonDefaults.MediumIconSpacing))
            }
        }
        Text(text = text, style = MaterialTheme.typography.labelLargeEmphasized)
    }
}

/** The quieter half of a pair of actions: cancel, dismiss, "not now". */
@Composable
fun BetweenUsSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        shapes = ButtonDefaults.shapes(),
        enabled = enabled,
        contentPadding = ButtonDefaults.MediumContentPadding,
        modifier = modifier.heightIn(min = ButtonDefaults.MediumContainerHeight),
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge)
    }
}

/**
 * A row of choices where exactly one is taken.
 *
 * `ButtonGroup` is the expressive control for this and it is not a segmented
 * button: the buttons stay separate, and pressing one squeezes it while its
 * neighbours give way. Handing it [ToggleButton]s is what makes the selected
 * one hold its state.
 */
@Composable
fun <T> BetweenUsChoice(
    options: List<T>,
    selected: T,
    onSelect: (T) -> Unit,
    label: (T) -> String,
    modifier: Modifier = Modifier,
) {
    ButtonGroup(
        overflowIndicator = {},
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        options.forEach { option ->
            val checked = option == selected
            customItem(
                buttonGroupContent = {
                    // The same source drives the button and the width animation:
                    // `animateWidth` is what makes a pressed item swell and its
                    // neighbours give way, and it can only see the press if it
                    // is watching the interactions the button reports.
                    val interactions = remember { MutableInteractionSource() }
                    ToggleButton(
                        checked = checked,
                        onCheckedChange = { onSelect(option) },
                        interactionSource = interactions,
                        modifier = Modifier.animateWidth(interactions),
                    ) {
                        Text(
                            text = label(option),
                            style = if (checked) {
                                MaterialTheme.typography.labelLargeEmphasized
                            } else {
                                MaterialTheme.typography.labelLarge
                            },
                        )
                    }
                },
                menuContent = {},
            )
        }
    }
}

/**
 * Progress with a known end: an upload, a download, an install.
 *
 * Wavy on purpose. The active half of the track is a travelling wave and the
 * remainder is flat, so "how far along" reads at a glance instead of needing
 * the two ends compared.
 */
@Composable
fun BetweenUsProgress(progress: () -> Float, modifier: Modifier = Modifier) {
    LinearWavyProgressIndicator(
        progress = progress,
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * An error, a warning or a note, in a tonal container.
 *
 * [tone] is the content colour; the container is that colour at low alpha over
 * the surface, which keeps one call site able to say "this one is red" without
 * knowing anything about the scheme.
 */
@Composable
fun Notice(message: String, tone: Color, modifier: Modifier = Modifier) {
    Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        color = tone,
        modifier = modifier
            .fillMaxWidth()
            .background(tone.copy(alpha = 0.12f), MaterialTheme.shapes.medium)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    )
}
