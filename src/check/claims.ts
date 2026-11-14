import { parseNumber } from "./numbers.js";
import { findDates, type DateClaim } from "./dates.js";

export type Language = "en" | "es";

export interface Span {
  index: number;
  end: number;
  raw: string;
}

export type BasisClaim = "per_person" | "double_occupancy" | "per_couple" | "per_night" | "per_room";

export interface PriceClaim extends Span {
  type: "price";
  amount: number;
  /** Currency token as written, e.g. "$", "USD", "dólares". */
  currencyToken: string;
  /** ISO codes the token can stand for ("$" is ambiguous). */
  currencies: string[];
  /** Price basis stated right after the price, if any. */
  basis: BasisClaim | null;
}

export interface PercentClaim extends Span {
  type: "percent";
  percent: number;
}

export type Claim = PriceClaim | PercentClaim | DateClaim;

const DOLLAR_SIGN = ["USD", "CAD", "AUD", "NZD", "MXN", "COP", "ARS", "CLP", "SGD", "HKD"];
const DOLLARS = ["USD", "CAD", "AUD", "NZD", "SGD", "HKD"];
const PESOS = ["MXN", "COP", "ARS", "CLP"];

const CURRENCY_TOKENS: Record<string, string[]> = {
  "us$": ["USD"],
  usd: ["USD"],
  "mx$": ["MXN"],
  mxn: ["MXN"],
  "c$": ["CAD"],
  cad: ["CAD"],
  "a$": ["AUD"],
  aud: ["AUD"],
  "r$": ["BRL"],
  brl: ["BRL"],
  $: DOLLAR_SIGN,
  "€": ["EUR"],
  eur: ["EUR"],
  euro: ["EUR"],
  euros: ["EUR"],
  "£": ["GBP"],
  gbp: ["GBP"],
  libras: ["GBP"],
  cop: ["COP"],
  ars: ["ARS"],
  clp: ["CLP"],
  pen: ["PEN"],
  dollar: DOLLARS,
  dollars: DOLLARS,
  dólares: DOLLARS,
  dolares: DOLLARS,
  pesos: PESOS,
  "pesos mexicanos": ["MXN"],
};

export function currenciesFor(token: string): string[] {
  const key = token.toLowerCase().replace(/\s+/g, " ");
  return CURRENCY_TOKENS[key] ?? [token.toUpperCase()];
}

const NUM = String.raw`\d{1,3}(?:[.,  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const CODES = "USD|MXN|CAD|AUD|BRL|EUR|GBP|COP|ARS|CLP|PEN";
const PREFIX = String.raw`US\$|MX\$|C\$|A\$|R\$|\$|€|£|(?<![A-Za-z])(?:${CODES})(?![A-Za-z])`;
const SUFFIX = String.raw`(?:${CODES})(?![A-Za-z])|€|\$|[Dd][oó]lares|[Dd]ollars?|[Ee]uros?|[Pp]esos(?:\s+[Mm]exicanos)?|[Ll]ibras`;

const MONEY_RE = new RegExp(
  String.raw`(?:(?<pc>${PREFIX})\s?(?<pn>${NUM})(?:\s?(?<pc2>(?:${CODES})(?![A-Za-z])))?)` +
    String.raw`|(?:(?<![\d.,])(?<sn>${NUM})\s?(?<sc>${SUFFIX}))`,
  "gu",
);

const PERCENT_RE = /(?<![\d.,])(?<n>\d{1,3}(?:[.,]\d{1,2})?)\s?(?:%|por\s?ciento|percent|per\s?cent)/giu;

const BASIS_PATTERNS: Array<[BasisClaim, RegExp]> = [
  ["double_occupancy", /double occupancy|ocupaci[oó]n doble|\bdbl\b|habitaci[oó]n doble|twin share/iu],
  ["per_couple", /per couple|for two\b|for 2\b|por pareja|para dos\b|para 2\b/iu],
  ["per_night", /per night|a night\b|\/\s?night|por noche|la noche\b|\/\s?noche/iu],
  ["per_room", /per room|por habitaci[oó]n/iu],
  ["per_person", /per person|\bpp\b|\bp\.p\.|por persona|\bp\/p\b|\bpax\b/iu],
];

function detectBasis(after: string): BasisClaim | null {
  // Stop at a line break; a basis belongs to the price right before it.
  const window = after.split(/\n/)[0]!.slice(0, 45);
  for (const [basis, re] of BASIS_PATTERNS) if (re.test(window)) return basis;
  return null;
}

function overlaps(spans: Span[], index: number, end: number): boolean {
  return spans.some((s) => index < s.end && end > s.index);
}

export function findPrices(text: string): PriceClaim[] {
  const prices: PriceClaim[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const g = m.groups ?? {};
    const numRaw = g.pn ?? g.sn;
    const token = g.pc2 ?? g.pc ?? g.sc;
    if (!numRaw || !token) continue;
    const amount = parseNumber(numRaw);
    if (amount === null) continue;
    const index = m.index!;
    prices.push({
      type: "price",
      index,
      end: index + m[0].length,
      raw: m[0],
      amount,
      currencyToken: token,
      currencies: currenciesFor(token),
      basis: null,
    });
  }
  // Basis: text after the price, up to the next price.
  prices.forEach((p, i) => {
    const next = prices[i + 1]?.index ?? text.length;
    p.basis = detectBasis(text.slice(p.end, next));
  });
  return prices;
}

export function findPercents(text: string, taken: Span[] = []): PercentClaim[] {
  const out: PercentClaim[] = [];
  for (const m of text.matchAll(PERCENT_RE)) {
    const index = m.index!;
    const end = index + m[0].length;
    if (overlaps(taken, index, end)) continue;
    const percent = parseNumber(m.groups!.n!);
    if (percent === null) continue;
    out.push({ type: "percent", index, end, raw: m[0], percent });
  }
  return out;
}

/** Guesses whether the text is English or Spanish from common words. */
export function detectLanguage(text: string): Language {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const es = new Set(["el", "la", "los", "las", "de", "del", "para", "por", "con", "y", "en", "tu", "reserva", "viaje", "hasta", "noches", "desde", "precio", "oferta", "antes", "una", "un", "es"]);
  const en = new Set(["the", "and", "for", "with", "your", "book", "travel", "until", "nights", "from", "price", "offer", "before", "a", "an", "is", "to", "of", "per"]);
  let esScore = 0;
  let enScore = 0;
  for (const w of words) {
    if (es.has(w)) esScore++;
    if (en.has(w)) enScore++;
  }
  return esScore > enScore ? "es" : "en";
}

/**
 * Finds every price, percentage and date in a marketing text.
 * Prices are found first so their digits are not read as dates or percentages.
 */
export function findClaims(text: string, language: Language = detectLanguage(text)): Claim[] {
  const prices = findPrices(text);
  const percents = findPercents(text, prices);
  const dates = findDates(text, language, [...prices, ...percents]);
  return [...prices, ...percents, ...dates].sort((a, b) => a.index - b.index);
}
