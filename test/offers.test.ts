import { describe, expect, it } from "vitest";
import { findClaims } from "../src/check/claims.js";
import { attributeOffers, findOfferMentions } from "../src/check/offers.js";

const OFFERS = [
  { name: "Madrid", aliases: [] },
  { name: "Lisbon", aliases: ["Lisboa"] },
  { name: "Ocean View Room", aliases: ["Ocean View"] },
];

const attribute = (text: string) => {
  const claims = findClaims(text);
  const offers = attributeOffers(text, claims, findOfferMentions(text, OFFERS));
  return claims.map((c, i) => `${c.raw} -> ${offers[i]}`);
};

describe("findOfferMentions", () => {
  it("matches names and aliases ignoring case and accents, whole words only", () => {
    const mentions = findOfferMentions("LISBOA y Madrid; not Madridista. Ocean View Room", OFFERS);
    expect(mentions.map((m) => m.offer)).toEqual(["Lisbon", "Madrid", "Ocean View Room"]);
  });

  it("prefers the longest overlapping name", () => {
    const [m] = findOfferMentions("Ocean View Room", OFFERS);
    expect(m).toMatchObject({ index: 0, end: 15 });
  });
});

describe("attributeOffers", () => {
  it("uses the nearest earlier offer in the same sentence", () => {
    expect(attribute("Madrid from €1,299 and Lisbon from €899.")).toEqual(["€1,299 -> Madrid", "€899 -> Lisbon"]);
  });

  it("falls back to a later offer in the same sentence", () => {
    expect(attribute("From €899, Lisbon awaits.")).toEqual(["€899 -> Lisbon"]);
  });

  it("carries a heading offer through its paragraph", () => {
    const text = "Lisbon\n3 nights from €899 pp.\nDeparture April 12-15, 2027.\n\nMadrid\nFrom €1,299 pp.";
    expect(attribute(text)).toEqual(["€899 -> Lisbon", "April 12-15, 2027 -> Lisbon", "€1,299 -> Madrid"]);
  });

  it("does not attribute claims in a paragraph with no offer", () => {
    expect(attribute("Madrid from €1,299.\n\nTaxes of €95 pp not included.")).toEqual(["€1,299 -> Madrid", "€95 -> null"]);
  });

  it("starts a new sentence after a period and a capital", () => {
    expect(attribute("Lisbon: 3 nights. From €899 pp. Madrid: from €1,299.")).toEqual(["€899 -> Lisbon", "€1,299 -> Madrid"]);
  });
});
