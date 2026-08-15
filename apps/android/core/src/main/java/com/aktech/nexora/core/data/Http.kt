package com.aktech.nexora.core.data

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The whole HTTP client.
 *
 * Four JSON routes do not need OkHttp and a serialization plugin behind them.
 * When the realtime phases land and a socket, an interceptor and a streaming
 * upload all want the same connection pool, that is the moment to bring one in.
 *
 * Redirects are followed by hand because [HttpURLConnection] refuses to follow
 * one that changes protocol, and http -> https is the single most common thing
 * a self-hosted deployment does. Following it here also gives the caller the
 * URL the request finally landed on, which is what [Endpoint.probe] stores.
 */
object Http {
    private const val MAX_REDIRECTS = 5
    private const val TIMEOUT_MS = 15_000

    class Result(val status: Int, val body: String, val finalUrl: String)

    fun get(url: String, bearer: String? = null): Result = send("GET", url, null, bearer)

    fun send(method: String, url: String, body: String?, bearer: String? = null): Result {
        var target = url
        repeat(MAX_REDIRECTS + 1) {
            var connection: HttpURLConnection? = null
            try {
                // Opening is inside the try because that is where a POST body
                // gets written, which is where the connection is actually made:
                // leaving it outside let a raw socket error past the wrapping
                // and put "failed to connect to /10.0.2.16 after 15000ms" under
                // a login form.
                connection = open(method, target, body, bearer)
                val status = connection.responseCode
                if (status in 300..399) {
                    val location = connection.getHeaderField("Location")
                    if (!location.isNullOrBlank()) {
                        target = URL(URL(target), location).toString()
                        return@repeat
                    }
                }
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                return Result(status, text, target)
            } catch (error: IOException) {
                // Name the host. "Could not reach that address" is true of a
                // wrong port, a stopped service and a firewall alike, and the
                // one thing that separates them is which address was tried.
                throw IOException("Could not reach ${hostOf(target)}", error)
            } finally {
                connection?.disconnect()
            }
        }
        throw IOException("That address redirected too many times")
    }

    private fun hostOf(url: String): String =
        runCatching { URL(url).authority }.getOrNull() ?: "that address"

    private fun open(method: String, url: String, body: String?, bearer: String?): HttpURLConnection {
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (error: Exception) {
            throw IOException("Could not reach ${hostOf(url)}", error)
        }
        connection.requestMethod = method
        connection.instanceFollowRedirects = false
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.setRequestProperty("Accept", "application/json")
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        return connection
    }
}
