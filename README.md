# FlowState

A flowchart editor that runs entirely in the browser. No build step, no dependencies,
no server, no account — open `index.html` and draw.

Live at <https://wasteddesigner.github.io/flowstate/>.

## Running it

Open `index.html` directly, or serve the folder (recommended, because ES modules are
blocked on `file://` in some browsers):

```bash
python3 serve.py 5191
```

Then open <http://127.0.0.1:5191>.

## What it does

**Drawing**
- Trace a photo of a hand-drawn chart into editable steps (see **Sketch to flowchart**).
- 12 shapes (Start, End, Process, Decision, Input/Output, Subprocess, Database,
  Document, Manual, Delay, Connector, Note) — drag from the palette or click a shape
  then click the canvas.
- Drag the dots on a selected step to connect it. Drop on empty canvas and the next
  step is created and connected for you.
- Illustrator-style align and distribute icons, plus **Smart align**: snaps steps whose centres are within 24 px onto shared rows and columns (selection, or everything if nothing is selected), skipping any group that would overlap.
- Alignment guides while dragging, grid snapping (hold <kbd>Alt</kbd> to ignore it),
  marquee select, align/distribute tools, resize handles, zoom and pan.
- Double-click to edit text in place; <kbd>Tab</kbd> moves to the next step still in
  edit mode. Double-click a connection to label it.
- Undo/redo of everything, 120 steps deep, with named history entries.

**Customisation**
- Five canvas palettes (Classic, Blueprint, Midnight, Pastel, Mono) plus per-step
  fill, outline, thickness, dash pattern, corner radius, font, size, weight, italic,
  colour and alignment.
- Per-connection routing (elbow / curved / straight), colour, thickness, dash, start
  and end caps (arrow, open, circle, diamond, bar), label, and fixed exit/entry sides.
- Seven worked sample charts as templates, each one passing its own logic checks.

**Live logic checks** (Checks tab, re-run as you type)
Missing or duplicated Start, missing End, steps nothing connects to, dead ends,
unreachable steps, paths that can never finish, decisions with fewer than two
branches, unlabelled or duplicate branch labels, non-decision steps with several
exits, loops with no way out, loops with no decision, duplicate connections and
blank labels. Many come with a one-click fix.

**Code on steps** (Code tab)
Attach code or pseudocode to any step and pick its language. The checks available
per language are listed in the panel and summarised here:

| Language | Brackets & quotes | Syntax slips | Logic mistakes | Matches the shape |
|---|---|---|---|---|
| Pseudocode | — | — | — | ✓ |
| Python | ✓ | ✓ | ✓ | ✓ |
| JavaScript | ✓ | ✓ | ✓ | ✓ |
| TypeScript | ✓ | ✓ | ✓ | ✓ |
| Java | ✓ | ✓ | — | ✓ |
| C++ | ✓ | ✓ | — | ✓ |
| C# | ✓ | ✓ | — | ✓ |
| SQL | ✓ | — | — | ✓ |
| Other / plain text | — | — | — | — |

These are pattern-based heuristics, not compilers. They catch unbalanced brackets and
quotes, `=` where `==` was meant, missing colons or semicolons, Python 2 `print`,
mixed tabs and spaces, unreachable code after `return`, endless loops with no `break`,
`DELETE`/`UPDATE` with no `WHERE`, and snippets that disagree with the shape they sit
on (for example a Decision whose code has no condition, or more code branches than
arrows). They will not find every error. A language with no checks still stores,
exports and backs up its snippet — the panel says so plainly.

**Smart hints** (Hints tab, optional)
Suggests the next shape or connection from the shape of the flow — give a decision its
missing branch, close off loose ends, continue from the selected step, add an exit to a
self-loop — each with a short reason, an Apply button and a Dismiss button. Turn the
whole thing off with <kbd>Shift</kbd>+<kbd>H</kbd>.

**Sketch to flowchart**
Drop, paste or pick a photo of a hand-drawn chart and FlowState traces it into editable
steps. The whole pipeline runs on a canvas in your browser — nothing is uploaded.

1. The photo is downscaled, converted to grey and thresholded against a *local*
   average, so shadows and uneven phone lighting do not swallow half the drawing.
2. The tilt is measured by projecting the ink at every angle from −14° to +14° and
   keeping the one where horizontal strokes line up best; the image is straightened
   before anything is traced. You can also rotate it a quarter turn at a time.
3. Shapes are found as the **white regions their outlines enclose**, not as strokes —
   a hand-drawn box wobbles, but the space it encloses is still a rectangle. Regions
   that are not convex, or that swallow other regions, are discarded: those are the
   gaps *between* an arrow and a box, not shapes.
4. Each interior is classified by how much of its bounding box it fills and whether it
   reaches into the corners: rectangle (Process), diamond (Decision), stadium or oval
   (Start/End), cut corners (Input/Output). Start and End are told apart by where they
   sit in the flow.
5. The outlines are then subtracted from the ink, which separates arrows that touch
   their boxes. Each arrow's two ends are found by walking *along* the stroke, so an
   elbow connector reports its real ends. The heavier end is the arrowhead; separate
   barbs are folded back in. Ends snap to the nearest shape, and the side they arrived
   on is kept, so the imported chart routes the way you drew it.
6. Leftover marks are grouped into words, placed inside the shape that contains them,
   or attached to the nearest arrow as its label.

Then the review workspace opens: the straightened photo on the left with every guess
drawn over it, the list of steps and connections on the right. Anything FlowState is
unsure about is listed first, outlined in amber, and says *why* ("no arrowhead was
visible — the direction follows the layout"). Change a shape, retype a label, repoint a
connection, delete a stray, slide the ink sensitivity and scan again — then **Add to
this chart** or **Open as a new chart**. Nothing reaches the canvas until you say so.

*Reading the handwriting* is the one part that is not self-contained. Three tiers:

| Mode | What it does | Cost |
|---|---|---|
| Type the labels myself (default) | Shows each cropped snippet beside a text box | Nothing downloaded |
| Browser text detection | Uses the Shape Detection API if this browser has one | Free, instant, print only |
| Downloadable engine | Fetches tesseract.js from a CDN on first use | Several MB, needs internet |

Recognised text is always marked "please check it" and stays editable, because
handwriting recognition is unreliable by nature. Running recognition again replaces
what it read rather than appending to it, and never overwrites a label you typed
yourself. If an engine fails to load, FlowState says so and falls back to typing.
Formats: PNG, JPEG, WebP, GIF, BMP and AVIF, with EXIF orientation honoured.

On the built-in sample sketch the downloadable engine read all seven labels correctly
— five step names plus the Yes and No branch labels — at 95–96% confidence, taking a
few seconds the first time (the download) and about 25 ms per snippet afterwards.

**Files and sharing**
- Autosave to the browser, with a Projects manager (open, duplicate, delete).
- **Backup** writes a complete `.json` file: shapes, connections, labels, styles, code,
  language choices and document settings.
- **Import** validates the file and explains what is wrong in plain words rather than
  failing silently. Older backups (format versions 1 and 2) are upgraded on open and
  the upgrade is reported. Newer-than-supported files are refused with a clear message.
- **Share** packs the whole chart into the URL (deflate + base64) — no server involved.

**Export**
PNG, JPG, SVG and PDF, with resolution (1×–4×), margin, background (theme / white /
transparent), JPG quality, and PDF page size (fit, A4, A3, Letter) and orientation.
A Preview button renders before you download.

## Keyboard

<kbd>V</kbd>/<kbd>H</kbd>/<kbd>C</kbd> tools · <kbd>Space</kbd>+drag pan ·
<kbd>N</kbd> new step · <kbd>Enter</kbd>/<kbd>F2</kbd> edit · <kbd>Tab</kbd> next step ·
<kbd>Alt</kbd>+arrows walk the flow · arrows nudge (<kbd>Shift</kbd> for further) ·
<kbd>Ctrl</kbd>+scroll zoom · <kbd>Shift</kbd>+<kbd>1</kbd> fit ·
<kbd>Ctrl</kbd>+<kbd>F</kbd> find · <kbd>Ctrl</kbd>+<kbd>S</kbd> backup ·
<kbd>Ctrl</kbd>+<kbd>E</kbd> export · <kbd>Ctrl</kbd>+<kbd>O</kbd> projects ·
<kbd>?</kbd> full list. (<kbd>Cmd</kbd> on macOS.)

## Backup format

```jsonc
{
  "kind": "flowstate.flowchart",
  "version": 3,
  "id": "doc_…", "name": "…", "createdAt": 0, "updatedAt": 0,
  "settings": { "theme": "midnight", "grid": true, "snap": true, "gridSize": 10,
                "hints": true, "autosave": true, "defaultLang": "python",
                "edgeCurve": "orthogonal", "showCodeBadges": true },
  "nodes": [{ "id": "n_…", "type": "process", "x": 0, "y": 0, "w": 170, "h": 70,
              "text": "…", "style": { /* fill, stroke, fonts … */ },
              "code": { "lang": "python", "source": "…" } }],
  "edges": [{ "id": "e_…", "from": "n_…", "to": "n_…",
              "fromPort": "auto", "toPort": "auto", "label": "Yes",
              "style": { /* stroke, dash, curve, arrowStart, arrowEnd … */ } }]
}
```

Version 1 (`links`, `label`, no styles) and version 2 (`code` as a plain string) are
read and migrated. Unknown shapes become Process boxes, connections pointing at
missing steps are dropped, duplicate ids are renumbered — every repair is reported
before the file opens.

## Known limits

- Everything is stored in this browser. Clearing site data removes saved projects;
  take a Backup for anything you want to keep.
- Exported images reference fonts by name rather than embedding them, so an SVG opened
  on a machine without that font falls back. PNG/JPG/PDF are rasterised here, so they
  always look right.
- PDF export is a single page containing the whole chart; there is no tiling across
  pages.
- Share links carry the whole document, so very large charts exceed practical URL
  length — FlowState warns and suggests a `.json` backup instead.
- Code checks are heuristic (see the table above) and never execute your code.
- Sketch tracing is heuristic too. It reads tidy sketches well — closed boxes, arrows
  that touch their boxes, text inside the shapes — and gets steadily worse with broken
  outlines, overlapping strokes, heavy shadow or very faint pencil. It will not read a
  shape it cannot find a closed outline for, and it only guesses arrow direction from
  the arrowhead (or, failing that, the layout). That is why every guess is reviewable
  before import.
- The downloadable recognition engine is a third-party package fetched from a CDN at
  the moment you ask for it. It is optional; everything else works offline.

## Layout

```
index.html        shell, panels, modal hosts
css/app.css       design tokens, light/dark interface, responsive rules
js/util.js        helpers: DOM, text measuring and wrapping, toasts, download
js/shapes.js      shape paths, text boxes, ports
js/model.js       document model, themes, edge routing, backup read/write + migrations
js/store.js       selection, viewport, undo/redo, autosave, project storage
js/render.js      SVG scene renderer (incremental patching)
js/interact.js    pointer gestures: drag, resize, connect, marquee, pan, zoom, snapping
js/panels.js      palette and the Design / Code / Checks / Hints panes
js/validate.js    flow logic checks
js/lint.js        per-language code checks
js/hints.js       next-step suggestions
js/vision.js      sketch tracing: threshold, deskew, shapes, arrows, text regions
js/ocr.js         text recognition tiers and their fallbacks
js/scanui.js      the sketch review workspace
js/exporters.js   SVG, PNG, JPG, PDF, JSON, share links
js/templates.js   sample charts
js/app.js         wiring: shortcuts, modals, search, text editing
serve.py          tiny static server for local development
```

## Code to flowchart

**From code** (toolbar or start screen) turns Python into a new chart. `if` / `elif` / `else`,
`while`, `for`, `def` (the first function), `return` and `input` / `print` become shapes; any
other line becomes a Process step, with its source attached on the Code tab. Limits: Python
only; `break` and `continue` appear as ordinary steps, not jumps; a `#` inside a string is
read as a comment; `try` / `with` / `class` headers become a step with their body inlined.
