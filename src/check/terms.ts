import { z } from "zod";

export const RequiredTermSchema = z.object({
  /** Stable id used in reports, e.g. "taxes". */
  id: z.string(),
  description: z.string().optional(),
  /**
   * The term is present if any of these phrases appears. Matching ignores case
   * and accents and respects word boundaries. Wrap a value in slashes to use a
   * regular expression, e.g. "/t&cs? apply/".
   */
  any: z.array(z.string()).min(1),
  severity: z.enum(["error", "warning"]).optional(),
});
export type RequiredTerm = z.infer<typeof RequiredTermSchema>;

/** Default disclosures, in English and Spanish. Replace with --terms <file>. */
export const DEFAULT_REQUIRED_TERMS: RequiredTerm[] = [
  {
    id: "availability",
    description: "Availability disclaimer",
    any: [
      "subject to availability", "while supplies last", "limited availability", "limited spots", "limited stock",
      "sujeto a disponibilidad", "sujeta a disponibilidad", "hasta agotar existencias", "disponibilidad limitada",
      "plazas limitadas", "cupo limitado", "cupos limitados",
    ],
  },
  {
    id: "taxes_fees",
    description: "Taxes and fees disclosure",
    any: ["tax", "taxes", "fees", "impuestos", "tasas", "cargos", "iva"],
  },
  {
    id: "terms",
    description: "Terms and conditions reference",
    any: [
      "terms apply", "conditions apply", "restrictions apply", "terms and conditions", "terms & conditions",
      "/t&cs? apply/", "aplican restricciones", "aplican condiciones", "aplican términos", "términos y condiciones",
      "consulta condiciones", "consulta términos",
    ],
  },
];

/** Lowercases and strips accents. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasTerm(text: string, term: RequiredTerm): boolean {
  const folded = fold(text);
  return term.any.some((phrase) => {
    if (phrase.length > 2 && phrase.startsWith("/") && phrase.endsWith("/")) {
      return new RegExp(phrase.slice(1, -1), "iu").test(text);
    }
    const p = fold(phrase).trim().split(/\s+/).map(escapeRegExp).join("\\s+");
    // Word boundaries only next to letters/digits, so phrases like "t&c" still work.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${p}(?![\\p{L}\\p{N}])`, "u");
    return re.test(folded);
  });
}

/** Reads a terms config: either an array of terms or { "requiredTerms": [...] }. */
export function parseTermsConfig(data: unknown): RequiredTerm[] {
  const list = Array.isArray(data) ? data : (data as { requiredTerms?: unknown })?.requiredTerms;
  return z.array(RequiredTermSchema).parse(list);
}
