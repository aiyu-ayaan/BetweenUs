# @Mention Feature Design: Highlighting & Autocomplete (Desktop & Android)

## Overview & Background
In BetweenUs, @mention detection for push notifications (`@username`, `@display name`, `@everyone`, `@here`) was previously implemented on the backend and in notification gates (`PushGate.kt` on Android, `mentions.ts` on Desktop). However, the user-facing feature remained unfinished:
1. No visual highlighting: messages containing mentions render as plain text.
2. No autocomplete popup: typing `@` does not trigger member suggestions.

This design delivers full @mention support on both **Desktop** (Discord/Teams style) and **Android** (WhatsApp style).

---

## Architecture & Requirements

### Global Constraints & Principles
- **End-to-End Encryption (E2EE) Integrity**: Message content remains sealed end-to-end under channel keys. Mention parsing and highlighting happen strictly client-side after decryption.
- **Pure Text Wire Format**: Mentions are stored as plaintext `@username` (or `@everyone` / `@here`). No proprietary or opaque markup syntax is introduced into the wire body.
- **Zero Regressions to Emoji Autocomplete & Markdown**: The existing `:emoji:` shortcode autocomplete (`EmojiSuggest`) and markdown formatting (`markup.ts` / `Markup.kt`) remain unaffected.
- **Offline / Local Execution**: Member suggestion lists are populated from local in-memory store states (`useChatStore` on desktop, `Workspace` on android) without extra network queries on every keystroke.

---

### Platform Specifications

#### 1. Desktop Experience (Discord / Teams Style)

##### A. Mention Query Detection (`apps/desktop/src/features/chat/mention-query.ts`)
- `mentionQueryAt(text: string, caret: number): { term: string; start: number } | null`:
  - Scans backward from `caret` to locate the active `@` trigger.
  - Verifies `@` is preceded by whitespace, newline, or is at index `0` (prevents false matches in email addresses like `alice@example.com`).
  - Returns `null` if any whitespace, newline, or closing boundary occurs between `@` and `caret`.
  - Returns `{ term, start }` where `term` is the substring between `@` and `caret`. `term.length === 0` (immediately after typing `@`) is valid and opens suggestions.

##### B. Desktop Autocomplete Popup (`apps/desktop/src/features/chat/MentionSuggest.tsx`)
- Appears floating above the composer when `mentionQuery` is non-null.
- Suggestion hierarchy:
  1. Broadcasts (in server channels):
     - `@everyone`: "Notify everyone in this channel"
     - `@here`: "Notify online members in this channel"
  2. Server/Channel Members:
     - Filtered from `useChatStore.getState().members` (or DM participants).
     - Matches `term` case-insensitively against `username` or `displayName` (exact matches first, prefix matches second, substring matches third).
- Keyboard Navigation (window event capture phase like `EmojiSuggest`):
  - `ArrowDown` / `ArrowUp` to cycle active row.
  - `Enter` or `Tab` to select.
  - `Escape` to dismiss.
- Selection Action:
  - Replaces `@term` with `@username ` and restores focus to the textarea with caret placed after the trailing space.

##### C. Desktop Highlighting & Message Rendering (`apps/desktop/src/features/chat/ChatView.tsx`)
- **Inline Mention Badges**:
  - In `renderPieces` / `renderTextWithLinks`, non-link text is scanned for `@everyone`, `@here`, and `@<username>` tokens.
  - Rendered as an inline badge:
    ```tsx
    <span className="inline-flex items-center font-medium text-accent bg-accent/15 px-1.5 py-0.5 rounded text-[0.9em] mx-0.5 hover:underline cursor-pointer">
      @{target}
    </span>
    ```
  - Clicking a member mention triggers their profile hover card or modal.
- **Message Row Highlight (Addressed To Me)**:
  - Evaluated using `mentionsMe(message.content, me)`.
  - When true, the message row displays a leading accent indicator bar (`border-s-2 border-accent`) and a subtle background tint (`bg-accent/[0.04]`).

---

#### 2. Android Experience (WhatsApp Style)

##### A. Mention Query Detection (`apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionQuery.kt`)
- Pure Kotlin utility: `mentionQueryAt(text: String, caret: Int): MentionQuery?`.
- Identical boundary rules to desktop: `@` must start at index 0 or follow whitespace, with no intervening whitespace between `@` and `caret`.

##### B. WhatsApp-Style Attached Autocomplete (`apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionSuggest.kt`)
- Appears attached directly above the composer input field inside `Composer.kt`.
- Styled as an elevated bottom card (`RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)`, max height ~220dp, lazy scrollable list):
  - Broadcasts at top (`@everyone`, `@here`) with broadcast icons.
  - Member rows:
    - 36dp circular avatar (or initials).
    - Primary line: Display Name (`bodyMedium`, bold/semi-bold, `Slate100`).
    - Secondary line: `@username` (`bodySmall`, `Slate400`).
    - Online presence dot.
  - Tapping a member inserts `@username ` at caret position and dismisses the popup.

##### C. Android Highlighting & Message Rendering (`apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MessageRow.kt`)
- **Inline Mentions**:
  - In `appendWithMentionsAndLinks`, matches `@everyone`, `@here`, and `@username`.
  - Pushes `AnnotatedString` styles: `color = Accent`, `fontWeight = FontWeight.SemiBold`.
  - Adds annotation `tag = "MENTION", annotation = username` so tapping opens `onOpenProfile`.
- **Row Highlight (Addressed To Me)**:
  - Uses `PushGate.mentions(readable.text, self)`.
  - When true, message row is tinted with `Accent.copy(alpha = 0.08f)` with an indicator on the bubble.

---

## Testing & Verification Plan

### Desktop
1. **Unit tests (`mention-query.check.ts`)**:
   - Verify query detection at start of string (`@ali`), after space (`hello @ali`), empty term (`@`), mid-word ignored (`email@test.com`), and space termination (`@ali smith`).
2. **Component & Rendering tests**:
   - Verify `MentionSuggest` filters by username and display name.
   - Verify keyboard navigation (`Enter`, `Tab`, `Escape`, arrows).
   - Verify `mentionsMe` row tinting and mention pill rendering.

### Android
1. **Unit tests (`MentionQueryTest.kt`)**:
   - Test caret positioning, whitespace boundary validation, email prevention, empty query string handling.
2. **Compose rendering verification**:
   - Verify `appendWithMentionsAndLinks` annotates string with correct `SpanStyle` and `MENTION` tags.
   - Verify `PushGate.mentions` triggers highlight on row.
