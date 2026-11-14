import { z } from "zod";

/**
 * Price bases. "per_person_double_occupancy" is the usual travel basis
 * ("from $1,299 pp, based on double occupancy").
 */
export const PRICE_BASES = [
  "per_person",
  "per_person_double_occupancy",
  "per_person_single_occupancy",
  "per_couple",
  "per_room",
  "per_night",
  "per_room_per_night",
  "per_unit",
  "total",
  "unspecified",
] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

const QUOTE_DESC =
  "Exact, verbatim text copied from the source that supports this value. Copy characters exactly; do not paraphrase, translate or fix typos.";
const PAGE_DESC = "1-based page number of the quote for PDF sources; null for images and email text.";

/**
 * Builds the promotion schema. The LLM gets the variant without `verified`;
 * stored records carry `verified` on every quoted item.
 */
const baseQuoted = {
  quote: z.string().describe(QUOTE_DESC),
  page: z.number().int().nullable().describe(PAGE_DESC),
};

const verifiedQuoted = {
  ...baseQuoted,
  verified: z
    .boolean()
    .nullable()
    .describe("true if the quote was found in the source text, false if not, null if it could not be checked (images)."),
};

function buildPromotionSchema<Q extends z.ZodRawShape>(quoted: Q) {
  const textField = z.object({ value: z.string(), ...quoted });

  const price = z.object({
    label: z.string().describe("What this price is for, e.g. '7-night package, garden-view room' or 'Trail runner shoe'."),
    amount: z.number().describe("Numeric amount, e.g. 1299 or 1299.5. No thousands separators."),
    currency: z.string().describe("ISO 4217 code, e.g. USD, EUR, MXN. Infer from symbol and context."),
    basis: z.enum(PRICE_BASES),
    ...quoted,
  });

  const discount = z.object({
    label: z.string().describe("What the percentage applies to, e.g. 'early booking discount'."),
    percent: z.number().describe("Percentage as a number, e.g. 30 for 30%."),
    ...quoted,
  });

  const dateRange = z.object({
    label: z.string().describe("What the dates mean, e.g. 'travel window', 'blackout', 'sale period'."),
    start: z.string().describe("ISO date YYYY-MM-DD."),
    end: z.string().describe("ISO date YYYY-MM-DD; same as start for a single day."),
    ...quoted,
  });

  const deadline = z.object({
    date: z.string().describe("ISO date YYYY-MM-DD: last day to book or buy."),
    ...quoted,
  });

  const condition = z.object({
    text: z.string().describe("The condition, restriction or required disclosure, in the source language."),
    ...quoted,
  });

  return z.object({
    supplier: textField.describe("Company offering the promotion."),
    product: textField.describe("Product, package, cruise, hotel or item being promoted."),
    destination: textField.nullable().describe("Travel destination; null for retail."),
    prices: z.array(price),
    discounts: z.array(discount),
    travel_dates: z.array(dateRange).describe("Travel or validity periods. Empty for retail promotions without them."),
    booking_deadline: deadline.nullable(),
    conditions: z.array(condition),
  });
}

/** Schema the LLM must fill. */
export const ExtractedPromotionSchema = buildPromotionSchema(baseQuoted);
export type ExtractedPromotion = z.infer<typeof ExtractedPromotionSchema>;

/** Promotion with quote verification results. */
export const VerifiedPromotionSchema = buildPromotionSchema(verifiedQuoted);
export type VerifiedPromotion = z.infer<typeof VerifiedPromotionSchema>;

export const SOURCE_KINDS = ["pdf", "image", "email"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** The record written by `extract` and read by `check`. */
export const PromoRecordSchema = z.object({
  schema_version: z.literal(1),
  source: z.object({
    kind: z.enum(SOURCE_KINDS),
    file: z.string().nullable(),
    pages: z.number().int().nullable(),
  }),
  extraction: z.object({
    provider: z.string(),
    model: z.string(),
    extracted_at: z.string(),
    unverified_quotes: z.number().int().describe("Count of quotes not found in the source text."),
  }),
  promotion: VerifiedPromotionSchema,
});
export type PromoRecord = z.infer<typeof PromoRecordSchema>;

/** Parses and validates a record (e.g. loaded from JSON). Throws on invalid input. */
export function parseRecord(data: unknown): PromoRecord {
  return PromoRecordSchema.parse(data);
}
