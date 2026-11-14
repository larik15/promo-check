/**
 * Optional test against the real Claude API. Not part of `npm test`.
 * Run with `npm run test:live`; it is skipped unless ANTHROPIC_API_KEY is set.
 * Each run makes one extraction call per fixture (a few cents in total) and
 * writes the records and token usage to .live/ (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { check } from "../src/check/index.js";
import { extract } from "../src/extract/index.js";
import type { PromoRecord, Usage } from "../src/schema.js";
import { compareExtraction } from "./compare.js";
import { example, fixture, llmOutput, readText } from "./helpers.js";

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const OUT = new URL("../.live/", import.meta.url);

// Claude Opus 5.5 list prices, USD per million tokens.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
const cost = (u: Usage) =>
  (u.input_tokens * PRICE.input +
    u.output_tokens * PRICE.output +
    u.cache_creation_input_tokens * PRICE.cacheWrite +
    u.cache_read_input_tokens * PRICE.cacheRead) /
  1e6;

const CASES = [
  { name: "sunward", source: "sunward-flyer.pdf", expected: "sunward-flyer", strictOffers: false, posts: ["sunward-good.en.txt"] },
  { name: "horizonte", source: "horizonte-crucero-email.txt", expected: "horizonte-crucero", strictOffers: false, posts: ["horizonte-good.es.txt"] },
  { name: "northpeak", source: "northpeak-sale-email.txt", expected: "northpeak-sale", strictOffers: false, posts: ["northpeak.en.txt"] },
  { name: "velatura", source: "velatura-city-breaks-email.txt", expected: "velatura-city-breaks", strictOffers: true, posts: ["velatura-good.en.txt"] },
];

const usage: Record<string, Usage & { model: string; usd: number }> = {};

describe.skipIf(!HAS_KEY).concurrent("live extraction (real model)", () => {
  afterAll(() => {
    const rows = Object.entries(usage);
    const total = rows.reduce(
      (t, [, u]) => ({
        input_tokens: t.input_tokens + u.input_tokens,
        output_tokens: t.output_tokens + u.output_tokens,
        cache_creation_input_tokens: t.cache_creation_input_tokens + u.cache_creation_input_tokens,
        cache_read_input_tokens: t.cache_read_input_tokens + u.cache_read_input_tokens,
        usd: t.usd + u.usd,
      }),
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, usd: 0 },
    );
    writeFileSync(new URL("usage.json", OUT), JSON.stringify({ perFixture: usage, total }, null, 2) + "\n");
    console.log(`Live run: ${total.input_tokens} input + ${total.output_tokens} output tokens, about $${total.usd.toFixed(4)}`);
  });

  it.each(CASES)("$name matches the expected record", async ({ name, source, expected, strictOffers, posts }) => {
    mkdirSync(OUT, { recursive: true });
    const record: PromoRecord = await extract(fixture(source), { referenceDate: "2026-11-14" });
    writeFileSync(new URL(`${name}.record.json`, OUT), JSON.stringify(record, null, 2) + "\n");
    if (record.extraction.usage) usage[name] = { ...record.extraction.usage, model: record.extraction.model, usd: cost(record.extraction.usage) };

    const { errors, notes } = compareExtraction(record.promotion, llmOutput(expected), strictOffers);
    writeFileSync(new URL(`${name}.comparison.json`, OUT), JSON.stringify({ errors, notes, warnings: record.extraction.warnings }, null, 2) + "\n");

    expect(errors).toEqual([]);
    expect(record.extraction.unverified_quotes).toBe(0);
    // The real record must also accept the accurate sample post.
    for (const p of posts) {
      const report = check(readText(example(`posts/${p}`)), record, { today: "2026-11-14" });
      expect(report.findings.filter((f) => f.severity === "error"), p).toEqual([]);
    }
  });
});
