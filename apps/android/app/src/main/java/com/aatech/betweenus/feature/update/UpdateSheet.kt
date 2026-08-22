package com.aatech.betweenus.feature.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.components.BetweenUsButton
import com.aatech.betweenus.ui.components.Notice
import com.aatech.betweenus.ui.components.findActivity
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Danger
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate50
import com.aatech.betweenus.ui.theme.Slate500
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface900
import kotlinx.coroutines.launch

/**
 * What a new release looks like when the app is opened.
 *
 * Two answers, both of them real: install it, or be left alone for a while.
 * There is no third button that means "never", because the version being
 * offered will be superseded by another one and a permanent refusal is what the
 * switch on the auto update screen is for.
 *
 * The install goes through Android's own installer, which needs the file first
 * - so the button downloads, and then becomes the one that hands it over. The
 * two steps are one button because they are one intention.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdateSheet(onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // Not a cast: a modal bottom sheet composes into its own window. See
    // findActivity.
    val context = LocalContext.current.findActivity() ?: LocalContext.current
    val state by Updates.state.collectAsState()

    // Nothing left to show: the download failed and was reset, or the install
    // screen came back and the state was cleared.
    LaunchedEffect(state) {
        if (state is UpdateState.Idle || state is UpdateState.UpToDate) onDismiss()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Surface900,
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 20.dp, vertical = 20.dp),
        ) {
            val release = when (val current = state) {
                is UpdateState.Available -> current.release
                is UpdateState.Downloading -> current.release
                is UpdateState.Ready -> current.release
                else -> null
            }

            Text(
                text = "Update available",
                style = MaterialTheme.typography.titleLarge,
                color = Slate50,
            )
            Text(
                text = "${release?.name ?: ""} · you are on ${Updates.installedName}",
                style = MaterialTheme.typography.bodySmall,
                color = Slate500,
            )

            val notes = release?.notes?.trim().orEmpty()
            if (notes.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                Text(
                    text = notes,
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate400,
                    modifier = Modifier
                        .heightIn(max = 220.dp)
                        .verticalScroll(rememberScrollState()),
                )
            }

            Spacer(Modifier.height(20.dp))

            when (val current = state) {
                is UpdateState.Available -> {
                    Text(
                        text = "${current.apk.name} ${sizeOf(current.apk.size)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                    Spacer(Modifier.height(10.dp))
                    BetweenUsButton(
                        text = "Install",
                        onClick = {
                            scope.launch {
                                runCatching { Updates.download(current.release, current.apk) }
                                    .onSuccess {
                                        if (Updates.canInstall(context)) {
                                            Updates.install(context, it)
                                        } else {
                                            // Not a runtime permission: it can
                                            // only be granted in settings, so
                                            // that is where this goes.
                                            Updates.requestInstallPermission(context)
                                        }
                                    }
                                    .onFailure {
                                        Updates.fail(it.message ?: "The download failed")
                                    }
                            }
                        },
                    )
                }

                is UpdateState.Downloading -> {
                    LinearProgressIndicator(
                        progress = { current.progress },
                        modifier = Modifier.fillMaxWidth(),
                        color = Accent,
                        trackColor = Surface700,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "Downloading… ${(current.progress * 100).toInt()}%",
                        style = MaterialTheme.typography.bodySmall,
                        color = Slate500,
                    )
                }

                is UpdateState.Ready -> BetweenUsButton(
                    text = if (Updates.canInstall(context)) "Install" else "Allow installing, then install",
                    onClick = {
                        if (Updates.canInstall(context)) {
                            Updates.install(context, current.file)
                        } else {
                            Updates.requestInstallPermission(context)
                        }
                    },
                )

                is UpdateState.Failed -> Notice(current.message, Danger)

                else -> Unit
            }

            Spacer(Modifier.height(4.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = { Updates.snooze(); onDismiss() }) {
                    val days = Updates.snoozeDays
                    Text(
                        text = "Remind me in $days ${if (days == 1) "day" else "days"}",
                        color = Slate400,
                    )
                }
                TextButton(onClick = { Updates.dismiss(); onDismiss() }) {
                    Text("Not now", color = Slate500)
                }
            }
        }
    }
}
