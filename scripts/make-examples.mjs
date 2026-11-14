// Builds examples/records/*.json by running the real extract pipeline
// (source loading + quote verification) with canned LLM output from
// test/fixtures/*.llm.json, so no API key is needed. Run `npm run build` first.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extract } from "../dist/index.js";

const root = new URL("../", import.meta.url);
const items = [
  ["sunward-flyer.pdf", "sunward-flyer.llm.json", "sunward.record.json"],
  ["horizonte-crucero-email.txt", "horizonte-crucero.llm.json", "horizonte.record.json"],
  ["northpeak-sale-email.txt", "northpeak-sale.llm.json", "northpeak.record.json"],
  ["velatura-city-breaks-email.txt", "velatura-city-breaks.llm.json", "velatura.record.json"],
];

await mkdir(new URL("examples/records/", root), { recursive: true });
for (const [source, llm, out] of items) {
  const output = JSON.parse(await readFile(new URL(`test/fixtures/${llm}`, root), "utf8"));
  const record = await extract(new URL(`test/fixtures/${source}`, root).pathname.replace(/^\/([A-Za-z]:)/, "$1"), {
    provider: { name: "anthropic", model: "claude-opus-5-5", extract: async () => ({ promotion: output, usage: null }) },
    now: new Date("2026-11-14T12:00:00Z"),
  });
  await writeFile(new URL(`examples/records/${out}`, root), JSON.stringify(record, null, 2) + "\n");
  console.log(`Wrote examples/records/${out} (${record.extraction.unverified_quotes} unverified quotes)`);
}
