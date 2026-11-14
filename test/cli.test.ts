import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { example } from "./helpers.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// The CLI test runs against the build output (`npm test` builds first).
describe.skipIf(!existsSync(CLI))("cli", () => {
  const record = example("records/sunward.record.json");

  it("passes an accurate post (exit 0)", () => {
    const r = run(["check", example("posts/sunward-good.en.txt"), "--record", record, "--today", "2026-11-14"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^PASS/);
  });

  it("fails an inaccurate post (exit 1) and prints JSON", () => {
    const r = run(["check", example("posts/sunward-bad.en.txt"), "--record", record, "--today", "2026-11-14", "--json"]);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.summary.errors).toBe(7);
  });

  it("reads the text from stdin", () => {
    const r = run(["check", "-", "--record", record, "--today", "2026-11-14", "--no-terms"], "Save 30%!");
    expect(r.code).toBe(0);
  });

  it("exits 2 on usage errors", () => {
    expect(run(["check", example("posts/sunward-good.en.txt")]).code).toBe(2);
    expect(run(["frobnicate"]).code).toBe(2);
    expect(run(["check", "x.txt", "--record", record, "--today", "Nov 14"]).code).toBe(2);
  });

  it("prints help", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("promo-check extract <file>");
  });
});
