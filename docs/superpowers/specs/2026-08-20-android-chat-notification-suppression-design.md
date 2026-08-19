# Android Active Chat FCM Notification Suppression (WhatsApp Rule)

## Overview
When a user is actively viewing a specific chat channel on Android (e.g. #general in Server 1), incoming FCM push notifications for that open channel must be suppressed, exactly like WhatsApp. At the same time, notifications for other channels and other servers (e.g. #general in Server 2) must still be posted to the system notification shade.

---

## Requirements & Scope

### 1. Active Channel Suppression Logic
- **Condition**: A push notification for channelId should be dropped if and only if:
  1. The app is in the foreground (isForeground == true, tracked by AppForeground.visible), AND
  2. The channel currently open on screen matches the incoming push message channel (isibleChannelId == channelId, tracked by Conversation.visibleChannelId).
- **Isolation**:
  - Viewing **Server 1 #general** (chan_1) + incoming push for **Server 1 #general** (chan_1) -> **SUPPRESSED** (dropped silently, UI already renders live message via WebSocket).
  - Viewing **Server 1 #general** (chan_1) + incoming push for **Server 2 #general** (chan_2) -> **NOT SUPPRESSED** (posts notification to shade).
  - Viewing **Server 1 #general** (chan_1) + incoming push for **Server 1 #random** (chan_3) -> **NOT SUPPRESSED** (posts notification to shade).
  - App in background / device locked (isForeground == false) + incoming push -> **NOT SUPPRESSED** (posts notification even if it was the last active channel).
  - In Friends / Server drawer / Settings (isibleChannelId == null) + incoming push -> **NOT SUPPRESSED** (posts notification).

---

## Technical Architecture

### 1. PushGate.kt (pps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushGate.kt)
Add pure evaluation helper:
`kotlin
fun shouldSuppress(
    channelId: String,
    isForeground: Boolean = AppForeground.visible,
    visibleChannelId: String? = Conversation.visibleChannelId,
): Boolean = isForeground && visibleChannelId == channelId
`

### 2. PushService.kt (pps/android/app/src/main/java/com/aatech/betweenus/feature/notifications/PushService.kt)
Integrate PushGate.shouldSuppress(channelId) in PushService.handle(data):
`kotlin
if (PushGate.shouldSuppress(channelId)) return
`

### 3. Unit Testing (pps/android/app/src/test/java/com/aatech/betweenus/feature/notifications/PushGateTest.kt)
Add comprehensive test suite covering:
- Foreground active channel matching -> ssertTrue(PushGate.shouldSuppress(...))
- Foreground different channel (Server 1 vs Server 2) -> ssertFalse(PushGate.shouldSuppress(...))
- Foreground different channel in same server -> ssertFalse(PushGate.shouldSuppress(...))
- Background with matching last channel -> ssertFalse(PushGate.shouldSuppress(...))
- No open channel (isibleChannelId == null) -> ssertFalse(PushGate.shouldSuppress(...))

### 4. Development Tracking Documentation
Update development/ANDROID_TODO.md and development/TRACK.md with explicit details on channel/server isolation and verification.

---

## Verification Plan
1. **Unit Tests**: Run ./gradlew :app:testDebugUnitTest --tests "com.aatech.betweenus.feature.notifications.PushGateTest" to verify all edge cases.
2. **Git Commit & Stage**: Commit changes with structured commit message following project conventions.
