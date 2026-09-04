# Price Per mm² Generator & Validator

A local, spreadsheet-style web app that turns an **expected price table** into
**price-per-mm² values**, proves those values can reproduce the expected prices
to the exact won, and exports them as CSV.

Everything runs in the browser. No backend, no network calls — your pricing data
never leaves the machine.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # calculation-engine unit tests
npm run build    # production bundle
```

---

## The relationship between the two tables

**Expected price table** (input)

| Size | Base Area | 10 | 20 | 30 | 40 | 50 | 100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10×10 | 100 | 1,900 | 3,600 | 5,300 | 7,000 | 8,600 | 12,900 |
| 15×15 | 225 | 2,100 | 4,000 | 5,800 | 7,600 | 9,300 | 14,000 |
| 25×25 | 625 | 2,500 | 4,700 | 6,900 | 8,800 | 10,700 | 16,100 |

**Price-per-mm² CSV** (output)

```csv
area_factor,10,20,30,40,50,100
100,1.9,1.8,1.7666666667,1.75,1.72,1.29
225,0.9333333333,0.8888888889,0.8592592593,0.8444444444,0.8266666667,0.6222222222
625,0.4,0.376,0.368,0.352,0.3424,0.2576
```

`area_factor` is the row's **Base Area**; each column is a **quantity**; each
value is:

```
rate = expectedPrice / (baseArea × quantity)
```

and the invariant the app enforces in the other direction is:

```
ROUND(baseArea × quantity × exportedRate, 0) === expectedPrice     difference = ₩0
```

The expected price table is the source of truth. The app never adjusts your
prices — it derives rates that reproduce them.

> **Note on the sample files.** The two sample files referenced in the spec were
> not present in the project directory, so the input structure and CSV format
> were taken from the worked examples in the spec itself (§1, §3, §12). The app
> reproduces those documented values exactly — see `src/__tests__/engine.test.ts`.
> The one place the spec is internally inconsistent is the number of decimals in
> the sample CSV (`1.766666667` is 9 dp / 10 significant digits, while
> `0.9333333333` is 10 dp), which looks like Google Sheets' 10-significant-digit
> display. §7 is explicit that the algorithm starts at **10 decimal places**, so
> that is what ships; `Min dp` in the header makes it adjustable.

---

## How precision is handled

This is the part that matters, and it is deliberately paranoid.

1. **No JS floats.** Every price calculation runs through a dedicated
   [decimal.js](https://mikemcl.github.io/decimal.js/) constructor configured at
   **80 significant digits** ([src/lib/decimal.ts](src/lib/decimal.ts)). An
   80-digit budget means a 9-digit area × a 6-digit quantity × an 18-decimal
   rate multiplies out *exactly*, with no intermediate rounding.

2. **The exact rate is never prematurely rounded.** `expectedPrice ÷ (baseArea ×
   quantity)` is kept at full working precision.

3. **The exported string is what gets validated** — not the in-memory value.
   For each cell the solver walks decimal places from 10 upward, and at each
   width it *serializes the candidate to a string, parses it back, and rebuilds
   the price from that string*. Only a string that reproduces the expected price
   is accepted. ([src/lib/precision.ts](src/lib/precision.ts))

4. **Round-trip validation.** After the whole CSV is serialized, it is parsed
   back as a downstream consumer would and every expected price is rebuilt from
   the literal characters in the file. `✔ CSV VALIDATED` only appears when all
   of them still match. ([src/lib/roundTrip.ts](src/lib/roundTrip.ts))

The spec's worst case is covered by a test:

```
Base Area 366,000 × Qty 30,000 → Expected ₩155,793,118
exact rate   0.01418880856102003643…
export rate  0.0141888086            (10 dp)
rebuilt      ₩155,793,118            difference ₩0     PASS
```

not `₩155,793,120`, `₩155,793,119`, or `₩155,793,117`.

### The decimal-place search

```
exact = expectedPrice / (baseArea × quantity)

for dp in 10..18:
    for rounding in [half-up, down, up]:
        candidate  = round(exact, dp, rounding)
        exported   = toFixed(dp) with trailing zeros stripped
        rebuilt    = ROUND(baseArea × quantity × parse(exported), 0)
        if rebuilt == expectedPrice: use it, PASS

otherwise: emit the highest-precision value and mark NEEDS REVIEW
```

Half-up is tried first so the common cases land on the values the spec quotes
(`0.4`, `0.376`, `1.7666666667`). The two directed roundings are free and rescue
cells where the nearest value falls just outside the half-won boundary while a
neighbour one ulp away lands inside it — yielding a shorter exact
representation instead of spilling into extra digits.

Trailing zeros are stripped (`0.40000000000` → `0.4`), which never changes a
value. Meaningful precision is never removed.

---

## Project layout

```
src/
  types.ts                  Shared domain types
  lib/
    decimal.ts              Configured Decimal constructor + KRW formatting
    precision.ts            ★ The rate solver and decimal-place search
    parse.ts                Number/size/header normalization, TSV & CSV splitting
    csv.ts                  CSV serialization and re-parsing
    roundTrip.ts            ★ Final validation against the serialized CSV
    engine.ts               Pipeline orchestration, integrity checks, summary
    calculator.ts           In-between size/quantity pricing off the rate grid
  state/
    sheetReducer.ts         Grid state: edits, paste, rows, columns
    sampleData.ts           Demo table
  components/
    SpreadsheetGrid.tsx     Virtualized grid: paste, copy, select, edit
    SummaryCards.tsx        Summary cards + pass/fail banner
    RateTable.tsx           Generated price-per-mm² table
    ValidationTable.tsx     Per-cell validation, issues, round-trip failures
    CsvPreview.tsx          Preview, copy, validate, download
    Calculator.tsx          In-between calculator with its working shown
    ImportDialog.tsx        Bulk paste target
  __tests__/                Engine, precision, parsing, calculator, parity tests
```

Parsing, calculation, precision handling, validation, CSV serialization,
round-trip validation, and UI are each their own module — no calculation logic
lives in a React component.

---

## Using it

**Tabs**

- **Price Table** — the editable spreadsheet.
- **Price Per mm²** — the generated rates in the same layout.
- **Calculator** — price a size/quantity that falls *between* the rows and columns.
- **Validation** — per-cell results, data-integrity issues, round-trip failures.
- **CSV Preview** — exactly what will be downloaded.

**Grid**

| Action | How |
|---|---|
| Paste from Sheets/Excel | Ctrl+V (grows rows and columns as needed) |
| Paste the quantity row | Click a quantity header, Ctrl+V — spreads across the header, adding columns; extra lines fill the prices beneath |
| Copy a range | Ctrl+C · Cut Ctrl+X |
| Select a range | Click-drag with Shift, or Shift+arrows |
| Select a whole row | Click the row number |
| Edit a cell | Double-click, Enter, F2, or just start typing |
| Clear cells | Delete / Backspace |
| Select all | Ctrl+A |
| Navigate | Arrows, Tab, Home/End, PageUp/PageDown |

Rows are virtualized and the header + Size/Base Area columns stay pinned, so
thousands of rows scroll smoothly. Recalculation is debounced 250 ms and
memoized, so typing never triggers a full-table recompute per keystroke.

**Inputs it understands**

`1900` · `1,900` · `₩1,900` · `₩ 1,900` · `(1,900)` → `-1900`
Sizes: `10*10` · `10x10` · `25 x 25` · `600 × 610` · `600X610`
Headers: `1,000` → `1000` · `100,000` → `100000`

Blank cells stay blank — they are never turned into zero.

**Delimiter rule.** Spreadsheets separate columns with a TAB, always — so for
clipboard data, *no tab means one column*, and commas in the text are thousands
separators inside values rather than delimiters:

| Pasted | Read as |
|---|---|
| `1,900` | one cell — not `1` and `900` |
| `1,900` ⏎ `2,500` | one column of two cells |
| `10*10` ⇥ `100` ⇥ `1,900` | three cells |

Scoring tabs against commas does not work here: a wide table of grouped won
amounts holds more commas *inside* its numbers than tabs *between* its columns,
which splits `1,225` into `1` and `225`. File imports (no tabs anywhere) are
still read as CSV, with the delimiter chosen by whichever yields a consistent
column count.

**When a paste goes wrong**, the Validation tab opens with an *Unreadable values*
panel: the distinct values that could not be parsed, most frequent first, each
one clickable to jump to its first occurrence. Text from a neighbouring column
showing up there means the paste is misaligned.

**Cell colours**

- Subtle green — validated, reproduces exactly
- Red border — mismatch or a value no precision can reproduce
- Amber — invalid input, or a base area that disagrees with width × height

Clicking any row in the Validation tab jumps to that cell in the grid.

---

## The in-between calculator

The generated table only covers the area_factors and quantities that are in the
price book. Real quotes land between them — 12×12 at qty 35. The **Calculator**
tab answers those, and shows its working rather than just a number.

Enter a **width** and **height** in mm — the base area fills in as
width × height, and stays editable if you need it to differ (pasting `600*610`
into either box splits it across both). Add a **quantity**, and each axis is
resolved independently against the generated table:

| Where it lands | What happens |
|---|---|
| On a table value | Straight lookup — the published rate, no interpolation |
| Between two | Weighted blend of the two neighbours |
| Above the largest area_factor | The largest row's rate is **held** and applied to your area |
| Below the smallest area_factor | Priced, but flagged — a quotation service refuses this |
| Outside the quantity columns | Priced, but flagged — refused either way |
| Only one row/column | That rate is applied directly |

Both axes in between means a rectangle of four corners. Every corner is listed
with the rate it contributed and the price book's own price there, alongside the
full stage-by-stage working — so an answer can always be traced back to values
that are actually in the table. Nothing is invented.

### How a quote is built (staged — matches production)

Interpolation happens in **two passes, rounding to the price unit after each**.
This is what the production quotation service does, and the intermediate
rounding is load-bearing:

```
STAGE 1 — dimension.  For each bracketing quantity column:
    lower = lower_area × qty × lower_rate          (unrounded)
    upper = upper_area × qty × upper_rate
    raw   = lower + (base_area − lower_area) × (upper − lower) / (upper_area − lower_area)
    price = ROUND(raw, unit)        ← the price for YOUR size at that quantity

STAGE 2 — quantity.  Over those *rounded* prices:
    raw   = lower + (qty − lower_qty) × (upper − lower) / (upper_qty − lower_qty)
    price = ROUND(raw, unit)
```

Worked through for 123×123 at quantity 123, against a book with area_factor rows
14,400 and 15,625 and quantity columns 100 and 200:

```
stage 1  qty 100   ₩86,899.9968 → ₩119,300   raw ₩106,181.31   on ₩100 → ₩106,200
stage 1  qty 200   ₩139,000.00  → ₩190,900   raw ₩169,885.79   on ₩100 → ₩169,900
stage 2  qty 123   ₩106,200 + 23 × 637 = ₩120,851             on ₩100 → ₩120,900
```

**Doing both axes at once and rounding once at the end gives ₩120,800** — a full
price unit low, because it never commits to the ₩106,200 the customer was just
shown in the quantity ladder. That is the whole reason the staged method is the
default. `src/__tests__/productionParity.test.ts` pins the entire published
quantity ladder and the ₩120,900 quote against a fixture captured from the live
endpoint.

The **Blend rates** method is kept as an alternative: it blends the
price-per-mm² across both axes at once and rounds only at the end. It answers a
different question — what unit rate does this size and quantity imply — and the
Calculator always shows the other method's quote with the difference, so the
spread is never hidden.

### Outside the book

Verified against the production endpoint, whose handling is deliberately
asymmetric — and the calculator now says which side of that line a quote is on:

| Request | Production | Here |
|---|---|---|
| Size **above** the largest area_factor | Pins a bound at the requested area and holds the largest row's rate | Same — matches to the won |
| Size **below** the smallest | Refuses: *"No base dimension data found!"* | Priced, with an **Outside the quotable range** banner |
| Quantity outside the columns | Refuses: *"Process requires quantity of (N)…"* | Priced, with the same banner |

The number still gets shown — exploring the shape of the book is the point of
the tool — but a quote that could never be sold has to look different from one
that could, rather than sitting there looking ordinary.

### Price normalization (₩100 / ₩10)

Price books are quoted on a round unit — production sends it as
`normalized_nr`. Rather than asking you to remember which, the calculator
**reads the unit off your own price table**: the coarsest of ₩100, ₩10, ₩1 that
divides every expected price in the sheet. The selector overrides it.

The unit is applied at *every* stage, including an exact table hit. If that
moves a price the book actually quotes, it is called out as a warning rather
than done quietly. ₩1 still means "round to the exact won" — prices never carry
a fraction from one stage to the next.

The reported price-per-mm² is solved against the *final* price, so the rate
shown still rebuilds the quote exactly.


### What it validates

The answer is checked the same way the CSV is:

- The price-per-mm² it reports is produced by the **same `solveRate`** the
  exporter uses — the shortest string that rebuilds the price exactly.
- `ROUND(baseArea × quantity × rate, 0)` is recomputed from that string and
  shown next to the price. A ✔ only appears at ₩0 difference.
- **Base area** is reported with its source — width × height, or a value you
  typed over it. If the two disagree, the typed one is used and the mismatch is
  called out, exactly as in the sheet (nothing is silently corrected).
- Landing exactly on a table row *and* column is flagged as an exact match and
  cross-checked against the price book's own price for that cell.
- An area row with no rate at the quantities in play is excluded from
  bracketing rather than reached across, and the exclusion is reported.

---

## Data-integrity checks

Nothing questionable is silently modified — it is reported:

missing/invalid size · missing base area · base area ≤ 0 · quantity ≤ 0 ·
non-numeric price · negative price · non-integer won price · duplicate
`area_factor` rows · conflicting rates for one `area_factor` · duplicate quantity
columns · width × height ≠ base area · empty rows · missing quantity header.

A base-area mismatch is a **warning**, not a failure: the app keeps the base area
you entered, shows both the provided and calculated values, and leaves the
decision to you.

---

## Export rules

- `Download CSV` is disabled while validation fails, unless you tick **Export
  anyway**, which shows a warning naming the number of bad values.
- No currency symbols, no thousands separators, in headers or values.
- LF line endings, no BOM.
- Blank input cells stay blank in the CSV.

---

## Deploying

The app is a static build — no backend, no environment variables, no secrets.

Vercel auto-detects Vite, and `vercel.json` pins the settings explicitly:
`npm ci` -> `npm run build` -> serve `dist/`, with hashed assets under
`/assets/*` marked immutable for a year.

To deploy: **vercel.com/new** -> import `romemadeloo/price-maker` -> Deploy.
Every push to `main` then redeploys automatically.

Pricing data stays in the browser either way: nothing is uploaded, and the app
makes no network calls after the page loads.

---

## Tests

```bash
npm test
```

120 tests covering the simple case (625 × 10 → ₩2,500 → `0.4`), repeating
decimals (225 × 30 → ₩5,800), the large precision-sensitive row (366,000 ×
30,000 → ₩155,793,118), a ~700-combination sweep asserting every exported rate
rebuilds its price, CSV round-trip on a 2,907-cell table, input normalization,
and negative tests that deliberately reduce precision and assert the resulting
₩5 / ₩10 mismatches are detected and reported as failures.

The calculator adds 46 of those: exact hits reproducing every populated cell of
the price book, interpolation on each axis and on both at once, held edges
agreeing between the two blend modes, width × height derivation, price-unit
detection and normalization (including exact hits being left alone), sparse
tables, rejected input, and a sweep of 90 area/quantity combinations across both
methods and all three price units — 540 quotes, each asserting the price is
rebuilt exactly by the rate reported alongside it and lands on its unit.

`productionParity.test.ts` adds 12 more, pinning the calculator against fixtures
captured from the live quotation endpoint: the full 14-step published quantity
ladder for an interpolated size, the ₩120,900 quote at quantity 123, the
stage-by-stage working matching the API's own debug payload, an exact size with
an in-between quantity (₩135,800), the oversize extrapolation (₩8,586,800 at
4,000,000 mm²), and each request production refuses.
