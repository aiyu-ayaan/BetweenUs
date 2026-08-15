package com.aktech.nexora.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.aktech.nexora.ui.theme.Accent
import com.aktech.nexora.ui.theme.Slate100
import com.aktech.nexora.ui.theme.Slate400
import com.aktech.nexora.ui.theme.Slate50
import com.aktech.nexora.ui.theme.Slate500
import com.aktech.nexora.ui.theme.Surface700
import com.aktech.nexora.ui.theme.Surface950

/**
 * The handful of controls every Nexora screen is built out of.
 *
 * They exist so a feature never re-specifies the palette: a field that picks
 * its own border colour is how three screens end up looking like three apps.
 */

/**
 * One text field, drawn the way the other clients draw theirs: an uppercase
 * label above, a dark well, and the accent only on focus.
 *
 * The 52dp floor is a touch target, not a look.
 */
@Composable
fun NexoraField(
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
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = Slate400,
        )
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            placeholder = {
                Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = Slate500)
            },
            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(
                onDone = { onImeAction?.invoke() },
                onGo = { onImeAction?.invoke() },
            ),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Surface950,
                unfocusedContainerColor = Surface950,
                disabledContainerColor = Surface950,
                focusedBorderColor = Accent,
                unfocusedBorderColor = Surface700,
                disabledBorderColor = Surface700,
                focusedTextColor = Slate100,
                unfocusedTextColor = Slate100,
                disabledTextColor = Slate400,
                cursorColor = Accent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp),
        )
    }
}

/**
 * The accent button. It carries its own spinner because a button that stays
 * pressable while a request is in flight submits the request twice.
 */
@Composable
fun NexoraButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Accent,
            contentColor = Slate50,
            disabledContainerColor = Accent.copy(alpha = 0.4f),
            disabledContentColor = Slate50.copy(alpha = 0.7f),
        ),
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = Slate50,
            )
            Spacer(Modifier.size(10.dp))
        }
        Text(text = text, style = MaterialTheme.typography.labelLarge)
    }
}

/** An error or a warning, in the tinted box the other clients use. */
@Composable
fun Notice(message: String, tone: Color, modifier: Modifier = Modifier) {
    Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        color = tone,
        modifier = modifier
            .fillMaxWidth()
            .background(tone.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}
