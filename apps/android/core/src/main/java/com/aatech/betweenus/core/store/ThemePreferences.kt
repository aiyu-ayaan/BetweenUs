package com.aatech.betweenus.core.store

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Persisted theme and appearance preferences for BetweenUs Android.
 *
 * Saves selected theme, system auto-sync state, and custom accent tint.
 */
object ThemePreferences {
    private lateinit var prefs: SharedPreferences

    private const val PREFS_NAME = "betweenus.theme"
    private const val KEY_THEME = "selectedTheme"
    private const val KEY_FOLLOW_SYSTEM = "followSystem"
    private const val KEY_ACCENT = "customAccentId"

    private val _selectedTheme = MutableStateFlow("dark")
    val selectedTheme: StateFlow<String> = _selectedTheme.asStateFlow()

    private val _followSystem = MutableStateFlow(false)
    val followSystem: StateFlow<Boolean> = _followSystem.asStateFlow()

    private val _customAccentId = MutableStateFlow("default")
    val customAccentId: StateFlow<String> = _customAccentId.asStateFlow()

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        _selectedTheme.value = prefs.getString(KEY_THEME, "dark") ?: "dark"
        _followSystem.value = prefs.getBoolean(KEY_FOLLOW_SYSTEM, false)
        _customAccentId.value = prefs.getString(KEY_ACCENT, "default") ?: "default"
    }

    fun setTheme(themeId: String) {
        _selectedTheme.value = themeId
        _followSystem.value = false // Explicit theme selection disables follow system
        if (::prefs.isInitialized) {
            prefs.edit()
                .putString(KEY_THEME, themeId)
                .putBoolean(KEY_FOLLOW_SYSTEM, false)
                .apply()
        }
    }

    fun setFollowSystem(follow: Boolean) {
        _followSystem.value = follow
        if (::prefs.isInitialized) {
            prefs.edit().putBoolean(KEY_FOLLOW_SYSTEM, follow).apply()
        }
    }

    fun setCustomAccent(accentId: String) {
        _customAccentId.value = accentId
        if (::prefs.isInitialized) {
            prefs.edit().putString(KEY_ACCENT, accentId).apply()
        }
    }
}
