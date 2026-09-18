# @Mention Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full user-facing @mention autocomplete and visual highlighting across Desktop (Discord/Teams style) and Android (WhatsApp style).

**Architecture:** Client-side query extraction (`mentionQueryAt`), real-time autocomplete UI popovers fed from local member caches (`useChatStore` / `Workspace`), inline mention badge rendering (`@mention` pills), and row-level alert highlighting for messages mentioning the current user.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Electron, Kotlin, Jetpack Compose, Coil.

**Spec:** `docs/superpowers/specs/2026-09-19-mention-feature-design.md`

## Global Constraints

- Message wire format remains plain text (`@username`, `@everyone`, `@here`); E2EE envelopes are unviolated.
- Delimiter boundaries: `@` must start at index 0 or follow whitespace, preventing false triggers in email addresses.
- Zero regressions to `:emoji:` autocomplete (`EmojiSuggest`) and markdown formatting (`markup.ts` / `Markup.kt`).
- Desktop UI: Discord / Teams style floating popover above composer with keyboard navigation (`ArrowUp`/`ArrowDown`, `Enter`/`Tab`, `Escape`).
- Android UI: WhatsApp style attached bottom sheet above composer with rounded top corners, avatar, display name, and `@username`.

---

### Task 1: Desktop Mention Query Extractor

**Files:**
- Create: `apps/desktop/src/features/chat/mention-query.ts`
- Create: `apps/desktop/src/features/chat/mention-query.check.ts`
- Modify: `apps/desktop/package.json:18`

**Interfaces:**
- Produces:
  ```typescript
  export interface MentionQuery {
    term: string;
    start: number;
  }
  export function mentionQueryAt(text: string, caret: number): MentionQuery | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/features/chat/mention-query.check.ts`:
```typescript
/** Run with `npx tsx src/features/chat/mention-query.check.ts`. */
import assert from 'node:assert/strict';
import { mentionQueryAt } from './mention-query';

// Query at caret
assert.deepEqual(mentionQueryAt('@', 1), { term: '', start: 0 });
assert.deepEqual(mentionQueryAt('@ali', 4), { term: 'ali', start: 0 });
assert.deepEqual(mentionQueryAt('hello @ali', 10), { term: 'ali', start: 6 });
assert.deepEqual(mentionQueryAt('hello @ali and more', 10), { term: 'ali', start: 6 });
assert.deepEqual(mentionQueryAt('hey @', 5), { term: '', start: 4 });

// Invalid: email address or middle of word
assert.equal(mentionQueryAt('test@example.com', 5), null, 'email is not a mention');
assert.equal(mentionQueryAt('hello@world', 7), null, 'mid-word @ is not a mention');

// Invalid: spaces inside term
assert.equal(mentionQueryAt('@ali smith', 10), null, 'space terminates query');

// Invalid: no @ symbol
assert.equal(mentionQueryAt('hello world', 5), null);
assert.equal(mentionQueryAt('', 0), null);
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx tsx apps/desktop/src/features/chat/mention-query.check.ts
```
Expected: FAIL with "Cannot find module './mention-query'"

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/features/chat/mention-query.ts`:
```typescript
/**
 * Detects an active `@mention` query in progress at `caret`.
 *
 * Patterned after `emojiQueryAt`: returns where the `@` starts and what has
 * been typed after it, so the composer can search members and replace the term
 * on selection.
 */
export interface MentionQuery {
  term: string;
  start: number;
}

export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;

  const term = before.slice(at + 1);

  // A space, newline, or punctuation terminates the query
  if (/[\s]/.test(term)) return null;
  // Valid username/search characters
  if (term.length > 0 && !/^[a-z0-9_.-]+$/i.test(term)) return null;

  // The character preceding `@` must be start of string or whitespace
  const preceding = at === 0 ? '' : (before[at - 1] ?? '');
  if (preceding !== '' && !/\s/.test(preceding)) return null;

  return { term, start: at };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx tsx apps/desktop/src/features/chat/mention-query.check.ts
```
Expected: PASS with exit code 0.

- [ ] **Step 5: Add check file to package.json check script and commit**

Modify `apps/desktop/package.json` to include `&& tsx src/features/chat/mention-query.check.ts` in the `"check"` script.
Commit:
```bash
git add apps/desktop/src/features/chat/mention-query.ts apps/desktop/src/features/chat/mention-query.check.ts apps/desktop/package.json
git commit -m "feat(desktop): add mentionQueryAt with check tests"
```

---

### Task 2: Desktop Mention Suggest Popover Component

**Files:**
- Create: `apps/desktop/src/features/chat/MentionSuggest.tsx`

**Interfaces:**
- Consumes:
  - `ServerMember` from `@betweenus/shared-types`
  - `Channel` from `@betweenus/shared-types`
  - `Avatar` from `../../components/Avatar`
- Produces:
  ```typescript
  export function MentionSuggest(props: {
    term: string;
    members: readonly ServerMember[];
    isDirect: boolean;
    onPick: (username: string) => void;
    onClose: () => void;
  }): JSX.Element | null;
  ```

- [ ] **Step 1: Write MentionSuggest.tsx**

Create `apps/desktop/src/features/chat/MentionSuggest.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { ServerMember } from '@betweenus/shared-types';
import { PersonAvatar } from '../../components/Avatar';
import { UsersIcon } from '../../components/icons';

export interface MentionOption {
  kind: 'broadcast' | 'member';
  id: string;
  name: string;
  subtitle: string;
  username: string;
  member?: ServerMember;
}

const BROADCASTS: MentionOption[] = [
  {
    kind: 'broadcast',
    id: 'everyone',
    name: '@everyone',
    subtitle: 'Notify everyone in this channel',
    username: 'everyone',
  },
  {
    kind: 'broadcast',
    id: 'here',
    name: '@here',
    subtitle: 'Notify active members in this channel',
    username: 'here',
  },
];

export function filterMentionOptions(
  term: string,
  members: readonly ServerMember[],
  isDirect: boolean,
): MentionOption[] {
  const needle = term.trim().toLowerCase();

  const matchingBroadcasts = isDirect
    ? []
    : BROADCASTS.filter(
        (b) => b.username.includes(needle) || b.name.toLowerCase().includes(needle),
      );

  const memberOptions: MentionOption[] = members.map((m) => ({
    kind: 'member',
    id: m.id || m.userId,
    name: m.displayName || m.username,
    subtitle: `@${m.username}`,
    username: m.username,
    member: m,
  }));

  const matchingMembers = memberOptions
    .filter(
      (m) =>
        m.username.toLowerCase().includes(needle) ||
        m.name.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const aUser = a.username.toLowerCase();
      const bUser = b.username.toLowerCase();
      if (aUser === needle) return -1;
      if (bUser === needle) return 1;
      if (aUser.startsWith(needle) && !bUser.startsWith(needle)) return -1;
      if (!aUser.startsWith(needle) && bUser.startsWith(needle)) return 1;
      return a.name.localeCompare(b.name);
    });

  return [...matchingBroadcasts, ...matchingMembers].slice(0, 10);
}

export function MentionSuggest({
  term,
  members,
  isDirect,
  onPick,
  onClose,
}: {
  term: string;
  members: readonly ServerMember[];
  isDirect: boolean;
  onPick: (username: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const [matches, setMatches] = useState<MentionOption[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const found = filterMentionOptions(term, members, isDirect);
    setMatches(found);
    setActive(0);
  }, [term, members, isDirect]);

  useEffect(() => {
    if (matches.length === 0) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((at) => (at + 1) % matches.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((at) => (at - 1 + matches.length) % matches.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const chosen = matches[active];
        if (chosen) onPick(chosen.username);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [matches, active, onPick, onClose]);

  if (matches.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full inset-x-3.5 z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-edge bg-surface-900 py-1 shadow-pop"
    >
      <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">
        {term ? `Members matching @${term}` : 'Members'}
      </p>
      <ul>
        {matches.map((match, index) => (
          <li key={match.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => onPick(match.username)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-start transition-colors duration-100 ${
                index === active ? 'bg-white/[0.08]' : ''
              }`}
            >
              {match.kind === 'broadcast' ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-accent">
                  <UsersIcon className="h-4 w-4" />
                </div>
              ) : match.member ? (
                <PersonAvatar
                  name={match.member.displayName || match.member.username}
                  url={match.member.avatarUrl}
                  size="sm"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-200">
                  {match.name}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {match.subtitle}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Add check file for filter logic**

Create `apps/desktop/src/features/chat/MentionSuggest.check.ts`:
```typescript
/** Run with `npx tsx src/features/chat/MentionSuggest.check.ts`. */
import assert from 'node:assert/strict';
import { filterMentionOptions } from './MentionSuggest';
import type { ServerMember } from '@betweenus/shared-types';

const mockMembers: ServerMember[] = [
  {
    id: '1',
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice Cooper',
    avatarUrl: null,
    role: 'MEMBER',
    permissions: [],
    grantedPermissions: [],
    deniedPermissions: [],
    roleIds: [],
    colour: null,
    about: '',
    coverUrl: null,
    joinedAt: '',
  },
  {
    id: '2',
    userId: 'u2',
    username: 'bob',
    displayName: 'Bob Builder',
    avatarUrl: null,
    role: 'MEMBER',
    permissions: [],
    grantedPermissions: [],
    deniedPermissions: [],
    roleIds: [],
    colour: null,
    about: '',
    coverUrl: null,
    joinedAt: '',
  },
];

// Empty term returns broadcasts and all members in server
const initial = filterMentionOptions('', mockMembers, false);
assert.equal(initial[0]?.username, 'everyone');
assert.equal(initial[1]?.username, 'here');
assert.equal(initial.length, 4);

// Filter by username
const filteredUser = filterMentionOptions('ali', mockMembers, false);
assert.equal(filteredUser[0]?.username, 'alice');

// Direct channel suppresses broadcasts
const direct = filterMentionOptions('', mockMembers, true);
assert.ok(!direct.some((m) => m.kind === 'broadcast'));
```

- [ ] **Step 3: Run check test**

Run:
```bash
npx tsx apps/desktop/src/features/chat/MentionSuggest.check.ts
```
Expected: PASS with exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/chat/MentionSuggest.tsx apps/desktop/src/features/chat/MentionSuggest.check.ts
git commit -m "feat(desktop): add MentionSuggest popover component"
```

---

### Task 3: Desktop ChatView Composer Integration

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatView.tsx`

**Interfaces:**
- Consumes: `mentionQueryAt` and `MentionSuggest` from earlier tasks.
- Produces: Autocomplete popover triggered on typing `@`, inserting `@username ` on selection.

- [ ] **Step 1: Wire mention query state & MentionSuggest in ChatView.tsx**

In `MessageComposer`:
1. Import `mentionQueryAt` and `MentionSuggest`.
2. Add state `const [mentionQuery, setMentionQuery] = useState<{ term: string; start: number } | null>(null);`
3. Read `members = useChatStore((state) => state.members);`
4. Update `onChange` and `onSelect` of textarea to invoke `setMentionQuery(mentionQueryAt(...))`.
5. On blur, close mention query after timeout or keep synced.
6. Render `<MentionSuggest>` above composer:
   ```tsx
   {mentionQuery && (
     <MentionSuggest
       term={mentionQuery.term}
       members={members}
       isDirect={channel.type === 'DM'}
       onClose={() => setMentionQuery(null)}
       onPick={(username) => {
         const end = mentionQuery.start + mentionQuery.term.length + 1;
         const insert = `@${username} `;
         const next = `${content.slice(0, mentionQuery.start)}${insert}${content.slice(end)}`;
         const caret = mentionQuery.start + insert.length;
         setContent(next);
         setMentionQuery(null);
         window.setTimeout(() => {
           box.current?.focus();
           box.current?.setSelectionRange(caret, caret);
         }, 0);
       }}
     />
   )}
   ```

- [ ] **Step 2: Verify desktop build passes**

Run:
```bash
pnpm --filter @betweenus/desktop typecheck
```
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/chat/ChatView.tsx
git commit -m "feat(desktop): integrate MentionSuggest in MessageComposer"
```

---

### Task 4: Desktop Message Mention Highlighting & Row Alert

**Files:**
- Modify: `apps/desktop/src/features/chat/ChatView.tsx`

**Interfaces:**
- Consumes: `mentionsMe` from `../../services/mentions`.
- Produces: Highlighting `@mentions` in message bodies and accent alert styling on message rows addressed to the user.

- [ ] **Step 1: Enhance text rendering to split on mentions and render badges**

In `ChatView.tsx`:
Replace plain text rendering in `renderTextWithLinks` or wrap it with `renderTextWithMentionsAndLinks`:
```tsx
const MENTION_REGEX = /(@[a-z0-9_.-]+)/gi;

function renderTextWithMentionsAndLinks(
  text: string,
  onOpenMention?: (username: string) => void,
): JSX.Element {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) => {
        if (part.match(/^https?:\/\//i)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent-hover font-medium break-all transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        // Split non-URL text by mentions
        const subparts = part.split(MENTION_REGEX);
        return (
          <Fragment key={i}>
            {subparts.map((sub, j) => {
              if (sub.startsWith('@') && sub.length > 1) {
                const target = sub.slice(1);
                return (
                  <span
                    key={j}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenMention?.(target);
                    }}
                    className="inline-flex items-center font-semibold text-accent bg-accent/15 px-1 py-0.5 rounded text-[0.9em] mx-0.5 hover:bg-accent/25 transition-colors cursor-pointer"
                  >
                    {sub}
                  </span>
                );
              }
              return <Fragment key={j}>{sub}</Fragment>;
            })}
          </Fragment>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Update MessageRow container highlight when addressed to me**

In `MessageItem` in `ChatView.tsx`:
Check `const mentioned = me ? mentionsMe(message.content, me) : false;`
When `mentioned` is true, add `border-s-2 border-accent bg-accent/[0.04]` to the message container.

- [ ] **Step 3: Run desktop typecheck and check suite**

Run:
```bash
pnpm --filter @betweenus/desktop typecheck
```
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/chat/ChatView.tsx
git commit -m "feat(desktop): add @mention badge rendering and row highlight alert"
```

---

### Task 5: Android Mention Query Extractor

**Files:**
- Create: `apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionQuery.kt`
- Create: `apps/android/app/src/test/java/com/aatech/betweenus/feature/chat/MentionQueryTest.kt`

**Interfaces:**
- Produces:
  ```kotlin
  data class MentionQuery(val term: String, val start: Int)
  object MentionQueryParser {
      fun queryAt(text: String, caret: Int): MentionQuery?
  }
  ```

- [ ] **Step 1: Write the failing unit test**

Create `apps/android/app/src/test/java/com/aatech/betweenus/feature/chat/MentionQueryTest.kt`:
```kotlin
package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MentionQueryTest {
    @Test
    fun detectsMentionAtStart() {
        assertEquals(MentionQuery("", 0), MentionQueryParser.queryAt("@", 1))
        assertEquals(MentionQuery("ali", 0), MentionQueryParser.queryAt("@ali", 4))
    }

    @Test
    fun detectsMentionAfterWhitespace() {
        assertEquals(MentionQuery("bob", 6), MentionQueryParser.queryAt("hello @bob", 10))
        assertEquals(MentionQuery("", 6), MentionQueryParser.queryAt("hello @", 7))
    }

    @Test
    fun ignoresEmailAddresses() {
        assertNull(MentionQueryParser.queryAt("test@example.com", 5))
        assertNull(MentionQueryParser.queryAt("user@domain", 11))
    }

    @Test
    fun ignoresWhitespaceInTerm() {
        assertNull(MentionQueryParser.queryAt("@ali smith", 10))
    }
}
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
./gradlew :app:testDebugUnitTest --tests "com.aatech.betweenus.feature.chat.MentionQueryTest"
```
Expected: FAIL compilation with Unresolved reference: MentionQuery.

- [ ] **Step 3: Implement MentionQuery.kt**

Create `apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionQuery.kt`:
```kotlin
package com.aatech.betweenus.feature.chat

data class MentionQuery(val term: String, val start: Int)

object MentionQueryParser {
    fun queryAt(text: String, caret: Int): MentionQuery? {
        if (caret <= 0 || caret > text.length) return null
        val before = text.substring(0, caret)
        val at = before.lastIndexOf('@')
        if (at == -1) return null

        val term = before.substring(at + 1)
        if (term.any { it.isWhitespace() }) return null
        if (term.isNotEmpty() && !term.all { it.isLetterOrDigit() || it == '_' || it == '.' || it == '-' }) {
            return null
        }

        val preceding = if (at == 0) null else before[at - 1]
        if (preceding != null && !preceding.isWhitespace()) return null

        return MentionQuery(term, at)
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
./gradlew :app:testDebugUnitTest --tests "com.aatech.betweenus.feature.chat.MentionQueryTest"
```
Expected: BUILD SUCCESSFUL with 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionQuery.kt apps/android/app/src/test/java/com/aatech/betweenus/feature/chat/MentionQueryTest.kt
git commit -m "feat(android): add MentionQueryParser with unit tests"
```

---

### Task 6: Android WhatsApp-Style Mention Suggest Popup

**Files:**
- Create: `apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionSuggest.kt`

**Interfaces:**
- Consumes: `ServerMember` from `com.aatech.betweenus.core.data`, `MentionQuery`.
- Produces:
  ```kotlin
  @Composable
  fun MentionSuggestPopup(
      query: MentionQuery,
      members: List<ServerMember>,
      isDirect: Boolean,
      onPick: (String) -> Unit,
      modifier: Modifier = Modifier,
  )
  ```

- [ ] **Step 1: Create MentionSuggest.kt**

Create `apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionSuggest.kt`:
```kotlin
package com.aatech.betweenus.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Group
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.aatech.betweenus.core.data.Endpoint
import com.aatech.betweenus.core.data.ServerMember
import com.aatech.betweenus.ui.theme.Accent
import com.aatech.betweenus.ui.theme.Slate100
import com.aatech.betweenus.ui.theme.Slate400
import com.aatech.betweenus.ui.theme.Surface800
import com.aatech.betweenus.ui.theme.Surface900

sealed interface MentionOption {
    val username: String
    val displayName: String

    data class Broadcast(
        override val username: String,
        override val displayName: String,
        val description: String,
    ) : MentionOption

    data class Member(
        val member: ServerMember,
    ) : MentionOption {
        override val username: String get() = member.username
        override val displayName: String get() = member.displayName.ifBlank { member.username }
    }
}

fun filterMentions(
    term: String,
    members: List<ServerMember>,
    isDirect: Boolean,
): List<MentionOption> {
    val needle = term.trim().lowercase()

    val broadcasts = if (isDirect) emptyList() else listOf(
        MentionOption.Broadcast("everyone", "@everyone", "Notify everyone in this channel"),
        MentionOption.Broadcast("here", "@here", "Notify active members"),
    ).filter { it.username.contains(needle) }

    val memberOptions = members.map { MentionOption.Member(it) }
        .filter {
            it.username.lowercase().contains(needle) ||
            it.displayName.lowercase().contains(needle)
        }
        .sortedWith(compareBy({ !it.username.lowercase().startsWith(needle) }, { it.displayName }))

    return (broadcasts + memberOptions).take(12)
}

@Composable
fun MentionSuggestPopup(
    query: MentionQuery,
    members: List<ServerMember>,
    isDirect: Boolean,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val filtered = remember(query.term, members, isDirect) {
        filterMentions(query.term, members, isDirect)
    }

    if (filtered.isEmpty()) return

    Surface(
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        color = Surface900,
        shadowElevation = 8.dp,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(max = 240.dp),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        ) {
            items(filtered, key = { it.username }) { option ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(option.username) }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    when (option) {
                        is MentionOption.Broadcast -> {
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .clip(CircleShape)
                                    .background(Accent.copy(alpha = 0.2f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Group,
                                    contentDescription = null,
                                    tint = Accent,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                        is MentionOption.Member -> {
                            val avatarUrl = option.member.avatarUrl?.let { Endpoint.absolute(it) }
                            if (avatarUrl != null) {
                                AsyncImage(
                                    model = avatarUrl,
                                    contentDescription = option.displayName,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .size(38.dp)
                                        .clip(CircleShape),
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(38.dp)
                                        .clip(CircleShape)
                                        .background(Surface800),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        text = option.displayName.take(1).uppercase(),
                                        color = Slate100,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp,
                                    )
                                }
                            }
                        }
                    }

                    Spacer(Modifier.width(12.dp))

                    Column(Modifier.weight(1f)) {
                        Text(
                            text = option.displayName,
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = Slate100,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = when (option) {
                                is MentionOption.Broadcast -> option.description
                                is MentionOption.Member -> "@${option.username}"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = Slate400,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MentionSuggest.kt
git commit -m "feat(android): add WhatsApp-style MentionSuggestPopup"
```

---

### Task 7: Android Composer Integration

**Files:**
- Modify: `apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/Composer.kt`

**Interfaces:**
- Consumes: `MentionQueryParser` and `MentionSuggestPopup`.
- Produces: Autocomplete popup when typing `@`, inserting `@username ` on selection.

- [ ] **Step 1: Wire mention query & popup into Composer.kt**

In `Composer.kt`:
1. Collect members:
   ```kotlin
   val serverId = remember(channelId) { Workspace.channel(channelId)?.serverId }
   val members = remember(serverId) { serverId?.let { Workspace.membersOf(it) }.orEmpty() }
   val isDirect = remember(channelId) { Workspace.directChannel(channelId) != null }
   ```
2. Detect mention query:
   ```kotlin
   val mentionQuery = remember(field) { MentionQueryParser.queryAt(field.text, field.selection.start) }
   ```
3. Insert mention handler:
   ```kotlin
   fun insertMention(username: String, query: MentionQuery) {
       val caret = field.selection.start
       val from = query.start
       val before = field.text.substring(0, from)
       val after = field.text.substring(caret)
       val insertion = "@$username "
       field = TextFieldValue(before + insertion + after, TextRange(from + insertion.length))
   }
   ```
4. Render `MentionSuggestPopup` right above composer bar when `mentionQuery != null`.

- [ ] **Step 2: Compile & verify Android unit tests**

Run:
```bash
./gradlew :app:compileDebugKotlin
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/Composer.kt
git commit -m "feat(android): wire MentionSuggestPopup into chat Composer"
```

---

### Task 8: Android Message Mention Highlighting & Row Alert

**Files:**
- Modify: `apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MessageRow.kt`

**Interfaces:**
- Consumes: `PushGate.mentions`
- Produces: WhatsApp-style high-contrast accent text for `@mentions`, profile opening on tap, and bubble highlight when user is mentioned.

- [ ] **Step 1: Enhance appendWithLinks in MessageRow.kt**

In `MessageRow.kt`:
Scan text for mentions using Regex `@([a-zA-Z0-9_.-]+)`:
```kotlin
private val MENTION_REGEX = Pattern.compile("@([a-zA-Z0-9_.-]+)")

private fun AnnotatedString.Builder.appendWithMentionsAndLinks(
    text: String,
    onMention: ((String) -> Unit)? = null,
) {
    // Splits on URLs first, then mentions in non-URL segments
    val urlMatcher = URL_REGEX.matcher(text)
    var lastIndex = 0
    while (urlMatcher.find()) {
        val start = urlMatcher.start()
        val end = urlMatcher.end()
        val url = urlMatcher.group()

        if (start > lastIndex) {
            appendMentions(text.substring(lastIndex, start))
        }

        pushStringAnnotation(tag = "URL", annotation = url)
        pushStyle(SpanStyle(color = Accent, textDecoration = TextDecoration.Underline, fontWeight = FontWeight.Medium))
        append(url)
        pop()
        pop()

        lastIndex = end
    }
    if (lastIndex < text.length) {
        appendMentions(text.substring(lastIndex))
    }
}

private fun AnnotatedString.Builder.appendMentions(text: String) {
    val matcher = MENTION_REGEX.matcher(text)
    var last = 0
    while (matcher.find()) {
        val start = matcher.start()
        val end = matcher.end()
        val mention = matcher.group()

        if (start > last) {
            append(text.substring(last, start))
        }

        pushStringAnnotation(tag = "MENTION", annotation = matcher.group(1))
        pushStyle(
            SpanStyle(
                color = Accent,
                fontWeight = FontWeight.SemiBold,
                background = Accent.copy(alpha = 0.15f),
            )
        )
        append(mention)
        pop()
        pop()

        last = end
    }
    if (last < text.length) {
        append(text.substring(last))
    }
}
```

- [ ] **Step 2: Add row alert when user is mentioned**

In `MessageRow`, check:
```kotlin
val mentioned = remember(readable.text, self) { PushGate.mentions(readable.text, self) }
```
When `mentioned` is true, add `Modifier.background(Accent.copy(alpha = 0.08f))` or border indicator to message bubble.

- [ ] **Step 3: Run Android tests**

Run:
```bash
./gradlew :app:testDebugUnitTest
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/MessageRow.kt
git commit -m "feat(android): add mention highlighting and addressed alert in MessageRow"
```

---

### Task 9: Full End-to-End Build & Verification

**Files:**
- None (Verification only)

- [ ] **Step 1: Run all desktop checks and typechecks**

Run:
```bash
pnpm --filter @betweenus/desktop check
pnpm --filter @betweenus/desktop typecheck
```
Expected: All check scripts pass with 0 errors.

- [ ] **Step 2: Run all Android unit tests**

Run:
```bash
./gradlew testDebugUnitTest
```
Expected: All tests pass.

- [ ] **Step 3: Update documentation in devdocs/TODO.md**

Check off `@mentions` visual highlighting and autocomplete item in `development/devdocs/TODO.md`.
Commit:
```bash
git add development/devdocs/TODO.md
git commit -m "docs: mark @mention autocomplete and highlighting complete"
```
