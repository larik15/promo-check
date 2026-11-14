import { describe, expect, it } from "vitest";
import { detectLanguage, findClaims, findPercents, findPrices } from "../src/check/claims.js";
import { findDates } from "../src/check/dates.js";

const price = (text: string) => {
  const [p] = findPrices(text);
  return p && { amount: p.amount, currencies: p.currencies, basis: p.basis };
};

describe("findPrices", () => {
  it.each([
    ["from $1,299", 1299, "USD"],
    ["desde 1.299 USD", 1299, "USD"],
    ["US$1,299.00 total", 1299, "USD"],
    ["USD 1,299", 1299, "USD"],
    ["1.299,50 €", 1299.5, "EUR"],
    ["€899", 899, "EUR"],
    ["899 euros", 899, "EUR"],
    ["MX$15,999", 15999, "MXN"],
    ["15.999 pesos mexicanos", 15999, "MXN"],
    ["£450", 450, "GBP"],
    ["1.749 dólares", 1749, "USD"],
    ["1 299 €", 1299, "EUR"],
  ])("%s", (text, amount, currency) => {
    const p = price(text)!;
    expect(p.amount).toBe(amount);
    expect(p.currencies).toContain(currency);
  });

  it("treats a bare $ as any dollar or peso currency", () => {
    expect(price("$1,299")!.currencies).toEqual(expect.arrayContaining(["USD", "MXN", "CAD"]));
  });

  it("prefers a trailing currency code over a bare $", () => {
    expect(price("$1,299 USD")!.currencies).toEqual(["USD"]);
  });

  it("ignores numbers without a currency", () => {
    expect(findPrices("7 nights, 2 adults, room 1299")).toEqual([]);
  });

  it("does not read lowercase words as currency codes", () => {
    expect(findPrices("bring 2 pen and 3 eur...")).toEqual([]);
  });

  it.each([
    ["$1,299 per person", "per_person"],
    ["$1,299 pp", "per_person"],
    ["1.299 USD por persona", "per_person"],
    ["$1,299 per person, based on double occupancy", "double_occupancy"],
    ["1.299 USD por persona en ocupación doble", "double_occupancy"],
    ["$1,299 per couple", "per_couple"],
    ["1.749 dólares por pareja", "per_couple"],
    ["$189 per night", "per_night"],
    ["$189 por noche", "per_night"],
    ["$1,299!", null],
  ])("basis: %s", (text, basis) => {
    expect(price(text)!.basis).toBe(basis);
  });

  it("does not borrow the basis of the next price", () => {
    const [a, b] = findPrices("Was $180, now $126 per person");
    expect(a!.basis).toBeNull();
    expect(b!.basis).toBe("per_person");
  });
});

describe("findPercents", () => {
  it.each([
    ["Save 30%", 30],
    ["30 % de descuento", 30],
    ["12,5% off", 12.5],
    ["un 25 por ciento", 25],
    ["40 percent off", 40],
  ])("%s", (text, percent) => {
    expect(findPercents(text)[0]!.percent).toBe(percent);
  });
});

describe("findDates", () => {
  const one = (text: string, lang: "en" | "es" = "en") => {
    const [d] = findDates(text, lang);
    return d && { from: d.from, to: d.to, isDeadline: d.isDeadline };
  };

  it.each([
    ["March 12, 2027", { y: 2027, m: 3, d: 12 }],
    ["Mar. 12", { y: null, m: 3, d: 12 }],
    ["12 March 2027", { y: 2027, m: 3, d: 12 }],
    ["the 12th of March", { y: null, m: 3, d: 12 }],
    ["12 de marzo", { y: null, m: 3, d: 12 }],
    ["12 de marzo de 2027", { y: 2027, m: 3, d: 12 }],
    ["1º de abril de 2027", { y: 2027, m: 4, d: 1 }],
    ["2027-03-12", { y: 2027, m: 3, d: 12 }],
    ["15 de setiembre", { y: null, m: 9, d: 15 }],
  ])("%s", (text, from) => {
    expect(one(text, "es")!.from).toEqual(from);
  });

  it("reads numeric dates as MM/DD in English and DD/MM in Spanish", () => {
    expect(one("03/12/2027", "en")!.from).toEqual({ y: 2027, m: 3, d: 12 });
    expect(one("03/12/2027", "es")!.from).toEqual({ y: 2027, m: 12, d: 3 });
    expect(one("25/12/2026", "en")!.from).toEqual({ y: 2026, m: 12, d: 25 });
  });

  it.each([
    ["March 12-19, 2027", [3, 12], [3, 19], 2027],
    ["March 28 - April 4, 2027", [3, 28], [4, 4], 2027],
    ["March 1 to April 30, 2027", [3, 1], [4, 30], 2027],
    ["12–19 March 2027", [3, 12], [3, 19], 2027],
    ["del 12 al 19 de marzo de 2027", [3, 12], [3, 19], 2027],
    ["del 28 de febrero al 6 de marzo de 2027", [2, 28], [3, 6], 2027],
    ["12-19 de marzo", [3, 12], [3, 19], null],
  ])("range %s", (text, [m1, d1], [m2, d2], y) => {
    const d = one(text, "es")!;
    expect(d.from).toEqual({ y, m: m1, d: d1 });
    expect(d.to).toEqual({ y, m: m2, d: d2 });
  });

  it("puts the start of a year-crossing range in the previous year", () => {
    const d = one("December 28 - January 4, 2027")!;
    expect(d.from).toEqual({ y: 2026, m: 12, d: 28 });
    expect(d.to).toEqual({ y: 2027, m: 1, d: 4 });
  });

  it("flags deadline wording", () => {
    expect(one("Book by December 15, 2026")!.isDeadline).toBe(true);
    expect(one("Reserva antes del 30 de noviembre", "es")!.isDeadline).toBe(true);
    expect(one("Travel on December 15, 2026")!.isDeadline).toBe(false);
  });

  it("rejects impossible dates and month-year phrases", () => {
    expect(findDates("February 30, 2027", "en")).toEqual([]);
    expect(findDates("Sailing in May 2027", "en")).toEqual([]);
  });
});

describe("findClaims", () => {
  it("does not read price digits as dates", () => {
    const claims = findClaims("From $1,299 on March 3, 2027. Save 30%.");
    expect(claims.map((c) => c.type)).toEqual(["price", "date", "percent"]);
  });

  it("detects language", () => {
    expect(detectLanguage("Reserva antes del 30 de noviembre y viaja con nosotros")).toBe("es");
    expect(detectLanguage("Book by November 30 and travel with us")).toBe("en");
  });
});
