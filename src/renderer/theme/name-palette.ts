/**
 * name-palette — which of the theme's four AI name colors (`namePalette`,
 * `--color-name-1..4`, spec 2026-10-01-messenger-redesign.md R1-3) an AI
 * uses.
 *
 * Two rules:
 *   - Inside a conversation (thread, room header, chat list cluster) the
 *     participant's seat picks the color: seat = index in the channel's
 *     member order (room seat order, registry order for the general
 *     channel, 0 for a DM), cycling through the four colors. Up to four
 *     participants therefore never share a color, and a room's colors do
 *     not change while it exists (room seats are a creation-time snapshot).
 *   - Outside a conversation (the settings AI list) the provider id picks
 *     it with a string hash, so one AI keeps the same color there.
 */

/** Literal class names so Tailwind generates them (`tailwind.config.ts` `name.1..4`). */
const NAME_COLOR_TEXT_CLASSES = ['text-name-1', 'text-name-2', 'text-name-3', 'text-name-4'] as const;
const NAME_COLOR_FILL_CLASSES = ['bg-name-1', 'bg-name-2', 'bg-name-3', 'bg-name-4'] as const;

/** Stable 0-based palette slot for a provider id (string hash, not list position). */
export function namePaletteIndex(providerId: string): number {
  let hash = 0;
  for (let i = 0; i < providerId.length; i += 1) {
    hash = (hash * 31 + providerId.charCodeAt(i)) >>> 0;
  }
  return hash % NAME_COLOR_TEXT_CLASSES.length;
}

/** Tailwind text-color class of the provider's name color (hash rule). */
export function nameColorTextClass(providerId: string): string {
  return NAME_COLOR_TEXT_CLASSES[namePaletteIndex(providerId)];
}

function seatSlot(seat: number): number {
  if (!Number.isInteger(seat) || seat < 0) throw new Error(`Invalid participant seat: ${seat}`);
  return seat % NAME_COLOR_TEXT_CLASSES.length;
}

/** Text color of the participant in `seat` (conversation rule). */
export function seatNameTextClass(seat: number): string {
  return NAME_COLOR_TEXT_CLASSES[seatSlot(seat)];
}

/** Fill color of the participant in `seat`, for initial chips (conversation rule). */
export function seatNameFillClass(seat: number): string {
  return NAME_COLOR_FILL_CLASSES[seatSlot(seat)];
}
