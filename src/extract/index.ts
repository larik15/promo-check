import type { PromoRecord, SourceKind } from "../schema.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { openAIProvider } from "./providers/openai.js";
import type { ExtractionProvider } from "./providers/types.js";
import { loadSource, sourceFromText, type PromoSource } from "./source.js";
import { verifyPromotion } from "./verify.js";

export interface ExtractOptions {
  /** "anthropic" (default), "openai", or a custom provider. Defaults to PROMO_CHECK_PROVIDER. */
  provider?: "anthropic" | "openai" | ExtractionProvider;
  /** Model override for the built-in providers. */
  model?: string;
  /** Force the source kind instead of detecting it. */
  kind?: SourceKind;
  /** ISO date used to resolve dates without a year. Defaults to today (UTC). */
  referenceDate?: string;
  /** Timestamp written into the record. Defaults to now. */
  now?: Date;
}

export function resolveProvider(options: Pick<ExtractOptions, "provider" | "model"> = {}): ExtractionProvider {
  const p = options.provider ?? process.env.PROMO_CHECK_PROVIDER ?? "anthropic";
  if (typeof p !== "string") return p;
  if (p === "anthropic") return anthropicProvider({ model: options.model });
  if (p === "openai") return openAIProvider({ model: options.model });
  throw new Error(`Unknown provider "${p}". Use "anthropic" or "openai".`);
}

/**
 * Extracts a promotion into a record. `input` is a file path (PDF, image or
 * email text) or an already loaded source.
 */
export async function extract(input: string | PromoSource, options: ExtractOptions = {}): Promise<PromoRecord> {
  const source = typeof input === "string" ? await loadSource(input, options.kind) : input;
  const provider = resolveProvider(options);
  const now = options.now ?? new Date();
  const referenceDate = options.referenceDate ?? now.toISOString().slice(0, 10);

  const extracted = await provider.extract({ source, referenceDate });
  const { promotion, unverified } = verifyPromotion(extracted, source);

  return {
    schema_version: 1,
    source: { kind: source.kind, file: source.file, pages: source.pageCount },
    extraction: {
      provider: provider.name,
      model: provider.model,
      extracted_at: now.toISOString(),
      unverified_quotes: unverified,
    },
    promotion,
  };
}

/** Extracts a promotion from email text held in memory. */
export function extractFromText(text: string, options: ExtractOptions = {}): Promise<PromoRecord> {
  return extract(sourceFromText(text), options);
}
