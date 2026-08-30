package com.aatech.betweenus.feature.chat

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aatech.betweenus.core.data.ChannelReadReceipt
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.store.Receipts
import com.aatech.betweenus.ui.components.Avatar
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Slate500


/**
 * The "seen by" row under your own messages, and the sheet behind it.
 *
 * Faces rather than a tick or a "read" caption: the question anybody asks of a
 * group is *who* has seen it, and four faces answer it without being read.
 * Past four they stop being recognisable and start being a texture, so the
 * rest become a count.
 *
 * Every timestamp here is the read *marker* - "had this channel open at" - and
 * the sheet says so rather than implying an eye was on that particular line.
 */
@Composable
fun SeenByRow(receipts: List<ChannelReadReceipt>, onOpen: () -> Unit) {
    // Nothing at all for a message nobody has read yet: a "seen by nobody" line
    // under every message you send is a nag, not a fact.
    if (receipts.isEmpty()) return

    val shown = receipts.takeLast(Receipts.FACES)
    val rest = receipts.size - shown.size

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 3.dp),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .clickable { onOpen() }
                .padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            shown.forEachIndexed { index, receipt ->
                // Overlapped, so four faces cost the width of two and a half.
                Box(Modifier.offset(x = (-5 * index).dp)) {
                    Avatar(
                        id = receipt.user.id,
                        label = receipt.user.label,
                        url = receipt.user.avatarUrl?.let { Endpoint.absolute(it) },
                        size = 16.dp,
                        // The row is the button, and what it opens is who read
                        // the message. A 16dp face is a texture here, not a
                        // target - the dialog behind it is where a face is one.
                        viewable = false,
                    )
                }
            }
            if (rest > 0) {
                Spacer(Modifier.width(2.dp))
                Text(
                    text = "+$rest",
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    color = Slate500,
                )
            }
        }
    }
}

/** When it was sent, and when each person read. Opened from the row. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SeenBySheet(
    sentAt: String,
    receipts: List<ChannelReadReceipt>,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                Text(
                    text = "Message info",
                    style = MaterialTheme.typography.titleMedium,
                    color = Slate100,
                )
                Text(
                    text = "Sent " + stamp(context, sentAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = Slate400,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }

            Spacer(Modifier.size(8.dp))

            if (receipts.isEmpty()) {
                Text(
                    text = "Nobody has read it yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate500,
                    modifier = Modifier.fillMaxWidth().padding(20.dp),
                )
            } else {
                LazyColumn(Modifier.fillMaxWidth()) {
                    items(receipts, key = { it.user.id }) { receipt ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(
                                id = receipt.user.id,
                                label = receipt.user.label,
                                url = receipt.user.avatarUrl?.let { Endpoint.absolute(it) },
                                size = 36.dp,
                            )
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = receipt.user.label,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = Slate100,
                                )
                                // The marker, said plainly: it is when they had
                                // the channel open, which is not quite when
                                // their eyes were on this message.
                                Text(
                                    text = "Read " + stamp(context, receipt.readAt),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Slate500,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * When somebody read it: "Today at 14:32", "Yesterday at 2:32 PM".
 *
 * The same words and the same clock the message list's dividers use - the day
 * from `dayLabel`, the time in the reader's own zone and the device's own
 * 12/24-hour setting - because a receipt sitting under a conversation must not
 * name the day, or tell the time, differently from the conversation.
 */
private fun stamp(context: Context, iso: String): String {
    val day = dayLabel(iso)
    return if (day.isEmpty()) "" else day + " at " + clockTime(context, iso)
}
