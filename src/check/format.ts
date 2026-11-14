import type { CheckReport } from "./index.js";

const LABEL = { error: "ERROR", warning: "WARN ", info: "INFO " } as const;

/** Renders a report for the terminal. */
export function formatReport(report: CheckReport): string {
  const { errors, warnings, claims, matched } = report.summary;
  const lines: string[] = [];
  lines.push(
    `${report.ok ? "PASS" : "FAIL"}  ${errors} error(s), ${warnings} warning(s); ${matched}/${claims} claim(s) match the record  [lang: ${report.language}, today: ${report.today}]`,
  );
  if (report.findings.length) lines.push("");
  for (const f of report.findings) {
    const where = f.line ? `line ${f.line}` : "";
    const excerpt = f.excerpt ? `  "${f.excerpt}"` : "";
    lines.push(`${LABEL[f.severity]} ${f.code.padEnd(21)} ${where.padEnd(8)}${excerpt}`.trimEnd());
    lines.push(`      ${f.message}`);
  }
  if (report.claims.length) {
    lines.push("", "Claims found:");
    for (const c of report.claims) {
      lines.push(`  ${c.ok ? "ok " : "BAD"}  line ${String(c.line).padEnd(3)} ${c.type.padEnd(8)} ${JSON.stringify(c.raw).padEnd(28)} -> ${c.normalized}`);
    }
  }
  return lines.join("\n");
}
