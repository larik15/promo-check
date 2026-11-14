import { describe, expect, it } from "vitest";
import { compareExtraction } from "./compare.js";
import { llmOutput, recordFor } from "./helpers.js";

// Sanity checks for the comparison used by the live test.
describe("compareExtraction", () => {
  it("finds no differences between a record and its own expected output", async () => {
    const record = await recordFor("velatura");
    expect(compareExtraction(record.promotion, llmOutput("velatura-city-breaks"), true).errors).toEqual([]);
  });

  it("reports wrong prices, deadlines and offer links", async () => {
    const record = await recordFor("velatura");
    record.promotion.prices[0]!.amount = 1199;
    record.promotion.prices[1]!.offer = "Madrid";
    record.promotion.booking_deadline!.date = "2026-12-31";
    const { errors } = compareExtraction(record.promotion, llmOutput("velatura-city-breaks"), true);
    expect(errors).toEqual([
      "missing price 1299 EUR (Madrid, 4 nights)",
      "price 899 EUR: offer Madrid, expected Lisbon",
      "unexpected price 1199 EUR (Madrid, 4 nights): \"from €1,299 per person, based on double occupancy\"",
      "booking deadline 2026-12-31, expected 2026-12-15",
    ]);
  });
});
