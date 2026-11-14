import type { ExtractedPromotion, Usage } from "../../schema.js";
import type { PromoSource } from "../source.js";

export interface ExtractionRequest {
  source: PromoSource;
  /** ISO date used to resolve dates without a year. */
  referenceDate: string;
}

export interface ExtractionResult {
  promotion: ExtractedPromotion;
  /** Token usage, when the provider reports it. */
  usage: Usage | null;
}

/** Anything that turns a source into an ExtractedPromotion. Implement this to plug in another LLM or a mock. */
export interface ExtractionProvider {
  name: string;
  model: string;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}
