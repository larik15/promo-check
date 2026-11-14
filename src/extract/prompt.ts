import type { PromoSource } from "./source.js";

export const SYSTEM_PROMPT = `You extract travel and retail promotions into a structured record that is later used to fact-check marketing copy. Accuracy matters more than completeness: a wrong price or date in the record will let a wrong price or date through into published marketing.

Rules:
- Only record what the source states. If a field is not stated, use null (or an empty list). Never guess a price, percentage or date.
- For every value, copy the exact supporting text from the source into "quote": verbatim characters, including currency symbols, separators and accents. Keep quotes short (the phrase that contains the value) but complete enough to be found by exact search. Do not translate.
- Record every distinct price (each room type, cabin, size or departure), each with its currency and basis. "pp" / "por persona" means per person; "based on double occupancy" / "en ocupación doble" means per_person_double_occupancy. Use "unspecified" when the basis is not stated.
- Amounts are plain numbers: "$1,299" -> 1299, "1.299,50 €" -> 1299.5.
- Dates are ISO YYYY-MM-DD. When a date has no year, use the first occurrence on or after the reference date unless the source implies otherwise.
- "offers" lists every separately priced option: each destination, package, product, room or cabin type. Give each a short "name" as written in the source and "aliases" that marketing copy might use instead (short forms, and the English or Spanish translation, e.g. "Lisboa" for "Lisbon"). Leave "offers" empty when there is only one price option.
- Set "offer" on each price, discount and date range to the offer name it belongs to, or null when it applies to the whole promotion (taxes, general sale periods, blackouts for everything).
- "booking_deadline" is the last day to book or buy (e.g. "book by", "reserva antes del", "offer ends").
- "conditions" lists restrictions and disclosures: availability, taxes and fees, blackout dates, minimum stay, non-refundable deposits, limits per customer, and similar.
- For PDFs, "page" is the 1-based page number where the quote appears. For images and email text, "page" is null.`;

export function userPrompt(source: PromoSource, referenceDate: string, includeTextLayer: boolean): string {
  const kind =
    source.kind === "pdf" ? "a PDF promotion" : source.kind === "image" ? "a promotional flyer image" : "a promotional email";
  const parts = [
    `Extract the promotion from ${kind}${source.file ? ` (${source.file})` : ""}.`,
    `Reference date for dates without a year: ${referenceDate}.`,
  ];
  if (source.kind === "email") {
    parts.push("<email>", source.pages[0] ?? "", "</email>");
  } else if (includeTextLayer && source.pages.length > 0) {
    parts.push("Text layer of the PDF, by page:");
    source.pages.forEach((text, i) => parts.push(`<page number="${i + 1}">`, text, "</page>"));
  }
  return parts.join("\n");
}
