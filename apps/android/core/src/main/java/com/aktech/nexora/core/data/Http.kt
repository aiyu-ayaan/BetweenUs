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
            val connection = open(method, target, body, bearer)
            try {
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
                throw IOException("Could not reach that address", error)
            } finally {
                connection.disconnect()
            }
        }
        throw IOException("That address redirected too many times")
    }

    private fun open(method: String, url: String, body: String?, bearer: String?): HttpURLConnection {
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (error: Exception) {
            throw IOException("Could not reach that address", error)
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
