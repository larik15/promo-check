import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ExtractedPromotionSchema } from "../../schema.js";
import { SYSTEM_PROMPT, userPrompt } from "../prompt.js";
import { toBase64 } from "../source.js";
import { ExtractionError, type ExtractionProvider, type ExtractionRequest, type ExtractionResult } from "./types.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Models that accept server-side refusal fallbacks with `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5"]);

export interface AnthropicProviderOptions {
  /** Defaults to PROMO_CHECK_MODEL, then claude-opus-5-5. */
  model?: string;
  /** Pre-configured client; defaults to `new Anthropic()` (reads ANTHROPIC_API_KEY). */
  client?: Anthropic;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export function anthropicProvider(options: AnthropicProviderOptions = {}): ExtractionProvider {
  const model = options.model ?? process.env.PROMO_CHECK_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  let client = options.client;

  return {
    name: "anthropic",
    model,
    async extract({ source, referenceDate }: ExtractionRequest): Promise<ExtractionResult> {
      client ??= new Anthropic();
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (source.kind === "pdf" && source.data) {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: toBase64(source.data) },
        });
      } else if (source.kind === "image" && source.data && source.mediaType && source.mediaType !== "application/pdf") {
        content.push({
          type: "image",
          source: { type: "base64", media_type: source.mediaType, data: toBase64(source.data) },
        });
      }
      // Claude reads the PDF itself (including scanned pages), so the text layer is not repeated.
      content.push({ type: "text", text: userPrompt(source, referenceDate, false) });

      const useFallbacks = FALLBACK_MODELS.has(model);
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: {
          effort: options.effort ?? "high",
          format: betaZodOutputFormat(ExtractedPromotionSchema),
        },
        messages: [{ role: "user", content }],
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });

      if (response.stop_reason === "refusal") {
        const details = response.stop_details;
        throw new ExtractionError(
          `The model declined to extract this promotion${details?.category ? ` (${details.category})` : ""}.`,
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new ExtractionError("The extraction was cut off (max_tokens). Try a shorter source.");
      }
      if (!response.parsed_output) {
        throw new ExtractionError("The model did not return a valid promotion record.");
      }
      const u = response.usage;
      return {
        promotion: response.parsed_output,
        usage: u
          ? {
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
              cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            }
          : null,
      };
    },
  };
}
