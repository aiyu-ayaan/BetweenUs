/**
 * The channel sidebar's arrangement, as data.
 *
 * Drag and drop, the keyboard shortcuts and the "Move to" menu are three ways
 * of saying the same thing - *this channel goes there* - so they all end up
 * here, in pure functions over `Section[]`, and come out as one
 * `ChannelLayoutRequest`. That keeps the interesting part (which rows move
 * where, across which boundary) checkable without a DOM.
 *
 * Section 0 is always the uncategorized channels, drawn above every category
 * and never draggable as a heading: it has no name to drag.
 *
 * Inside every section the text channels come first and the voice channels
 * after them, each group in its own position order. A voice channel is never
 * drawn between two text ones, however it was dropped: every move re-groups
 * before it is saved, so the saved positions agree with what is drawn.
 */
import {
  sortByPosition,
  type Channel,
  type ChannelCategory,
  type ChannelLayoutRequest,
} from '@betweenus/shared-types';

export interface Section {
  /** Null for the loose channels above every category. */
  category: ChannelCategory | null;
  channels: Channel[];
}

/** True for a channel drawn in the voice group at the bottom of its section. */
function isVoice(channel: Channel): boolean {
  return channel.type === 'VOICE';
}

/** Text channels, then voice channels, each group keeping its relative order. */
export function groupByKind(channels: readonly Channel[]): Channel[] {
  return [
    ...channels.filter((channel) => !isVoice(channel)),
    ...channels.filter(isVoice),
  ];
}

/**
 * Uncategorized first, then each category in order; inside each, text before
 * voice, and every channel in position order within its group.
 */
export function buildSections(
  categories: readonly ChannelCategory[],
  channels: readonly Channel[],
): Section[] {
  const ordered = sortByPosition(categories);
  const known = new Set(ordered.map((category) => category.id));
  const filed = (id: string | null): Channel[] =>
    groupByKind(
      sortByPosition(
        channels.filter((channel) => {
          // A channel pointing at a category we do not hold is drawn loose
          // rather than vanishing.
          const own =
            channel.categoryId && known.has(channel.categoryId) ? channel.categoryId : null;
          return own === id;
        }),
      ),
    );
  return [
    { category: null, channels: filed(null) },
    ...ordered.map((category) => ({ category, channels: filed(category.id) })),
  ];
}

/** The request that makes the server's layout match these sections. */
export function layoutFrom(sections: readonly Section[]): ChannelLayoutRequest {
  return {
    categoryIds: sections.flatMap((section) => (section.category ? [section.category.id] : [])),
    channels: sections.flatMap((section) =>
      section.channels.map((channel) => ({
        id: channel.id,
        categoryId: section.category?.id ?? null,
      })),
    ),
  };
}

/** Where a channel currently sits, or null if it is not in the sections. */
function locate(
  sections: readonly Section[],
  channelId: string,
): { section: number; index: number } | null {
  for (let section = 0; section < sections.length; section += 1) {
    const index = sections[section]?.channels.findIndex((channel) => channel.id === channelId) ?? -1;
    if (index >= 0) return { section, index };
  }
  return null;
}

/**
 * Moves a channel to `index` of the section holding `categoryId` (null for
 * the loose ones). `index` counts in the destination *after* the channel has
 * been taken out of wherever it was, which is what a drop position means.
 * The destination is then re-grouped text-before-voice, so a voice channel
 * dropped among text channels lands at the top of the voice group instead.
 * Returns the sections unchanged when there is nothing to do.
 */
export function moveChannel(
  sections: readonly Section[],
  channelId: string,
  categoryId: string | null,
  index: number,
): Section[] {
  const from = locate(sections, channelId);
  const to = sections.findIndex((section) => (section.category?.id ?? null) === categoryId);
  const channel = from ? sections[from.section]?.channels[from.index] : undefined;
  if (!from || to < 0 || !channel) return [...sections];

  const without = sections.map((section, at) =>
    at === from.section
      ? { ...section, channels: section.channels.filter((item) => item.id !== channelId) }
      : section,
  );
  return without.map((section, at) => {
    if (at !== to) return section;
    const clamped = Math.max(0, Math.min(index, section.channels.length));
    const channels = [...section.channels];
    channels.splice(clamped, 0, channel);
    return { ...section, channels: groupByKind(channels) };
  });
}

/** Drop-on-a-row semantics: the channel lands just before `beforeId`, in that row's section. */
export function moveChannelBefore(
  sections: readonly Section[],
  channelId: string,
  beforeId: string,
): Section[] {
  if (channelId === beforeId) return [...sections];
  const withoutMoved = sections.map((section) => ({
    ...section,
    channels: section.channels.filter((channel) => channel.id !== channelId),
  }));
  const target = locate(withoutMoved, beforeId);
  if (!target) return [...sections];
  return moveChannel(
    sections,
    channelId,
    withoutMoved[target.section]?.category?.id ?? null,
    target.index,
  );
}

/** Drop-on-a-heading (or the empty end of a list): last in the section. */
export function moveChannelToEnd(
  sections: readonly Section[],
  channelId: string,
  categoryId: string | null,
): Section[] {
  return moveChannel(sections, channelId, categoryId, Number.MAX_SAFE_INTEGER);
}

/** Drop-on-a-heading for a heading: just before `beforeCategoryId`. */
export function moveCategoryBefore(
  sections: readonly Section[],
  categoryId: string,
  beforeCategoryId: string,
): Section[] {
  if (categoryId === beforeCategoryId) return [...sections];
  const rest = sections.slice(1).filter((section) => section.category?.id !== categoryId);
  const index = rest.findIndex((section) => section.category?.id === beforeCategoryId);
  return index < 0 ? [...sections] : moveCategory(sections, categoryId, index);
}

/**
 * One step up (-1) or down (+1) with the keyboard. Inside a section it swaps
 * with the neighbour of the same kind; at the edge of its group it crosses
 * into the next section - the bottom of its group in the one above, the top
 * of its group in the one below - so a channel can be carried from the loose
 * list into a category without a pointer. Swapping a voice channel with the
 * text channel above it would only be undone by the grouping, so that edge
 * crosses too.
 */
export function stepChannel(
  sections: readonly Section[],
  channelId: string,
  delta: -1 | 1,
): Section[] {
  const at = locate(sections, channelId);
  if (!at) return [...sections];
  const here = sections[at.section];
  if (!here) return [...sections];

  const channel = here.channels[at.index];
  const target = at.index + delta;
  const neighbour = here.channels[target];
  if (channel && neighbour && isVoice(neighbour) === isVoice(channel)) {
    return moveChannel(sections, channelId, here.category?.id ?? null, target);
  }
  const next = sections[at.section + delta];
  if (!next) return [...sections];
  return moveChannel(
    sections,
    channelId,
    next.category?.id ?? null,
    delta === -1 ? next.channels.length : 0,
  );
}

/** Moves a category heading (with its channels) to `index` among the categories. */
export function moveCategory(
  sections: readonly Section[],
  categoryId: string,
  index: number,
): Section[] {
  const [loose, ...rest] = sections;
  const moving = rest.find((section) => section.category?.id === categoryId);
  if (!loose || !moving) return [...sections];
  const others = rest.filter((section) => section !== moving);
  const clamped = Math.max(0, Math.min(index, others.length));
  others.splice(clamped, 0, moving);
  return [loose, ...others];
}

export function stepCategory(
  sections: readonly Section[],
  categoryId: string,
  delta: -1 | 1,
): Section[] {
  const at = sections.findIndex((section) => section.category?.id === categoryId);
  // Index 0 is the loose section, so a category's place among categories is at - 1.
  return at < 1 ? [...sections] : moveCategory(sections, categoryId, at - 1 + delta);
}

/** True when two arrangements would send the same request. */
export function sameLayout(a: readonly Section[], b: readonly Section[]): boolean {
  return JSON.stringify(layoutFrom(a)) === JSON.stringify(layoutFrom(b));
}

/** Which categories are folded away, per person and per device. */
export function parseCollapsed(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

/**
 * What a folded category still has to say: the unread total of what is hidden
 * in it, and whether the open channel is in it, so folding never hides that
 * you are standing there or that something happened.
 */
export function collapsedSummary(
  section: Section,
  unread: Readonly<Record<string, number>>,
  activeChannelId: string | null,
): { unread: number; containsActive: boolean } {
  return {
    unread: section.channels.reduce((sum, channel) => sum + (unread[channel.id] ?? 0), 0),
    containsActive: section.channels.some((channel) => channel.id === activeChannelId),
  };
}
