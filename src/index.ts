export * from "./schema.js";

export { extract, extractFromText, resolveProvider, type ExtractOptions } from "./extract/index.js";
export { loadSource, sourceFromBytes, sourceFromText, type PromoSource } from "./extract/source.js";
export { verifyPromotion, locateQuote, normalizeForMatch } from "./extract/verify.js";
export { anthropicProvider, DEFAULT_ANTHROPIC_MODEL, type AnthropicProviderOptions } from "./extract/providers/anthropic.js";
export { openAIProvider, DEFAULT_OPENAI_MODEL, type OpenAIProviderOptions } from "./extract/providers/openai.js";
export { ExtractionError, type ExtractionProvider, type ExtractionRequest, type ExtractionResult } from "./extract/providers/types.js";

export { check, localToday, type CheckOptions, type CheckReport, type CheckedClaim, type Finding, type Severity } from "./check/index.js";
export { findClaims, findPrices, findPercents, detectLanguage, type Claim, type PriceClaim, type PercentClaim, type Language } from "./check/claims.js";
export { findDates, type DateClaim, type PartialDate } from "./check/dates.js";
export { parseNumber } from "./check/numbers.js";
export { DEFAULT_REQUIRED_TERMS, hasTerm, parseTermsConfig, type RequiredTerm } from "./check/terms.js";
export { formatReport } from "./check/format.js";
