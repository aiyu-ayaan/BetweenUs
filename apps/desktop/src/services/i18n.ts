/**
 * Where the words live, and which way the layout runs.
 *
 * Groundwork rather than translations: nothing here ships a second language,
 * and the phase that adds one does not have to touch a single component to do
 * it. Extracting strings after another fifty screens is the expensive version
 * of this, which is why it is here now, with one language in it.
 *
 * ## Why `t(key, fallback)` and not `t(key)`
 *
 * The usual shape makes English a *lookup*, so a missing entry renders a key
 * — `chat.empty.title` on somebody's screen — and every extraction is a chance
 * to ship one. Here English is the argument: the fallback **is** the string,
 * the key names it for a translator, and a catalogue that has never been
 * written renders exactly what the component would have rendered anyway. The
 * extraction becomes incremental and cannot regress the shipping language,
 * which is the only property that makes doing it over fifty screens survivable.
 *
 * The catalogue is `Record<key, string>` per locale, and `en` is deliberately
 * empty: English is already at the call sites, and a second copy of it here is
 * a second thing to keep in step.
 *
 * ## Direction
 *
 * `dir` on `<html>` is what actually flips a layout, and it flips it only if
 * the layout was written in logical properties - `ms-2` rather than `ml-2`,
 * `text-start` rather than `text-left`, `end-0` rather than `right-0`. That
 * sweep has been done and `i18n.check.ts` holds it, because one `ml-2` added
 * later is a component that stays left-aligned inside a right-to-left screen
 * and nothing warns anybody.
 */

export type Locale = 'en' | 'ar' | 'he' | 'fa' | 'ur';

export type Direction = 'ltr' | 'rtl';

/**
 * The locales the client knows the *shape* of. Being here is not a claim that
 * anything is translated - it is a claim about which way the screen runs and
 * what the language is called, both of which are needed before a single string
 * exists.
 */
export const LOCALES: Array<{ id: Locale; label: string; direction: Direction }> = [
  { id: 'en', label: 'English', direction: 'ltr' },
  { id: 'ar', label: 'العربية', direction: 'rtl' },
  { id: 'he', label: 'עברית', direction: 'rtl' },
  { id: 'fa', label: 'فارسی', direction: 'rtl' },
  { id: 'ur', label: 'اردو', direction: 'rtl' },
];

const RTL = new Set<Locale>(['ar', 'he', 'fa', 'ur']);

/**
 * Which way this locale runs.
 *
 * Unknown reads as `ltr` rather than throwing: a locale from a newer build, or
 * a corrupted preference, is never worth failing to draw the app over - the
 * same rule `asDensity` follows.
 */
export function direction(locale: string): Direction {
  return RTL.has(locale as Locale) ? 'rtl' : 'ltr';
}

/** Whatever came out of storage, as a locale this build knows. */
export function asLocale(value: unknown): Locale {
  return LOCALES.some((entry) => entry.id === value) ? (value as Locale) : 'en';
}

/**
 * The locale the machine asks for, narrowed to one this build knows.
 *
 * `navigator.language` is a tag like `ar-EG`, so only the primary subtag is
 * looked at - a client that ignored `ar-EG` because it only knows `ar` would be
 * ignoring the whole point of the tag.
 */
export function preferredLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0];
    const known = LOCALES.find((entry) => entry.id === primary);
    if (known) return known.id;
  }
  return 'en';
}

/**
 * A catalogue per locale: the key a component asked for, mapped to the words in
 * that language. `en` is empty on purpose - see the note at the top.
 */
export type Catalogue = Partial<Record<Locale, Record<string, string>>>;

const catalogues: Catalogue = { en: {} };

let current: Locale = 'en';

/** The locale in force. */
export function locale(): Locale {
  return current;
}

/**
 * Sets the locale and points the document the right way.
 *
 * `lang` as well as `dir`, and not as a nicety: a screen reader picks its voice
 * and its pronunciation rules from `lang`, so an Arabic interface tagged `en`
 * is read aloud by an English synthesiser. It is the cheapest accessibility
 * line in this file and the easiest one to leave out.
 */
export function setLocale(next: Locale, root?: { lang: string; dir: string }): void {
  current = next;
  const element = root ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  if (!element) return;
  element.lang = next;
  element.dir = direction(next);
}

/** Adds or replaces one locale's words. The shape a translation file arrives in. */
export function loadCatalogue(target: Locale, entries: Record<string, string>): void {
  catalogues[target] = { ...catalogues[target], ...entries };
}

/**
 * The words for `key`, or `fallback` when this locale has none.
 *
 * `vars` fills `{name}` placeholders. Named rather than positional because a
 * translator reorders a sentence and cannot reorder `%s` - which is the bug
 * that positional formatting exists to produce.
 *
 * A placeholder with no matching variable is **left as it was written** rather
 * than blanked. An empty gap in a sentence says nothing about what went wrong;
 * a literal `{count}` on screen names the missing variable.
 */
export function t(key: string, fallback: string, vars?: Record<string, string | number>): string {
  const template = catalogues[current]?.[key] ?? fallback;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
