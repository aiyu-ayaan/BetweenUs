# What R8 must not take away.
#
# The rule for this file is that every entry says *why*. A keep rule nobody can
# explain is a keep rule nobody dares delete, and a proguard file grows into a
# list of everything anybody was ever frightened of.
#
# Everything not listed here is fair game, which is the point: the release build
# shrinks, obfuscates and optimises, and `shrinkResources` drops the drawables
# and strings that survive only because a library shipped them.

# --- WebRTC ------------------------------------------------------------------
#
# The whole media stack is a JNI library calling back into Java by name. A
# renamed method is a call that finds nothing at runtime - and it fails when a
# call starts, not when the app does, which is the worst place to find out.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# --- OkHttp ------------------------------------------------------------------
#
# OkHttp reflects on optional platform pieces (Conscrypt, BouncyCastle, the
# Android platform provider) and warns about ones that are not on the classpath.
# The warnings are expected; the classes are genuinely absent.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- Room --------------------------------------------------------------------
#
# The generated DAO implementations are found by name at runtime, and the
# entities are read reflectively when a schema is verified.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep @androidx.room.Entity class * { *; }
-dontwarn androidx.room.paging.**

# --- Kotlin coroutines -------------------------------------------------------
#
# The debug agent and the service loader are optional and absent in release.
-dontwarn kotlinx.coroutines.debug.**
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }

# --- Compose -----------------------------------------------------------------
#
# Compose ships its own consumer rules; this is the one thing they do not
# cover here - a composable referenced only from a preview annotation.
-dontwarn androidx.compose.ui.tooling.**

# --- Our own model layer -----------------------------------------------------
#
# Nothing here is serialised reflectively: `Models.kt` parses org.json by hand,
# which is exactly why it can be obfuscated like everything else. If a
# serialization library ever arrives, this is where its rule goes - and not
# before, because a keep rule for a library nobody uses is dead weight that
# looks load-bearing.
