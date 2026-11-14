import { describe, expect, it } from "vitest";
import { extract, extractFromText } from "../src/extract/index.js";
import { anthropicProvider } from "../src/extract/providers/anthropic.js";
import { openAIJsonSchema } from "../src/extract/providers/openai.js";
import { loadSource, sniffMediaType, sourceFromBytes } from "../src/extract/source.js";
import { locateQuote } from "../src/extract/verify.js";
import { PromoRecordSchema } from "../src/schema.js";
import { fixture, llmOutput, mockProvider, NOW, readText } from "./helpers.js";

// Smallest valid PNG header bytes; enough for type detection.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("loadSource", () => {
  it("reads PDF text page by page", async () => {
    const source = await loadSource(fixture("sunward-flyer.pdf"));
    expect(source.kind).toBe("pdf");
    expect(source.pageCount).toBe(2);
    expect(source.pages[0]).toContain("US$1,299");
    expect(source.pages[1]).toContain("Book by December 15, 2026.");
  });

  it("reads email text", async () => {
    const source = await loadSource(fixture("horizonte-crucero-email.txt"));
    expect(source.kind).toBe("email");
    expect(source.pages).toHaveLength(1);
  });

  it("detects images from bytes", async () => {
    expect(sniffMediaType(PNG)).toBe("image/png");
    const source = await sourceFromBytes(PNG, "flyer.png");
    expect(source).toMatchObject({ kind: "image", mediaType: "image/png", pages: [] });
  });

  it("refuses a forced kind that does not match the bytes", async () => {
    await expect(loadSource(fixture("horizonte-crucero-email.txt"), "pdf")).rejects.toThrow(/not a PDF/);
  });
});

describe("extract with a mock LLM", () => {
  it("builds a valid record and verifies every quote in a PDF", async () => {
    const record = await extract(fixture("sunward-flyer.pdf"), { provider: mockProvider(llmOutput("sunward-flyer")), now: NOW });
    expect(() => PromoRecordSchema.parse(record)).not.toThrow();
    expect(record.source).toEqual({ kind: "pdf", file: "sunward-flyer.pdf", pages: 2 });
    expect(record.extraction).toMatchObject({ provider: "mock", model: "mock-model", unverified_quotes: 0 });
    expect(record.promotion.prices.every((p) => p.verified === true)).toBe(true);
    expect(record.promotion.booking_deadline).toMatchObject({ date: "2026-12-15", page: 2, verified: true });
  });

  it("corrects a wrong page number from the model", async () => {
    const output = llmOutput("sunward-flyer");
    output.booking_deadline!.page = 1;
    const record = await extract(fixture("sunward-flyer.pdf"), { provider: mockProvider(output), now: NOW });
    expect(record.promotion.booking_deadline!.page).toBe(2);
  });

  it("marks quotes that are not in the source", async () => {
    const output = llmOutput("sunward-flyer");
    output.prices[0]!.quote = "Garden View Room from US$1,199 per person";
    output.prices[0]!.amount = 1199;
    const record = await extract(fixture("sunward-flyer.pdf"), { provider: mockProvider(output), now: NOW });
    expect(record.promotion.prices[0]).toMatchObject({ amount: 1199, verified: false });
    expect(record.extraction.unverified_quotes).toBe(1);
  });

  it("verifies quotes in email text, across line breaks, with null pages", async () => {
    const text = readText(fixture("horizonte-crucero-email.txt"));
    const record = await extractFromText(text, { provider: mockProvider(llmOutput("horizonte-crucero")), now: NOW });
    expect(record.extraction.unverified_quotes).toBe(0);
    expect(record.promotion.product.verified).toBe(true);
    expect(record.promotion.prices.every((p) => p.page === null)).toBe(true);
  });

  it("leaves image quotes unverified (null)", async () => {
    const source = await sourceFromBytes(PNG, "flyer.png");
    const record = await extract(source, { provider: mockProvider(llmOutput("northpeak-sale")), now: NOW });
    expect(record.promotion.prices.every((p) => p.verified === null)).toBe(true);
    expect(record.extraction.unverified_quotes).toBe(0);
  });

  it("passes the reference date to the provider", async () => {
    const seen = { requests: [] as unknown[] };
    await extract(fixture("northpeak-sale-email.txt"), {
      provider: mockProvider(llmOutput("northpeak-sale"), seen),
      referenceDate: "2026-11-01",
      now: NOW,
    });
    expect(seen.requests[0]).toMatchObject({ referenceDate: "2026-11-01" });
  });
});

describe("locateQuote", () => {
  it("ignores case, curly quotes, dashes and spacing", () => {
    const pages = ["Intro", "Blackout dates: March 20 - March 28, 2027.\nSubject to availability."];
    expect(locateQuote("BLACKOUT DATES: March 20 – March 28,  2027.", pages)).toBe(2);
    expect(locateQuote("Subject to\navailability", pages)).toBe(2);
    expect(locateQuote("Blackout dates:March 20", pages)).toBe(2);
    expect(locateQuote("Not there", pages)).toBeNull();
  });
});

describe("anthropicProvider", () => {
  it("sends the PDF as a document with structured output and refusal fallbacks", async () => {
    let params: any;
    const fakeClient = {
      beta: {
        messages: {
          parse: async (p: unknown) => {
            params = p;
            return { stop_reason: "end_turn", stop_details: null, parsed_output: llmOutput("sunward-flyer") };
          },
        },
      },
    };
    const provider = anthropicProvider({ client: fakeClient as any, model: "claude-opus-5-5" });
    const record = await extract(fixture("sunward-flyer.pdf"), { provider, now: NOW });

    expect(record.extraction).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", unverified_quotes: 0 });
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.output_config.format.type).toBe("json_schema");
    const content = params.messages[0].content;
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(content[1].text).toContain("Reference date for dates without a year: 2026-11-14");
  });

  it("raises a clear error on refusal", async () => {
    const fakeClient = {
      beta: { messages: { parse: async () => ({ stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null }) } },
    };
    const provider = anthropicProvider({ client: fakeClient as any });
    await expect(extract(fixture("northpeak-sale-email.txt"), { provider })).rejects.toThrow(/declined.*cyber/);
  });

  it("omits fallbacks for models that do not support them", async () => {
    let params: any;
    const fakeClient = {
      beta: { messages: { parse: async (p: unknown) => ((params = p), { stop_reason: "end_turn", parsed_output: llmOutput("northpeak-sale") }) } },
    };
    await extract(fixture("northpeak-sale-email.txt"), { provider: anthropicProvider({ client: fakeClient as any, model: "claude-haiku-5-5" }) });
    expect(params.fallbacks).toBeUndefined();
    expect(params.betas).toBeUndefined();
  });
});

describe("openAIJsonSchema", () => {
  it("closes every object and requires every property (strict mode)", () => {
    const walk = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
      }
      Object.values(node).forEach(walk);
    };
    const schema = openAIJsonSchema();
    expect(schema.$schema).toBeUndefined();
    walk(schema);
  });
});
