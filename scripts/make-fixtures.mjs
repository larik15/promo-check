// Generates the sample PDF flyer used in tests and examples.
// All companies, hotels and places in it are made up.
import { writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const pages = [
  [
    ["Sunward Travel Co. (fictional sample)", 20],
    ["Spring Escape to Isla Marisol", 16],
    ["7 nights at Hotel Brisa Serena, all-inclusive", 12],
    ["Garden View Room from US$1,299 per person, based on double occupancy", 12],
    ["Ocean View Room from US$1,549 per person, based on double occupancy", 12],
    ["Save 30% when you book early", 12],
    ["Travel between March 1 and April 30, 2027", 12],
  ],
  [
    ["Terms and conditions", 16],
    ["Book by December 15, 2026.", 12],
    ["Blackout dates: March 20 - March 28, 2027.", 12],
    ["Prices exclude taxes and fees of US$189 per person.", 12],
    ["Subject to availability. A non-refundable deposit of 20% is due at booking.", 12],
  ],
];

const doc = await PDFDocument.create();
doc.setTitle("Sunward Travel Co. sample flyer");
doc.setCreationDate(new Date("2026-11-01T00:00:00Z"));
doc.setModificationDate(new Date("2026-11-01T00:00:00Z"));
const font = await doc.embedFont(StandardFonts.Helvetica);
for (const lines of pages) {
  const page = doc.addPage([612, 792]);
  let y = 720;
  for (const [text, size] of lines) {
    page.drawText(text, { x: 54, y, size, font, color: rgb(0.1, 0.1, 0.1) });
    y -= size * 2.2;
  }
}
await writeFile(new URL("../test/fixtures/sunward-flyer.pdf", import.meta.url), await doc.save());
console.log("Wrote test/fixtures/sunward-flyer.pdf");
