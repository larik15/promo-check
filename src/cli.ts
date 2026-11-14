#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { check } from "./check/index.js";
import { formatReport } from "./check/format.js";
import { parseTermsConfig } from "./check/terms.js";
import { extract } from "./extract/index.js";
import { parseRecord, SOURCE_KINDS, type SourceKind } from "./schema.js";

const USAGE = `promo-check - keep AI-generated promotional copy accurate

Usage:
  promo-check extract <file> [options]
      Extract a promotion (PDF, image flyer, or email text) into a JSON record.
      --kind <pdf|image|email>     Override type detection
      --provider <anthropic|openai> LLM provider (default: anthropic, or PROMO_CHECK_PROVIDER)
      --model <id>                 Model override (default: claude-opus-5-5 / PROMO_CHECK_MODEL)
      --reference-date <date>      ISO date for resolving dates without a year (default: today)
      -o, --out <file>             Write the record to a file instead of stdout

  promo-check check <text-file | -> --record <record.json> [options]
      Check a marketing post or email against a record. No LLM is used.
      --lang <en|es>               Language of the text (default: detected)
      --today <date>               ISO date treated as today (default: local date)
      --terms <file>               JSON list of required terms (replaces the defaults)
      --no-terms                   Skip required-term checks
      --json                       Print the report as JSON

Exit codes: 0 = pass, 1 = check found errors, 2 = usage or runtime error.
`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(message: string): never {
  process.stderr.write(`promo-check: ${message}\n`);
  process.exit(2);
}

async function runExtract(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      kind: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      "reference-date": { type: "string" },
      out: { type: "string", short: "o" },
    },
  });
  const file = positionals[0];
  if (!file) fail("extract needs a file. Run promo-check --help.");
  if (values.kind && !SOURCE_KINDS.includes(values.kind as SourceKind)) fail(`--kind must be one of ${SOURCE_KINDS.join(", ")}`);
  if (values.provider && values.provider !== "anthropic" && values.provider !== "openai") fail("--provider must be anthropic or openai");
  if (values["reference-date"] && !ISO_DATE.test(values["reference-date"])) fail("--reference-date must be YYYY-MM-DD");

  const record = await extract(file, {
    kind: values.kind as SourceKind | undefined,
    provider: values.provider as "anthropic" | "openai" | undefined,
    model: values.model,
    referenceDate: values["reference-date"],
  });
  const json = JSON.stringify(record, null, 2) + "\n";
  if (values.out) {
    await writeFile(values.out, json, "utf8");
    process.stderr.write(`Wrote ${values.out}\n`);
  } else {
    process.stdout.write(json);
  }
  if (record.extraction.unverified_quotes > 0) {
    process.stderr.write(
      `Warning: ${record.extraction.unverified_quotes} quote(s) were not found in the source text. Review them (verified: false) before use.\n`,
    );
  }
  return 0;
}

async function runCheck(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      record: { type: "string", short: "r" },
      lang: { type: "string" },
      today: { type: "string" },
      terms: { type: "string" },
      "no-terms": { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  const input = positionals[0];
  if (!input) fail("check needs a text file (or - for stdin). Run promo-check --help.");
  if (!values.record) fail("check needs --record <record.json>.");
  if (values.lang && values.lang !== "en" && values.lang !== "es") fail("--lang must be en or es");
  if (values.today && !ISO_DATE.test(values.today)) fail("--today must be YYYY-MM-DD");

  const text = input === "-" ? await readStdin() : await readFile(input, "utf8");
  const record = parseRecord(JSON.parse(await readFile(values.record, "utf8")));
  const requiredTerms = values["no-terms"]
    ? []
    : values.terms
      ? parseTermsConfig(JSON.parse(await readFile(values.terms, "utf8")))
      : undefined;

  const report = check(text, record, {
    language: values.lang as "en" | "es" | undefined,
    today: values.today,
    requiredTerms,
  });
  process.stdout.write((values.json ? JSON.stringify(report, null, 2) : formatReport(report)) + "\n");
  return report.ok ? 0 : 1;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }
  if (command === "extract") return runExtract(rest);
  if (command === "check") return runCheck(rest);
  fail(`unknown command "${command}". Run promo-check --help.`);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
);
