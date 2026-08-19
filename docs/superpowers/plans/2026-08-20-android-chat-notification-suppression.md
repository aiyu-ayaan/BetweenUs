# Android Active Chat FCM Notification Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ensure FCM push notifications on Android are suppressed when the target chat channel is actively open in the foreground (e.g. viewing Server 1 #general suppresses notifications for Server 1 #general, while notifications for Server 2 are still shown), and update the development docs.

**Architecture:** Encapsulate suppression check in PushGate.shouldSuppress(channelId, isForeground, visibleChannelId), consume it in PushService.kt, add unit tests in PushGateTest.kt, and update development tracking documents.

**Tech Stack:** Kotlin, Android Jetpack Compose, JUnit4, Firebase Cloud Messaging.

## Global Constraints
- Do not add any new backend endpoints.
- Keep PushGate.shouldSuppress pure and testable with optional default parameters.
- Follow existing codebase style and commit conventions.

---

### Task 1: Add PushGate.shouldSuppress & Unit Tests

**Files:**
- Modify: pps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushGate.kt
- Test: pps/android/app/src/test/java/com/aatech/betweenus/feature/notifications/PushGateTest.kt

**Interfaces:**
- Produces: un shouldSuppress(channelId: String, isForeground: Boolean = AppForeground.visible, visibleChannelId: String? = Conversation.visibleChannelId): Boolean

- [ ] **Step 1: Write the unit test for PushGate.shouldSuppress**

In pps/android/app/src/test/java/com/aatech/betweenus/feature/notifications/PushGateTest.kt:
`kotlin
    @Test
    fun suppresses push when the exact channel is open in the foreground() {
        val server1General = "chan_server1_general"
        val server2General = "chan_server2_general"
        val server1Random = "chan_server1_random"

        // Server 1 general is open in foreground: suppress push for server 1 general
        assertTrue(
            PushGate.shouldSuppress(
                channelId = server1General,
                isForeground = true,
                visibleChannelId = server1General,
            )
        )

        // Server 1 general is open in foreground: DO NOT suppress push for server 2 general
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server2General,
                isForeground = true,
                visibleChannelId = server1General,
            )
        )

        // Server 1 general is open in foreground: DO NOT suppress push for server 1 random
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server1Random,
                isForeground = true,
                visibleChannelId = server1General,
            )
        )

        // App is in background: DO NOT suppress push even if visibleChannelId matches
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server1General,
                isForeground = false,
                visibleChannelId = server1General,
            )
        )

        // No channel is open (e.g., friends tab, drawer): DO NOT suppress
        assertFalse(
            PushGate.shouldSuppress(
                channelId = server1General,
                isForeground = true,
                visibleChannelId = null,
            )
        )
    }
`

- [ ] **Step 2: Run test to verify it fails**

Run: .\gradlew.bat :app:testDebugUnitTest --tests "com.aatech.betweenus.feature.notifications.PushGateTest"
Expected: Compilation failure or missing shouldSuppress method.

- [ ] **Step 3: Implement PushGate.shouldSuppress**

In pps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushGate.kt:
`kotlin
    /**
     * The WhatsApp rule: whether a push for [channelId] should be suppressed because
     * the user is actively viewing that exact chat right now in the foreground.
     *
     * If the user is looking at Server 1 #general (isibleChannelId == "chan_general_1"),
     * a message in that same channel is dropped silently because it's already rendered on screen.
     * A message in Server 2 #general (channelId == "chan_general_2") or any other channel
     * is not suppressed and will post a push notification.
     */
    fun shouldSuppress(
        channelId: String,
        isForeground: Boolean = com.aatech.betweenus.core.store.AppForeground.visible,
        visibleChannelId: String? = com.aatech.betweenus.core.store.Conversation.visibleChannelId,
    ): Boolean = isForeground && visibleChannelId == channelId
`

- [ ] **Step 4: Run unit tests to verify they pass**

Run: .\gradlew.bat :app:testDebugUnitTest --tests "com.aatech.betweenus.feature.notifications.PushGateTest"
Expected: BUILD SUCCESSFUL and all tests PASS.

- [ ] **Step 5: Commit**

`ash
git add apps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushGate.kt apps/android/app/src/test/java/com/aatech/betweenus/feature/notifications/PushGateTest.kt
git commit -m "feat(android): add PushGate.shouldSuppress active channel check with unit tests"
`

---

### Task 2: Integrate PushGate.shouldSuppress into PushService

**Files:**
- Modify: pps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushService.kt

**Interfaces:**
- Consumes: PushGate.shouldSuppress(channelId)

- [ ] **Step 1: Update PushService.kt**

In pps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushService.kt:
Update lines 66-69 to use PushGate.shouldSuppress(channelId).

- [ ] **Step 2: Run all Android unit tests**

Run: .\gradlew.bat testDebugUnitTest
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

`ash
git add apps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushService.kt
git commit -m "feat(android): use PushGate.shouldSuppress in PushService"
`

---

### Task 3: Update Development Tracking Documentation

**Files:**
- Modify: development/ANDROID_TODO.md
- Modify: development/TRACK.md

- [ ] **Step 1: Update development/ANDROID_TODO.md and development/TRACK.md**

Document the active chat channel suppression behavior and unit testing verification under Phase 5 FCM Notifications.

- [ ] **Step 2: Commit**

`ash
git add development/ANDROID_TODO.md development/TRACK.md
git commit -m "docs: update android development tracking for active chat notification suppression"
`
