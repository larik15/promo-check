import type { Language, Span } from "./claims.js";

export interface PartialDate {
  /** Null when the text gives no year; resolved later against the record. */
  y: number | null;
  m: number;
  d: number;
}

export interface DateClaim extends Span {
  type: "date";
  from: PartialDate;
  /** Set for ranges ("March 12–19", "del 12 al 19 de marzo"). */
  to: PartialDate | null;
  /** True when the date is introduced as a booking or offer deadline ("book by", "reserva antes del"). */
  isDeadline: boolean;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
  enero: 1, ene: 1, febrero: 2, marzo: 3, abril: 4, abr: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12, dic: 12,
};

const ABBREVIATIONS = ["jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "ene", "abr", "ago", "dic"];
const byLength = (a: string, b: string) => b.length - a.length;
const FULL_NAMES = Object.keys(MONTHS).filter((k) => !ABBREVIATIONS.includes(k)).sort(byLength);
// Only abbreviations take a dot, so a sentence-ending period after "diciembre." is not swallowed.
const MONTH = `(?:(?:${FULL_NAMES.join("|")})|(?:${[...ABBREVIATIONS].sort(byLength).join("|")})\\.?)(?![\\p{L}])`;
const DAY = String.raw`(?:[0-3]?\d)(?:st|nd|rd|th|º|°|ro)?(?!\d)`;
const YEAR = String.raw`\d{4}`;
const DASH = String.raw`\s*(?:-|–|—)\s*`;
const B = String.raw`(?<![\p{L}\d])`;

const g = (name: string, re: string) => `(?<${name}>${re})`;

/** Patterns in priority order; earlier matches win over overlapping later ones. */
const PATTERNS: RegExp[] = [
  // 2027-03-12
  new RegExp(`${B}${g("y1", "\\d{4}")}-${g("m1n", "\\d{2}")}-${g("d1", "\\d{2}")}(?!\\d)`, "gu"),
  // del 28 de febrero al 6 de marzo de 2027 | del 12 al 19 de marzo | 12-19 de marzo
  new RegExp(
    `${B}(?:del?\\s+)?${g("d1", DAY)}(?:\\s+de\\s+${g("m1", MONTH)})?(?:\\s+(?:al?)\\s+|${DASH})${g("d2", DAY)}\\s+de\\s+${g("m2", MONTH)}(?:,?\\s+(?:del?\\s+)?${g("y2", YEAR)})?`,
    "giu",
  ),
  // March 12–19, 2027 | March 28 to April 4 | Mar 3 - Mar 10 2027
  new RegExp(
    `${B}${g("m1", MONTH)}\\s*${g("d1", DAY)}(?:,?\\s+${g("y1", YEAR)})?(?:${DASH}|\\s+(?:to|through|thru)\\s+)(?:${g("m2", MONTH)}\\s*)?${g("d2", DAY)}(?:,?\\s+${g("y2", YEAR)})?`,
    "giu",
  ),
  // 12–19 March 2027 | 28 March - 4 April
  new RegExp(
    `${B}${g("d1", DAY)}(?:\\s+${g("m1", MONTH)})?(?:${DASH}|\\s+(?:to|through)\\s+)${g("d2", DAY)}\\s+(?:of\\s+)?${g("m2", MONTH)}(?:,?\\s+${g("y2", YEAR)})?`,
    "giu",
  ),
  // 12 de marzo de 2027 | 1º de abril
  new RegExp(`${B}${g("d1", DAY)}\\s+de\\s+${g("m1", MONTH)}(?:,?\\s+(?:del?\\s+)?${g("y1", YEAR)})?`, "giu"),
  // March 12, 2027 | Mar 12
  new RegExp(`${B}${g("m1", MONTH)}\\s*${g("d1", DAY)}(?:,?\\s+${g("y1", YEAR)})?`, "giu"),
  // 12 March 2027 | 12th of March
  new RegExp(`${B}${g("d1", DAY)}\\s+(?:of\\s+)?${g("m1", MONTH)}(?:,?\\s+${g("y1", YEAR)})?`, "giu"),
  // 03/12/2027 (MM/DD in English, DD/MM in Spanish)
  new RegExp(`${B}${g("a", "\\d{1,2}")}[/.]${g("b", "\\d{1,2}")}[/.]${g("y1", "\\d{4}|\\d{2}")}(?!\\d)`, "gu"),
];

const DEADLINE_CUES = [
  "book by", "book before", "book until", "booking deadline", "bookings close", "reserve by", "book now through",
  "offer ends", "sale ends", "ends", "expires", "deadline", "last day", "buy by", "order by", "valid until",
  "reserva antes", "reserva hasta", "reservas hasta", "reserva a más tardar", "reserva a mas tardar",
  "compra antes", "compra hasta", "válido hasta", "valido hasta", "válida hasta", "valida hasta",
  "vence", "fecha límite", "fecha limite", "último día", "ultimo dia", "termina", "finaliza",
];

/** True if the text right before a date introduces a deadline. */
function isDeadlineContext(before: string): boolean {
  const line = before.split(/\n/).pop() ?? "";
  const window = line.slice(-40).toLowerCase();
  return DEADLINE_CUES.some((cue) => window.includes(cue));
}

function monthNum(token: string | undefined): number | null {
  if (!token) return null;
  return MONTHS[token.toLowerCase().replace(/\.$/, "")] ?? null;
}

function dayNum(token: string | undefined): number | null {
  if (!token) return null;
  const n = parseInt(token, 10);
  return n >= 1 && n <= 31 ? n : null;
}

function yearNum(token: string | undefined): number | null {
  if (!token) return null;
  const n = parseInt(token, 10);
  return token.length === 2 ? 2000 + n : n;
}

function valid(p: PartialDate): boolean {
  if (p.m < 1 || p.m > 12 || p.d < 1) return false;
  const days = new Date(Date.UTC(p.y ?? 2028, p.m, 0)).getUTCDate(); // 2028 is a leap year
  return p.d <= days;
}

function toClaim(groups: Record<string, string | undefined>, language: Language): { start: PartialDate; end: PartialDate | null } | null {
  // Numeric dates
  if (groups.a !== undefined && groups.b !== undefined) {
    const a = parseInt(groups.a, 10);
    const b = parseInt(groups.b, 10);
    let m: number;
    let d: number;
    if (a > 12) [d, m] = [a, b];
    else if (b > 12) [m, d] = [a, b];
    else if (language === "es") [d, m] = [a, b];
    else [m, d] = [a, b];
    const start = { y: yearNum(groups.y1), m, d };
    return valid(start) ? { start, end: null } : null;
  }

  const m1 = groups.m1n ? parseInt(groups.m1n, 10) : monthNum(groups.m1);
  const d1 = dayNum(groups.d1);
  const m2 = monthNum(groups.m2);
  const d2 = dayNum(groups.d2);
  const y1 = yearNum(groups.y1);
  const y2 = yearNum(groups.y2);

  if (d2 !== null) {
    // Range
    const endMonth = m2 ?? m1;
    const startMonth = m1 ?? m2;
    if (startMonth === null || endMonth === null || d1 === null) return null;
    const end: PartialDate = { y: y2 ?? y1, m: endMonth, d: d2 };
    let startYear = y1 ?? end.y;
    if (y1 === null && end.y !== null && startMonth > endMonth) startYear = end.y - 1;
    const start: PartialDate = { y: startYear, m: startMonth, d: d1 };
    return valid(start) && valid(end) ? { start, end } : null;
  }

  if (m1 === null || d1 === null) return null;
  const start = { y: y1, m: m1, d: d1 };
  return valid(start) ? { start, end: null } : null;
}

/** Finds dates and date ranges in English or Spanish text. */
export function findDates(text: string, language: Language, taken: Span[] = []): DateClaim[] {
  const spans: Span[] = [...taken];
  const out: DateClaim[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const index = m.index!;
      const end = index + m[0].length;
      if (spans.some((s) => index < s.end && end > s.index)) continue;
      const parsed = toClaim(m.groups ?? {}, language);
      if (!parsed) continue;
      spans.push({ index, end, raw: m[0] });
      out.push({
        type: "date",
        index,
        end,
        raw: m[0],
        from: parsed.start,
        to: parsed.end,
        isDeadline: isDeadlineContext(text.slice(0, index)),
      });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function toIso(p: { y: number; m: number; d: number }): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
