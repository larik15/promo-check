# promo-check

Keep AI-generated marketing accurate when it is based on travel and retail promotions.

`promo-check` does two things:

1. **`extract`** reads a supplier promotion (a PDF, a flyer image, or email text) and uses an LLM to build a structured JSON record: supplier, product/destination, prices (amount, currency, basis such as per person or double occupancy), travel dates, booking deadline and conditions. Every value carries the **exact source quote** (and the **page number** for PDFs). Quotes are then checked against the source text, so a value the model invented is marked `verified: false`.
2. **`check`** takes a marketing post or email (English or Spanish) plus that record and, **without any LLM**, finds every price, percentage and date in the text, normalizes it (`$1,299`, `1.299 USD`, `12 de marzo`, `March 12–19`...), and reports anything the record does not back up. It also flags passed booking deadlines and missing required terms.

## Why it matters

LLMs write good promotional copy, but they also round prices, swap currencies, drop "per person, double occupancy", move dates into blackout periods, or keep promoting an offer after it expired. In travel and retail these mistakes are not cosmetic: a wrong price or deadline in a published post can mean honoring a price you never offered, or misleading customers.

`promo-check` splits the job so the risky part is deterministic:

- The LLM is used once, to read the supplier's material, and every value it extracts must point to a quote you can verify.
- The check on the generated copy is plain code: no model decides whether `$1,199` is "close enough" to `$1,299`.

## Install

Requires Node.js 20+.

```bash
git clone https://github.com/larik15/promo-check.git
cd promo-check
npm install
npm link   # optional: puts `promo-check` on your PATH
```

Or as a dependency straight from GitHub (it is not published to npm):

```bash
npm install github:larik15/promo-check
```

`extract` needs an API key: `ANTHROPIC_API_KEY` for Claude (default), or `OPENAI_API_KEY` with `PROMO_CHECK_PROVIDER=openai`. `check` needs nothing.

| Variable | Default | Purpose |
|---|---|---|
| `PROMO_CHECK_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `PROMO_CHECK_MODEL` | `claude-opus-5-5` | Claude model for extraction |
| `OPENAI_MODEL` | `gpt-5` | OpenAI model when the provider is `openai` |

## Usage

### CLI

```bash
# 1. Extract a promotion into a record (PDF, PNG/JPEG/GIF/WebP flyer, or .txt/.eml email)
promo-check extract flyer.pdf -o flyer.record.json

# 2. Check a generated post against it (exit code 1 if anything is wrong)
promo-check check post.txt --record flyer.record.json

# Options
promo-check check post.txt --record flyer.record.json --lang es --today 2026-11-14 --json
promo-check check - --record flyer.record.json < post.txt     # read the post from stdin
promo-check check post.txt --record flyer.record.json --terms my-terms.json
```

Exit codes: `0` pass, `1` check found errors, `2` usage or runtime error, so `check` can gate a publishing pipeline.

### Library

```ts
import { extract, check, formatReport } from "promo-check";

const record = await extract("flyer.pdf");            // or extractFromText(emailBody)
const report = check(generatedPost, record, { today: "2026-11-14" });

if (!report.ok) console.log(formatReport(report));
```

`extract` also accepts `{ provider }` with your own `ExtractionProvider` (any object with `name`, `model` and `extract()`), which is how the tests run without an API key.

## Example

Every company, hotel, ship and place in this repo is made up. The sample flyer [`test/fixtures/sunward-flyer.pdf`](test/fixtures/sunward-flyer.pdf) becomes the record [`examples/records/sunward.record.json`](examples/records/sunward.record.json), where each value looks like this:

```json
{
  "label": "7-night package, Garden View Room",
  "amount": 1299,
  "currency": "USD",
  "basis": "per_person_double_occupancy",
  "quote": "Garden View Room from US$1,299 per person, based on double occupancy",
  "page": 1,
  "verified": true
}
```

Checking an AI-written post ([`examples/posts/sunward-bad.en.txt`](examples/posts/sunward-bad.en.txt)) against it:

```text
$ promo-check check examples/posts/sunward-bad.en.txt --record examples/records/sunward.record.json --today 2026-11-14
FAIL  7 error(s), 1 warning(s); 1/6 claim(s) match the record  [lang: en, today: 2026-11-14]

ERROR price_mismatch        line 1    "$1,199"
      Price $1,199 does not match the record. Record prices: 1,299 USD per person double occupancy (7-night package, Garden View Room); 1,549 USD per person double occupancy (7-night package, Ocean View Room); 189 USD per person (Taxes and fees (not included in package price)).
ERROR price_basis_mismatch  line 2    "$1,299"
      Price $1,299 is described as "per couple", but the record says per person double occupancy.
ERROR percent_mismatch      line 3    "35%"
      35% does not match the record (30%, 20%).
ERROR date_in_blackout      line 3    "March 22-26, 2027"
      Dates 2027-03-22..2027-03-26 overlap the blackout 2027-03-20..2027-03-28 (Blackout dates).
ERROR deadline_mismatch     line 5    "December 31, 2026"
      Deadline 2026-12-31 does not match the record's booking deadline 2026-12-15.
ERROR missing_term
      Missing required term "availability" (Availability disclaimer). Expected one of: subject to availability, while supplies last, limited availability, limited spots, ....
ERROR missing_term
      Missing required term "taxes_fees" (Taxes and fees disclosure). Expected one of: tax, taxes, fees, impuestos, ....
WARN  price_basis_missing   line 4    "US$1,549"
      Price 1,549 USD does not say its basis; the record says per person double occupancy.
```

A Spanish example: [`examples/posts/horizonte-bad.es.txt`](examples/posts/horizonte-bad.es.txt) against [`examples/records/horizonte.record.json`](examples/records/horizonte.record.json) catches `$1.199` vs `1.299 USD`, `por pareja` vs `por persona en ocupación doble`, `12 de marzo` outside both departures, and `Reserva hasta el 15 de diciembre` vs the real deadline of 30 November.

## What `check` looks for

| Finding | Severity | Meaning |
|---|---|---|
| `price_mismatch` | error | Amount not in the record |
| `currency_mismatch` | error | Amount exists but in another currency (`$` is accepted for dollar and peso currencies) |
| `price_basis_mismatch` | error | Text says "per couple" / "por pareja" where the record says per person, etc. |
| `price_basis_missing` | warning | A per-person/per-night price is quoted with no basis |
| `percent_mismatch` | error | Percentage not in the record's discounts, conditions, or implied by two record prices (was/now) |
| `date_mismatch` | error | Date or range outside every record date and travel window |
| `date_in_blackout` | error | Date falls in a window labeled as blackout/excluded |
| `deadline_mismatch` | error | A "book by" / "reserva antes del" date differs from the record's deadline |
| `deadline_passed` | error | The record's booking deadline is before `--today` |
| `missing_term` | error (configurable) | A required disclosure is missing |
| `record_unverified` | warning | The record contains quotes not found in the source |

Dates without a year are resolved against the record (and then `--today`). Numeric dates are read as MM/DD in English and DD/MM in Spanish.

### Required terms

By default the text must mention availability, taxes/fees, and terms and conditions (English or Spanish wording). Matching ignores case and accents. Replace the list with a JSON file:

```json
{
  "requiredTerms": [
    { "id": "availability", "any": ["subject to availability", "sujeto a disponibilidad"] },
    { "id": "limit", "any": ["limit 2", "/l[ií]mite de 2/"], "severity": "warning" }
  ]
}
```

Values wrapped in `/.../` are regular expressions. Use `--no-terms` to skip this check.

## How extraction works

- **Claude (default):** the PDF or image is sent as-is (so scanned PDFs work), with structured outputs so the response always matches the record schema. Refusals and truncated responses raise an `ExtractionError` instead of returning a partial record. Server-side refusal fallbacks are enabled for models that support them.
- **OpenAI (optional):** uses strict JSON-schema output. PDFs are sent as their text layer, so scanned PDFs need the Claude provider.
- **Quote verification:** for PDFs (with a text layer) and email text, every quote is searched in the source, ignoring case, spacing, curly quotes and dash styles. Found quotes get `verified: true` and the page where they really appear; missing quotes get `verified: false` and are counted in `extraction.unverified_quotes`. Image quotes cannot be checked locally and get `verified: null`.

## Limitations

- `check` only verifies what it can parse: prices need a currency symbol, code or word (`$`, `USD`, `€`, `dólares`, `pesos`...); bare numbers like "1,299" are ignored. Spelled-out numbers ("thirty percent"), "2x1", "half price" and relative dates ("next Friday", "this weekend") are not detected.
- It checks that each claim exists in the record, not that it is attached to the right product: if the record has two prices, quoting the cheaper one for the more expensive room passes.
- Only English and Spanish are supported. A bare `$` is accepted for any dollar or peso currency in the record.
- Ambiguous separators are resolved by a rule: one separator followed by exactly three digits is a thousands separator (`1.299` = 1299).
- Deadline detection relies on nearby wording ("book by", "offer ends", "reserva antes del", "válido hasta"...).
- Extraction quality depends on the model and the source. Quote verification catches invented quotes, not a correct quote paired with a wrong value: review records (especially `verified: false` or `null` items) before relying on them.
- The default required-terms list is a starting point, not legal advice. Use your own list for your market's advertising rules.

## Development

```bash
npm test               # builds, then runs the tests (no API key needed; LLM calls are mocked)
npm run fixtures       # regenerate the sample PDF
npm run examples       # regenerate examples/records from the canned LLM outputs
```

All sample promotions in `test/fixtures` and `examples` are invented for this project.

## License

[MIT](LICENSE)
