import type { ExtractedPromotion, VerifiedPromotion } from "../src/schema.js";
import { fold } from "../src/check/terms.js";

export interface Comparison {
  /** Differences that would make `check` give wrong answers. */
  errors: string[];
  /** Differences worth reading but not necessarily wrong (wording, offer granularity). */
  notes: string[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Compares a real extraction with the expected (hand-written) one on the
 * fields `check` relies on: prices, percentages, dates, deadline, offers.
 */
export function compareExtraction(actual: VerifiedPromotion, expected: ExtractedPromotion, strictOffers: boolean): Comparison {
  const errors: string[] = [];
  const notes: string[] = [];
  const offerProblem = (msg: string) => (strictOffers ? errors : notes).push(msg);

  // Map expected offer names to actual ones through names and aliases.
  const names = (o: { name: string; aliases: string[] }) => [o.name, ...o.aliases].map((n) => fold(n).trim());
  const offerMap = new Map<string, string | null>();
  for (const e of expected.offers) {
    const hit = actual.offers.find((a) => names(a).some((n) => names(e).includes(n)));
    offerMap.set(e.name, hit?.name ?? null);
    if (!hit) offerProblem(`offer "${e.name}" not found (actual offers: ${actual.offers.map((o) => o.name).join(", ") || "none"})`);
  }
  if (expected.offers.length === 0 && actual.offers.length > 0) {
    notes.push(`model listed offers the expected record does not: ${actual.offers.map((o) => o.name).join(", ")}`);
  }
  const sameOffer = (expectedOffer: string | null, actualOffer: string | null) =>
    expectedOffer === null ? true : offerMap.get(expectedOffer) === actualOffer;

  for (const e of expected.prices) {
    const a = actual.prices.find((p) => near(p.amount, e.amount) && p.currency === e.currency);
    if (!a) {
      errors.push(`missing price ${e.amount} ${e.currency} (${e.label})`);
      continue;
    }
    if (a.basis !== e.basis) errors.push(`price ${e.amount} ${e.currency}: basis ${a.basis}, expected ${e.basis}`);
    if (!sameOffer(e.offer, a.offer)) offerProblem(`price ${e.amount} ${e.currency}: offer ${a.offer}, expected ${e.offer}`);
  }
  for (const a of actual.prices) {
    if (!expected.prices.some((e) => near(e.amount, a.amount) && e.currency === a.currency)) {
      errors.push(`unexpected price ${a.amount} ${a.currency} (${a.label}): "${a.quote}"`);
    }
  }

  // Percentages may be recorded as discounts or only inside conditions.
  const actualPercents = new Set([
    ...actual.discounts.map((d) => d.percent),
    ...actual.conditions.flatMap((c) => [...c.text.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)].map((m) => Number(m[1]!.replace(",", ".")))),
  ]);
  for (const e of expected.discounts) {
    if (![...actualPercents].some((p) => near(p, e.percent))) errors.push(`missing percentage ${e.percent}% (${e.label})`);
    const a = actual.discounts.find((d) => near(d.percent, e.percent));
    if (a && !sameOffer(e.offer, a.offer)) offerProblem(`${e.percent}%: offer ${a.offer}, expected ${e.offer}`);
  }

  for (const e of expected.travel_dates) {
    const a = actual.travel_dates.find((t) => t.start === e.start && t.end === e.end);
    if (!a) {
      errors.push(`missing dates ${e.start}..${e.end} (${e.label})`);
      continue;
    }
    if (!sameOffer(e.offer, a.offer)) offerProblem(`dates ${e.start}..${e.end}: offer ${a.offer}, expected ${e.offer}`);
    const blackout = /blackout/i;
    if (blackout.test(e.label) !== blackout.test(a.label)) errors.push(`dates ${e.start}..${e.end}: label "${a.label}" does not say blackout`);
  }
  for (const a of actual.travel_dates) {
    if (!expected.travel_dates.some((e) => e.start === a.start && e.end === a.end)) {
      notes.push(`extra date range ${a.start}..${a.end} (${a.label})`);
    }
  }

  const ed = expected.booking_deadline?.date ?? null;
  const ad = actual.booking_deadline?.date ?? null;
  if (ed !== ad) errors.push(`booking deadline ${ad}, expected ${ed}`);

  return { errors, notes };
}
