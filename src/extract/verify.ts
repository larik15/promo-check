import type { ExtractedPromotion, VerifiedPromotion } from "../schema.js";
import type { PromoSource } from "./source.js";

/** Normalizes text for quote matching: Unicode, case, quotes, dashes, whitespace. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/­/g, "") // soft hyphen
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds the 1-based page that contains `quote`, or null.
 * Tries whitespace-normalized matching first, then ignores whitespace entirely
 * (PDF text layers often split or merge spaces).
 */
export function locateQuote(quote: string, pages: string[]): number | null {
  const q = normalizeForMatch(quote);
  if (!q) return null;
  const normalized = pages.map(normalizeForMatch);
  let idx = normalized.findIndex((p) => p.includes(q));
  if (idx === -1) {
    const tight = q.replace(/ /g, "");
    idx = normalized.findIndex((p) => p.replace(/ /g, "").includes(tight));
  }
  return idx === -1 ? null : idx + 1;
}

/**
 * Checks every quote against the source text. Quotes that are found get
 * `verified: true` and, for PDFs, the page where they were actually found.
 * Images (and PDFs without a text layer) get `verified: null`.
 */
export function verifyPromotion(
  promotion: ExtractedPromotion,
  source: PromoSource,
): { promotion: VerifiedPromotion; unverified: number; warnings: string[] } {
  let unverified = 0;
  const warnings: string[] = [];

  // Offer references must name a listed offer; map aliases and case variants
  // to the canonical name, and drop references to unknown offers.
  const offerNames = new Map<string, string>();
  for (const o of promotion.offers) {
    for (const n of [o.name, ...o.aliases]) offerNames.set(normalizeForMatch(n), o.name);
  }
  const ref = <T extends { offer: string | null }>(item: T, what: string): T => {
    if (item.offer === null) return item;
    const canonical = offerNames.get(normalizeForMatch(item.offer));
    if (canonical) return { ...item, offer: canonical };
    warnings.push(`${what} referred to unknown offer "${item.offer}"; treated as promotion-wide.`);
    return { ...item, offer: null };
  };
  const canCheck = source.pages.length > 0;

  const v = <T extends { quote: string; page: number | null }>(item: T): T & { verified: boolean | null } => {
    const modelPage = source.kind === "pdf" ? item.page : null;
    if (!canCheck) return { ...item, page: modelPage, verified: null };
    const found = locateQuote(item.quote, source.pages);
    if (found === null) {
      unverified++;
      return { ...item, page: modelPage, verified: false };
    }
    return { ...item, page: source.kind === "pdf" ? found : null, verified: true };
  };

  return {
    promotion: {
      supplier: v(promotion.supplier),
      product: v(promotion.product),
      destination: promotion.destination ? v(promotion.destination) : null,
      offers: promotion.offers.map(v),
      prices: promotion.prices.map((p) => v(ref(p, `Price ${p.amount} ${p.currency}`))),
      discounts: promotion.discounts.map((d) => v(ref(d, `Discount ${d.percent}%`))),
      travel_dates: promotion.travel_dates.map((t) => v(ref(t, `Dates ${t.start}..${t.end}`))),
      booking_deadline: promotion.booking_deadline ? v(promotion.booking_deadline) : null,
      conditions: promotion.conditions.map(v),
    },
    unverified,
    warnings,
  };
}
