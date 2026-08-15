package com.aktech.nexora.core.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** The subset of `PublicUser` this client has a use for so far. */
data class PublicUser(
    val id: String,
    val email: String,
    val username: String,
    val displayName: String,
    val avatarUrl: String?,
    val role: String,
) {
    companion object {
        fun from(json: JSONObject) = PublicUser(
            id = json.getString("id"),
            email = json.optString("email"),
            username = json.optString("username"),
            displayName = json.optString("displayName"),
            avatarUrl = json.optString("avatarUrl").takeIf { it.isNotEmpty() && it != "null" },
            role = json.optString("role", "USER"),
        )
    }
}

data class AuthTokens(val accessToken: String, val refreshToken: String)

data class AuthResponse(val user: PublicUser, val tokens: AuthTokens)

/** The shape every service answers an error with. See section 24 of CLAUDE.md. */
class ApiError(val code: String, message: String, val status: Int) : Exception(message)

/**
 * The client for `/api/v1/auth`, matching `apps/desktop/src/services/api.ts`:
 * bearer access token, one refresh on a 401, one retry.
 *
 * Every path is resolved against [Endpoint.current] at call time rather than
 * captured, so switching servers does not leave a stale base behind.
 */
object NexoraApi {

    suspend fun login(email: String, password: String): AuthResponse =
        authResponse("/api/v1/auth/login", JSONObject().put("email", email).put("password", password))

    suspend fun register(email: String, username: String, password: String): AuthResponse =
        authResponse(
            "/api/v1/auth/register",
            JSONObject().put("email", email).put("username", username).put("password", password),
        )

    suspend fun refresh(refreshToken: String): AuthTokens = withContext(Dispatchers.IO) {
        tokensOf(public("POST", "/api/v1/auth/refresh", JSONObject().put("refreshToken", refreshToken)))
    }

    suspend fun logout(refreshToken: String): Unit = withContext(Dispatchers.IO) {
        public("POST", "/api/v1/auth/logout", JSONObject().put("refreshToken", refreshToken))
        Unit
    }

    /** Authenticated: the one route the session restore hangs off. */
    suspend fun me(): PublicUser = withContext(Dispatchers.IO) {
        PublicUser.from(authed("GET", "/api/v1/auth/me", null))
    }

    private suspend fun authResponse(path: String, body: JSONObject): AuthResponse =
        withContext(Dispatchers.IO) {
            val json = public("POST", path, body)
            AuthResponse(PublicUser.from(json.getJSONObject("user")), tokensOf(json))
        }

    private fun tokensOf(json: JSONObject) =
        AuthTokens(json.getString("accessToken"), json.getString("refreshToken"))

    /** A route that needs no session: sign in, register, refresh, sign out. */
    private fun public(method: String, path: String, body: JSONObject?): JSONObject =
        parse(Http.send(method, Endpoint.current() + path, body?.toString()))

    /**
     * A route that needs one. A 401 is the access token having expired, which
     * is normal and not an error: refresh once, retry once, and only then give
     * up. Anything else is the caller's problem.
     */
    private suspend fun authed(method: String, path: String, body: JSONObject?): JSONObject {
        val url = Endpoint.current() + path
        val first = Http.send(method, url, body?.toString(), Session.accessToken)
        if (first.status != 401) return parse(first)

        val refreshed = Session.refreshAccessToken() ?: return parse(first)
        return parse(Http.send(method, url, body?.toString(), refreshed))
    }

    private fun parse(result: Http.Result): JSONObject {
        val json = runCatching { JSONObject(result.body) }.getOrNull()
        if (result.status !in 200..299) {
            val error = json?.optJSONObject("error")
            throw ApiError(
                error?.optString("code").orEmpty().ifEmpty { "REQUEST_FAILED" },
                error?.optString("message").orEmpty().ifEmpty { "Request failed" },
                result.status,
            )
        }
        return json ?: JSONObject()
    }
}
