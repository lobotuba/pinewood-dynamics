# Build package, M4 (spec 14; BLD-001, BLD-002, BLD-004, LOC-WB-009)

Status: first slice. In Design mode, the **Build package** panel downloads the build sheet, the 1:1
templates and the body STL. The project file is *Save* in the top bar. Everything is derived from the
master model: the templates are the profiles themselves (6.1), and the STL is the evaluated solid,
an export and never the master design (GEO-001).

## 1. Export gate (14.2; `exportGate` in `src/build/package.ts`)

A certified "BUILD THIS CAR" export needs three things:

- the CERTIFIED compliance context (MODE-002);
- every published hard rule and active local lock passing;
- nothing left unevaluated.

A design in the SANDBOX context exports watermarked SANDBOX. A design in the CERTIFIED context
exports certified only when CERTIFIED COMPLIANT. Until the gate geometry is known (CHAR-004) the
starting-gate test stays unevaluated, and the kit's lengths are ESTIMATED. So the best any design
reaches is PROVISIONALLY COMPLIANT, and its exports are watermarked PROVISIONAL. Either way the sheet
says why. Published rules that fail are listed apart from local constraints and from other checks,
as 14.2 requires; for a CERTIFIED design the provisional passes are listed too.

## 2. Templates (BLD-002; `templatesSvg`)

One SVG sized in millimetres, so that at 96 px per inch the browser renders it at true size. The
test page measured 193.80 mm as 732.5 px.

- **Side outline**, seen from the car's right with the nose to the right; turn the sheet over to
  trace on the left side. **Top outline**, seen from above.
- The block (dashed), the axle datums labelled LOCAL/FROZEN, and the CG mark.
- Holes and pockets outlined with centre marks. A bore seen end-on is drawn as a circle.
- Saw cuts seen edge-on, as lines clipped to the block.
- Weights (dash-dot).
- **Scale-check bars** of 100 mm and 4 in. The instruction is to print at 100 %, not fit to page, and
  measure both. The print-scale tolerance is a GEO-007 field still to be characterized, so the sheet
  says it is not yet set rather than claiming one.
- A diagonal SANDBOX watermark, and the reminder that kit dimensions are ESTIMATED: check the block
  and slots against the lines before cutting.

## 3. Build sheet (`buildSheetHtml`)

A single printable HTML file: the templates on the first page, then:

- **Export status**, with the gate's reasons.
- **Targets.**
  - Finished mass, predicted ± 2σ (wood density ESTIMATED unless the block was weighed). It is
    compared with the rule's limit and the margin given. The event's scale decides.
  - The CG from the rear axle and from the tail, its height and its offset.
  - The wheelbase, LOCAL/FROZEN: set by the kit's axle slots.
  - The compliance state.
- **Operations in shop order**, with the build tier each needs (from `src/build/tiers.ts`).
- **Holes and pockets**: size, and centre from the block's tail, centreline and bottom (the faces a
  builder measures from), with how to make each.
- **Weights**: material, size, mass, mounting and centre. A lead weight adds the SAF-003 handling
  note.

Numbers are in the workspace's chosen units: metric by default, English selectable.

## 4. STL (BLD-001; `bodyStl`)

Binary STL of the evaluated body solid, in millimetres or inches as chosen at export. The unit is in
the file name (`<name>.body.mm.stl`) and in the STL header (6.4).

## 5. Verification (`test/m4-build.test.ts`)

| Case | Reference |
|---|---|
| Export gate | Not certified; SANDBOX; reasons name the missing context and the compliance state |
| Templates | Width = block length + 16 mm margins; each outline vertex at 1 mm per mm from the tail; edge lengths true; 100.00 mm and 101.60 mm bars |
| STL, mm and in | One facet per triangle, size 84 + 50n bytes, unit in header; volume from the facets equals the solid's (× unit³) to 1e-5; extent to 1e-6 |
| Build sheet, both unit systems | Mass, wheelbase (LOCAL/FROZEN), CG, every operation, hole and weight listed; SANDBOX status; templates embedded |

Browser check: all four downloads from the panel. The build sheet and templates were rendered and
inspected.

## 6. Not yet built

- **PDF** export. Spec 14.1 allows SVG or PDF; the SVG and the HTML sheet print from any browser.
- **A certified export in practice.** The gate and the event kit must be measured first (CHAR-004,
  CHAR-001..003).
- **Hole dimensions on the drawing itself.** They are in the sheet's tables, not as dimension lines.
- **Later (14.1):** a dimensioned build sheet with the operation sequence and adult-supervision notes
  (BLD-003), and jigs.
