import type { PriceBasis, PromoRecord } from "../schema.js";
import { detectLanguage, findClaims, findPercents, type BasisClaim, type Claim, type Language, type PriceClaim, type PercentClaim } from "./claims.js";
import { toIso, type DateClaim, type PartialDate } from "./dates.js";
import { formatAmount, sameAmount } from "./numbers.js";
import { attributeOffers, findOfferMentions } from "./offers.js";
import { DEFAULT_REQUIRED_TERMS, hasTerm, type RequiredTerm } from "./terms.js";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  severity: Severity;
  code:
    | "price_mismatch"
    | "currency_mismatch"
    | "price_basis_mismatch"
    | "price_basis_missing"
    | "percent_mismatch"
    | "date_mismatch"
    | "date_in_blackout"
    | "wrong_offer"
    | "deadline_mismatch"
    | "deadline_passed"
    | "missing_term"
    | "record_unverified"
    | "record_warning"
    | "no_claims";
  message: string;
  /** 1-based line in the marketing text. */
  line?: number;
  /** The text as written, e.g. "1.299 USD". */
  excerpt?: string;
  /** Offer the claim was attributed to, if any. */
  offer?: string | null;
}

export interface CheckedClaim {
  type: Claim["type"];
  raw: string;
  line: number;
  /** Normalized value, e.g. "1299 USD", "30%", "2027-03-12..2027-03-19". */
  normalized: string;
  /** Offer (product, destination, room type...) the claim was attributed to, or null. */
  offer: string | null;
  ok: boolean;
}

export interface CheckReport {
  ok: boolean;
  language: Language;
  today: string;
  summary: { errors: number; warnings: number; claims: number; matched: number };
  findings: Finding[];
  claims: CheckedClaim[];
}

export interface CheckOptions {
  /** "en" or "es"; detected from the text by default. Used for numeric dates (MM/DD vs DD/MM). */
  language?: Language;
  /** ISO date treated as today, for deadline checks. Defaults to the local date. */
  today?: string;
  /** Disclosures the text must contain. Defaults to DEFAULT_REQUIRED_TERMS; pass [] to skip. */
  requiredTerms?: RequiredTerm[];
}

/** Which basis phrases are consistent with each record basis. */
const BASIS_COMPAT: Record<PriceBasis, BasisClaim[] | "any"> = {
  per_person: ["per_person"],
  per_person_double_occupancy: ["per_person", "double_occupancy"],
  per_person_single_occupancy: ["per_person"],
  per_couple: ["per_couple", "double_occupancy"],
  per_room: ["per_room"],
  per_night: ["per_night"],
  per_room_per_night: ["per_night", "per_room"],
  per_unit: [],
  total: [],
  unspecified: "any",
};

/** Bases a reader needs to see next to the price. */
const BASIS_NEEDS_DISCLOSURE = new Set<PriceBasis>([
  "per_person",
  "per_person_double_occupancy",
  "per_person_single_occupancy",
  "per_couple",
  "per_room",
  "per_night",
  "per_room_per_night",
]);

const BLACKOUT = /blackout|black-out|excluded|exclusion|not valid|no v[aá]lid|no aplica|excepto|except|bloqueo/i;

export function localToday(now = new Date()): string {
  return toIso({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

/** "1,299 USD" when the currency is certain; "$1,299" or "1,749 dólares" when the token is ambiguous. */
function formatPrice(c: PriceClaim, amount: string): string {
  if (c.currencies.length === 1) return `${amount} ${c.currencies[0]}`;
  return /^\p{L}/u.test(c.currencyToken) ? `${amount} ${c.currencyToken}` : `${c.currencyToken}${amount}`;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

type RecordPrice = PromoRecord["promotion"]["prices"][number];

function describePrice(p: RecordPrice): string {
  return `${formatAmount(p.amount)} ${p.currency} ${p.basis.replace(/_/g, " ")} (${p.label})`;
}

function owners(items: Array<{ offer: string | null }>): string {
  return [...new Set(items.map((i) => i.offer!))].join(" / ");
}

interface Window {
  start: string;
  end: string;
  label: string;
  blackout: boolean;
  offer: string | null;
}

/**
 * Checks marketing text against a promotion record without any LLM.
 * Every price, percentage and date in the text must be backed by the record.
 * When the record lists several offers, each claim is attributed to the
 * nearest offer named in the text and compared only with that offer (and with
 * promotion-wide values).
 */
export function check(text: string, record: PromoRecord, options: CheckOptions = {}): CheckReport {
  const language = options.language ?? detectLanguage(text);
  const today = options.today ?? localToday();
  const terms = options.requiredTerms ?? DEFAULT_REQUIRED_TERMS;
  const promo = record.promotion;

  const findings: Finding[] = [];
  const checked: CheckedClaim[] = [];
  const claims = findClaims(text, language);
  const claimOffers = attributeOffers(text, claims, findOfferMentions(text, promo.offers));

  /** Items that apply to `offer`: its own plus promotion-wide ones. Without an offer, everything. */
  const inScope = <T extends { offer: string | null }>(items: T[], offer: string | null): T[] =>
    offer === null ? items : items.filter((i) => i.offer === null || i.offer === offer);
  /** Items that belong to a different, named offer. */
  const otherOffers = <T extends { offer: string | null }>(items: T[], offer: string | null): T[] =>
    offer === null ? [] : items.filter((i) => i.offer !== null && i.offer !== offer);

  const windows: Window[] = promo.travel_dates.map((t) => ({
    start: t.start,
    end: t.end,
    label: t.label,
    blackout: BLACKOUT.test(t.label),
    offer: t.offer,
  }));
  const deadline = promo.booking_deadline?.date ?? null;
  const recordDates = [...windows.flatMap((w) => [w.start, w.end]), ...(deadline ? [deadline] : [])];

  // Percentages the record supports: explicit discounts, percentages inside
  // any quoted condition, and discounts implied by two prices of the same offer.
  const conditionPercents = promo.conditions.flatMap((c) => [...findPercents(c.quote), ...findPercents(c.text)]).map((p) => p.percent);
  const impliedPercents: Array<{ percent: number; offer: string | null }> = [];
  for (const a of promo.prices) {
    for (const b of promo.prices) {
      if (a.amount > b.amount && a.currency === b.currency && a.basis === b.basis && a.offer === b.offer) {
        impliedPercents.push({ percent: (1 - b.amount / a.amount) * 100, offer: a.offer });
      }
    }
  }

  const resolve = (p: PartialDate): string => {
    if (p.y !== null) return toIso({ y: p.y, m: p.m, d: p.d });
    const md = `-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    const exact = recordDates.find((d) => d.endsWith(md));
    if (exact) return exact.slice(0, 4) + md;
    for (const w of windows) {
      for (let y = Number(w.start.slice(0, 4)); y <= Number(w.end.slice(0, 4)); y++) {
        const iso = `${y}${md}`;
        if (iso >= w.start && iso <= w.end) return iso;
      }
    }
    const y = Number(today.slice(0, 4));
    const iso = `${y}${md}`;
    return iso >= today ? iso : `${y + 1}${md}`;
  };

  const push = (f: Finding) => findings.push(f);

  const checkPrice = (c: PriceClaim, line: number, offer: string | null): boolean => {
    const pool = inScope(promo.prices, offer);
    const normalized = formatPrice(c, formatAmount(c.amount));
    const base = { line, excerpt: c.raw, offer };
    const byAmount = pool.filter((p) => sameAmount(p.amount, c.amount));
    if (byAmount.length === 0) {
      const elsewhere = otherOffers(promo.prices, offer).filter((p) => sameAmount(p.amount, c.amount));
      if (elsewhere.length) {
        push({ ...base, severity: "error", code: "wrong_offer", message: `Price ${normalized} belongs to ${owners(elsewhere)}, not ${offer}.` });
        return false;
      }
      const scope = offer ? ` for ${offer}` : "";
      push({
        ...base,
        severity: "error",
        code: "price_mismatch",
        message:
          pool.length === 0
            ? `Price ${normalized} is not in the record (the record has no prices${scope}).`
            : `Price ${normalized} does not match the record. Record prices${scope}: ${pool.map(describePrice).join("; ")}.`,
      });
      return false;
    }
    const byCurrency = byAmount.filter((p) => c.currencies.includes(p.currency.toUpperCase()));
    if (byCurrency.length === 0) {
      push({
        ...base,
        severity: "error",
        code: "currency_mismatch",
        message: `Currency "${c.currencyToken}" does not match the record: ${byAmount.map(describePrice).join("; ")}.`,
      });
      return false;
    }
    if (c.basis) {
      const compatible = byCurrency.some((p) => {
        const allowed = BASIS_COMPAT[p.basis];
        return allowed === "any" || allowed.includes(c.basis!);
      });
      if (!compatible) {
        push({
          ...base,
          severity: "error",
          code: "price_basis_mismatch",
          message: `Price ${normalized} is described as "${c.basis.replace(/_/g, " ")}", but the record says ${byCurrency.map((p) => p.basis.replace(/_/g, " ")).join(" / ")}.`,
        });
        return false;
      }
    } else if (byCurrency.every((p) => BASIS_NEEDS_DISCLOSURE.has(p.basis))) {
      push({
        ...base,
        severity: "warning",
        code: "price_basis_missing",
        message: `Price ${normalized} does not say its basis; the record says ${byCurrency[0]!.basis.replace(/_/g, " ")}.`,
      });
    }
    return true;
  };

  const checkPercent = (c: PercentClaim, line: number, offer: string | null): boolean => {
    const same = (p: number) => Math.abs(p - c.percent) < 0.005;
    const discounts = inScope(promo.discounts, offer);
    if (discounts.some((d) => same(d.percent)) || conditionPercents.some(same)) return true;
    if (inScope(impliedPercents, offer).some((p) => Math.abs(p.percent - c.percent) < 0.5)) return true;
    const base = { line, excerpt: c.raw, offer };
    const elsewhere = [
      ...otherOffers(promo.discounts, offer).filter((d) => same(d.percent)),
      ...otherOffers(impliedPercents, offer).filter((p) => Math.abs(p.percent - c.percent) < 0.5),
    ];
    if (elsewhere.length) {
      push({ ...base, severity: "error", code: "wrong_offer", message: `${c.percent}% belongs to ${owners(elsewhere)}, not ${offer}.` });
      return false;
    }
    const known = [...new Set([...discounts.map((d) => d.percent), ...conditionPercents])].map((p) => `${p}%`);
    const scope = offer ? ` for ${offer}` : "";
    push({
      ...base,
      severity: "error",
      code: "percent_mismatch",
      message: known.length
        ? `${c.percent}% does not match the record${scope} (${known.join(", ")}).`
        : `${c.percent}% is not in the record (the record has no percentages${scope}).`,
    });
    return false;
  };

  const windowsText = (ws: Window[]) =>
    ws.length ? ws.map((w) => `${w.start}..${w.end} (${w.offer ? `${w.offer}, ` : ""}${w.label})`).join("; ") : "none";

  /** Does [from, to] match a window exactly, or sit inside a non-blackout window? */
  const fits = (ws: Window[], from: string, to: string) =>
    ws.some((w) => w.start === from && w.end === to) ||
    (from === to && ws.some((w) => w.start === from || w.end === from)) ||
    ws.some((w) => !w.blackout && from >= w.start && to <= w.end);

  const checkDate = (c: DateClaim, line: number, offer: string | null): { ok: boolean; normalized: string } => {
    const base = { line, excerpt: c.raw, offer };
    const from = resolve(c.from);
    let to = from;
    if (c.to) {
      to = resolve(c.to);
      if (to < from) to = `${Number(to.slice(0, 4)) + 1}${to.slice(4)}`;
    }
    const isRange = c.to !== null;
    const normalized = isRange ? `${from}..${to}` : from;
    const what = isRange ? `Dates ${normalized}` : normalized;

    if (!isRange && c.isDeadline) {
      if (deadline === from) return { ok: true, normalized };
      push({
        ...base,
        severity: "error",
        code: "deadline_mismatch",
        message: deadline
          ? `Deadline ${from} does not match the record's booking deadline ${deadline}.`
          : `${from} is presented as a deadline, but the record has no booking deadline.`,
      });
      return { ok: false, normalized };
    }

    const scoped = inScope(windows, offer);
    if (scoped.some((w) => w.start === from && w.end === to)) return { ok: true, normalized };
    if (!isRange && (deadline === from || scoped.some((w) => w.start === from || w.end === from))) return { ok: true, normalized };
    const blackout = scoped.find((w) => w.blackout && from <= w.end && to >= w.start);
    if (blackout) {
      push({
        ...base,
        severity: "error",
        code: "date_in_blackout",
        message: `${what} ${isRange ? "overlap" : "falls in"} the blackout ${blackout.start}..${blackout.end} (${blackout.label}).`,
      });
      return { ok: false, normalized };
    }
    if (fits(scoped, from, to)) return { ok: true, normalized };

    const elsewhere = otherOffers(windows, offer).filter((w) => fits([w], from, to));
    if (elsewhere.length) {
      push({ ...base, severity: "error", code: "wrong_offer", message: `${what} belong${isRange ? "" : "s"} to ${owners(elsewhere)}, not ${offer}.` });
      return { ok: false, normalized };
    }
    const scope = offer ? ` for ${offer}` : "";
    push({
      ...base,
      severity: "error",
      code: "date_mismatch",
      message: isRange
        ? `Dates ${normalized} are not within the record's travel dates${scope}: ${windowsText(scoped)}.`
        : `${from} is not a date in the record${scope}. Travel dates: ${windowsText(scoped)}; booking deadline: ${deadline ?? "none"}.`,
    });
    return { ok: false, normalized };
  };

  claims.forEach((c, i) => {
    const line = lineOf(text, c.index);
    const offer = claimOffers[i] ?? null;
    if (c.type === "price") {
      const ok = checkPrice(c, line, offer);
      checked.push({ type: c.type, raw: c.raw, line, normalized: formatPrice(c, String(c.amount)), offer, ok });
    } else if (c.type === "percent") {
      checked.push({ type: c.type, raw: c.raw, line, normalized: `${c.percent}%`, offer, ok: checkPercent(c, line, offer) });
    } else {
      const { ok, normalized } = checkDate(c, line, offer);
      checked.push({ type: c.type, raw: c.raw, line, normalized: c.isDeadline && !c.to ? `deadline ${normalized}` : normalized, offer, ok });
    }
  });

  if (deadline && deadline < today) {
    push({
      severity: "error",
      code: "deadline_passed",
      message: `The booking deadline ${deadline} has passed (today is ${today}). Do not publish this promotion.`,
    });
  }

  for (const term of terms) {
    if (!hasTerm(text, term)) {
      push({
        severity: term.severity ?? "error",
        code: "missing_term",
        message: `Missing required term "${term.id}"${term.description ? ` (${term.description})` : ""}. Expected one of: ${term.any.slice(0, 4).join(", ")}${term.any.length > 4 ? ", ..." : ""}.`,
      });
    }
  }

  if (record.extraction.unverified_quotes > 0) {
    push({
      severity: "warning",
      code: "record_unverified",
      message: `The record has ${record.extraction.unverified_quotes} quote(s) that were not found in the source. Review the record before relying on it.`,
    });
  }
  for (const w of record.extraction.warnings) {
    push({ severity: "warning", code: "record_warning", message: `Record: ${w}` });
  }

  if (claims.length === 0) {
    push({ severity: "info", code: "no_claims", message: "No prices, percentages or dates found in the text." });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? Infinity) - (b.line ?? Infinity));

  const errors = findings.filter((f) => f.severity === "error").length;
  return {
    ok: errors === 0,
    language,
    today,
    summary: {
      errors,
      warnings: findings.filter((f) => f.severity === "warning").length,
      claims: checked.length,
      matched: checked.filter((c) => c.ok).length,
    },
    findings,
    claims: checked,
  };
}
