/**
 * Parses a number written with English or Spanish separators.
 *
 *   "1,299" -> 1299      "1.299" -> 1299       "1 299" (nbsp) -> 1299
 *   "1,299.50" -> 1299.5 "1.299,50" -> 1299.5  "12,5" -> 12.5   "12.5" -> 12.5
 *
 * A single separator followed by exactly three digits is read as a thousands
 * separator (prices like "1.299" or "1,299"); followed by one or two digits it
 * is a decimal separator.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[\s  ']/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot !== -1 && lastComma !== -1) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("");
    s = s.replace(dec, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (parts.slice(1).some((p) => p.length !== 3)) return null;
      s = parts.join("");
    } else {
      const after = parts[1] ?? "";
      if (after.length === 3) s = parts.join("");
      else if (after.length >= 1 && after.length <= 2) s = `${parts[0]}.${after}`;
      else return null;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** Formats an amount for messages: 1299 -> "1,299", 1299.5 -> "1,299.50". */
export function formatAmount(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
