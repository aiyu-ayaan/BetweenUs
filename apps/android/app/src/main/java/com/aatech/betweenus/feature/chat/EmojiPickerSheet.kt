package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.ServerEmoji
import com.aatech.betweenus.ui.components.BetweenUsIcon
import com.aatech.betweenus.ui.components.BetweenUsIcons
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Edge
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Surface700
import com.aatech.betweenus.ui.theme.Surface900

private data class EmojiCategory(val name: String, val icon: String, val emojis: List<String>)

private val CATEGORIES = listOf(
    EmojiCategory(
        name = "Smileys",
        icon = "😀",
        emojis = listOf(
            "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
            "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
            "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩",
            "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖",
            "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯",
            "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔",
            "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦",
            "💀", "👻", "👽", "🤖", "💩", "🤡", "👹", "👺", "🎃", "😺",
        ),
    ),
    EmojiCategory(
        name = "Gestures",
        icon = "👍",
        emojis = listOf(
            "👍", "👎", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✌️", "🤞",
            "🤟", "🤘", "👌", "🤌", "🤏", "👈", "👉", "👆", "👇", "☝️",
            "👋", "🤚", "🖐️", "✋", "🖖", "🤙", "🦾", "💪", "🖕", "✍️",
            "🤳", "💅", "🤝", "🤛", "🤜", "👊", "✊", "🤛", "🤜", "🤝",
        ),
    ),
    EmojiCategory(
        name = "Hearts",
        icon = "❤️",
        emojis = listOf(
            "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
            "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "💌",
            "💋", "👄", "🏩", "❤️‍🔥", "❤️‍🩹", "💐", "🌹", "🥀", "🌺", "🌸",
        ),
    ),
    EmojiCategory(
        name = "Fun & Symbols",
        icon = "🔥",
        emojis = listOf(
            "🔥", "✨", "🎉", "💯", "🚀", "⭐", "⚡", "💡", "👀", "🧠",
            "💰", "💎", "🏆", "⚽", "🎮", "🎵", "🍕", "🍔", "☕", "🍻",
            "🌈", "☀️", "🌙", "☁️", "⚡", "❄️", "🔔", "🔑", "📦", "📌",
            "🚨", "🛑", "✅", "❌", "❓", "❗", "💬", "💭", "💤", "🎯",
        ),
    ),
)

/**
 * WhatsApp-style Emoji Picker Bottom Sheet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmojiPickerSheet(
    onDismiss: () -> Unit,
    onEmojiPicked: (String) -> Unit,
    /**
     * This server's own emoji, in a tab of their own before the Unicode ones.
     * A custom one is picked as its `:name:`, because the shortcode is what the
     * message carries; the picture comes from the manifest the sender attaches.
     */
    custom: List<ServerEmoji> = emptyList(),
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var selectedCategory by remember { mutableIntStateOf(0) }
    // The server's tab is index 0 when there is one, so every other index
    // shifts by one - which is why the grid asks this rather than the tab.
    val customTab = custom.isNotEmpty()
    val tabs = (if (customTab) listOf("🏷️" to "Server") else emptyList()) +
        CATEGORIES.map { it.icon to it.name }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Surface900,
        dragHandle = {
            Box(
                modifier = Modifier
                    .padding(vertical = 8.dp)
                    .size(width = 36.dp, height = 4.dp)
                    .clip(CircleShape)
                    .background(Surface700),
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(bottom = 8.dp),
        ) {
            // Category Tabs
            ScrollableTabRow(
                selectedTabIndex = selectedCategory,
                containerColor = Surface900,
                contentColor = Slate100,
                edgePadding = 12.dp,
                divider = {},
                indicator = { tabPositions ->
                    if (selectedCategory < tabPositions.size) {
                        TabRowDefaults.SecondaryIndicator(
                            Modifier.tabIndicatorOffset(tabPositions[selectedCategory]),
                            color = Accent,
                            height = 2.dp,
                        )
                    }
                },
            ) {
                tabs.forEachIndexed { index, tab ->
                    Tab(
                        selected = selectedCategory == index,
                        onClick = { selectedCategory = index },
                        text = {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(text = tab.first, fontSize = 16.sp)
                                Text(
                                    text = tab.second,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (selectedCategory == index) Slate100 else Slate400,
                                )
                            }
                        },
                    )
                }
            }

            HorizontalDivider(color = Edge)

            // Emoji Grid
            val onCustomTab = customTab && selectedCategory == 0
            val currentEmojis = if (onCustomTab) emptyList() else {
                CATEGORIES.getOrNull(if (customTab) selectedCategory - 1 else selectedCategory)
                    ?.emojis.orEmpty()
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 44.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (onCustomTab) {
                    items(custom) { emoji ->
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .clickable { onEmojiPicked(":${emoji.name}:") },
                            contentAlignment = Alignment.Center,
                        ) {
                            AsyncImage(
                                model = Endpoint.absolute(emoji.url),
                                contentDescription = ":${emoji.name}:",
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.size(30.dp),
                            )
                        }
                    }
                }

                items(currentEmojis) { emoji ->
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { onEmojiPicked(emoji) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = emoji,
                            fontSize = 24.sp,
                        )
                    }
                }
            }
        }
    }
}
