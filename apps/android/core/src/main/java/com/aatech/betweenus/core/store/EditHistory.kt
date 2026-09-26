package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.crypto.E2ee
import com.aatech.betweenus.core.data.BetweenUsApi
import com.aatech.betweenus.core.data.EditHistoryRules
import com.aatech.betweenus.core.data.MessageBody
import com.aatech.betweenus.core.data.OpenedVersion

/** Loads and opens the earlier versions of an edited message, on this device. */
object EditHistory {
    suspend fun load(channelId: String, messageId: String): List<OpenedVersion> =
        EditHistoryRules.openVersions(BetweenUsApi.messageEdits(messageId)) { content ->
            val plaintext = E2ee.decryptForChannel(channelId, content)
            if (plaintext == E2ee.UNDECRYPTABLE) null else MessageBody.decode(plaintext).text
        }
}
