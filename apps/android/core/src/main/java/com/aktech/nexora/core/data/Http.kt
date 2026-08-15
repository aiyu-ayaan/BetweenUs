package com.aktech.nexora.core.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * The HTTP client, and the WebSocket one - `Sockets` shares this [client] so a
 * connection pool, a DNS cache and a set of timeouts exist once.
 *
 * This started as `HttpURLConnection`, which was right while the app made four
 * JSON calls. It is OkHttp now because the realtime phases need a WebSocket,
 * uploads need multipart with a progress-reporting body, and writing either by
 * hand is not laziness. It also follows an http -> https redirect, which
 * `HttpURLConnection` refuses to do and which self-hosted deployments do all
 * the time.
 */
object Http {
    private const val TIMEOUT_SECONDS = 20L

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
        // A WebSocket that has said nothing for a while is not a WebSocket that
        // has gone away, but a phone's NAT will drop it as though it were.
        .pingInterval(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    val json = "application/json; charset=utf-8".toMediaType()

    class Result(val status: Int, val body: String, val bytes: ByteArray, val finalUrl: String)

    fun get(url: String, bearer: String? = null): Result = send("GET", url, null, bearer)

    fun send(method: String, url: String, body: String?, bearer: String? = null): Result =
        execute(url, bearer) { builder ->
            builder.method(method, body?.toRequestBody(json) ?: emptyBodyFor(method))
        }

    /** Multipart and other prepared bodies - the upload routes. */
    fun post(url: String, body: RequestBody, bearer: String? = null): Result =
        execute(url, bearer) { it.post(body) }

    private fun execute(
        url: String,
        bearer: String?,
        configure: (Request.Builder) -> Request.Builder,
    ): Result {
        val builder = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
        if (bearer != null) builder.header("Authorization", "Bearer $bearer")

        return try {
            client.newCall(configure(builder).build()).execute().use { response ->
                val bytes = response.body?.bytes() ?: ByteArray(0)
                Result(
                    status = response.code,
                    // Attachment ciphertext is not text; only decode when a
                    // caller asks for the string form.
                    body = if (isTextual(response.header("Content-Type"))) String(bytes) else "",
                    bytes = bytes,
                    finalUrl = response.request.url.toString(),
                )
            }
        } catch (error: IOException) {
            // Name the host. "Could not reach that address" is equally true of a
            // wrong port, a stopped service and a firewall, and the one fact
            // that separates them is which address was tried.
            throw IOException("Could not reach ${hostOf(url)}", error)
        } catch (error: IllegalArgumentException) {
            throw IOException("That is not a usable address", error)
        }
    }

    private fun isTextual(contentType: String?): Boolean {
        if (contentType == null) return true
        val lower = contentType.lowercase()
        return lower.startsWith("text/") || lower.contains("json") || lower.contains("xml")
    }

    /** POST and PUT need a body even when there is nothing to say; GET must not have one. */
    private fun emptyBodyFor(method: String): RequestBody? =
        if (method == "POST" || method == "PUT" || method == "PATCH") {
            ByteArray(0).toRequestBody(json)
        } else {
            null
        }

    fun hostOf(url: String): String =
        runCatching { URL(url).authority }.getOrNull() ?: "that address"
}
