# Neural network classifier playground — notes & decisions

## 2026-08-27 — Initial build

Single self-contained file: [index.html](../index.html). No build step, no dependencies —
open it directly in a browser.

### Layout of the file
- CSS in `<style>` (dark theme, CSS vars in `:root`).
- `<script>` sections, in order:
  - `ACT` — the four activations with derivatives expressed as `d(z, a)` so both
    pre-activation and activation are available (relu needs `z`, sigmoid/tanh need `a`).
  - `makeRng` / `makeGauss` — xorshift32 + Box–Muller, so runs are reproducible from the seed field.
  - `makeNet`, `forward`, `trainEpoch`, `evaluate` — the whole network. Pure functions, no DOM.
  - `state` + DOM helpers, table rendering, split logic, charts, wiring.

### Decisions
- **Softmax + cross-entropy on the output layer, always.** The chosen activation applies to
  hidden layers only. Rejected: letting the user pick the output activation. For classification
  softmax is the correct head, and it makes the output delta exactly `p - onehot`, which keeps
  the backprop code short and numerically stable. A sigmoid/linear output would need a separate
  loss and would mostly just let the user configure a broken setup.
- **Class label as an integer in the last column** rather than one-hot columns. Keeps the table
  narrow and the "number of output neurons" control meaningful (it validates the label range).
- **Weight init: He for relu, Xavier otherwise.** Without this, relu nets with >1 hidden layer
  died at the default learning rate.
- **Input standardization is a checkbox, on by default,** fitted on the *training split only*
  (`fitNorm`) so the test split stays honest. Off = raw values fed to the net.
- **Training runs in `requestAnimationFrame` chunks of ~24 ms** instead of a blocking loop, so the
  UI stays responsive and Stop works. History is subsampled to ~200 points per run so the chart
  stays cheap regardless of epoch count.
- **Split modes: random (seeded, share slider) or "same data for train & test".** The latter is an
  explicit menu entry rather than dragging the slider to 100%, because the user asked for it and
  it makes the "identical sets" caveat visible in the split info line.
- **Decision boundary only for 2 inputs** — 56×56 grid, alpha keyed to softmax confidence.
  Anything else shows an explanatory placeholder.

### Gotchas
- `trainEpoch` divides the learning rate by the batch length (mean gradient), so the same `lr`
  behaves comparably for full-batch and mini-batch.
- Blank table rows are skipped silently; malformed rows are reported in `#dataMsg` and excluded.
- Table cell values are HTML-escaped via `esc()` before being spliced into the row markup.
- Preset loading sets `nIn`/`nOut` programmatically, which does *not* fire `input`, so
  `loadPreset` re-renders everything itself.

### Verified
Extracted the pure network functions and ran them under node (2026-08-27):
noisy XOR, 2-8-2, 800 epochs, lr 0.1 → tanh 100 %, relu 100 %, sigmoid 69 %, linear 69 %.
sigmoid is genuinely slow (saturating + Xavier), linear cannot separate XOR — both expected.
3-class blobs: no hidden layer → 100 %, two hidden layers → 100 %.

## 2026-08-27 — Revision: low-level view, light theme

Requested changes: light theme only, a visual network view with clickable weights, remove the
test-loss curve and remove the dataset / decision-boundary plot.

### What changed
- **Dark mode removed.** The `:root` palette is now a single light theme; there is no
  `prefers-color-scheme` block and no toggle.
- **Deleted**: `drawBoundary()`, the `#boundary` canvas and its legend, the `COLORS` class palette,
  and the `testLoss` series (both the chart line and the history field). Test accuracy is still
  plotted and still shown as a metric tile — only the *loss* curve for the test split is gone.
- **Added `drawNet()` + `layoutNet()` + `pickAt()`** — the network diagram on a canvas. Connections
  are drawn with width proportional to |w| and colour by sign (blue positive, red negative), scaled
  against `maxAbsWeight(net)`. Neuron radius is derived from the widest layer so a 32-neuron layer
  still fits; below r=9 the index labels are dropped.
- **Added `renderInspector()`** — the panel beside the diagram. Click a neuron → its bias, every
  incoming weight, and every outgoing weight, each as an editable number field. Click a connection
  → that one weight. Nothing selected → per-network stats (max |w|, mean |w|, parameter counts).
- **Added the probe.** "Forward pass" runs one sample and stores `{x, zs, as}`; neurons are then
  shaded by their activation and the inspector shows that neuron's z and a. `refreshProbe()` re-runs
  it whenever the weights change, so hand-editing a weight updates the shading live.

### Decisions
- **Hand-edited parameters are applied to the live net** (`afterEdit()`), which re-evaluates both
  splits, appends a history point at the current epoch, and redraws. Rejected: making the inspector
  read-only. Being able to poke a single weight and watch loss/accuracy move is the point of a
  low-level view.
- **Hit-testing gives neurons priority over connections** (radius + 4 px, then 6 px to a segment).
  Without the priority, clicking a neuron in a dense layer usually selected an edge passing under it.
- **Neuron shading is normalized per layer**, not globally — softmax outputs are ≤ 1 while relu
  hidden units can be much larger, so a global scale washed out the output layer entirely.

### Verified
- `node --check` on the extracted page script.
- Extracted `layoutNet`/`pickAt`/`distToSeg` and drove them with a fake state (2026-08-27):
  2‑5‑3‑4 → all 14 neurons hit at their own centre, all 37 edge midpoints resolve to an edge,
  empty space returns null, every node inside the canvas. Edge cases: 12‑32‑10 fits (r=5,
  y 29…401 of 430), 1‑1‑2 works, 3‑2 (no hidden layer) works.
- Not verified: the page has never been opened in a real browser here (none available), so the
  DOM wiring rests on syntax checking and review.

## 2026-08-27 — Revision: kid-friendly, and the oversized-canvas bug

### Bug: the network picture sat small in a huge box
`#netView` had a `height="430"` **attribute** but only `width:100%` in CSS. A canvas is a replaced
element: with an explicit width and `height:auto` the browser scales the intrinsic height by the
same factor, so in a ~900 px column the box became 430 × (900/300) ≈ 1290 px tall. `fitCanvas()`
then sized the backing store to that, and `layoutNet()` centred the drawing at `h/2` with the row
gap capped at 46 px — a small network floating in the middle of a very tall box. `#lossChart` had
the same problem.
**Fix:** explicit CSS heights (`#netView{height:470px}`, `#lossChart{height:200px}`) and the height
attributes removed. Any future canvas here needs a CSS height, not just an attribute.

### Bigger neurons
`layoutNet()` now sizes circles from the space available instead of a fixed 14 px cap:
`r = min(34, colGap*0.30, (avail/widest)*0.42)`, then centres are spread over `avail - 2r` so the
circles cannot poke out of the canvas. The 0.42 factor keeps `2r` inside each neuron's vertical slot
and leaves a visible gap between neighbours. The default 2‑4‑2 net now draws at r=34 (was 14).
Neuron labels scale with `r`, and when a probe is active a circle of r≥15 shows its activation value
under its index.

### Simplified for younger users
- Panels are numbered steps: Build the network → Teach it → Practice and exam → Try one example.
- Plain-language labels with the technical term as a sub-caption ("Learning speed / how big a step
  it takes each time", "Practice rounds / epochs", "Neuron style / activation function").
- Batch size, seed and input scaling moved into a collapsed **Expert settings** `<details>`; the
  confusion matrix into a collapsed "Which answers did it mix up?". Nothing was removed — all the
  controls and all four activations are still there, just folded away.
- Metric tiles read "Rounds done / Mistakes (loss) / Right in practice / Right in the exam"; the
  weight legend reads "blue = pushes up, red = pushes down, thicker = stronger".
- Base font 15 px, larger buttons.

### Verified (2026-08-27)
`node --check` on the page script, plus the extracted layout driven against the real 470 px canvas
height across 8 configurations (2‑4‑2 at two widths, 2‑8‑3, 1‑1‑2, 3‑2, 4‑6‑6‑6‑3, 12‑32‑10,
2‑16‑16‑4): every neuron inside the canvas, no overlapping circles, every neuron clickable at its
own centre, vertical fill 80–87% except the trivial 1‑1‑2 (36%, radius-capped).
An earlier formula that spread centres over the full height overflowed for 2‑8‑3 and 4‑6‑6‑6‑3 —
caught by that check, hence the `avail - 2r` reservation.
Still not verified in a real browser (none available in this environment).

## 2026-08-27 — Fix: "Paste CSV" ignored line breaks

**Cause:** the handler used `prompt()`. A `prompt()` dialog is a single-line text input, so the
browser strips the newlines out of anything pasted into it — the whole paste arrived as one line and
`split(/\r?\n/)` produced a single row. Not a parser bug; the wrong input control.

**Fix:** replaced it with an in-page modal (`#csvModal`) containing a real `<textarea>`, and moved
the parsing into `loadPastedRows(txt)`, which returns an error string or null so the dialog can show
the problem instead of failing silently. The button is now "Paste data…".

Parsing rules, all covered by the check below:
- separators: comma, semicolon, tab or space (`/[\s,;]+/`), so a spreadsheet copy works;
- `\r\n` and trailing/blank lines tolerated;
- a heading line is dropped (any non-numeric cell in the first row, when more rows follow);
- ragged lines, single-column input and empty input are rejected with a specific message;
- more than 12 inputs or a label above 9 is now rejected. It previously clamped `nIn` to 12 while
  leaving 14-column rows in the table, which silently reinterpreted an input column as the label —
  caught by the edge-case run, worth remembering as the failure mode of clamping over rejecting.

### Verified (2026-08-27)
Extracted `loadPastedRows` and ran it against 13 inputs: the user's own sample (`1,1,1,1,0` ×3 →
4 inputs, 3 rows), CRLF, blank/trailing lines, space/tab/semicolon separators, a header row, ragged
rows, single column, empty, one row, 12 vs 13 inputs, label 12. All behave as intended.

## 2026-08-27 — Neuron names, and the "typed 0 shows as −1" report

### Neuron names
- Input circles are labelled with the **table column name**, which is now editable: the header row
  of the data table holds `input.colName` fields, backed by `state.colNames`. Defaults are
  `x0, x1, …`; a blank field falls back to the default. A heading line in pasted data becomes the
  column names automatically.
- Hidden neurons are `h0, h1, …` (the layer caption distinguishes several hidden layers), answers
  are `y0, y1, …`.
- **Deviation from the request:** the user asked for answers `y1, y2`. Used `y0, y1` instead so the
  name matches the class number the data table and confusion matrix already use — `y1` labelling
  class 0 would contradict the rest of the page. Flagged to the user; trivial to switch.
- Names are used in the diagram, the inspector (titles, incoming/outgoing weight rows, the edge
  title), the "try one example" fields, and dataset error messages.
- Input and answer names are drawn **outside** their circles (left / right) so a long column name
  cannot spill over the circle. That margin depends on the radius and the radius depends on the
  margin, so `drawNet()` lays out twice: once with the default padding to get `r`, then again with
  `r + textWidth + 16`, capped at 30% of the canvas width per side. `layoutNet(w, h, padL, padR)`
  gained the two padding arguments for this.
- Renaming a column updates the "try one example" label in place rather than re-rendering the
  panel, so a value already typed there is not wiped.

### "Inserting 0 shows −1 in the picture"
Not a rendering bug: **Scale the inputs** (on, in Expert settings) standardizes each column, and for
a column with mean 0.5 / spread 0.5 a typed 0 legitimately becomes −1. The diagram was showing the
scaled number that the network actually receives.
**Change:** input circles now display the raw number the user typed (`state.probe.x[i]`); the
inspector shows both "you typed" and "after scaling", with a line explaining what scaling does and
where to turn it off. Hidden and answer circles still show their true activation.

### Verified (2026-08-27)
`node --check`, plus the extracted naming and layout functions: defaults `x0,x1,x2 | h0..h3 | y0,y1`,
a renamed column shows its name and a blank one falls back, `ensureColNames` grows and shrinks
correctly, and the layout stays inside the canvas with every neuron clickable for margins up to the
30% cap (2‑4‑2 at padL 180/192, 12‑32‑10, 1‑1‑2).

## 2026-09-09 — CSV export of all biases and weights

Added **Download numbers (CSV)** (`#btnExportCsv`) under the network diagram's legend, plus
`exportRows(net)` / `exportCsv(net)` next to the resize handler at the end of the script.

Format, as requested — one line per neuron, layers in order, neurons in order, each line
`bias` followed by that neuron's *incoming* weights:

```
neuron,bias,w0,w1,w2
h0,0,3.0949…,0.3712…
h1,…
y0,0,0.4503…,0.1786…,0.1764…
y1,…
```

This maps one-to-one onto the storage: row for neuron `i` of layer `l+1` is
`[net.b[l][i], ...net.W[l][i]]`, so every parameter appears exactly once and nothing is
transposed. Filename is `network-<sizes>-epoch<n>.csv`.

### Decisions
- **A leading `neuron` column with the display name** (`h0`, `y1`, or the column name for
  inputs — inputs have no row of their own, but the name vocabulary is shared) rather than bare
  numbers. Rejected: numbers only. The requested nesting `[[h0b,h0w0,…][h1b,…]…]` is exactly
  "one group per neuron", and in a flat CSV a name column is what makes the grouping readable in
  a spreadsheet; it costs nothing to strip.
- **Header row `neuron,bias,w0…wN`** where N is the widest *source* layer
  (`max(sizes[0..L-1])`), so rows from a narrower layer simply have fewer cells. Rejected:
  padding short rows with empty cells — ragged rows are valid CSV and padding would invite
  reading a blank as a zero weight.
- **No epoch/config metadata inside the file.** It is in the filename instead, so the CSV stays
  purely numeric and loads without a skiprows argument.
- Uses a `Blob` + object URL + synthetic `<a download>`, revoked immediately after the click.

### Verified (2026-09-09)
`node --check` on the extracted page script, and `exportCsv` driven against real `makeNet`
output for 2‑3‑2, 2‑4‑2, 3‑2 (no hidden layer), 2‑5‑4‑2 and 1‑1‑2: row count equals the neuron
count, the number of numeric cells equals the true parameter count in every case (17/22/8/49/6),
the first row is `b[0][0]` + `W[0][0]`, and the last row is the last answer neuron.
Still not opened in a real browser (none available here), so the click handler and the download
itself rest on review.

## 2026-09-09 — Export format changed to nested brackets

The user showed the exact target format in their editor. `exportCsv` now emits
`[[b,w0,w1],\n[b,w0,w1],…]` — brackets around every row, comma after every row, brackets around
the whole thing — and the `neuron` name column and the `neuron,bias,w0…` header row added
earlier were **dropped**. Follow-up to the previous entry's first two decisions: they were wrong
for this use, the output was meant to be pasted as a literal, not opened in a spreadsheet.

Output is valid JSON, so the verification now round-trips it through `JSON.parse` and compares
every value against `net.b` / `net.W` element by element. Note the file extension and MIME type
are still `.csv` / `text/csv` and the button still says CSV, which is what the user asked for by
name; the content is a bracketed literal.

### Verified (2026-09-09)
`node --check`, plus `exportCsv` against real `makeNet` output for 2‑3‑2, 2‑4‑2, 3‑2, 2‑5‑4‑2 and
1‑1‑2: every output parses as JSON, row count equals the neuron count, cell count equals the true
parameter count, each row's width is exactly `1 + fanIn` for its layer, and every number equals
the stored bias/weight in order. Browser click path still unverified (no browser here).

## 2026-09-09 — Note: input normalization is ON by default

Asked whether the page normalizes inputs. It does, and this is pre-existing behaviour, not part of
today's change. `#standardize` ("Scale the inputs") in **Expert settings** is `checked` in the
markup, and `fitNorm()` (index.html:554) computes a per-column mean and population std **over the
training split only**, storing `state.norm`; `normalize()` then applies `(v - mean)/std` to every
sample fed to the net, including the "try one example" probe. `std` of 0 falls back to 1
(`|| 1`). Unchecking the box sets `state.norm = null` and raw values go in.

Consequence worth remembering, and already the subject of the 2026-08-27 "typed 0 shows −1"
entry: **the exported weights belong to the scaled input space.** To use them outside this page
you must apply the same mean/std, and those numbers are *not* in the CSV export. If that becomes
a problem the options are to export `state.norm` alongside, or to fold it into the first layer.

## 2026-09-09 — Confirmed: the two weight sets are convention-locked

Reproduced the user's 2‑3‑2 sigmoid net outside the page (scratchpad `chk.js`), forward pass
`sigmoid` hidden + softmax out, unpacking the bracketed export as
`[b, w…]` per neuron in order h0,h1,h2,y0,y1.

Dataset (20 rows, 2 in, 2 classes) column stats: mean `[0.625, 0.6]`,
population std `[0.2795084971874737, 0.282842712474619]`.

| weight set | raw inputs | standardized |
|---|---|---|
| first (trained with scaling ON)  | 12/20 = 60 % | **20/20 = 100 %** |
| second (trained with scaling OFF)| **20/20 = 100 %** | 16/20 = 80 % |

So the original report ("works on the site, not in my code") was purely the standardization, as
suspected — not an export-order or transposition bug. The export order is confirmed correct by
this independent reimplementation: it reproduces 100 % accuracy, which it could not do if the
rows or the bias/weight split were wrong.

### Gotcha worth remembering
The exported file records **nothing** about which input convention it belongs to, and the two
conventions are mutually incompatible (each set is ~60–80 % under the wrong one — degraded but
not obviously broken, which is the dangerous part). The user retrained with **"Scale the inputs"
unticked**, which is the right choice for firmware deployment.

Fold-in formula, if the scaling ever needs to be baked into the first layer instead:
`w'[i][j] = w[i][j] / std[j]`, `b'[i] = b[i] - Σ_j w[i][j]*mean[j]/std[j]`.

Offered to the user, not yet implemented: a leading comment / warning in the export stating
whether scaling was on (plus mean/std), or always folding the scaling in so the export works on
raw inputs regardless of the checkbox.

## 2026-09-14 — New two-file micro:bit structure (sender + neuron)

Replaced the single per-board `nn.js` with [neuron.ts](../neuron.ts) and [sender.ts](../sender.ts).
`nn.js` is left in place untouched as the old reference.

### Structure
- **`neuron.ts` is flashed UNCHANGED onto all five neuron boards.** No per-board editing.
- **`sender.ts`** is one extra board holding the serial-number→name table and every weight/bias
  from the training-page export. Button A pushes parameters, B requests a round, A+B dumps the table.

Chosen with the user (2026-09-14):
- **softSerial keeps carrying activations** over cables (P0/P1/P2 in, P3 out); radio carries only
  parameters and the calc request. Rejected: all-radio, which would have removed the wiring-order
  dependency but was a bigger change than wanted.
- **The two x input boards are out of scope** — they already exist with their own code and feed the
  h boards' P0/P1.
- **Identity by device serial number**, so one hex fits every board.

### Radio protocol
```
"id:<name>"  value = serial number   only the matching board takes the name
"<name>i"    value = fanIn
"<name>b"    value = bias
"<name>w<j>" value = weight j
"calc" / "reset"                     broadcast to all
"<yN>o"      value = output          y boards report back to the sender
```
Names are 2 chars so `substr(0,2)`/`substr(2)` splits target from field, and every key stays inside
`radio.sendValue`'s ~8-byte name limit.

### Bug caught by simulation, worth remembering
First draft assigned identity with `"<name>i"` and let an *unclaimed* board adopt any name it saw.
Simulating all five boards against one shared "air" showed every board latching onto `h0` from the
first message: `fanIn: y0=2 y1=2` (should be 3), and the pipeline scored **8/20 = 40 %** because the
output neurons silently ignored `h2`. `boardSerials` was declared in the sender but never actually
transmitted — the mechanism the user asked for was missing. Fixed with the separate `id:` message
keyed on `control.deviceSerialNumber()`. **A whole-network simulation caught what reading the file
did not**; do that before flashing.

### Other fixes carried in
- `sigmoid` clamps z to ±30 before `Math.exp` (weights reach ±16, so z reaches ±40).
- Firing now requires `armed && isConfigured() && hasAllInputs()` — a board can no longer compute
  with default all-zero weights if the radio push is missed, which the old implicit
  `if (ownWeights[0])` interlock did by accident.
- Button B is read-only (the old one called `getNeuronOutput()` and muddied the state being read).

### Verified (2026-09-14)
Simulated `sender.ts` + five copies of `neuron.ts` message-by-message (scratchpad `netsim2.js`):
after `sendAll` all five report configured with fanIn 2/2/2/3/3, and the full h→y pipeline
classifies **20/20 = 100 %** on the user's dataset, identical on a second pass (state resets).
Not verified on hardware: radio delivery, softSerial framing/`parseFloat` of the wire format, and
whether `control.deviceSerialNumber()` is exposed in this MakeCode target.

## 2026-09-14 — Why every neuron stayed on "?" (two bugs)

Hardware run: all five boards showed `?` forever, i.e. no board ever matched its identity message.
Two independent causes, both in the first draft of the new files.

### 1. neuron.ts never joined the radio group
`sender.ts` called `radio.setGroup(1)`; `neuron.ts` called nothing, so the boards sat on the default
group 0 and heard nothing at all. Added `radio.setGroup(1)` at the top of `neuron.ts`.
**Rule: the group must be set in every file, not just the transmitter.**

### 2. A micro:bit serial number does not survive `radio.sendValue()`
`radio.sendValue(name, value)` carries the value as a **32-bit float**, which represents integers
exactly only up to 2^24 = 16 777 216. All five real serials are 9–10 digits, so every one was
rounded in flight and `value == control.deviceSerialNumber()` could never be true:

| real serial | as float32 |
|---|---|
| 139422584  | 139422592  |
| 1280350870 | 1280350848 |
| 850974008  | 850974016  |
| 1240653277 | 1240653312 |
| 1843421070 | 1843421056 |

**Fix:** identity now travels as text — `radio.sendString("<serial>=<name>")`, e.g.
`"139422584=h0"`, matched in `radio.onReceivedString` against
`convertToText(control.deviceSerialNumber())`. `boardSerials` in the sender is therefore a
`string[]`, not a `number[]`.
This limit applies to any large integer sent over `sendValue`; the weights/biases are unaffected
because they are small floats where float32 precision is plenty.

### 3. Garbled serial output was a red herring
The user's A+B dump came back with dropped characters (`2  srial850974008`, `fnIn`, and a bias
missing its decimal point). Not a code bug — the USB serial link drops bytes when written in a tight
loop. Added `basic.pause(50)` per line in the A+B handler. Worth remembering so a mangled dump is not
mistaken for bad data.

### Open question flagged to the user (2026-09-14)
The user filled in `1394225184` (10 digits) for h0, but their own serial dump showed `139422584`
(9 digits). Used the dump's value and marked the line `<-- CHECK`. Unresolved.

### Verified (2026-09-14)
Re-ran the five-board simulation with the string identity path (scratchpad `netsim3.js`):
all five adopt the correct name, configured with fanIn 2/2/2/3/3, pipeline still **20/20 = 100 %**.
Radio delivery and `control.deviceSerialNumber()`'s availability remain unverified on hardware.

## 2026-09-14 — The serial number is SIGNED (and the earlier dump ate a digit)

Board dump resolved the open question from the previous entry: h0 reports
`serial: -1394225184` — **ten digits and negative**. My `"139422584"` was wrong twice over.

- `control.deviceSerialNumber()` returns a **signed 32-bit int**, so any serial above 2^31 wraps
  negative. The identity string must carry the minus sign and every digit exactly.
- The nine-digit value came from the character-dropping USB dump (previous entry, item 3). That
  dump is also the only source for h1/h2/y0/y1, so those four are now marked `<-- UNCONFIRMED`
  in `sender.ts` and must be re-read with button B before they can work.

**Fix:** button B in `neuron.ts` now prints a **ready-to-paste quoted line**
(`    "-1394225184",`) so the value is copied, never transcribed, and the remaining dump lines are
paced with `basic.pause(30)`.

Of the five, only h0 wraps negative (the other four are below 2^31) — but that is luck, not a rule.

### Verified (2026-09-14)
Re-ran the five-board simulation with h0's real negative serial: all five adopt the right name,
fanIn 2/2/2/3/3, pipeline **20/20**. Plus 5/5 identity edge cases: exact negative matches, a missing
minus sign does NOT match, a missing digit does NOT match, and one board's id does not claim another.

## 2026-09-14 — Why "calc" never reached the old input layer

**`radio.sendString("calc")` vs `radio.onReceivedValue()` — two different channels.**
In the old `nn.js` the A+B button sent the trigger as a STRING (nn.js:46) but the only listener in
the file was `radio.onReceivedValue` (nn.js:85), which fires only for `sendValue(name, value)`.
A string broadcast never reaches a value handler, so the trigger was sent and never heard. Not a
timing or wiring fault.

The new files are consistent (`sender.ts` uses `radio.sendValue("calc", 0)`), and the two channels
are now split by purpose:
- **`sendValue`** — numbers: `calc`, fanIn, bias, weights, choice values.
- **`sendString`** — text that must be exact: identity and pictures, both destroyed by float32.

## 2026-09-14 — Input layer folded into neuron.ts, with per-choice pictures

`neuron.ts` now also runs the x boards, so **one hex covers all seven boards**. An x board is
simply one whose name starts with `x` (`isInputBoard()`).

Chosen with the user: **values selected by buttons on the board**, from a list the sender supplies,
each value shown as a **picture drawn on the sender and transferred over radio**. The boards store
no pictures of their own.

### Protocol additions
```
"<name>n"    value = number of choices       e.g. "x0n" = 4
"<name>v<k>" value = choice k's value        e.g. "x0v0" = 0.25
STRING "<name>p<k>:<25 chars>"  choice k's picture, row-major, "1" = lit
```
Pictures travel as **text** for the same reason the serials do: a 25-pixel mask reaches 2^25, past
float32's exact range of 2^24. `imageFromText()` rebuilds the Image with `setPixel`.

On an x board A/B step through the choices (wrapping) and show the picture; on every other board B
still dumps state. `isConfigured()` branches: an x board needs choices, not weights.

### Race fixed before flashing
An x board sends the moment `calc` arrives, but every h board also *clears* `received[]` on `calc`.
If the x value won that race, `clearRound()` wiped it and the h board waited forever for an input
already sent. The x path now waits `basic.pause(150)` before sending. This is a timing workaround,
not a handshake — if it ever proves flaky the robust fix is for h boards to clear on *completion*
rather than on `calc`.

### Verified (2026-09-14)
Simulated all seven boards message-by-message (scratchpad `full.js`): every board claims its name,
all seven report configured, x0 receives 4 values + 4 pictures and x1 5 + 5, **all 20 button
combinations classify correctly (20/20)**, and A/B wrap 0→3→0.
Unverified on hardware: radio delivery, the `images.createImage`/`setPixel` API in this target,
and whether 150 ms is enough for the calc race.

## 2026-09-14 — Sender: x boards included everywhere, not just in sendAll

`sendAll()` already pushed the x boards (`sendInput`), but the **A+B board table still listed only
the five neurons** — the very dump being used to verify setup silently omitted the input layer.
Now it prints the x boards first (serial, choice count, picture count) and flags
`<-- SERIAL NOT SET` while an `inputSerials` entry is still `"0"`.

Added `checkInputTables()`, run at the start of `sendAll()`, warning on:
values/pictures count mismatch, any picture not exactly 25 characters, and an unset serial. A
mis-edited picture table would otherwise fail silently on the board.

### Verified (2026-09-14)
Extracted the real tables from `sender.ts`: x0 = 4 values/4 pictures, x1 = 5 values/5 pictures,
every picture exactly 25 chars. Rendered them — x0 fills bottom-up, x1 fills left-to-right, so the
two input boards are distinguishable at a glance.

## 2026-09-14 — "sel_x0:undefined": dropped radio messages left holes in the choice list

Board log stepping through x0: `0.5, undefined, undefined, 0.25` — i.e. cycling 4 slots but only
slots 0 and 1 held a value. Reproduced exactly in simulation by dropping `x0v2` and `x0v3`.

**Cause:** `"<name>n"` sets `choiceCount` in one message, but each `"<name>v<k>"` is a separate,
**unacknowledged** radio message. Two were lost, and `isConfigured()` only checked
`choiceValues.length >= choiceCount` — which the `while (...) push(0)` growth satisfied even for
slots that never arrived. The board therefore reported configured and stepped onto empty slots.

**Fixes:**
- `choiceValuesSeen[]` records which values actually arrived; `isConfigured()` now requires every
  slot 0..choiceCount-1 to be present. Same pattern as `received[]` for inputs and `weightsSeen[]`
  for weights — *never infer arrival from a value or an array length.*
- `"<name>n"` now clears `choiceValues`/`choiceValuesSeen`/`choiceImages`, so a re-push cannot
  leave stale entries from a longer previous list.
- A missing slot shows `!` on the display, prints `MISSING (choice k never arrived)` instead of
  `undefined`, and an x board refuses to send it into the network.
- Sender paces radio at 120 ms (was 60) and **sends the choice values a second time** after the
  pictures. Repeats are harmless — each overwrites its own slot.

### Verified (2026-09-14)
Simulation reproduces the reported log position-for-position with v2/v3 dropped; after the fix that
board reports `configured: false` and prints MISSING rather than leaking `undefined`. A clean push
cycles `0.25, 0.5, 0.75, 1` correctly, and a re-push to a shorter list leaves no stale values.

### Still open
The user reports not seeing any calculation. With x0 unconfigured it could not send, so the h boards
never had inputs — expect this to resolve once the values all arrive. Next check: press A on the
sender, confirm x0/x1 show pictures (not `!`), then press B and watch for `out_h*` then `out_y*`.

## 2026-09-14 — Boards back to "?": a second onReceivedString killed identity

Regression from the input-layer work. `neuron.ts` ended up with **two**
`radio.onReceivedString` registrations — one for identity (`"<serial>=<name>"`), one for pictures
(`"<name>p<k>:<bits>"`).

**In MakeCode, registering the same radio event twice REPLACES the first handler.** Only the
pictures handler survived, identity strings were never processed, and every board stayed `?`.
This is why it worked before the input layer existed and broke immediately after.

**Fix:** one handler, dispatching on shape — a `:` means picture, otherwise `=` means identity.
Merged at neuron.ts:275. `radio.onReceivedValue` is registered exactly once (neuron.ts:197); keep
it that way.

**Rule for this codebase: exactly one `onReceivedString` and one `onReceivedValue` per file.**
Any new message type is a new branch inside the existing handler, never a new registration. Same
caution applies to `input.onButtonEvent` for the same button (already shared: B dumps state on h/y
boards but steps choices on x boards, inside a single handler).

### Verified (2026-09-14)
Exactly one registration of each remains. Merged dispatch drives correctly: own identity claimed,
own pictures accepted at the right index, another board's identity and pictures both ignored.

### Diagnostic note
`?` vs the board's name is a useful distinction when debugging:
`?` = never claimed identity (radio group, serial mismatch, or no handler);
name shown but nothing since = claimed, but no choice data arrived;
`!` = claimed and configured count known, but that choice's value went missing.

## 2026-09-14 — "choice 2 never arrived", reproducibly: drawing inside a radio handler

`sel_x1: MISSING (choice 2 never arrived)`, and repeated pushes never fixed it. Not random packet
loss — something systematic.

**Cause:** the radio handlers called `showChoice()`, which fell through to
`basic.showNumber(value)` whenever no picture had arrived yet. `showNumber`/`showString` **scroll,
blocking for hundreds of ms to seconds**. While `x1v1`'s handler sat there scrolling "0.4", the
packets behind it — `x1v2` among them — overflowed the micro:bit's small radio queue and were
discarded. The retry loop hit the identical wall, so pressing A again could never help.

**Rule: never draw, scroll, or pause inside a radio handler.** Handlers must return immediately.

**Fixes:**
- Handlers now only set `displayDirty`; the `basic.forever` loop repaints. No drawing, scrolling or
  pausing remains inside any handler (verified by parsing the handler bodies).
- `showChoice()` is non-blocking: `showImage(0)` or `led.plot` dots, never a scrolling number.
  Unclaimed = centre dot, missing value = two corner dots, no-picture-yet = index as a row of dots.
- Sender sends **all values (twice) BEFORE any picture**, at 200 ms spacing. Previously values and
  large picture strings were interleaved, so a picture was in flight when the next value was sent.
  The board is usable as soon as the values land; pictures are decoration and arrive after.

### Verified (2026-09-14)
Handler bodies contain no `showNumber`/`showString`/`showImage`/`showChoice`/`basic.pause`.
Main loop repaints on `displayDirty`. Message order is now n, v0..v4, v0..v4 repeat, then p0..p4.

### Display vocabulary (all non-blocking now)
| shows | meaning |
|---|---|
| single centre dot | unclaimed, no identity yet |
| two opposite corner dots | that choice's value never arrived |
| row of dots | claimed, value present, picture not yet |
| full picture | fully configured |

## 2026-09-14 — h boards saw received:false — clearing on "calc" was the bug

h0 dumped `configured: true`, `fanIn 2`, both weights right, but `received: false` on every input
after a calc, while the x boards were transmitting.

### Wrong turn first (recorded so it is not repeated)
Suspected `softSerial.onLine` registered three times (P0/P1/P2) was a single-device conflict where
the last registration wins — by analogy with the `radio.onReceivedString` regression. Started
rewriting to multiplex all inputs over one tagged line. **The user confirmed multiple pins DO work
simultaneously**, so the diagnosis was wrong and the rewrite was reverted. Lesson: that analogy does
not hold for softSerial; do not "fix" the three per-pin handlers again.

The revert also **deleted the entire `basic.forever` loop** — caught by a structural check, not by
reading. Restored. Worth running a brace/registration/function-presence check after any bulk revert.

### Actual cause
`"calc"` called `clearRound()`, which wipes `received[]`. The x boards send very soon after the same
broadcast, so whenever an x value reached an h board **before** that h board processed its own
`calc`, the clear wiped an already-delivered value and the board then waited forever. The earlier
`basic.pause(150)` on the x side was a timing patch on the wrong end of the problem.

**Fix: receivers no longer clear on `calc` — only `armed = true`.** Inputs are cleared on
COMPLETION (`clearRound()` after firing), so every round still starts clean and arrival order no
longer matters. The x-side delay is now just a 50 ms settle, not load-bearing.

### Verified (2026-09-14)
Both orderings now fire: values-before-calc (the failing case) and calc-before-values. Two rounds
back to back produce correct distinct outputs with `received[]` cleared in between.
Structural check: braces balanced, all 10 functions present, exactly one `basic.forever`, one
`onReceivedValue`, one `onReceivedString`, and no `clearRound` in the calc branch.

## 2026-09-14 — Isolating the softSerial link (diagnostics added)

Radio, identity, weights and the calc trigger are all confirmed working; the remaining unknown is
whether anything crosses the **softSerial cables**. Added two diagnostics to `neuron.ts`:

- **Every `softSerial.onLine` handler logs the raw line first**: `RX P0 raw: [0.25]`. This separates
  "nothing reaches the pin" (wiring, ground, baud) from "arrived but mis-parsed".
- **Button A on a non-x board sends a test value** `0.5` on P3 and logs `TX P3 test`. That exercises
  one cable on its own — no radio, no calc, no weights. (On an x board A still steps choices.)

Note `basic.showNumber` is deliberately not used in these paths; serial writes do not block the way
scrolling the display does.

### Note
A dump the user labelled `y0` was actually y1 (bias +4.7589, weights [10.37, -8.88, -9.66], serial
1843421070 = y1's slot). Self-consistent, not a bug — the user confirmed they had sent y1.

## 2026-09-14 — No RX at all on h0: two regressions vs the old working nn.js

h0 showed no `RX P0 raw:` line whatsoever, i.e. the softSerial handler never ran, even though the
same cabling worked with the older `nn.js`. Diffing the two files found two things the rewrite had
dropped or added.

### 1. `basic.pause(10)` at the top of every softSerial handler (dropped)
`nn.js` had it as the first statement of all three handlers; the rewrite removed it. Restored, and
the registration order was put back to nn.js's P1, P2, P0. Treat the pause as **load-bearing**: it
yields briefly so the bit-banged driver settles before the handler reads.

### 2. `basic.showString(ownName)` in the main loop (added)
The `displayDirty` repaint scrolled the board's name — over a second of blocking — inside
`basic.forever`. Bit-banged softSerial has no buffer: a line arriving while the board is scrolling
is missed outright, not queued. This is the same class of bug as drawing inside a radio handler,
one layer along, and it was introduced by the fix for that one.

**Now nothing on a neuron board scrolls, ever.** Identity is a single plotted dot (row 0 for h, row
4 for y, column = index), the startup marker is a centre dot, and `showChoice()` uses `showImage` or
`led.plot`. Verified mechanically: zero `showString`/`showNumber` calls remain in the code once
comments are stripped.

**Rule: on these boards, display output must be instant (`led.plot`, `showImage`, `clearScreen`).
`showString`/`showNumber` scroll and will eat incoming serial and radio traffic.**

### Verified (2026-09-14)
Comment-stripped source contains no `showString`/`showNumber`. Braces balanced; exactly one
`basic.forever`, one `onReceivedValue`, one `onReceivedString`, three `softSerial.onLine`.
No display calls inside any softSerial handler.

## 2026-09-14 — Visual RX/TX indicators added

The user asked whether anything is shown when a softSerial read lands. It was serial-log only, which
is awkward when debugging several boards without a monitor on each. Added, all instant (`led.plot`):

| pixel | meaning |
|---|---|
| (0,0) / row 0 col N | claimed identity, h board index N |
| row 4 col N | claimed identity, y board index N |
| (2,2) centre | unclaimed |
| **(0,2) (1,2) (2,2) middle row** | **a value arrived on P0 / P1 / P2** |
| **(4,0) top-right blink** | **transmitting on P3** |

`clearRound()` unplots the middle-row dots, so each round starts visually clean. This gives a
cable test needing no serial monitor: press A on an upstream board, watch for the top-right blink
there and a middle-row dot on the downstream board.

### Open: A on h0 produces nothing on y0
Per the documented wiring h0.P3 -> y0.P0, so y0 should log `RX P0 raw: [0.5]`. It does not. With the
code-side regressions now fixed (pause(10) restored, no blocking display anywhere), the remaining
suspects are physical: the cable itself, and **common ground between the boards** — softSerial needs
a shared reference and separately-powered boards often lack one.

### Note for later
Old `nn.js` fired on inputs alone (`if (ready)`), with **no `armed` gate** and `basic.pause(100)` in
the loop; the new code gates on `armed` (set by "calc") and uses `basic.pause(20)`. If the link is
proven good but boards still do not fire, the `armed` gate is the next thing to question — an x
board that missed the "calc" radio packet stays silent, where the old design would have run purely
on data arrival.

## 2026-09-14 — Cables ruled out; radio/softSerial timing conflict suspected

User confirms the cables and electrical connections are good (they worked with the older code), and
still nothing arrives — no `RX` line, no indicator dot.

### The one structural difference left
`nn.js`, whose cables demonstrably worked, **never calls `radio.setGroup`** — it has no radio init
anywhere. `neuron.ts` calls `radio.setGroup(1)` at the top, *before* the three
`softSerial.onLine` registrations. The micro:bit radio stack and bit-banged softSerial compete for
tight timing/interrupts, which makes the radio the prime suspect for killing reception.

This is a hypothesis, not yet a finding — every earlier guess here (softSerial single-device,
wiring) was wrong, so it gets tested before anything is rewritten.

### Test: softserial-test.ts
Minimal standalone file, softSerial only, no radio. Flash to two boards, wire TX->RX + common
ground. A transmits 0.5 on P3; the receiver lights a dot and logs the raw line. `radio.setGroup(1)`
sits commented out at the top as step 2.

| result | conclusion |
|---|---|
| works without setGroup, fails with it | radio/softSerial conflict proven |
| fails both ways | not the radio; pins or API usage |
| works both ways | neither — the bug is elsewhere in neuron.ts |

If the conflict is proven, the fix is to separate the two rather than reorder the calls — e.g.
parameters distributed by radio once at setup, then radio left idle while values move over cable.

### CORRECTION (2026-09-14, same day)
The radio hypothesis above is **wrong**. The user points out radio was present before: `nn.js` uses
`radio.onReceivedValue` and `radio.sendString`, so the radio stack was live while those cables
worked. `setGroup` alone is not the difference. Disregard that theory; `softserial-test.ts` remains
useful as a pure-softSerial baseline but the setGroup step-2 is no longer the point.

## 2026-09-14 — FOUND IT: the 5x5 matrix was stealing the softSerial RX pins

Every `RX` went missing the moment the rewrite started drawing on the **5x5 LED matrix**. On the
Calliope mini the matrix contends with **P0, P1 and P2** — exactly the three pins the neurons read
on. With the display enabled the display driver drives those pins and softSerial cannot read them.

**This is the real difference from `nn.js`.** That file's cables worked because it only ever used
the **separate RGB LED** (`basic.setLedColors` / `turnRgbLedOff`) and never touched the matrix. The
rewrite added `basic.showString`, `showImage`, `led.plot` for identity, choices, RX/TX indicators —
and each of those quietly claimed the RX pins.

**Per the user: P3 is exclusive and independent of the display**, so TRANSMITTING was never
affected. That matches the symptom exactly — x boards happily sent (`out_x0` logged), nothing was
ever received.

**Fix:** `led.enable(false)` at startup, and every status indicator moved to the RGB LED:

| RGB colour | meaning |
|---|---|
| purple | unclaimed, no identity yet |
| teal | hidden neuron, claimed |
| blue | output neuron claimed / transmitting |
| green flash | a value arrived on softSerial |
| red | selected choice never arrived |
| blue->red gradient | which choice an x board has selected |

Verified mechanically: zero `led.plot`/`led.unplot`/`clearScreen`/`showImage`/`showString`/
`showNumber` remain in the code; `led.enable(false)` present; braces balanced.

### Cost
The per-choice **pictures can no longer be displayed** while the matrix is off. They are still
received and stored in `choiceImages`, so re-enabling the display on a board that does no softSerial
reading would bring them back. The x boards do not read softSerial at all -- only transmit on P3,
which is unaffected -- so **the x boards could keep their matrix and their pictures**. Worth doing
if the pictures matter: gate `led.enable(false)` on `!isInputBoard()`. Not done yet because identity
arrives after startup, so the board does not know it is an x board at the time led.enable runs.

### Wrong turns on the way here (do not repeat)
1. softSerial as a single device where the last `onLine` wins — **wrong**, multiple pins work.
2. Radio/softSerial timing conflict from `radio.setGroup` — **wrong**, nn.js used radio too.
Both were plausible and both cost a hardware round-trip. The thing that actually found it was
diffing nn.js for *what it never did*, rather than looking for what the new code did wrong.

### CORRECTION (2026-09-14, same day) — this was WRONG TOO
The user confirms **P0, P1 and P2 are also independent of the display** on the Calliope mini. The
matrix is therefore NOT stealing the RX pins, and `led.enable(false)` is not the fix. Disregard the
entire finding above.

That makes **three** wrong hypotheses about the dead RX path (softSerial single-device, radio
timing, display pin contention). All three were reasoned from plausible micro:bit-family behaviour
rather than from evidence about this specific board, and each cost a hardware round-trip.

**Stop hypothesising. The next step is a measurement**, not another theory: `softserial-test.ts`
(two boards, softSerial only, no radio, no display work) establishes whether reception works AT ALL
in the current physical setup. Everything else is guessing until that returns a result.

## 2026-09-15 — Root cause of "y1 always fires": stale hidden input, not the weights

### Weights are correct — verified independently
Reproduced the `input.ts` weight set outside the firmware (scratchpad `chk.js`), 2‑3‑2 sigmoid
hidden + linear output, unpacked as `[b, w…]` per neuron in order h0,h1,h2,y0,y1:

| input convention | accuracy |
|---|---|
| raw (unscaled) | **20/20 = 100 %** |
| standardized | 16/20 = 80 % |

So the deployed set belongs to the **raw** convention, matching the 2026-09-09 entry — the user
retrained with "Scale the inputs" unticked, which is right for firmware. No weight bug.

### The actual bug: one-cycle lag on the last-arriving hidden value
User's observed sequence on x0=0.25 was correct, then wrong, then correct, then wrong. Simulating
"h_n is one sample stale" against the real activations isolated it to **h2**:

- h1 barely moves across the whole x1 sweep (0.9992 → 0.9993), so a stale h1 changes nothing.
- h2 is the only hidden unit that varies (0.814 → 0.294 → 0.038 → 0.814) and **carries the
  decision entirely**. Shifting h2 by one sample reproduces the user's log exactly.

Two mechanisms combined:

1. **`while (!(inputs[n]))` treats a legitimate 0.0 as "not arrived."** h2 reaches **0.000355**
   on the x1=0.2 rows — falsy. The board waits for a value it already holds, falls through into
   the next cycle, and desynchronizes permanently. This is the failure mode the 2026-09-09 entry
   at line 496 already warned about: *never infer arrival from a value*.
2. **`rainbow()` ran BEFORE the computation**, burning ~2.3 s between reading `inputs[]` and the
   reset loop that zeroed it. Any line landing in that window was destroyed rather than counted.

### Decision — explicit arrival flags, guard instead of block
Chose `needed[]` / `received[]` booleans plus a `haveAllInputs()` helper, and restructured the
`forever` loop from *block until ready* to **`if (all necessary inputs received) { … }`** at the
user's request. Three details matter and are easy to get wrong:

- **Clear `received[]` at the START of the cycle**, not the end — otherwise the same destroy-window
  reopens around the display code.
- **`rainbow()` moved to after the computation**, shrinking the race and costing nothing (it is
  decorative).
- `needed[n]` is set when the weight arrives over radio, **not** by testing `ownWeights[n]` —
  a legitimately zero weight would otherwise read as "input not needed".

Alternatives considered and rejected:
- **Bitmask** (`(receivedMask & neededMask) == neededMask`, `neededMask = (1 << fanIn) - 1`).
  Clears in a single store, which is genuinely safer than a four-iteration loop, but `|=` in a
  handler is a non-atomic read-modify-write; MakeCode's cooperative scheduling makes that safe in
  practice, but the array version doesn't rest on that assumption. User asked for the plain version.
- **Counter** (`recvCount < needCount`). Still needs `received[]` to prevent double-counting a
  duplicate line, so it is not actually less code, and it loses *which* input is missing — the
  exact question that took three rounds to answer here.

### Still open
- The `while` loops never protected against a missing input as intended; a board could print a
  result with `inputs[1] = 0`. Button-B dumps showed **post-reset** state, so they were misleading
  during debugging. If dumps are needed again, latch a `lastInputs[]` copy at calc time.
- `neuron.ts` has the same pattern and was left untouched.

## 2026-09-15 — FOUND (for real): writeNumber never triggers onLine

The user supplied `nn.ts`, a version that **works**. Diffing it against `neuron.ts` gives the answer
in one line.

**Working `nn.ts` transmits with:**
```typescript
softSerial.writeLine(DigitalPin.P3, softSerial.BaudRate.Baud1200, convertToText(ownOutput))
```
**`neuron.ts` transmitted with `softSerial.writeNumber(...)`.**

`softSerial.onLine` fires on a **NEWLINE**. `writeLine` appends one; `writeNumber` does not. The
bytes went out on the wire — which is why the TX side always looked healthy and `out_x0` logged
every time — but the receiver's handler was never triggered. Hence: transmit fine, reception zero,
on every board, regardless of cable, ground, radio or display.

Fixed in `neuron.ts` (3 call sites) and `softserial-test.ts` (1).

**Rule: pair `softSerial.writeLine` with `softSerial.onLine`. `writeNumber` is for a reader that
does not depend on line framing.**

### Three wrong hypotheses before this (all mine, all cost a hardware round-trip)
1. softSerial is a single device, last `onLine` wins — wrong, multiple pins work.
2. `radio.setGroup` conflicts with softSerial timing — wrong, nn.js/nn.ts use radio too.
3. The 5x5 matrix steals P0/P1/P2 — wrong, P0-P3 are independent of the display on the Calliope.

Each was reasoned from plausible micro:bit-family behaviour instead of from the working code. **The
fix was found in minutes once a known-good version was available to diff.** Ask for the working
artefact first; it beats any amount of reasoning about what might be wrong.

### Still differing from nn.ts, deliberately (watch if problems persist)
- **`needed[]` vs `fanIn`.** nn.ts marks a slot needed when its weight arrives and waits only for
  those (`haveAllInputs`), with **no `armed`/`calc` gate on the receive side** — it fires purely on
  data arrival. `neuron.ts` uses `fanIn` from the sender plus an `armed` gate. If boards still fail
  to fire, drop the `armed` gate first: a missed "calc" packet silences a board that nn.ts would
  have run anyway.
- nn.ts clears `received[]` **before** computing, so a line landing mid-computation counts toward
  the next cycle. `neuron.ts` clears after firing (`clearRound`). nn.ts's order is the safer one.
- nn.ts's y neurons skip the sigmoid (`getNeuronOutput()` raw) and compare against
  `outputThreshold`; `neuron.ts` applies sigmoid to every layer. Monotonic, so the argmax is the
  same — but the y board's printed numbers differ between the two.

## 2026-09-15 — Matrix display restored, real images, cleanup

### Matrix is back
`basic.showLeds` / `showIcon` / `led.plot` are **instant**; only `showString`/`showNumber` scroll
and block. The earlier `led.enable(false)` panic was based on a wrong pin-conflict theory (already
retracted above), so the 5x5 matrix is fine to use. All RGB-LED status code removed.

State on the matrix again: `?` unclaimed, the board's name once claimed, the No icon when a choice's
value never arrived, and the choice picture on an x board.

### Images: copied from input.ts, sent over radio
The 9 real pictures were extracted programmatically from `input.ts` (4 for x0, 5 for x1) and put in
`sender.ts`'s `inputPictures`, **verified byte-for-byte identical** to the originals. Note input.ts
indexes choices from 1; `choiceIndex` here is 0-based, so they are shifted down by one.

Per the user they travel **over radio**, not hardcoded on the boards, so the artwork can change
without reflashing the neurons. `neuron.ts` stores them as 25-char strings (`choicePics`) and
renders with `drawBits()` — `led.plot`/`unplot` per pixel, instant. `basic.showImage` is NOT used:
it blocks. The `Image` type and `imageFromText()` are gone with it.

### Removed while tidying
- The RGB helpers `setRgb`/`rgbOff`/`flash` and every call.
- `imageFromText()` and the `choiceImages: Image[]` array.
- The unused `"reset"` radio message and its doc line.
- Stale comments from the three retracted theories (softSerial single-device, radio timing,
  display pin contention).

### Verified (2026-09-15)
Both files brace-balanced. `neuron.ts`: exactly one `basic.forever`, one `onReceivedValue`, one
`onReceivedString`, three `softSerial.onLine`, two `onButtonEvent`; zero `writeNumber`, three
`writeLine`; **no dead functions, no unused variables, no blocking display call inside any radio or
softSerial handler**. All 9 pictures match `input.ts` exactly.

## 2026-09-15 — Pictures never arrived: radio.sendString caps payload at 19 chars

x boards kept showing the middle-row dots, which is the explicit "value arrived, picture did not"
fallback — so `choicePics` was empty.

**Cause:** `radio.sendString` carries at most **19 characters**. The message
`"<name>p<k>:<25 bits>"` is **30**, so it arrived truncated (`"x0p0:11011110110000"`, 14 bits) and
the receiver's own `bits.length < 25` guard rejected it silently. The identity strings are 12-14
characters, which is exactly why those always worked and only the pictures failed.

**Fix: one ROW per message.** `"<name>p<k>r<y>:<5 bits>"` = **12 characters**. The receiver seeds a
picture with 25 dark pixels on first sight and patches in each row as it lands, so a picture can be
drawn as soon as any row of it arrives rather than needing all five.

Same root cause as the serial-number bug (a radio primitive's limit silently mangling the payload):
**check the transport's size limit before assuming a message arrives intact.**

### Verified (2026-09-15)
All 9 pictures still byte-identical to `input.ts`; longest per-row message 12 chars (limit 19);
all 9 reassemble exactly from their 5 rows. `neuron.ts` structure unchanged and balanced.

## 2026-09-15 — Pictures packed into ONE message again

The per-row split (5 messages per picture) was replaced with **bit packing**, so a whole picture
fits one `radio.sendString` after all.

**Scheme:** 5 bits per character, one character per row — character code `95 + rowValue(0..31)`.
`"<name>p<k>:<5 chars>"` = **10 characters**, well inside the 19-char limit.

**Why base 95:** codes 95..126 (`_` through `~`) are 32 consecutive printable characters containing
no `":"` (the field separator), no quote and no backslash — nothing to escape, nothing to confuse
the parser. Base 65 was rejected because its range includes backslash (92).

Pictures stay **1 bit per pixel, on/off only** — same as `input.ts`. No brightness is encoded
(the user confirmed it is not wanted). For reference if it is ever revisited: 2-bit/4-level
brightness would be 50 bits = 10 payload chars and would still fit one message; 3-bit would not.

`packPicture()` lives in `sender.ts`, the matching unpack is inline in `neuron.ts`'s string handler.

### Verified (2026-09-15)
Both implementations transcribed from the actual files and run against each other: all 9 pictures
round-trip **exactly**, every message is 10 chars, and no payload contains a separator/quote/
backslash. Picture traffic per `sendAll` is back to 9 messages (was 45 per-row).
Both files brace-balanced; `neuron.ts` handler counts unchanged, no dead functions.

## 2026-09-15 — packImage(): author pictures as MakeCode Images

Added to `sender.ts` so pictures can be drawn in MakeCode's visual grid rather than typed as
"0"/"1" text:

```typescript
sendPicture("x0", 0, images.createImage(`
    . . . . .
    . # . . #
    . # . . #
    . . # # #
    . . . . .
    `))
```

`packImage(img)` reads the picture back with **`img.pixel(x, y)`** and emits the same wire format as
`packPicture` — 5 bits per character, one character per row, base 95. `sendPicture(name, k, img)`
wraps it with the `"<name>p<k>:"` header and transmits; the whole message is 10 characters.

Both helpers coexist: `inputPictures` (text) still drives `sendInput()`'s bulk push, while
`sendPicture` is for sending an individual image ad hoc. Neither is preferred — text is easier to
diff, Images are easier to draw.

### Verified (2026-09-15)
`packImage` and `packPicture` transcribed from the file and run against a simulated
`images.createImage`/`Image.pixel`: **byte-identical output for all 9 real pictures**, every one
round-trips through the receiver's unpack, and the user's own example encodes to `"x0p0:_qq{_"`
(10 chars) and decodes back to exactly the drawn shape.

## 2026-09-15 — Fixed: `colon` declared twice in the radio string handler

`let colon` appeared at neuron.ts:352 (the picture branch) and again further down, left behind when
the picture branch was restored after the packing change. Same function scope, so it is a
redeclaration error. The second one was also dead — the identity path only needs `eq`. Removed.

A block-scope-aware scan of every function and handler now reports no other duplicate declarations.
(An earlier naive scan flagged two sequential `for (let i = ...)` loops in the button-B handler;
those are correctly scoped to their own blocks and are fine.)

## 2026-09-15 — Output-neuron win messages, configured by the sender

Ported nn.ts's behaviour (y0 -> green flash + "nicht frech", y1 -> red flash + "frech" when the
output exceeds a threshold), but with all of it **sent over radio** instead of hardcoded, so the
text, colour and threshold change without reflashing the neurons.

### sender.ts, new section "2a. THE OUTPUT LAYER"
`outputMessages`, `outputColors` ([r,g,b]) and a shared `outputThreshold`, pushed by `sendOutput()`
from `sendAll()`.

### Protocol additions
```
"<name>t"         value = win threshold        e.g. "y0t"  = 0.5
"<name>cr/cg/cb"  value = flash colour 0-255   e.g. "y1cr" = 40
STRING "<name>m<n>:<text>"  chunk n of the win message, e.g. "y1m0:frech"
                            chunk 0 replaces, later chunks append
```
The message is **chunked at 14 characters** ("<name>m<n>:" is 5 of the 19-char limit) so arbitrarily
long text works.

### Bug caught while adding this
The picture branch did `return` on **any** colon message whose head was not a picture, which would
have silently swallowed every message chunk. Rewrote both branches to match on the head
(`mine && head.charAt(2) == "p"` / `== "m"`) instead of returning early. Worth remembering: with
several `"<head>:<payload>"` message types sharing one handler, an early `return` in the first
branch eats all the others.

### Display timing
The flash and `basic.showString(winMessage)` run **after** the round completes and immediately
before `clearRound()`. Blocking is safe there — no input is expected until the next "calc" — and
this is the one place `showString` is still allowed. `displayDirty` is set afterwards so the board
returns to showing its name.

### Verified (2026-09-15)
Sender chunking and the receiver's string handler transcribed and run against each other:
"frech" (1 chunk), "nicht frech" (1), and a 25-character message (2 chunks) all reassemble exactly;
every message is within 19 characters; y1 ignores y0's messages; a picture message does not consume
a following message chunk. Both files brace-balanced, handler counts unchanged.

## 2026-09-15 — Is displayDirty necessary? Yes, for the scrolling paths

Asked whether the `displayDirty` indirection is needed. It is, but for a narrower reason than the
old comment claimed, which is now corrected in the file.

All four setters sit inside **radio handlers**. Three of them would otherwise call
`basic.showString` (identity claimed/released, choice value arrived), which **scrolls for over a
second**. A board stuck in that MISSES an arriving softSerial line outright — bit-banged serial has
no buffer — which is precisely the bug that killed reception earlier. So deferring the repaint to
the main loop is load-bearing.

The fourth setter (a picture row arriving) calls `drawBits`, which is instant and would be safe
inline; it uses the flag for consistency.

The fifth use, after a win, is already in the main loop rather than a handler, so it could repaint
directly. Deferring costs one ~20 ms iteration and keeps repaint logic in one place — convention,
not necessity.

The old comment said "so drawing never stalls the radio queue". The radio queue is the lesser
hazard: radio buffers a few packets, softSerial buffers nothing.

## 2026-09-16 — kids.html: child-friendly rebuild of the playground

New standalone file [kids.html](../kids.html). `index.html` is untouched. Same network engine
(activations, makeNet/forward/trainEpoch/evaluate, diagram, inspector, confusion, presets, paste,
export all reused verbatim or lightly reworded); new layout and chrome.

### Structure, as requested
- **Network in the middle**, with a **+/- stepper above each layer column**. The steppers are
  absolutely positioned and aligned to the canvas column x from `state.geom`, so they track the
  diagram when layers are added or the window resizes (`positionLayerBar()`, called from
  `drawNet()` and on resize).
- **Hidden-layer count** has its own +/- control, and the **activation picker sits below the hidden
  layers**, centred under them; both hide when there are no hidden layers.
- **sigmoid is the default** (was relu in index.html).
- **Data table below the network**, unchanged behaviour.
- **"Try one example" beside the input layer**, in the left column of the network grid, with
  probability bars instead of the old ASCII output.
- **"How is it doing?" collapsed by default** (`<details>`).
- **White margin left and right**: `.page{max-width:1180px;margin:0 auto;padding:0 40px}`.

### Notes
- Layer sizes now live in `state.nIn`/`state.nOut`/`state.hiddenSizes` rather than being read back
  out of DOM inputs, because the steppers are re-rendered on every change and reading a
  just-replaced node is fragile. `nIn()`/`nOut()` return the state values.
- `drawChart()` returns early when the canvas has zero width — the results panel is collapsed at
  load, and a hidden canvas would otherwise be sized 0 and stay blank. Redrawn on `toggle`.
- Limits: 12 inputs, 10 answers, 4 hidden layers, 12 neurons per hidden layer.

### Verified (2026-09-16)
Ran the page script headlessly against a stub DOM and exercised it:
- boots at 2-4-2 with **sigmoid** default, XOR preset, 64 usable rows;
- every stepper direction works (`3-4-2`, `2-4-3`, `2-4-4-2`, `2-4-6-2`, `2-2` with no hidden layer)
  and clamps at 12 / 2 / 4;
- **XOR trains 53.3% -> 100.0%** (loss 0.758 -> 0.058) with the default sigmoid;
- export: 6 rows / 22 cells vs 22 real parameters, parses as JSON;
- all four presets load with the right shapes; paste accepts good input and rejects single-column.
Not verified in a real browser (none available here), so the canvas layout and stepper alignment
rest on the geometry maths and review.

## 2026-09-16 — UART→radio bridge in sender.ts + WebUSB in kids.html

The page can now push a freshly trained network into the Calliopes without anyone editing
`sender.ts`.

### sender.ts, section 6: the bridge
`serial.onDataReceived(Delimiters.NewLine)` reads one command per line and answers `OK …` or
`ERR …`, so the browser waits for a reply instead of guessing at timing.

```
PING | ARCH <sizes> | SERIAL <n|x> <i> <serial> | NEURON <i> <bias> <w,w,…>
MSG <i> <text> | COL <i> <r> <g> <b> | THRESH <v> | CHOICES <i> <v,…>
PIC <i> <k> <25 bits> | SEND | CALC
```
`SERIAL` lets the **page** own the serial-number→neuron mapping (user request), so the tables in
`sender.ts` are only defaults now.

### kids.html: step 4 panel
Connect / Send the brain / Run one round / Disconnect, a collapsible board table (serials stored in
`localStorage`, kept as TEXT — a 9-10 digit possibly-negative serial does not survive a float), and
a log of everything sent. Talks CMSIS-DAP over WebUSB: claim the class-0xFF interface, DAP `0x88`
reads serial, `0x89` writes it. Chrome/Edge/Opera only; the panel says so on other browsers.

### The 19-character limit: audited, two real bugs found
USB lines are unconstrained (longest is 56 chars); the limit applies only to what the bridge then
re-emits over **radio**. Audited every radio message at the page's maximum network size:

1. **Two-character names are baked into the protocol.** `neuron.ts` parses `name.substr(0,2)`, so
   `h10` is read as `h1` + field `0w0` — messages would go to the **wrong board**, silently. Fixed
   by `usbCheckSize()` in the page: at most 10 hidden neurons in total, 10 answers, 10 inputs,
   refused with a plain-language message before anything is sent. (Hidden neurons are numbered
   across all hidden layers, so two layers cannot both claim h0.)
2. **Win-message chunking broke past 130 characters.** `"<name>m<n>:"` is 5 chars while the chunk
   index is one digit but 6 at chunk 10, so a long message emitted a 20-character radio string.
   Fixed: 14 chars per chunk below index 10, 13 from there on.

### Verified (2026-09-16)
- Bridge parser extracted from `sender.ts` and driven with 17 lines: every command parses, `MSG`
  keeps its spaces, `\r` is stripped, malformed input returns `ERR` and changes nothing.
  Two bugs caught here first: `splitFields` truncated `MSG` at its first space (field count now
  depends on the command), and `ARCH` restarted hidden names per layer (`h0..h4,h0..h3` → collision).
- Page side headless: role keys unique and all ≤2 chars for 2-4-2 and 2-3-2-2; size guard fires at
  12 hidden neurons; 23 well-formed USB lines for XOR; longest 56 chars.
- Radio audit: every message within its limit at maximum size; win-message chunks reassemble
  exactly at 1/5/13/14/15/130/140/141/200/400 characters, longest chunk 19.
- Not verified on hardware: no board here, so the DAP endpoint numbers and the WebUSB handshake
  rest on the CMSIS-DAP spec and review.

## 2026-09-16 — WebUSB fix, German title, answer names, and input scaling on the x boards

### "no bulk endpoints found" — fixed
The connect code took the FIRST class-0xFF interface and then read endpoints from it. A board
exposes several interfaces and more than one can be 0xFF, so it could pick an endpoint-less one.
Now it requires an interface that actually carries a **bulk endpoint in each direction**, filters
`e.type === 'bulk'`, and on failure logs every interface it saw (number, class, endpoint counts) to
the "What was sent" box — so a next failure is diagnosable instead of opaque.

### Title
"Build a Brain" → **"Calliope mini Neuronales Netz"**, subtitle removed (`<title>` and `<h1>`).

### Answer names
New collapsible "What do the answers mean?" in the network panel: one text field per answer,
stored in `localStorage`, empty falls back to `Antwort <i>`. These become the win messages the y
boards scroll, replacing the hardcoded `usbAnswerName()`.

### Input scaling: the x boards do it (user's choice)
**Do the neurons scale? No** — `neuron.ts` computes `sigmoid(sum(w*x)+b)` on whatever arrives, and
nothing in the export recorded which convention the weights belonged to. That is the 60%-vs-100%
trap from 2026-09-09.

First implemented as folding the scaling into the first layer's weights
(`w' = w/std`, `b' = b - sum(w*mean/std)`, verified exact to 4e-17). **The user preferred the sender
to send normalized input instead**, so that was reverted in favour of:

- page sends `NORM <i> <mean> <std>` per input column, or `NORM off`;
- `sender.ts` stores it and relays `"<name>m"` / `"<name>s"` to each x board;
- `neuron.ts` scales in the x-board transmit path: `sent = (chosen - myMean) / myStd`,
  with `myStd == 0` meaning "send the raw value".

Better than folding: the arithmetic stays visible on the board (it even logs
`chose 0.25 -> scaled -1.34`), rather than being hidden inside weights that look arbitrary.

### Verified (2026-09-16)
Full chain simulated — page `fitNorm` → `NORM` lines → bridge parse → x-board scaling → network:
**20/20 correct with scaling, 12/20 (60%) without**, reproducing the original bug exactly and
confirming the fix. Wire values are sent at 6 decimals; rounding error 1.4e-6, negligible.
`kids.html`: no missing DOM ids, no duplicate declarations, title/subtitle correct.
`neuron.ts`: braces balanced, handler counts unchanged.
Bridge now answers 12 commands: ARCH CALC CHOICES COL MSG NEURON NORM PIC PING SEND SERIAL THRESH.

## 2026-09-16 — "no reply to PING": wrong DAP opcodes and no baud rate

Checked the reference implementation the user pointed at,
`/home/hugo/fw/Makecode/microbit-connection` (it wraps **dapjs**). Two faults in my transport,
both fatal on their own:

1. **Wrong vendor command codes.** I had guessed `0x88`/`0x89` for serial read/write. From
   `dapjs/src/daplink/enums.ts` the real DAPLink serial commands are:
   `0x81` READ_SETTINGS, `0x82` WRITE_SETTINGS, **`0x83` READ, `0x84` WRITE**.
   `0x89` is in fact a *flash* command (DAPLinkFlash.RESET), so the board was being sent nonsense.
2. **The serial baud rate was never set.** `usb-device-wrapper.ts` calls
   `setSerialBaudrate(115200)` before reading. The board's serial port speed is independent of USB,
   so without this both ends were at different speeds and nothing intelligible arrived.

Framing itself was right and is confirmed by dapjs: write is `[0x84, count, ...bytes]` (max 62
chars per 64-byte packet), read replies `[0x83, count, ...bytes]` and the reply's first byte is now
checked. Baud is written as a little-endian uint32 payload to `0x82`. After connecting, the page
drains six read packets and clears the buffer so the first line it matches is its own reply.

**Lesson: look for a working implementation before guessing at a hardware protocol.** Both values
were one grep away in a repo already on this machine.

### Also in this pass
- **"What do the answers mean?" moved** out of the network panel into section 4 (Send it to the
  Calliopes), above the board table — it is send-time configuration, so it belongs with it.
- **The "Try one example" box now matches the height of the network** beside it: `.netwrap` uses
  `align-items:stretch`, `.trybox` is a flex column, and `.answer` takes `flex:1` so it absorbs the
  leftover height instead of leaving the card short.

### Verified (2026-09-16)
Opcodes and baud present, answers panel inside section 4 and before the board table, no missing DOM
ids, braces balanced. The transport itself is still unverified on hardware (no board here), but it
now matches dapjs's behaviour rather than my guess.

## 2026-09-16 — PING "answered" by the board's own startup banner

`Could not connect: the board replied "eady -- A = send parameters, B = calculate "`.

**Good news: the transport works.** That text is `sender.ts`'s own startup banner ("sender ready --
…"), truncated because the drain consumed the first half of the line. So the DAP opcode and baud
fixes were right; the remaining fault was in matching replies.

**Cause:** `usbPoll` handed the *first* complete line to whoever was waiting, whatever it was. The
board is not silent — it prints a banner at boot and a log line for every neuron it sends — so a
command's "reply" was whatever happened to arrive next.

**Fix:** `isReply()` — only `OK`/`OK …`/`ERR`/`ERR …` may satisfy a waiter. Everything else is the
board talking to itself and is shown in the log prefixed `·` instead. Also:
- the post-connect drain now reads until the board goes quiet (up to 25 polls) rather than a fixed
  6, and clears any stale waiters;
- `PING` retries 3× before giving up, since the first command can be swallowed while the banner is
  still printing, and the failure message now names the likely cause (wrong hex on the board).

This also fixes a bug that had not surfaced yet: `SEND` makes the board print nine
`sent h0 (2 weights)`-style lines before `OK SEND`, and the old code would have resolved on the
first of them and then desynchronised every later command.

### Verified (2026-09-16)
`isReply` over 13 lines, 13/13 correct: both forms of the banner rejected, all OK/ERR forms
accepted, board chatter (`sent h0 …`, `out_y0:…`, `=== board table ===`) rejected, and the
near-miss `"OKAY something"` rejected. A simulated `SEND` passes all nine log lines through to the
display and resolves the waiter on `OK SEND` with no waiters left over.

## 2026-09-16 — One serial table instead of two

`boardSerials` (neurons) and `inputSerials` (x boards) merged into a single
**`allNames` / `allSerials`** pair covering every board, with `serialOf(name)` and
`setSerial(name, sn)` doing lookups **by name** rather than by position.

### Why by name, not just one concatenated list
Position-keyed tables have to stay in step with a second list (`boardNames`, `inputNames`), and
`ARCH` rewrites `boardNames` at will — so a positional serial table silently points at the wrong
board as soon as the architecture changes. Keyed by name, `serialOf("h0")` is stable across any
`ARCH`, and a name that has no board yet returns `"0"` instead of reading off the end.

### Knock-on simplifications
- `SERIAL` is now `SERIAL <name> <sn>` (e.g. `SERIAL h0 -1394225184`) — the `n`/`x` role flag is
  gone, and with it the chance of addressing the wrong table. `kids.html` sends `r.key` directly,
  which is what the board table UI was already keyed by.
- `sendNeuron` and `sendInput` both call `serialOf(name)`, so they no longer index a parallel array.
- The A+B dump is one loop over `allNames`, annotating each row with whatever else is known about
  that board (choices/pictures for an x, fanIn/bias for a neuron) and flagging `SERIAL NOT SET`.

### Verified (2026-09-16)
Extracted the merged functions and drove them: lookups correct for all seven boards, unknown name
returns `"0"`, `SERIAL h1 …` updates in place, `SERIAL h7 …` appends (table grows to 8, arrays stay
aligned), `SERIAL h0` alone is rejected. After `ARCH 2,4,2` rewrites `boardNames` to
`h0,h1,h2,h3,y0,y1`, existing serials still resolve and the new `h3` correctly reports no serial.

## 2026-09-16 — "How many thinking layers" vanished at zero

`positionLayerBar()` hid the whole `#actBar` when there were no hidden layers, but that bar carries
**both** the activation picker and the layer-count stepper. At zero hidden layers the control that
adds one disappeared with it — a dead end, since nothing else can raise the count.

**Fix:** the activation picker is now its own `#actPick` inside the bar, and only that hides. The
bar and the layer count always stay. The picker still goes, since with no hidden layer there is
nothing for an activation function to apply to (the output is always softmax).

### Verified (2026-09-16)
Headless: at `setHiddenCount(0)` the network is `2-2`, `#actBar` stays visible, `#actPick` is
`none`, and the count control renders showing `0` with **+** enabled and **&minus;** disabled.
Going back to 1 restores `2-4-2` and the picker; at the maximum of 4 the **+** is disabled.

## 2026-09-16 — "no reply to NORM", and pasting a list of board numbers

### The NORM failure
The bridge parser handles `NORM 0 0.625000 0.279508` correctly (verified directly — `splitFields`
gives exactly `["NORM","0","0.625000","0.279508"]` and it answers `OK NORM 0`), so the line never
reached the board. Two fixes on the browser side:

1. **`usbSend` resolved on the wrong reply.** The spin loop tested `if (!usb.waiters.length)` —
   "is the queue empty" — so this promise resolved whenever **any** waiter was satisfied. A late
   reply to an earlier command could stand in for the current one, leaving the real reply to be
   matched against the *next* command and the sequence progressively desynchronised. Each send now
   tracks its own waiter by identity.
2. **A dropped line aborted the whole transfer.** USB serial on these boards loses the occasional
   line; `usbSendRetry()` resends once before failing, and all 10 sends inside `usbSendNetwork` use
   it. Losing one command mid-send no longer abandons the rest.

### Pasting board numbers
"Paste a list…" in the board table takes one number per line. Two shapes, mixable:
```
-1394225184            positional: Nth non-blank line -> Nth row of the table
h0 = -1394225184       named: order does not matter ("h0: …" also works)
```
Positional entries fill top to bottom, named ones override. The box is **pre-filled with the
current values** in `h0 = …` form, so it doubles as a way to copy the numbers out. "Clear all"
empties the table.

### Verified (2026-09-16)
Positional paste maps all seven boards of a 2-3-2 net exactly; named paste works shuffled; mixed
positional/named/blank/colon forms work; a partial list fills what it can. Rejected with a specific
message: more numbers than boards, an unreadable line, an unknown board name, an empty box.
Round trip — prefill the box and paste it straight back — leaves every value unchanged.

## 2026-09-16 — Only h2 and x1 claimed identity; the other five stayed "?"

### What the pattern said
h2 (`850974008`) and x1 (`984150378`) are exactly the two **9-digit** serials; every 10-digit one
failed. Sign is not the factor — y0 and y1 are positive and still failed. Checked and ruled out:
identity messages are 12-14 characters (limit 19), and `splitFields` parses
`SERIAL h0 -1394225184` correctly. So neither length nor parsing.

### Most likely cause: the identity message was sent ONCE
`sendNeuron`/`sendInput` each sent `serialOf(name) + "=" + name` a single time. **Radio is
unacknowledged**, and this is the one message a board cannot do without — miss it and the board
ignores everything that follows and sits on "?" for the whole round. Every other critical value
(the x boards' choices) was already sent twice for exactly this reason; identity was not.

Digit count is then a red herring: the two survivors are simply the two packets that happened to
get through.

**Fix:** `sendIdentity(name)` sends it **three times** at 120 ms. Repeats are harmless — a board
re-adopting its own name is a no-op.

At a 30% packet loss rate this moves the expected number of lost boards from 2.1 of 7 to 0.19,
which matches the reported 5-of-7 failure well.

### Also added: the board now reports every identity offer
`neuron.ts` logs `id? want [-1394225184](11) mine [850974008](9) -> no` for each identity message it
hears, with both strings and their lengths. If a mismatch survives the repeat fix, this shows
whether it is a wrong serial, a lost character, or a stray space — instead of a silent "?".

### Verified (2026-09-16)
Simulated all seven boards through a full `sendAll`: every board claims the right name; with two of
every three identity packets dropped they still all claim correctly; a repeat never dislodges a
board that already has its name.

## 2026-09-16 — Per-neuron calculate (A+B), bar-graph output, last result on B

### Bar graph instead of the scrolling number
`basic.showNumber(output, 80)` replaced with **`led.plotBarGraph(output, 1)`**.

The `1` matters. `plotBarGraph(value, high)` **auto-scales when `high` is 0** — it tracks the
largest value seen (pxt-calliope/libs/core/led.ts: `if (high > 0) barGraphHigh = high; else if
(value > barGraphHigh …)`). With 0 the same 0.93 would draw differently depending on what came
before, so the bar would mean nothing between rounds. A sigmoid output is always 0..1, so the scale
is pinned there: 0 → empty, 0.5 → 3 rows, 0.93 → full.

It is also instant, where `showNumber` scrolls and blocks for about a second — which on these
boards costs arriving softSerial lines.

### A+B: calculate on this board alone
New handler on every neuron board. Computes from whatever inputs have arrived (missing ones count
as 0, and it says so on serial: `h0: only 1 of 2 inputs so far`), sends the result on P3 and draws
the bar — without waiting for the sender's "calc". An x board just arms itself and sends its
current choice. Refuses with the No icon when the board is not configured yet.

### B shows the last output again
`lastOutput` / `hasOutput` remember the most recent result. After a round the screen is cleared, so
B now re-draws it as a bar at the end of its state dump. `hasOutput` stays false until the first
calculation, so an empty bar is never mistaken for a real 0 — it says
`h0: has not calculated anything yet` instead.

Added `showState()` (name, "?" or the x board's picture) and `countInputs()`; the main loop's
repaint now calls `showState()` rather than repeating the same three-way branch.

### Verified (2026-09-16)
Braces balanced; exactly one `basic.forever`, one `onReceivedValue`, one `onReceivedString`, three
`softSerial.onLine`, and now **three** `input.onButtonEvent` (A, B, A+B). No `showNumber` remains.
Bar rows reproduced from the MakeCode source for 0, 0.11, 0.25, 0.5, 0.75, 0.93, 1 at `high=1`.

## 2026-09-16 — A+B triggers the whole network; identity still failing for 10-digit serials

### A+B now broadcasts
Changed from "calculate this one neuron" to **`radio.sendValue("calc", 0)` plus arming this board**
— the same thing the sender's B does, so a round can be run with the sender unplugged. The board
arms itself explicitly because a board does not hear its own radio broadcast.
`countInputs()` became unused and was removed.

### Identity: still only h2 and x1, and what that now rules out
The repeat fix works — x1 reports receiving **three** identity messages, i.e. its own three
repeats. So radio delivery is fine, and the message length (12-14 chars vs the 19 limit) was never
the problem. The `SERIAL` value is stored as a **string** end to end (`setSerial` keeps `f[2]`
verbatim; no parseInt/parseFloat touches it), so the USB hop is not rounding it either.

That leaves the value itself: either the serial in the table is not what that board reports, or
`control.deviceSerialNumber()` returns something other than what button B printed. The digit-count
pattern may well be coincidence — two of seven getting through is also what random loss looked
like before.

**Both ends now log, so the next run is decisive rather than another guess:**
- sender: `id-> [-1394225184=h0]` for every identity it transmits (and flags an unset serial);
- board: `id? want [-1394225184](11) mine [850974008](9) -> no` for every identity it hears.

If no board ever prints a line whose `want[]` equals its own `mine[]`, the table is simply wrong for
that board and the serials need re-reading with button B.

### Verified (2026-09-16)
`neuron.ts` braces balanced, three button handlers, one forever loop, no dead functions.
