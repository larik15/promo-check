import { describe, expect, it } from "vitest";
import { parseNumber } from "../src/check/numbers.js";

describe("parseNumber", () => {
  it.each([
    ["1,299", 1299],
    ["1.299", 1299],
    ["1299", 1299],
    ["1,299.00", 1299],
    ["1.299,50", 1299.5],
    ["1,299.50", 1299.5],
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["15,999", 15999],
    ["1.234.567", 1234567],
    ["1,234,567.89", 1234567.89],
    ["1 299", 1299],
    ["1 299,90", 1299.9],
  ])("%s -> %d", (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected);
  });

  it("rejects malformed groupings", () => {
    expect(parseNumber("1,29,9")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("12.3456")).toBeNull();
  });
});
