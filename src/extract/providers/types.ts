import type { ExtractedPromotion } from "../../schema.js";
import type { PromoSource } from "../source.js";

export interface ExtractionRequest {
  source: PromoSource;
  /** ISO date used to resolve dates without a year. */
  referenceDate: string;
}

/** Anything that turns a source into an ExtractedPromotion. Implement this to plug in another LLM or a mock. */
export interface ExtractionProvider {
  name: string;
  model: string;
  extract(request: ExtractionRequest): Promise<ExtractedPromotion>;
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}
