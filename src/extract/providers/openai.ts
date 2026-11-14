import { z } from "zod";
import { ExtractedPromotionSchema } from "../../schema.js";
import { SYSTEM_PROMPT, userPrompt } from "../prompt.js";
import { toBase64 } from "../source.js";
import { ExtractionError, type ExtractionProvider, type ExtractionRequest, type ExtractionResult } from "./types.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5";

export interface OpenAIProviderOptions {
  /** Defaults to OPENAI_MODEL, then gpt-5. */
  model?: string;
}

/** JSON Schema for OpenAI strict structured outputs: every object closed, no $schema key. */
export function openAIJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ExtractedPromotionSchema) as Record<string, unknown>;
  delete schema.$schema;
  const close = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(close);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object") obj.additionalProperties = false;
    Object.values(obj).forEach(close);
  };
  close(schema);
  return schema;
}

/**
 * OpenAI provider (optional). Select with PROMO_CHECK_PROVIDER=openai.
 * PDFs are sent as their text layer, so scanned PDFs without text need the Anthropic provider.
 */
export function openAIProvider(options: OpenAIProviderOptions = {}): ExtractionProvider {
  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  return {
    name: "openai",
    model,
    async extract({ source, referenceDate }: ExtractionRequest): Promise<ExtractionResult> {
      if (source.kind === "pdf" && source.pages.length === 0) {
        throw new ExtractionError("This PDF has no text layer. Use the Anthropic provider for scanned PDFs.");
      }
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI();

      const text = userPrompt(source, referenceDate, true);
      const content: Array<
        { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
      > = [{ type: "text", text }];
      if (source.kind === "image" && source.data && source.mediaType) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${source.mediaType};base64,${toBase64(source.data)}` },
        });
      }

      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "promotion", strict: true, schema: openAIJsonSchema() },
        },
      });

      const message = completion.choices[0]?.message;
      if (message?.refusal) throw new ExtractionError(`The model declined: ${message.refusal}`);
      if (!message?.content) throw new ExtractionError("The model returned no content.");
      const parsed = ExtractedPromotionSchema.safeParse(JSON.parse(message.content));
      if (!parsed.success) throw new ExtractionError(`Invalid record from model: ${parsed.error.message}`);
      const u = completion.usage;
      const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
      return {
        promotion: parsed.data,
        usage: u
          ? {
              input_tokens: u.prompt_tokens - cached,
              output_tokens: u.completion_tokens,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: cached,
            }
          : null,
      };
    },
  };
}
