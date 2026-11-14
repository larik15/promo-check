import { describe, expect, it } from "vitest";
import { check } from "../src/check/index.js";
import { formatReport } from "../src/check/format.js";
import { parseTermsConfig } from "../src/check/terms.js";
import { example, readText, recordFor } from "./helpers.js";

const TODAY = "2026-11-14";
const post = (name: string) => readText(example(`posts/${name}`));
const codes = (r: ReturnType<typeof check>) => r.findings.map((f) => f.code);

describe("check: travel flyer (English)", () => {
  it("passes an accurate post", async () => {
    const record = await recordFor("sunward");
    const report = check(post("sunward-good.en.txt"), record, { today: TODAY });
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.language).toBe("en");
    expect(report.claims.map((c) => c.normalized)).toEqual([
      "1299 USD",
      "30%",
      "2027-03-01..2027-04-30",
      "deadline 2026-12-15",
      "$189",
    ]);
  });

  it("reports every inaccurate claim", async () => {
    const record = await recordFor("sunward");
    const report = check(post("sunward-bad.en.txt"), record, { today: TODAY });
    expect(report.ok).toBe(false);
    expect(codes(report).sort()).toEqual(
      [
        "price_mismatch", // $1,199
        "price_basis_mismatch", // $1,299 per couple
        "percent_mismatch", // 35%
        "date_in_blackout", // March 22-26
        "deadline_mismatch", // December 31
        "missing_term", // availability
        "missing_term", // taxes
        "price_basis_missing", // US$1,549 with no basis
      ].sort(),
    );
    const price = report.findings.find((f) => f.code === "price_mismatch")!;
    expect(price.line).toBe(1);
    expect(price.excerpt).toBe("$1,199");
    expect(price.message).toContain("1,299 USD per person double occupancy");
  });

  it("flags a passed booking deadline", async () => {
    const record = await recordFor("sunward");
    const report = check(post("sunward-good.en.txt"), record, { today: "2026-12-16" });
    expect(codes(report)).toEqual(["deadline_passed"]);
    expect(report.ok).toBe(false);
  });

  it("accepts a sample date inside the travel window but outside the blackout", async () => {
    const record = await recordFor("sunward");
    const ok = check("Fly out April 10, 2027.", record, { today: TODAY, requiredTerms: [] });
    expect(ok.ok).toBe(true);
    const bad = check("Fly out May 10, 2027.", record, { today: TODAY, requiredTerms: [] });
    expect(codes(bad)).toEqual(["date_mismatch"]);
  });

  it("resolves dates without a year against the record", async () => {
    const record = await recordFor("sunward");
    const report = check("Travel March 1 - April 30. Book by Dec 15.", record, { today: TODAY, requiredTerms: [] });
    expect(report.ok).toBe(true);
    expect(report.claims.map((c) => c.normalized)).toEqual(["2027-03-01..2027-04-30", "deadline 2026-12-15"]);
  });

  it("rejects a currency the record does not use", async () => {
    const record = await recordFor("sunward");
    const report = check("Now from €1,299 per person, double occupancy.", record, { today: TODAY, requiredTerms: [] });
    expect(codes(report)).toEqual(["currency_mismatch"]);
  });
});

describe("check: cruise email (Spanish)", () => {
  it("passes an accurate post", async () => {
    const record = await recordFor("horizonte");
    const report = check(post("horizonte-good.es.txt"), record, { today: TODAY });
    expect(report.findings).toEqual([]);
    expect(report.language).toBe("es");
    expect(report.claims.map((c) => c.normalized)).toEqual([
      "1299 USD",
      "2027-02-10..2027-02-15",
      "2027-03-03..2027-03-08",
      "25%",
      "deadline 2026-11-30",
    ]);
  });

  it("reports every inaccurate claim", async () => {
    const record = await recordFor("horizonte");
    const report = check(post("horizonte-bad.es.txt"), record, { today: TODAY });
    expect(codes(report).sort()).toEqual(
      [
        "price_mismatch", // $1.199
        "price_basis_mismatch", // 1.749 dólares por pareja
        "date_mismatch", // 12 de marzo
        "percent_mismatch", // 40%
        "deadline_mismatch", // 15 de diciembre
        "missing_term",
        "missing_term",
        "missing_term",
      ].sort(),
    );
    const deadline = report.findings.find((f) => f.code === "deadline_mismatch")!;
    expect(deadline.message).toContain("2026-12-15");
    expect(deadline.message).toContain("2026-11-30");
  });
});

describe("check: retail sale", () => {
  it("accepts was/now prices and the percentage", async () => {
    const record = await recordFor("northpeak");
    const report = check(post("northpeak.en.txt"), record, { today: TODAY });
    expect(report.findings).toEqual([]);
  });

  it("accepts a percentage implied by record prices", async () => {
    const record = await recordFor("northpeak");
    record.promotion.discounts = [];
    const report = check("Save 30%!", record, { today: TODAY, requiredTerms: [] });
    expect(report.ok).toBe(true);
  });

  it("flags the sale once it has ended", async () => {
    const record = await recordFor("northpeak");
    const report = check(post("northpeak.en.txt"), record, { today: "2026-12-01" });
    expect(codes(report)).toEqual(["deadline_passed"]);
  });
});

describe("check: required terms", () => {
  it("uses a custom terms list", async () => {
    const record = await recordFor("northpeak");
    const terms = parseTermsConfig({
      requiredTerms: [
        { id: "limit", any: ["limit 2", "/l[ií]mite de 2/"] },
        { id: "online_only", any: ["online only"], severity: "warning" },
      ],
    });
    const report = check(post("northpeak.en.txt"), record, { today: TODAY, requiredTerms: terms });
    expect(report.findings.map((f) => `${f.severity}:${f.code}`)).toEqual(["error:missing_term", "warning:missing_term"]);
    expect(report.findings[0]!.message).toContain('"limit"');
  });

  it("matches terms without accents or case", async () => {
    const record = await recordFor("horizonte");
    const text = "SUJETO A DISPONIBILIDAD. Impuestos no incluidos. Aplican terminos y condiciones.";
    const report = check(text, record, { today: TODAY });
    expect(codes(report)).toEqual(["no_claims"]);
  });
});

describe("check: record quality", () => {
  it("warns when the record has unverified quotes", async () => {
    const record = await recordFor("sunward");
    record.extraction.unverified_quotes = 2;
    const report = check(post("sunward-good.en.txt"), record, { today: TODAY });
    expect(codes(report)).toEqual(["record_unverified"]);
    expect(report.ok).toBe(true);
  });

  it("notes when nothing was checked", async () => {
    const record = await recordFor("sunward");
    const report = check("Paradise awaits.", record, { today: TODAY, requiredTerms: [] });
    expect(codes(report)).toEqual(["no_claims"]);
  });
});

describe("formatReport", () => {
  it("renders a readable summary", async () => {
    const record = await recordFor("sunward");
    const text = formatReport(check(post("sunward-bad.en.txt"), record, { today: TODAY }));
    expect(text).toMatch(/^FAIL {2}7 error\(s\), 1 warning\(s\)/);
    expect(text).toContain('ERROR price_mismatch');
    expect(text).toContain('"$1,199"');
  });
});

describe("check: several offers (Madrid / Lisbon)", () => {
  it("passes a post where every claim sits next to the right city", async () => {
    const record = await recordFor("velatura");
    const report = check(post("velatura-good.en.txt"), record, { today: TODAY });
    expect(report.findings).toEqual([]);
    expect(report.claims.map((c) => `${c.normalized} [${c.offer}]`)).toEqual([
      "1299 EUR [Madrid]",
      "2027-04-05..2027-04-09 [Madrid]",
      "2027-05-03..2027-05-07 [Madrid]",
      "15% [Madrid]",
      "899 EUR [Lisbon]",
      "2027-04-12..2027-04-15 [Lisbon]",
      "10% [Lisbon]",
      "deadline 2026-12-15 [null]",
      "95 EUR [null]",
    ]);
  });

  it("reports values that belong to a different offer", async () => {
    const record = await recordFor("velatura");
    const report = check(post("velatura-bad.en.txt"), record, { today: TODAY });
    expect(report.findings.map((f) => f.message)).toEqual([
      "Price 1,299 EUR belongs to Madrid, not Lisbon.",
      "Dates 2027-04-05..2027-04-09 belong to Madrid, not Lisbon.",
      "15% belongs to Madrid, not Lisbon.",
      "Price 899 EUR belongs to Lisbon, not Madrid.",
    ]);
    expect(report.findings.every((f) => f.code === "wrong_offer")).toBe(true);
  });

  it("recognizes Spanish names through aliases (Lisboa)", async () => {
    const record = await recordFor("velatura");
    const report = check(post("velatura-bad.es.txt"), record, { today: TODAY });
    expect(report.language).toBe("es");
    expect(report.findings.map((f) => `${f.code} line ${f.line}: ${f.message}`)).toEqual([
      "wrong_offer line 1: Price 1,299 EUR belongs to Madrid, not Lisbon.",
      "wrong_offer line 1: Dates 2027-04-05..2027-04-09 belong to Madrid, not Lisbon.",
      "wrong_offer line 2: Price 899 EUR belongs to Lisbon, not Madrid.",
      "wrong_offer line 2: 10% belongs to Lisbon, not Madrid.",
    ]);
  });

  it("still reports values that are in no offer at all", async () => {
    const record = await recordFor("velatura");
    const report = check("Lisbon from €799 per person, double occupancy.", record, { today: TODAY, requiredTerms: [] });
    expect(report.findings.map((f) => f.code)).toEqual(["price_mismatch"]);
    expect(report.findings[0]!.message).toBe(
      "Price 799 EUR does not match the record. Record prices for Lisbon: 899 EUR per person double occupancy (Lisbon, 3 nights); 95 EUR per person (Taxes and fees (not included)).",
    );
  });

  it("compares claims with no nearby offer against the whole record", async () => {
    const record = await recordFor("velatura");
    const report = check("City breaks from €899 per person, double occupancy.", record, { today: TODAY, requiredTerms: [] });
    expect(report.ok).toBe(true);
  });

  it("checks room types as offers too", async () => {
    const record = await recordFor("sunward");
    const report = check("Ocean View Room from US$1,299 per person, double occupancy.", record, { today: TODAY, requiredTerms: [] });
    expect(report.findings.map((f) => f.message)).toEqual(["Price 1,299 USD belongs to Garden View Room, not Ocean View Room."]);
  });
});
