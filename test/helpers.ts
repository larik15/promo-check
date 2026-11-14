import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extract } from "../src/extract/index.js";
import type { ExtractionProvider } from "../src/extract/providers/types.js";
import type { ExtractedPromotion, PromoRecord } from "../src/schema.js";

export const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
export const example = (name: string) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
export const readText = (path: string) => readFileSync(path, "utf8");

export const NOW = new Date("2026-11-14T12:00:00Z");

/** A provider that returns canned LLM output, so tests never call an API. */
export function mockProvider(output: ExtractedPromotion, seen?: { requests: unknown[] }): ExtractionProvider {
  return {
    name: "mock",
    model: "mock-model",
    async extract(request) {
      seen?.requests.push(request);
      return { promotion: structuredClone(output), usage: null };
    },
  };
}

export function llmOutput(name: string): ExtractedPromotion {
  return JSON.parse(readText(fixture(`${name}.llm.json`)));
}

const SOURCES = {
  sunward: "sunward-flyer.pdf",
  horizonte: "horizonte-crucero-email.txt",
  northpeak: "northpeak-sale-email.txt",
  velatura: "velatura-city-breaks-email.txt",
} as const;

/** Runs the real extract pipeline (loading, quote verification) with a mock LLM. */
export function recordFor(name: keyof typeof SOURCES): Promise<PromoRecord> {
  const llmName = ({ sunward: "sunward-flyer", horizonte: "horizonte-crucero", northpeak: "northpeak-sale", velatura: "velatura-city-breaks" } as const)[name];
  return extract(fixture(SOURCES[name]), { provider: mockProvider(llmOutput(llmName)), now: NOW });
}
