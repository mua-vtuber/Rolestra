/**
 * Time and date text shared by the chat list and the room (spec
 * 2026-10-01-messenger-redesign.md R2-2, R3-2/R3-3): 24-hour "21:12"
 * beside messages and in today's list rows, and the long date of a day
 * separator ("2026년 10월 1일 수요일").
 */

/** The `Intl` locale for the app language (ko or en). */
export function uiLocale(language: string): string {
  return language.startsWith('ko') ? 'ko-KR' : 'en-US';
}

export function clockTime(timestamp: number, language: string): string {
  return new Date(timestamp).toLocaleTimeString(uiLocale(language), {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function longDateLabel(timestamp: number, language: string): string {
  return new Date(timestamp).toLocaleDateString(uiLocale(language), {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
}
