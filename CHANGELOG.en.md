# Changelog

All dates are GMT+8. **Starting with V1.9.1, the repository keeps only two versioned HTML files: the current version + the previous version** (Q1: the 8 old snapshots formerly at the repository root, v1.5.2~v1.8.0, have been deleted, about 5 MB); a baseline snapshot is additionally kept locally under `archive/` for rollback and is not committed to the repository;
the per-version technical details and pitfall records live in the local development doc `PROCESS.md` (**contains working notes, not committed to the repository**);
development notes, per-round task/review checklists and one-off audit scripts are likewise **not committed** (the convention and its machine-enforceable gate are described in `scripts/repo_hygiene.mjs` and in the "Repository layout" section of the README).

The version is written in the footer (`CISTrack · Vx.y.z`), and the bottom bar of exported images carries the same version number.

> 🌐 [中文](CHANGELOG.md) | **English**

---

## [Unreleased] — V1.9.5 (in progress)

> This section grows as development proceeds and is **finalised at release** (version number, date, full entries).

### Attribution (H31)

- **SGP4 now has a numerical regression against the official verification cases.** Every previous gate
  checked only structure / order of magnitude / coordinate validity — **never whether the numbers were right** —
  so a regression in `satellite-js` (e.g. after an upgrade) would shift every satellite position undetected.
  Added `data/cssi/` (two **verbatim** official files: `SGP4-VER.TLE` inputs + `tcppver.out` expected values)
  and `data/cssi-testcases.json` (deterministically derived by `scripts/mk_cssi_vectors.mjs`:
  33 scenarios / 667 cases); `smoke` compares them against the very implementation the page runs,
  with the reference implementation's own tolerance (`2e-7`).
  - Cases: [CSSI / Spacetrack Report #3 official verification cases](https://celestrak.org/NORAD/documentation/).
  - Obtained via [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) (MIT, ships the verbatim official
    files in its sdist). The tolerance convention comes from its tests too.
  - Test-only data, never shipped to the page; the sha256 of both source files is recorded in the derived file's `meta`.

### ① ★ The globe keeps spinning during a theme switch ("hole wipe") — requested, and **revertible in one step**

**What you reported**: "no more jumping, but the globe stops spinning while switching — can a smooth
switch keep the globe turning?"

**Root cause (not a browser mechanism — we paused it ourselves)**: `loop()` contains a V1.8.0
frame-drop measure, `if (document.documentElement.classList.contains('vt-running')) return;` — the
main loop bails out for the whole 700 ms wipe, so `G.yaw` never advances and the globe is never
redrawn. Measured in a real browser against the real build: in classic mode the globe advances
**0 rad/s** during the wipe (nominal 0.028).

**Approach** — the same look, implemented twice, pick one:

| Mode | Mechanism | During the wipe |
|---|---|---|
| `classic` (since V1.6.0) | new snapshot clipped to the growing circle, laid over the old one | inside the circle is a **static snapshot** → the globe freezes |
| **`hole` (new default)** | the new snapshot is not painted at all; instead the **old snapshot gets a growing hole** | inside the hole is the **live page** → the globe keeps spinning |

- The hole is cut with a `mask` radial gradient (`clip-path` can only clip a shape, not cut a hole);
  the hole radius `--vt-hole-r` must be registered via `@property` as `<length>` to be
  **interpolable** — an unregistered custom property only steps discretely, turning the animation
  into a two-step jump. Browsers without `@property` (older Firefox / Safari) **fall back to classic**.
- Duration, easing curve, origin and end radius are **untouched**; the boundary looks identical (see ②).
- During the wipe the cost is minimised: it **reuses the previous second's propagation**, only
  advancing the spin and redrawing the visible canvas — **no SGP4 run** (half a second of orbital
  motion is imperceptible; same stance as V1.8.0).

**Measured** (Edge headless, real build, 1920×1080, globe visible, spin on):

| Mode | Spin during wipe | Mean angular rate | Attainment | Frame p50 / max | Frames >50 ms |
|---|---|---|---|---|---|
| **hole** | 0.01868 rad | **0.0283 rad/s** | **101%** (nominal 0.028) | 16.7 / 31.2 ms | **0** |
| classic | 0 | 0 rad/s | 0% (behaviour identical to V1.9.4) | 16.7 / 19.9 ms | 0 |

**Rollback** (you asked for the option to be kept; three ways, **none of them persists anything**):
① URL suffix `?vt=classic`; ② console `CISTrack.vtMode('classic')`; ③ change the `THEME_VT` default
and rebuild. Both code paths **remain** (it is not "delete the old, write the new"); refreshing
returns to the factory state (dark + hole).

### ② ★ Also established: the V1.9.5 "boundary glow" **never actually rendered** (unchanged, for you to decide)

Pixel-level review (row scans plus a per-band statistic on the viewport border) shows that
`box-shadow: inset 0 0 38px 6px var(--vt-glow)` on `::view-transition-new(root)` is a **no-op**:
a VT snapshot is **replaced content**, and by paint order an inset shadow is drawn above the
background but **below the content**, so the snapshot covers it completely.

| Observation point | Border-band blueness (positive = themed glow) |
|---|---|
| Before the switch | −2.52 |
| During a classic wipe (+150 / +350 ms) | −2.50 / −2.10 (**same as before → no glow**) |
| Same shadow on an ordinary in-page element (control) | **+4.06 / +3.07** (glow appears immediately) |

**So hole mode deliberately adds no extra glow layer**: in both modes the boundary is just that 1 px
hard edge, aligned pixel for pixel. **Whether to make the boundary glow actually visible is your
call** (it would change the current presentation, so per our discipline it was left alone).

### ③ ★ Hover hit-testing consolidated (§14.3-D; approved, and you required it to be **revertible**)

**What changed is the gate, not the hit-test semantics**: the default moves from the V1.4.3
**32 ms time throttle** to **once per animation frame**.

- 32 ms ≈ 31 Hz is **out of step** with the display refresh (60/120 Hz): some frames admit twice,
  some admit nothing → while the pointer sweeps at a steady speed the hit result "shakes" (the
  floating panel flickers between two neighbours). One admission per frame locks it to the refresh.
- **All four chapters share one gate**: 03 Inclination Distribution / 01 Map / 02 Globe /
  **04 Network Progress** — 04 used to be the only one with **no throttling at all** (a full
  `drawNet()` per pointer event).
- Dragging/panning **bypasses** the gate (it must be immediate), so only hovering changes feel.
- The frame counter only schedules a `requestAnimationFrame` **when a hover event actually occurs** —
  **no new permanent loop** (still idle when idle).

**Behavioural measurement** (injected counter, 705 ms of synthetic pointer movement every 8 ms):

| Mode | Sent | Admitted | Observed rate | Expected |
|---|---|---|---|---|
| `frame` (new default) | 88 | 43 | **61 /s** | ≈ 60 Hz refresh |
| `classic` (rollback) | 88 | 21 | **30 /s** | ≈ 1000/32 |

**Rollback**: URL `?hover=classic` or console `CISTrack.hoverMode('classic')` (also **non-persistent**).

### ④ ★ Runtime data fetching migrated to OMM/JSON (H42 wrap-up)

The build side (`refresh.mjs`) had already moved to `GP_FORMAT=json`; only the **visitor's browser**
still fetched `FORMAT=tle` (CelesTrak's legacy text format, officially being retired). Now fixed:

- All six source URLs use `FORMAT=json`; the page carries a **compact OMM → two-line TLE converter**
  (column-for-column identical to `tleFromOmm` in the build-side `scripts/omm.mjs`), so nothing
  downstream changes — satellite.js / batch attribution / table / charts / history all still consume
  `{name,id,c,l1,l2}`.
- The catalogue number comes straight from the OMM `NORAD_CAT_ID` (**already the real 6-digit id**),
  so even V1.9.3's "placeholder → real id" restoration (`ommMap`) is no longer needed on this path —
  one less silent failure mode.
- **None of the semantics you asked to keep were touched**: the page still **tries** to update online
  on open; any failure (offline / timeout / HTTP error / bad field) **silently falls back to the
  built-in snapshot**; and one extra safety net was added — the format returned by a URL (JSON or
  TLE) is **auto-detected**, so a mirror or proxy that ignores the parameter still parses.
- Cache key `cistrack.tle.v2` → **v3** (v2 entries carry the old convention; keeping them would let
  someone who opens the page right after the migration read stale data).

**A real bug was caught by our own cross-check assertions**: the first version **omitted
`NORAD_CAT_ID`** when building the normalised object, so the page wrote `00NaN` into the catalogue
column of every line → **in online mode the entire batch failed `twoline2satrec`** and silently fell
back to the built-in snapshot — a textbook "only breaks when online" hole. Fixed, and now guarded
permanently by smoke.

**Nine new smoke assertions**, the hardest of which **extracts those ten fetch/convert functions from
app.js and actually runs them**, comparing the output **byte for byte** with the build-side
`scripts/omm.mjs` (currently identical: `1 00203U 24240A   26289.19093506  .00001234  00000+0  12345-3 0  9994`).

### ⑤ Chapter 03: the three GEO satellites are drawn as **themed circles** with name labels (your request)

- They changed from "small dots like everything else" to **themed-stroke circles** (8 px radius) with
  the satellite name beside them.
- Labels are laid out **deterministically in a vertical stack**: the three are within ~1 km of the
  same altitude, so the previous random avoidance stacked their labels on top of each other; now they
  shift down by 13 px only on collision — predictable and identical every time.

### ⑥ Chapter 03 pan no longer drags the view out of its domain + a **pre-draw safety clamp** (this recurred several times; hardened this round)

- The `chartDrag` pan branch had **no clamping** (the other two paths — Shift box zoom and wheel
  zoom — both go through `clampChartView`), making it the only way to drag the view out of its
  domain (0–180° / 0–2200). Measured after dragging right: `x0 = −35.85`; after dragging down:
  `y1 = 4212.9`. It now goes through the **same** clamp as the other two.
- More fundamentally, a new `guardView(name, v, clampFn)` adds a "clamp once before drawing" step at
  the **three draw entry points** (`drawChart` / `drawNet` / `drawClimb`), warning on any out-of-range
  value (once per view name). So even if a future write path forgets to clamp, **the picture can no
  longer go out of range**.

### ⑦ Two-way linkage between the Orbits-Change chapter and the other chapters

- Forward: selecting a batch here syncs to the global selection set;
- Backward: selecting a satellite/batch elsewhere makes this chapter follow;
- A `climbSync` re-entry guard prevents the two sides from triggering each other in a loop.

### ⑧ README (zh + en) adjusted in sync (your request)

- The four badges (version / CSCN / Qianfan / MIT) now sit **on one evenly centred line, directly
  below the big CISTrack logo and directly above the language switch**;
- "Quick start" moved to just after "Project origin and credits";
- Removed the internal self-archive sections ("files not committed / rebuild chain / link rules") —
  they are not project documentation.

### ⑨ English review: 4 wording fixes + 4 items for your decision

All **255 UI strings** were reviewed one by one, plus a **structural alignment check** of the
documentation pairs (headings / version numbers / code fences / table rows / external links).
Overall the English passes; **4 fixes were applied directly** (`brandNote` missing its head noun,
`d_shot_disc` a word-for-word translation, `d_pend_sum` capitalisation, `notice_new_m` phrasing).
**Items you had already finalised were left untouched**; four before/after comparisons and four
bilingual multiple-choice questions are attached for your ruling. The full list is in the local doc
`维护文档/V1.9.5_英文核查_修正清单与待裁决项（2026-10-17）.md` (Chinese).

---

## [V1.9.4] — 2026-10-14

> A focused round after re-review: **new batches now enter the launch ledger automatically**
> (batch/group name, manufacturer, days in orbit for newly catalogued satellites), a full
> `maker` → `manufacturer` rename, and **publish-side redaction** (a new hard gate plus cleanup of
> existing text). Every change ships with a regression guard; `smoke` went from **752 → 756 PASS**.

### ① ★ New wiki batches enter the ledger automatically ("new satellites had no batch/group, manufacturer, or days in orbit")

**Root cause** (two layers):

1. The fetch script only kept rows whose COSPAR was **already in the ledger** → a new batch was
   dropped outright during the window where the catalog has satellites but the ledger has no
   metadata yet; and it stored only result/count, discarding date / rocket / site / payload / entry link.
2. The ledger is a hand-written constant, so a new batch stayed missing → the page showed
   "no ledger entry" → no batch name, no launch date → **days in orbit could not be computed**.

**Fix**:

- Fetch side: keep **ledger ∪ catalog** (`catalogPrefixes()`: COSPARs of satellites already on record);
  extract rows per `<td>` (each cell `{t, u}`, with `u` = wiki entry link);
  new `parseRow()` locates date/rocket/site/payload/result **by content**, not by column index
  (so it survives different column orders across year pages);
  `wiki_launches.json` gains `date / rocket / site / payload / u`.
- Build side: new `autoFillLedger()` fills missing batches from two sources:
  · **A wiki row** (measured for 26230: `2026-10-09` / `CZ-12Y10` / `HCSLS, LCC-2` / success / entry link);
  · **B TLE-name fallback**: when the wiki has no row yet, parse `GUOWANG 27 OBJECT B` → "低轨27组".
    Only whitelisted name shapes are accepted; anything else is **left unfilled** (an honest
    "no ledger entry" beats a guessed value).
- New `normBatchName()`: losslessly compresses the wiki payload into the hand-written style
  (`卫星互联网低轨27组 (9)` → `低轨27组`), otherwise `batchName()` cannot match and the English
  UI leaks Chinese (caught immediately by the i18n audit).

**Page side**: auto-filled rows show an "**自动补录** / auto" tag (honest distinction between
wiki-filled and human-reviewed); `_dayOnly` drops the fake `00:00`; an unknown target inclination
renders `-`; and a real bug was fixed — an empty date produced `dateMs = NaN`, which made the
descending sort undefined so the row vanished at random (26230 dropped off page 1 in testing);
it now falls back to the current time and sorts first deterministically.

**Measured** (real browser, the 26230 row):
Chinese `低轨27组 自动补录 | 长征十二号Y10 2026-230 | 2026-10-09 | 海商 LCC-2 | - | 7 颗 | 成功`;
English `LEO Group 27 auto | CZ-12Y10 2026-230 | 2026-10-09 | HCSLS, LCC-2 | - | 7 sats | Success`.

### ② Full `maker` → `manufacturer` rename

The English column label has long been `Manufacturer`, but identifiers, file names and CSS classes
still used the legacy `maker`. Now aligned throughout:

- Files: `mkmaker.mjs` → `mkmanufacturers.mjs`, `data/makers.json` → `data/manufacturers.json`;
- Identifiers: `MAKERS` / `makerOf` / `makerMap` / `makerCell` / `makerShortList` / `MAKER_ALIAS` /
  `MAKER_RAW` / `makerAliasSet` / `EN_MAKER` / `t_maker` → their `manufacturer*` counterparts;
- CSS: `td.maker` / `.maker-link` / `.maker-line` → `.manufacturer*`; data field `makers` → `manufacturers`.

**Visible copy (Chinese 「制造商」/ English "Manufacturer") was already correct and is unchanged**;
manufacturer data and links render exactly as before.

### ③ ★ Publish-side redaction (hard gate + cleanup)

Public files and release notes had drifted into **maintainer-local operational narrative** that is
irrelevant to anyone using the project. The fix is a **machine-enforceable gate**, not "remembering
next time":

- New `scripts/privacy_check.mjs`: scans every text file that lands in the repository and fails on a hit.
  Its rule is "**narrative that is only about the maintainer's own machine and is irrelevant to
  anyone using the project**". The concrete keyword list and exemptions live in that script's
  comments (they are not repeated here, so this document never reproduces them);
  it deliberately **does not** block generic words like "network unreachable", nor script file names
  that appear as historical facts.
- Wired twice: smoke executes it directly (so a local one-line change is caught immediately, with
  tolerance for a non-zero exit code), and the CI "offline self-check" step runs it too
  (in case someone pushes without running it locally).
- Cleaned ~60 existing spots: both workflows, `refresh.mjs`, `smoke.mjs`, `CHANGELOG.md/en.md`
  (V1.9.3 section), `README.md/en.md`, the V1.9.3 review checklist, the V1.9.0-1.9.2 merged checklist,
  and `scripts/e2e_include_offline.mjs`.
  **Kept**: script file names that are historical facts; and "user's original wording" style
  **product requirement** quotes (those are requirement provenance, not environment privacy).

### ④ Side investigation: can the wiki be fetched from the cloud?

Still no: MediaWiki `api.php` is blocked by Cloudflare exactly like the pages (measured 403 / challenge
page); a bot account is an **in-wiki editing** permission and does not solve cloud-side reading.
Wiki-side data continues to be maintained by a local task, as documented in the README and release notes.

### Tests

- smoke **756 PASS / 0 FAIL** (includes the redaction-scan assertion, auto-fill guards, and a
  batch-name translatability assertion)
- i18n **0 failures**
- visual **132 PASS / 0 FAIL**
- `scripts/privacy_check.mjs` **0 hits**

---

## [V1.9.3] — 2026-10-13

> A focused round of fixes after the user's re-review. Six UI/data changes plus root-cause fixes for
> two **silent failures** (the real cause of the two CI red lights, and the data pipeline's
> "succeeded but the data is old"). Every change ships with a regression guard;
> `smoke` went from **700 → 713 PASS**.

### ① Top-bar section tabs are now **right-aligned** (they used to hug CISTrack on the left)

The user: "the top-bar tabs are flush and follow CISTrack; the old version had the tabs' right edge at
the **standard spacing** from the CSCN/Qianfan switch buttons (i.e. the same consistent pixel distance
as the other buttons on the right), and the tab text on the same line as the button text."

| Item | Before | After |
|---|---|---|
| Position | first tab's left edge against CISTrack's right edge | **the whole row is flush right**: last tab's right edge → constellation segment's left edge |
| Criterion | `first tab left − CISTrack right < G` | **`tabs' right edge → constellation segment's left edge < G`** |
| Spacing | 22 px (hard-coded, **inconsistent** with the 12 px between buttons) | **12 px** (= the shared `G`) |
| Vertical | text baseline 1 px low | `line-height:32px` pinned → **same height** as the three buttons |

Measured (Edge headless, 1440 px): `gapTabsToSeg = gapSegToLang = gapLangToTheme = 12`,
and `tabCy === segCy === 30.5`.

### ② Intro paragraph's right edge now aligns with the rest of the column

The user: "the intro text box's right side is not aligned with the unified right edge of everything else
(the table above it and the search button below it)."

Root cause: `.hero-note` had `max-width:62ch` (a **character-count** limit, unrelated to the column's
pixel width) → on wide screens it was visibly shorter than `.hero-kv` / `.hero-search` in the same column.
Changed to `max-width:none` (fills the column). `.sec-lead`'s `82ch` was removed for the same reason.
Measured: `noteRight = kvRight = searchRight = 1386` (perfectly aligned).

### ③ Inclination distribution: the axis break is now a **fold mapping** (the two regions truly become one chart)

The user: "the upper bound of the LEO region should align directly with the lower edge of the GEO region…
the height in between is treated as non-existent, the two regions merged completely into one, instead of
the current state where they are drawn together but are still independent (zooming and panning causes the
page to jump between two regions of different nature; dragging up switches to the GEO chart rather than
genuinely drawing both in one chart)."

**The flaw in the old (V1.9.2) implementation**: the upper and lower bands each got height proportional to
their visible span → while zooming or panning the **relative heights of the two bands changed**, and
dragging across the seam produced a non-linear jump.

**New implementation**: a **fold mapping** `f(y)` (continuous, strictly monotonic):

```
f(y) = y                          , y ≤ 2000
f(y) = 2000 + (y − 35700)          , y ≥ 35700
(2000 < y < 35700 is collapsed to zero width; no data lives in that range)
```

Replacing the y axis with a linear axis over `f(y)` yields an **ordinary, continuous** chart — zooming and
panning are plain linear transforms on the folded axis, **a rigid body that cannot jump**.
The user's example holds automatically: `2000` and `35700` land on the **same pixel row** (measured: both
52.4), and `35800` sits 100 folded units above it.

Also changed:

- `brkYMap().Y()` **no longer returns null** (defined everywhere) — the curve is drawn straight across the break;
- `brkTicks()` now derives ticks from the **visible range** (LEO band dense as before, GEO band at `nTop`);
- `clampChartView()`'s vertical clamping now happens in **folded space** (the old version subtracted real
  altitudes, so the 33700-unit break consumed the whole span → the clamp was always misaligned — the other
  half of the "jumping" symptom);
- the break marker label now reads `2000~35700` (the folded interval).

### ④ Orbits-change chart: the y axis hugs the data range ("shrink the margins, magnify the differences")

The user: "shrink the top and bottom of the page to enlarge the view and show the differences between the
satellites of the selected satellite/batch/group."

**The old behavior** (measured on 26221, LEO-26 group): the y axis always started at **180**, while all
nine satellites sat between 1112 and 1137 km → the data occupied only **93%~96%** of the axis, and the
25 km spread was compressed into **2 pixels** — impossible to tell which satellite was higher.

**New behavior**: the lower bound moves up to just below the **data's lower edge**
(`mn − span×6% − 2`, never past the 180 floor), and the upper bound sits just above the **data maximum**
(floor: the visual height of `CLIMB_MIN_TOP`). The x axis got the same treatment: its right edge is now the
**data's last point** (extended to today only when the data is within 3 days of today) — the old version
always extended to today, wasting a large blank area for older batches.

### ⑤ Launch history: "Target inclination" / "Satellites" (column names + failure rows + `M/N`)

The user: "in the launch history, failed launches must show '-' for the design inclination (rename this to
'Target inclination') and the orbital elements (rename to 'Satellites'), and note that when not all launched
satellites belong to CSCN/Qianfan, write it as 'M/N' — e.g. if 3 satellites were launched and only 2 are
CSCN/Qianfan network or test satellites, write '2/3'."

| Case | Target inclination | Satellites |
|---|---|---|
| Normal, whole launch is this constellation | `50.0°` | `9` |
| Normal, carried other satellites | `50.0°` | **`1/2`** (M = this constellation, N = whole launch) |
| **Failure** | **`-`** | **`-`** |

The data layer (`pendingSummary` in `mkdata.mjs`) gained `tot` = the **total payload count** of that launch
(satcat's PAY count, **including** rideshares) — the page cannot derive this, so it must come from the data
layer. A real case exists: batch `24226` has `n=1 / tot=2` → renders `1/2`.
The section intro gained one explanatory sentence (one each in Chinese and English).

### ⑥ Very small magnitudes now use **standard scientific notation** (`1.23×10⁻⁵` instead of bare `1.23e-5`)

The user: "the BSTAR coefficients in the satellite table should use standard scientific notation
(10↑n…) to improve readability" (and asked to check the rest of the project for the same class of values,
**excluding things like 36500 km which "is not large"**).

New `fmtSci(v, n)`: splits `toExponential` into mantissa + **Unicode superscript** exponent (`⁻⁵`),
joined by `×10`. Applied to the **eccentricity** and **BSTAR** columns.

> **Why Unicode superscripts rather than `<sup>`**: the table is **exported as an image** (canvas redraw),
> and `<sup>` cannot be drawn on canvas → the export would lose the formatting. Superscript characters are
> plain text and render on both paths.
> Magnitude exemption: when `0.001 ≤ |v| < 100000` the plain-number path is used (the user explicitly said
> "36500 km is not large").

### ⑦ ★ The real cause of the two CI red lights: satellites with no history left the tri-state fields `undefined`

> Not on the requirements list — uncovered while investigating data-pipeline reliability.

**Symptom** (CI log): `A7: tri-state fields complete` reported "512 satellites: 400 in orbit / 105 raising" —
400+105 = 505 ≠ 512, **7 missing**; and `A7: working altitude is a 10 km step` also failed.

**Root cause**: `ORBIT_ST`'s rows are built **only from the history store**. A satellite with no history
points yet (just launched / just catalogued / history pool not yet covering it) is absent from rows → the old
code `continue`d → **`orb` / `wk` / `od` were all `undefined`** → both assertions failed.

**Why it can never be reproduced locally**: the local history store is complete (57 shards / 64495 records
covering 488 satellites), whereas CI **runs refresh first every time** — the newly catalogued satellites had
no history points at that moment. Another instance of "a test that has only ever run locally counts as never run".

**★ The CI log contained a red herring**: the `wk` output contained `950`, which looked like a "non-10-step"
suspect — but 950 is legitimate (`950 % 10 === 0`); the actual failure was that **satellites missing the field
never enter that Set at all**, which is invisible in the log. Both assertions' diagnostics were changed to
"**list the offending satellites**" instead of "the first 8 step values".

**Fix** (`mkdata.mjs`): a satellite with no history points → classified as **raising** (`orb=1`; conservative
rather than falsely claiming "in orbit"); `wk` is taken from **other members of the same batch** (same batch,
same altitude), falling back to 400; `od` left empty. **And always snapped to a 10 km step.**
**Reproduction**: temporarily removing one history shard to simulate CI → 8 satellites missing fields before
the fix, **0 missing / 0 off-step** after.

### ⑧ ★ Silent failures in the data pipeline: `refresh.mjs` had no timeout, and "success with stale data"

> The user: "my computer does run the task at 12:00/0:00, but I still get failure emails from GitHub, and the
> update time shown on the page is not the latest — there must be a serious problem with the data-update flow."

**Two real problems** (both in `refresh.mjs`):

1. **No timeout on network requests**: a bare `fetch()` hung for **over 12 minutes** (measured at stage S2),
   and S1~S5 each make several attempts across multiple name queries → in the worst case the task is killed
   while `git.lock` is still held (blocking `update_wiki.bat`).
   → Added a hard **20 s** timeout (`AbortSignal.timeout`); the whole run drops from "tens of minutes" to "tens of seconds".
2. **Silent success when no new data arrives**: when S1~S5 all fail, each step merely prints "0 new" and the
   process **exits 0** → downstream still runs mkdata/build/**push** → the task log says `updated and pushed`
   while the repository snapshot grows **older every day**, and the "TLE updated" line on the page stays at an
   old epoch — directly contradicting "the task succeeded".
   → Added a **data-freshness gate**: if the newest epoch is **more than 3 days** old → non-zero exit code **5**
   (distinct from code 4 for missing satcat), so the task/CI fails visibly.
   > The criterion uses the "newest epoch" rather than "did we fetch anything this round": upstream may
   > legitimately not update a given satellite for days, so "did we fetch anything" would produce false
   > positives; whereas "the newest epoch is old" can only mean a broken link or upstream stopped — both
   > worth reporting.
   > ⚠️ The two e2e scripts use stub data (fake epochs) → they must be exempted
   > (`CISTRACK_SKIP_STALE_CHECK`), because `exitCode` is **process-wide** and would pollute the test process.

**Measured** (2026-10-13, local): `ct_hulianwang.tle` newest epoch 10-09 18:21 (**3.41 days** behind),
`ct_qianfan.tle` 10-09 07:49 (**3.85 days** behind) → the gate fires correctly.
**CI data is healthy** (same-day CI log: `qf S5 OMM → filled 202, 0 failures`) → no false trigger.

### ⑨ A **concurrent-overwrite** hazard in the release chain (actually hit during this session)

The local scheduled task (`update_tle.bat`, 12:00/00:00) runs `build_release.mjs`, which copies
`refresh.mjs` / `app.js` / `smoke.mjs` etc. **SRC → REPO**. Editing REPO sources **while the task is
running** means the edits get overwritten by SRC's older copies — this session actually lost changes to
`refresh.mjs`, `template.html` and `smoke.mjs`.

**Workaround**: run `node sync_src.mjs` (a one-way REPO → SRC alignment) right after editing to level both
sides; `sync_src.mjs` prints "aligned N / overwritten M / created K" — check that `overwritten` is 0.

### ⑩ ★ The gate became the fault: the freshness check used the wrong epoch unit (caught by a real CI run)

After fixing ⑦ and ⑧ I manually triggered CI to verify — and a run whose **data was perfectly healthy**
(`gw 251 sats / qf S5 filled 19, 0 failures`) was judged "stale data" by the gate I had just added,
failing with `exitCode 5`:

```
❌ Data-freshness gate: newest TLE epoch is 20739.2 days behind
```

**Root cause**: the `epoch` field in `parseTLE` is the **raw TLE value** (`YYDDD.DDDDDDDD`, e.g.
`26282.76` = day 282.76 of 2026) — **not milliseconds**. The gate computed
`(Date.now() − 262.76) / 86400000` → **20739 days**.
(The name `epoch` sounds like milliseconds — before using someone else's variable you must verify its
**unit and type**.)

**Why local "verification" missed it** (this part matters more than the bug itself):
I had written a **second, separate parser** inside the verification script (correctly splitting YY/DDD),
which printed "3.41 days behind ✓" — **I verified the implementation in my head, not the one in the code**.

**Fix**:
- `tleEpochMs()` moved into `scripts/omm.mjs` (a pure-function module that **tests can import directly**),
  and `parseTLE` now stores an `epochMs` field;
- `omm.mjs --selftest` gained epoch checks: 5 parse assertions (including the 57/56 century boundary)
  + a **506-line real-TLE sample** (all must fall inside a five-year window);
- `smoke` gained 4 guards that **import the real function and assert on it** (no more source-regex matching).

CI re-verification (run 38349678820): `freshness: newest epoch 0.22 days behind (limit 3) ✓`,
`epoch self-test = 5 checks, 0 failures`, `real-TLE sample = 513 lines, 0 outside the window`.

### ⑪ ★ 6-digit catalogue-number compatibility audit (requested by the user; found three real gaps)

> The user: "because you have had several major incidents caused by the 5-digit numbering system, you must
> now do a compatibility audit to prevent it from happening again."

Background: CelesTrak has assigned **6-digit** numbers (100000+) to newly catalogued objects since
**2026-07-11**, while the classic TLE format's catalogue-number field holds only **5 columns** → such objects
appear in `.tle` text as "the last 5 digits of the real number" (`100203` → `00203`). The build side has
always restored them via the `omm_norad.json` map, but the page's **"fetch fresh TLE at runtime"** path was
missing two pieces — meaning **online visitors saw fewer satellites than offline ones (including every GEO
satellite)**, a gap that only appears when online.

**Method**: instrumented the **real artifact** with a probe, fed the real `.tle` text into `parseTleText`
and simulated `applyFresh`.

| # | Gap | Evidence | Fix |
|---|---|---|---|
| ① | **36 6-digit satellites had mismatched ids** (incl. all GEO) | Before: after `applyFresh` gw went **244→235** and ids changed `100203`→`203`, no longer matching the built-in data | `ommMap` injected into `satdata` (works offline too) + `parseTleText` now uses `tleRealId()` (pad to 5 before lookup); cache key `v1→v2` |
| ② | **Name filter dropped 14 satellites** (`NAME_OK` too narrow) | Real `.tle`: passed the filter **235/244** (gw), **257/262** (qf) | `NAME_OK` now recognises the name forms from the build side's `INCLUDE` allowlist → measured **244/244, 262/262**, exactly matching satdata |
| ③ | **S4 backup source compared placeholder vs real number** (never equal) | `parseInt('00203')` = 203 ≠ `o.norad` = 100203 | Restore through `OMM_IDS` first (the same convention as the history archiving block) |

The names dropped by ② (all of them included by name on the build side via the allowlist):

```
CX-20A/B/C (CSCN inclined-orbit test sats, group 02), CX-19, CX-26, OBJECT B
HULIANWAN GAOGUI-01/02/03   ← note the single G! These three are every GEO satellite
KL-ALPHA A/B, KL-BETA A/B (early Qianfan test satellites)
DTC TEST OBJECT A (2026-128A = Qianfan DTC-01)
```

**After the fix**: `applyFresh` leaves `gw 244 → 244` and 6-digit satellites `36 → 36` (unchanged).

**9 new guards** (smoke 713 → **722**), two of which measure **real data**:
the number of satellites passing `NAME_OK` on the real `.tle` **must equal** satdata's count;
and every NORAD named in the `INCLUDE` allowlist must really be in satdata.

**An honest note on ③** (so "normal" is not misread as "broken"): S4 has always printed "filled 0" in CI,
which looks broken, but that is by design — 6-digit objects are explicitly handed to S5, and the remaining
"missing" ones are mostly absent upstream. Measured: `S3 missing 208→filled 60; S4 missing 148→filled 0;
S5 missing 193→filled 193, 0 failures` (the main path covers everything). This is now documented in a code
comment so it will not be mistaken for a regression again.

### Tests

smoke **700 → 722 PASS / 0 FAIL** (+22 V1.9.3 guards: end-of-curve value drawn once, audit prefix-skip,
top-bar right alignment and vertical centering, intro right edge, break folding (coincidence/continuity/
monotonicity/inverse), climb y-axis hugging, `fmtSci` output and both column wirings, launch-history column
names / failure rows / `M/N`, the A7 fallback, refresh hard timeout, the freshness gate and its e2e
exemption, **4 epoch-unit guards**, **5 6-digit compatibility guards**);
i18n **0 failures** (key union 228); visual **132 PASS / 0 FAIL**.

Also fixed 3 assertions that had **expired with the data** (all "look like a regression but are not"):
① the 6-digit batch shard list was hard-coded as `['26176','26187',…]`, and this round's refresh compaction
merged `26221` into another shard → now asserts "at least half of the batches containing 6-digit satellites
have shards";
② the section-04 y axis was hard-coded as `y0 === 180` → now asserts "the lower bound hugs the data's lower
edge (gap < 20% of the span)";
③ the `rr` (raising rate) missing-count threshold of 15 was too tight — fallback satellites (no history)
cannot have a slope by construction → now asserts "satellites with history must have rr, and those without
must belong to recent batches".

---

## [V1.9.2] — 2026-10-11

> Completes the **two unmet items** found while auditing the V1.9.1 task list against the build
> (see `V1.9.1_任务清单逐条核对表.md`). That audit verified each item independently through
> source-symbol checks + release-artifact checks + full data-layer statistics + all three test gates;
> 83 of 88 verdict rows passed, and the misses are exactly the two below.

### A7 "In-orbit status" column completed to three states (was only two)

The original implementation had only "In orbit / Re-entered", while the task list specifies
**three** states: In orbit / **Raising** / Re-entered.

**Data layer (new `ORBIT_ST` in `mkdata.mjs`)**:

| State | Criterion | Display |
|---|---|---|
| In orbit | 30-day **net drift** ≤ 1 km (LEO) / 3 km (GEO), **and** within ±30 km of the batch working altitude | `在轨（~2024-12-20，1100km）`; GEO shows `GEO` |
| Raising | still drifting, **or** clearly short of the batch working altitude | `变轨中（~2026-10-08，1043km (+3.16km/天)）` |

**The criterion was calibrated against real data, and went through three versions**
(all recorded in code comments so nobody "optimizes" them back):

1. **Least-squares slope** (same as the climb chapter's `climbRates`) → **failed**: batch 26108's
   altitude oscillates between 1071.4 ↔ 1086.5 (4~5 round trips in 14 days while the net change is
   only 0.04 km), so the slope was skewed to −1.3 km/day → all 18 satellites of that batch that had
   **already arrived** were classified as "Raising".
2. **Net drift** (median of the last third minus median of the first third) → immune to the
   sawtooth; 26108 fully corrected.
3. **Batch working altitude switched to the "highest cluster"**: in batch 24185 (Polar-02 group),
   only 4 of 18 satellites reached 1071 km — the other 14 sit at 800~974 km for the long run
   (e.g. 61552 has stayed at 846.9 since its 2024-11 launch). Taking the batch median would give
   880 km, which in turn misclassified those 4 **arrived** satellites as Raising. Clustering by
   descending altitude (break when the adjacent gap > 30 km) and taking the median of the top
   cluster gives **1070 km** ✓ (consistent with sibling batches).

Other conventions: working altitude rounded to **10 km** (Q26a), same altitude within a batch,
GEO written as `GEO` rather than a number (Q46, criterion = semi-major axis ≥ 42000 km, equivalent
to a period of ≈1436 min); "date entered the working orbit" is computed **only for the in-orbit
state** (a raising satellite passes through the working band on its way up — that is a pass-through,
not an arrival).

**Page layer**: new yellow `.st-raising` state; the climb-rate fragment is **colored on its own**
(green for positive / yellow for negative / gray for zero, and does not inherit the cell's yellow);
5 new i18n keys in each language.

**Hit a pitfall it had already fallen into once**: both `unpackSat()` and `build()` **rebuild
objects from a whitelist** (copying only the fields they list), so the new `orb/wk/od/rr` were
silently dropped again and the page degraded to `在轨（~—，undefinedkm）`. This time both places
now share one `EXTRA` field table, and a **regression guard** was added
(criterion: any field present in satdata must be carried through both places).

### Bilingual CHANGELOG (Q37 / Q38 / Q45)

New `CHANGELOG.en.md` (full translation, 1604 lines / 172 KB), same pattern as `README.en.md`,
with a language switch at the top. `CHANGELOG.en.md` was also wired into `sync_src.mjs` and
`build_release.mjs` (otherwise the source-alignment round trip would drop it).

### ★ "Orbits Change" chart rebuilt + seamless axis break + reclustered circles

**(1) Orbits Change chart (section 04) rebuilt** (user request: "follow График 01 on findrassvet.ru"):

| Item | Before | After |
|---|---|---|
| X axis | auto-fit to the data range | **left end = that batch's launch date, right end ≥ today** (launch → today) |
| Y axis | axis break (GEO floated in the upper segment) | **180 ~ data max × 1.04**, locked vertically (only the X axis zooms) |
| Colors | one color per batch | **an independent color per satellite** |
| Labels | NORAD numbers | **satellite names** (Chinese names in the Chinese UI, English names in the English UI), with **overlap-avoiding layout**; the right margin **widens dynamically** based on how many labels need to fit |

**(2) Axis break is now "seamless"**: the old implementation pinned the GEO segment to a fixed 70%
and floated it above the chart, so the two segments zoomed and panned independently. The new
`brkYMap(v, PT, ph)` allocates the upper and lower segments **in proportion to the visible range**,
so both share one transform — they **zoom and pan together, seamlessly**, treating the chart as
"the top of GEO directly connected to the bottom of the GEO display area, with the intermediate
altitude range not existing" (user's words). Section 04 uses the `nobrk` path (it frames by
180 ~ data max and does not need a break).

**(3) Clustering circles re-divided**: the user reported the circles were "**too thin and
overlapping each other**". The merge criterion moved from **screen space** (the old `rxRaw`,
now deleted) to a **data-space distinguishability threshold** (`CL_MERGE_Y = 80` km /
`CL_MERGE_X = 0.8°` — merge what cannot be told apart); line width **1.2 → 1.7**; labels got an
overlap-avoiding layout.

### ★ Network progress: time-range switch (All / This year / Last 3 months)

Three ranges added **to the right of the constellation row, on the same line** (a separate,
isomorphic `.ctl` aligned via `.controls{align-items:flex-end}`):

| Range | X-axis span | Cumulative baseline | Nodes |
|---|---|---|---|
| **All** | data start ~ today | 0 (full total) | **January 1 of every year** (sitting on the year's guide line) + today at the end |
| **This year** | **Jan 1 00:00 local of the current year** ~ today | the full total at the window start; the curve accumulates from 0 | **the 1st of every month** + today |
| **Last 3 months** | **the day three months before today** ~ today | same as above | **every 7 days from the initial date** + today |

Three design principles (so nothing existing breaks):

1. **`weeks` untouched** (the weekly sampling table is the base data);
2. **`delta` / `netShowInfoAt` untouched** — nodes carry only a **week index**
   (`netSpanNodes()` returns `{ms, wi, kind}`), so hitting the info window still reads the
   **full table** ⇒ the user's requirement that "**the info window still shows the full total**"
   is met at **zero cost**;
3. only the **curve's Y baseline** (= the full total before the window start) and the **X-axis
   span** change with the range.

Also: switching ranges goes through the **same** `cvSwap` non-linear transition as every other
button (button highlight responds immediately); X-axis tick **anchors follow the range**
(all → old convention; year → the 1st of each month; qtr → every stepD days from the window
start); `clampNetView` bounds follow the range; the range joined the preference system
(`PREF_DEF` / this section's "default settings" / snapshot / restore).

### ★ Two extra segments in the export bar + three watermark color rules

**Export bottom bar** (emitted only by section 05 Network progress; text follows the on-screen
range in real time):

```
… | 选择纵轴量 发射量（累计） | 选择时间段 全部
```

**Three watermark color rules** (`shotConstelState(view)` returns `{both, key}`):

| Case | Wordmark | Constellation name |
|---|---|---|
| Guowang only | **red** CISTrack | **星网** |
| Qianfan only | **blue** (same for SpaceSail) | **千帆** |
| Both selected | **left half red, right half blue, each half the length** | **星网+千帆** / `CSCN + SpaceSail` |

> **A real bug was fixed in the half-half path**: the right half used to be drawn with
> `fillText(BRAND, x + half - brandW, cy)`, shifting the whole text left by about half the
> wordmark width → the clip window showed blank → on screen **only the red "CIST" remained and
> the blue "rack" disappeared entirely**. The fix draws **both halves at the same x**, each taking
> its half via complementary clips. A source-level guard now catches this (earlier than a pixel
> assertion would).

### ★ End-of-curve value no longer drawn twice (user: "just show the last point once")

A user screenshot showed the **same number appearing twice, side by side** at the end of the curve.
The cause turned out to be **two independent draws** stacked on top of each other:

| # | Where | Form |
|---|---|---|
| ① | the curve segment's "end value" | right-aligned, just left of the curve's last point |
| ② | the end "today/latest" node label (`J.last`) | **bold**, left-aligned, with a halo ring |

Their x coordinates differ by only ~20 px, so on screen the end shows two identical numbers
(measured in Edge: with Qianfan only, `244` is drawn at `x=1306.3 align=right` **and** at
`x=1284.2 align=left bold`).

**Fix**: remove ①; the **end node label** takes over entirely — it is exactly what the user called
"the node showing today's latest count", has a more prominent form (bold + halo ring), and the
curve's last point and the end node share the same coordinate, so the value is never lost.

**A second layer of duplication was also found** (another cause of the same symptom):
`netPickLabels()` used to drop a label only when **positions overlapped**, but under the "This year"
range the Sep-30 monthly node and the "today" end node **happen to hold the same cumulative value**
(nothing was launched after that month) → two labels side by side showing the same number
(measured: `87` at x=802.3 and `87` at x=833.4, 31 px apart — under the 28 px threshold).
New rule: **any other node with the same value as the end node and nearby (±80 px / ±20 px) drops
its label** (the dot is still drawn) — the end node is the reference form, so it is kept.

**Guards** (two, to prevent regression):
- source: the right-aligned "end value" draw must never reappear (in case someone "fixes it back");
- runtime: for all three ranges × {CSCN only / Qianfan only / both}, within ±80 px / ±20 px of the
  end label's anchor, that same number may be drawn **only once** (the `netTexts()` probe records
  the text and coordinates of every `fillText` call).
  ⚠️ The criterion must be restricted to "near the end" — different nodes **coincidentally holding
  the same value is normal data** (the year range actually has two monthly nodes both at 87,
  480 px apart); that is not duplicated display.

### ★ A false-positive source in the reference audit: suffixed temp dirs were not skipped

Running `node scripts/audit_refs.mjs` locally reported:

```
✗ referenced but missing on disk:
    assets/background.js-<hash>.js ← referenced by .edgecdp-<ts>/…/service-worker-loader.js
```

It looked like a real problem, but the audit had **walked into the headless browser's user-data
directories** (the `.edgecdp-<timestamp>` dirs created by `visual.mjs` and friends). Root cause:
`SKIP_DIR` is an **exact-name match**, and these dir names carry a timestamp suffix → no match →
they were scanned (180 of the 213 "source files" came from these junk dirs).

**Why this had to be fixed**: a false positive is more dangerous than a miss — it is red locally
and green in CI (CI only checks out the repo and has none of these dirs), so over time nobody reads
the audit output carefully and real problems get drowned out.

Fix: added **prefix-based** skipping (`.edgecdp` / `.edgeprof` / `.cdp-` / `junk-`) and switched
`walk()` to the combined predicate. After the fix the scan went from 213 → **33 source files** and
the verdict changed from "1 class of problem found" to "passed".
> The same trap again: the `.edgecdp/` exact match in `.gitignore` also missed suffixed dirs and was
> changed to `.edgecdp*/` earlier. This time a smoke guard was added too (asserting the prefix-based
> skip exists and that the old exact-match form must not come back).

### Tests

smoke **650 → 668 → 696 → 698 → 699 PASS / 0 FAIL** (+18 A7 guards; +28 V1.9.2 guards: the three windows,
baselines and node rhythm, full-total info window, node hit priority, auto view, the two export-bar
segments, the three watermark rules, the half-half drawing position, non-overlapping labels and
left-edge flipping, non-intersecting clusters, and the axis-break enable condition; +2 end-value
guards; +1 audit guard);
i18n **0 failures** (key union 228); visual **128 → 132 PASS / 0 FAIL**.

Also fixed two **assertions that had expired with the data/environment**:
① A9's "three altitude bands at 50°" was hard-coded as `=== 3`, but the satellites of "LEO-25
group" (26213) launched in 2026-10 sit at 935 km (still raising) → it became 4 bands and failed.
Changed to "band count ≥ 3 and strictly increasing" (keeps the original intent of "adjacent
clusters must not be merged").
② visual's "no high-saturation pixels outside the plot area" threshold was 40; measurements showed
the 40~70 band is **grid-line / tick-label anti-aliasing** (light theme yields
`rgb 128/170/170 sat=42`, `128/128/191 sat=63`) while real data colors are `sat≥120` → the
threshold was corrected to **70**, and warnings now carry an `[edge]` tag + `sat=` + `rgb=` for
quick localization next time.
The same batch also fixed an **anti-aliasing spill**: in the `climb` section the guide line
(1 px wide, spilling ~1.5 px to either side) landed on the scan band
(measured `s0[right]@1220 sat=137 rgb=85/222/131`) → the guide line now runs from
`PL+pw+6 ~ PL+pw+10` (leaving a gap).

---

## [V1.9.1] — 2026-10-10

> Rounds 11 ~ 14 (merged release). The task list and decisions (Q1–Q48, A1–A20) are in
> `V1.9.1版本任务清单（第十一轮）.md`; the per-version technical details are in the local `PROCESS.md` (not committed to the repository).
>
> Theme of this release: **section reorder and rename · major search expansion · full GEO support · history database completion · brand animation rework · a batch of performance and correctness root-cause fixes**.

**Section numbering change (important)**: 04/05 are swapped — **04 = Orbits Change Status** (formerly "Raising Status"), **05 = Network progress**;
this also fixes two **long-standing numbering bugs** (the satellite table was actually 06 and the launch history was actually 07, while old versions kept writing 04/05).

| Group | Content |
|---|---|
| **A15** | Section exchange + rename (22 touch points verified one by one), pill order and labels synchronized, i18n three-part key set complete |
| **A13** | Table-header wording fixes (including 2 real bugs) |
| **A19** | **Three parallel search pools**: main pool + `dead` (re-entered) + `pend` (not yet cataloged); click-to-jump + the corresponding tooltip; also fixes "**multi-word search completely broken**" |
| **A3** | Selection-hint pill made tri-state (all selected / selected / **currently no TLE data** · inverted); fixes `d_sel_all` being overwritten by a same-named key |
| **#3/#4** | Orbits Change chapter **colored multi-line** (one color per satellite using the **golden angle 137.508°** — even distribution would recolor everything every time a satellite is added) + selected highlight, others dimmed (Q5) |
| **A7 / A10 / A11 / A17** | "In-orbit status" column (In orbit / Re-entered / GEO); full spec for re-entered rows (gray frame, excluded from linkage, searchable); re-entry rules for launch records + popup X/T counts; 6-digit catalog-number satellites **collection path fixed, now properly ingested** |
| **A1** | Info window gains an "orbital altitude change" row (shows `—` when it is the first historical point) |
| **A6 + Q19** | Orbits Change chapter selector rework (launch time descending, single satellites included, latest selected by default) + chapter 03 batch dropdown descending, top entry always "all satellites" |
| **A8** | Network progress: the test-satellite phase uses **the constellation's own color dashed line** (Q23=A, cut by time: solid line for everything after 2024-02-29) |
| **A9** | Inclination Distribution's **dashed cluster circles** (binning 1°×25km, members ≥8, merge overlapping clusters, fade out on zoom, not part of hit-testing); radius takes 2.2σ as a compromise with visibility |
| **A18 + Q41/Q43** | Full GEO support: chapters 03/04 use a **broken axis** (the broken region 2000~35750 hidden, upper segment 35750~35850, top/bottom 70:30, **values inside the broken region return null so the curve breaks naturally**); chapter 02's 3D globe cannot use a broken axis → switched to **segmented exaggeration** (LEO ≤8000km still 2.4×, gentle slope in the high-orbit segment, GEO brought in from 14.47 Earth radii to **2.2**) |
| **A12** | Both charts gain a y=100 km atmosphere boundary line (unconditional in 03, only in semi-major-axis mode in 04) |
| **A20** | Orbits Change chapter hover no longer pops the info window; changed to "**show and pin on click only**", consistent with chapter 05 |
| **#9** | The two lines of text on the loading page are **hard-coded into the HTML** (text is present on the first frame, no longer just a ring) |
| **#2 / #10 / A5** | **Site-wide frosted glass unified** (9 parameter sets → two `:root` variables, 18 paired sites); transitions **disabled site-wide** during switching (root-causes "CSCN/SpaceSail button text briefly disappearing" — the background and text colors interpolated toward each other and collided on the same gray); the frosted-glass exception list expanded from 1 to 17 |
| **#6** | Horizontal-axis **time tick ladder**: chapters 04/05 consolidated to a single `tickStepDays()`; fixes "deep zoom → step falls back to 1825 days → **ticks vanish entirely**"; axis start = the earliest launch record (early test satellites kept on the chart, distinguished with dashed lines) |
| **#7** | Transition generalized `chartSwap → cvSwap(cvId, apply)`: chapter 05's two controls + chapter 04's one control are all wired into the same curve |
| **#8 + Q6** | Fullscreen geometry and redraw: `drawClimb` added to 3 paths (previously **never** redrawn in fullscreen → the old bitmap was stretched, 1.43× on real horizontal devices); the Orbits Change chapter's `chart-wrap` under border-box **subtracted climb-bar twice** → geometry aligned; button-column bottom margin gains a touch safe-area value |
| **A2 + A4** | Orbits Change chapter export bottom bar **six segments** (picked node / latest node / ±Δ semi-major axis + interval days; the 6th segment colored green for positive, yellow for negative, gray for 0), new session state `climbPickNode`; export bottom bar **all rows unified to white** |
| **A14** | The English completeness audit extended to the **export path** — caught 3 real issues: ① **the export image bottom bar's constellation name was always Chinese** (`shot_gw/shot_qf` defined since V1.9.0 but **never referenced**) ② 3 inline Chinese strings ③ two historical suspicions confirmed correct and locked down with guards |
| **A16** | README **language switching**: `README.md` (Chinese default) + `README.en.md` (full English counterpart), cross-linked at the top; an **animated wordmark** added at the top |
| **1.5** | **History backfill**: the criterion corrected from "has history" to "**has *enough* history**" (a single point cannot form a line) → 33 satellites matched; also fixes **two silent failures** (see below); coverage 506/506 |
| **Top bar** | Desktop **restores section text labels** (new order, new names, excluding the relocated TLE update time); not shown on touch; auto-collapses when space runs out |
| **Brand animation** | Sweep reworked (see below) |

### "Silent failures" and correctness issues fixed in this release (all of the **no-error, looks-fine** kind)

1. **`data/satcat.csv` missing → three features silently zeroed out** (re-entered flag / ledger decrement / search pool top-up), while the build still succeeded.
   Now: mkdata emits a prominent warning + writes `satcatOk` into the output + **the build refuses to produce artifacts when satcat is missing** + refresh uses `exitCode=4` when there is no old copy.
2. **`scripts/climb.mjs` never committed** (the repository "referenced a file that does not exist in its own tests" for a long time) → restored into the repository + new **reference-integrity health check** `scripts/audit_refs.mjs` (hooked into CI).
3. **Newline platform differences**: `core.autocrlf` made 4 assertions that depend on `\n` **fail locally but pass on CI** → `.gitattributes` (`eol=lf`) + assertions no longer depend on newlines.
4. **1.4-D's "in-orbit status" column never took effect**: `build()` did not carry `st/dt`, and `unpackSat()` rebuilt the object by whitelist and dropped them again → fixed both + strengthened the assertion.
5. **Multi-word search completely broken**: it matched the "last word" instead of "all words" → changed to judge by **number of matched words**.
6. **wiki.json / history/ regressed by stale artifacts** (the former 257/253 → 248/244; the latter 8154 → 8124 points and even deleted a shard) → two "no-regression" guards.
7. **`history/` and `data/history` diverged bidirectionally**: development happened inside the git repository, while the local scheduled task's SRC pointed at an early standalone directory → it would **push the old source back into the repository** (at the time it narrowly avoided doing so thanks to a TDZ crash). Response: new `sync_src.mjs` performs **one-way source alignment** (repository → SRC, run before the scheduled task starts), eliminating this by construction.
8. **Two Space-Track issues**: ① a credential field-name mismatch (`SEC.username` vs the `user` returned by `loadCreds()`) meant login had actually always been failing, yet "has cookie" reported success → now **must actually query once after login**; ② **Alpha-5 catalog numbers** (`A0211` = 100211) were not recognized by the line-start regex → data for 6-digit-number satellites was silently discarded (92 KB sitting in cache yet "0 records parsed").

### Brand wordmark animation rework (user: "the switch isn't smooth, there's a stutter in the middle, and it isn't long enough")

Three causes stacked on top of each other, each confirmed by measurement:

| # | Root cause | Fix |
|---|---|---|
| ① | The easing's final segment is too steep — it borrowed `--ease-slow-fast`, whose **terminal slope is as high as 27** (the last 2% covers 54% of the distance) | Made it its own `--ease-brand: cubic-bezier(.4,0,.2,1)` (**terminal slope 0**) |
| ② | Duration too short — it used `--anim-half` (260ms, which is only the **half-way point** of a four-way animation) | Made it its own `--brand-sweep: 520ms` |
| ③ | **Strokes momentarily thinned** — the old implementation wrote `color:transparent` during the sweep, while the stroke is `-webkit-text-stroke: .85px currentColor` → the stroke went transparent too | Changed to **two complete glyph layers + a `clip-path` reveal** (measured: the old implementation dropped edge pixels by **−264** during the sweep, the new one gained **+174**, a 438-pixel difference; the new implementation's sweep frame and its static frame have **pixel-identical** bounding boxes) |

### Performance root-cause fixes (the **real** source of the stutter)

Real-browser measurement: the half-way point of a constellation switch (`ANIM.half = 260ms`) had one **120ms long task**, and the brand sweep (the clip-path transition is **main-thread** driven — adding `will-change` does not help, the compositor path was ruled out by measurement) froze for exactly 133ms at the **25%** mark.

The culprit is `measureRowUnits`: it renders **all 262 rows** into an offscreen table and measures the height row by row (a single `renderTable` takes 43~52ms; called twice during the half-way = 95ms).
But the CSS fact is that `.ltable td` is **all nowrap**, and only `.ltable td.maker` can wrap → **row height is purely a function of the manufacturer cell**, and manufacturers are attached **per batch** → **rows in the same batch necessarily have the same height**.
So **measure just one row per batch** (≤59 rows), and change the cache signature from `getBoundingClientRect().width` (the whole page is shifting during a constellation switch, dragging transforms in → the cache never hits) to `clientWidth`.

**Measured comparison**:

| Metric | Before fix | After fix |
|---|---|---|
| Half-way long task | **120 ms** | **0** |
| Max frame interval | 133 ms | **17 ~ 33 ms** |
| Sweep progress | froze 133ms at 25% | **advances every frame** |
| `renderTable` | 42.6 + 51.9 ms | **8.4 ms × 2** |
| `rebuild` / `afterConstelSwap` | 59 / 55 ms | **17.4 / 12.7 ms** |

### Other

- **README**: removed outdated page screenshots (those three images are incomplete and no longer of reference value); badges changed to **one line**; version bumped to 1.9.1;
  added an **animated wordmark** `assets/cistrack-logo.gif` at the top (1581×292 / 50fps / 4.88s,
  **first and last frames identical pixel for pixel** so the loop is seamless — generated deterministically frame by frame with the same parameters as the page, not a screen recording).
- **Repository slimming (Q1)**: deleted the 8 old snapshots at the repository root (`CISTrack_v1.5.2 … v1.8.0.html`, about 5 MB);
  from V1.9.1 onward only "current version + previous version" are kept; older versions live in `git log` or the local `archive/` baseline.
- **Repository description and topics** synchronized: no longer calls itself "purely offline" (the page goes online to fetch TLEs, loads history shards on demand, and reads wiki.json),
  the `offline` tag removed; the CSCN / SpaceSail badges are now clickable, pointing to the corresponding encyclopedia entries.

### Tests

smoke **413 → 640 PASS / 0 FAIL**; i18n **0 failures** (10 new A14 guards); visual **128 / 0**;
plus some one-off real-browser probes: top-bar labels **16/0**, brand sweep **4/0**, performance **long tasks 0**.

---

## [V1.9.0] — 2026-10-09

> Round 10, 19 requirements (R1–R19) + the historical orbit database (the core addition of this release).
> New chapter "**05 Orbits Change Status**": each satellite's **semi-major-axis climb curve** from insertion to working orbit, backed by a self-built historical orbit database.

| # | Requirement | Delivery |
|---|------|------|
| R1–R16 | Main body of the round-10 list | Section renumbering (05/06/07), assorted visual and interaction fixes, all accepted via smoke (358 PASS) and real-browser measurement (124 PASS / 0 FAIL) |
| R17 | **New chapter "Orbits Change Status"** | Standalone chapter, pill button "Climb/C". The data source references findrassvet.ru's ТЕМП algorithm: **±2-day window least squares** to derive the climb rate (the fit must **center x** — squaring raw millisecond timestamps directly causes catastrophic cancellation: uncentered error 2.9e-9 → 1.7e-16 after centering); vertical axis 0~2000 km **clamped at the top**; altitude above ground = Brouwer semi-major axis − 6378.137; grouped by batch; the exported image carries the climb-rate column; two-way linkage with the global selection. Only the Brouwer semi-major axis is stored (one model, one value) |
| R18 | **Self-built historical orbit database** | Two-tier architecture: **source DB** `data/history/<batch>.json` (v1 triples `[norad, ms, semi-major axis]`, `refresh.mjs` appends automatically every day) → **published DB** `history/` (v2 compact encoding + per-batch sharding + index, packed by `mkdata.mjs`). The page loads **on demand**: the first screen fetches only the index, fetching a shard only when a batch is selected, LRU caching 24 shards; three-level degradation (external shard → built-in 60-day slim fallback → "no historical data"). **Capacity re-estimated for the tens-of-thousands to hundreds-of-thousands scale**: change-driven sampling (dense during the climb phase, 1~2 points per month during the stable phase and at most 24 points per satellite) + v2 encoding (norad stored once, days relativized, about 10 bytes per point) → **100k satellites × 20 years ≈ 42 MB** (naive approach 2.26 GB, 54× smaller) |
| R19 | **Historical data source delivered** | Data comes from **Space-Track's GP history element set** (gp_history). The **command-line login path** was proven end-to-end (measured) (`ajaxauth/login` + session cookie — the earlier conclusion that "command-line always 401" was because login was not performed); full history elements from 2023 to now for 436 cataloged satellites have been downsampled by day (≤2 records/day) into the source DB. Key points of the command-line bulk-fetch script: batched queries (10 satellites/request + windowing by year), `format=tle` (160 bytes each, 10× lighter than OMM JSON), raw responses cached to disk for resumable runs, 3 s request interval for quota protection |

**Pitfalls from this round (to avoid repeating)**

- **Three TLE column-offset errors** (each once caused "not a single byte could be stored" or an entire batch being flagged as duplicates): COSPAR takes `slice(9,14)` (taking 15 chars would include the shard letter A); the epoch day takes `slice(20,32)` (including decimals; taking only integer days would be flagged as duplicates); the 3LE format's first line is the satellite name, `l1=L[1]`, `l2=L[2]`.
- **Space-Track queries**: `nullsort=ignore` makes the whole `gp_history` query return 400 (do not add it); the subquery clause must come before `/format/…`.
- **The default batch must be taken from the index**: the built-in fallback has only 1 point per satellite and cannot compute a batch; inferring the default batch from the curve would cause **not a single shard to load**, and the page would forever show "no historical data".
- **Chapter 05 fullscreen canvas CSS**: must use `--climbbar-h`; mistakenly using chapter 04's `--fsbar-h` squeezes the canvas by 17px.

---
## [V1.8.0] — 2026-10-08

> Round 9, 17 requirements + 1 addition (⑱) + 4 confirmed defects found during the read-only investigation phase (D1–D4).
> The list and resolutions (Q1–Q11) are in `V1.8.0版本任务清单（第九轮）.md`.
> This round was authorized by the user to be **completed in one go and released directly** (a special case).

**Visual keynote**: black-gray base + blue accents; orange is **no longer the primary color**, retained only on the cover-style short dash and the third line's byline in exported images.

| # | Requirement | Delivery |
|---|------|------|
| 1 | Chapters 2/3 mobile tap anomaly | **Q1 ruled it a false positive; no code changed this round.** The read-only investigation conclusion is on record: the tap chain itself works (pointerdown→up→click complete, 9/9 canvas hits); the only real suspects are "window A occupies 20.7% of the screen in mobile fullscreen and eats clicks" and "synthetic-click dedup split across the three chapters" |
| 2 | Breathing state changed to **themed fill flashing** | Applies to only two "live" buttons: the in-page `.time-val` and the live button in the fullscreen drawer; fill color = theme color (CSCN red / SpaceSail blue), text black in light mode and white in dark mode. The old version was "themed border breathing"; changed to whole-block fill breathing |
| 3 | Help / Reset-all-defaults changed to themed fill | "Help" (footer) and "Reset all default settings" (chapter 0) = `--row-sel` fill + `--fg` text (white in dark / black in light), hover brightens by 14%; **when no setting has been changed in the page**, "Reset all default settings" degrades to a transparent background + gray text + hairline border. Each chapter's "Default settings" = **themed border, no fill**; when the chapter has no changes, no themed border and gray text (`.sec-clean`) |
| 4 | Four toggle animations (Q4 all selected) | ① Switch↔canvas sync (name/orbit/visibility cone/visible inclination → 520ms alpha tween) ② color-mode interpolation (per-frame color mixing among by-constellation/by-batch/by-inclination) ③ observatory-point mode enter/exit fade ④ **table page-flip "fade out → fade in"** (260ms, `fadeTableSwap()`) |
| 5 | Paginator page number clickable to jump | The current page number changed from plain text to a button; clicking turns it into an input in place (`.pg-in`), Enter/blur commits and clamps to a valid page |
| 6 | Satellite table "batch/group" bold high-contrast | `.batch-link` changed to `font-weight:800` + `var(--fg)` (dark=white / light=black) |
| 7 | Light/dark toggle transition stutter optimization | The culprits are the **full-table reflow** inside the view-transition callback and the site-wide per-frame recomposition of `backdrop-filter`; changed to freezing reflow during the transition and converging in one pass afterwards. Duration and form (circular wipe 560ms) unchanged |
| 8 | New **03.5 Network progress** line chart | Inserted between 03 and 04. The horizontal axis is **by week but labeled with the corresponding date** (`YY/MM/DD`, not "week X"); the vertical axis has two definitions — **launch count** = cumulative number of satellites launched (including launch failures and partial successes; those without a number written on the page are excluded), **in-orbit count** = number with the latest TLE ＋ number launched but not yet cataloged whose launch record is a success; the two curves take **this page's theme color** (CSCN red / SpaceSail blue) |
| 9 | SpaceSail's earliest two groups of 4 test satellites have no satellite records | **A data-definition issue, not a bug** (German KLEO payloads, not in the NORAD SpaceSail grouping, hence no in-orbit data). Per Q6, "keep as-is + add a note to the corresponding two rows in the launch history" |
| 10 | README revision | Added an **English intro** (per Q8: translate the Chinese content normally, without sales pitches); constellation full names/aliases unified as `星网（国网 / GW / GuoWang / SatNet，代号 CSCN）` and `千帆星座（千帆 / Qianfan / Thousand Sails / SpaceSail，G60）`, with shields badges taking on the "theme tint"; the dual-data-source table reordered to "conclusion first, then table", removing in-cell line breaks; the closing byline and the in-page note aligned to "本页面由 小橙子的宇宙Jackoraniverse 使用 AI 工具生成，灵感与最初版本来自于 Где «Рассветы»（Bureau 1440）的页面风格与布局" |
| 11 | Mobile fullscreen cannot tap to select satellites | Same as requirement 1; Q1 ruled it a false positive |
| 12 | Launch-time column + mission-result column | The satellite table gains a "launch time (GMT+8)" column; the launch history gains a "mission result" column, data from the **satellite encyclopedia's yearly launch-records page** (`scripts/fetch_launch_results.mjs` → `wiki_launches.json` → `mkdata.mjs` merged into `launches[*][6]`) |
| 13 | Verify column labels and record centering in both tables | Measured header and cells are both left-aligned, consistent; no change needed; added a guard assertion |
| 14 | Data injection + update strategy | Inject the day's latest TLE and encyclopedia data (TLE epoch, entry statistics, yearly launch records all from the same batch); update strategy per **Q7 A＋B**: A harden the local scheduled task (retry + logging + `git.lock` mutex), B move the TLE pipeline to GitHub Actions every 12h (wiki stays local, since it has to pass the WAF) |
| 15 | Rename/text CN-EN sync + "?" popup copy sync | Use `i18n.mjs` for static four-way checks + runtime four-pass scans; fill in the `Qianfan/CSCN` prefixes for `n_gw/n_qf`, the `paren()` helper, and `batchName()`; sync the "?" help popup CN/EN |
| 16 | Map chapter control reorder + enhanced restore-defaults + hint-button merge + content moved up | Control order aligned with chapter 02; "Visible inclination?" and "Zoom?" **merged into one** help button (root-causing "? taking up a whole line"); body text moved up one line, and the "select ground observatory point" row stays on its own. The chapter's "Default settings" upgraded to the **same definition** as "Reset all default settings": the time slider **tweened** back to live + the observatory-point group back to factory + this chapter's view (map zoom/pan / Earth attitude) back to factory |
| 17 | First two chapters' drawers changed to the homepage layout + drawer-area fix | The drawer changed to the homepage's control layout, **with the full controls but no search box**; the two chapters that have drawers have the same width (`min(380px, 82vw)`) |
| ⑱ | Coordinate-chart images overflowing the axis lines (new) | In both the "Inclination Distribution" and "Network progress" chapters (**in-page + fullscreen**, **any screen ratio**), all drawn content is **clipped** at the horizontal and vertical axis lines: `ctx.save(); beginPath(); rect(...); clip()` before drawing |

**Two "fake fixes" root-caused this round (recorded to avoid repeating)**

- **The chapter "Default settings" time-slider tween did not actually take effect** (frame-by-frame caught `[30, 0, 0, …]`, i.e. a jump). There are **two layers** to the real cause:
  ① `timeOffsetMap` / `timeOffsetGlobe` are themselves inside `PREF_SEC`, and `resetSection()` first **overwrites these two keys to 0** via `p[k] = PREF_DEF[k]`, and only then reads `p.timeOffsetMap` for the start value → always 0, `if (off0)` never holds, and the tween branch is never entered at all;
  ② even if it were entered, `animateTo()`'s start point takes the closure variable `shown`, while `syncTimeUI()` **writes `el.value` directly** without going through `applyV()` → `shown` stays at the old value → `from === target` → the very first statement `applyV(target)` snaps.
  Fix: read the start value before the overwrite; `animateTo()` re-reads `shown = +el.value` when no tween is running. The assertion changed to a **synchronous criterion** (the slider must still be at the start value at the instant `click()` returns) — independent of frame rate, 100% certain.
- **CDP had long failed to observe the app's internal state** (`chartRect` / `clampChartView` / `netDateLabel` all `undefined`). The real cause is that `app.js` is **entirely wrapped in an IIFE**, so none of its internal declarations are on `window`. Fix: `visual.mjs` copies the release artifact to a temp directory on the D drive and injects a read-only exit `window.__CISTRACK__` only **after the main IIFE header** (all members are getter functions), opens the copy in Edge → **zero pollution of the release artifact**, and asserts that the copy is byte-identical to the release HTML except for this one injection.

**Regression (all measured)**

- `smoke.mjs`: **332 PASS / 0 FAIL / 0 errors**
- `visual.mjs` (real browser, Edge via CDP): **115 PASS / 0 FAIL / 0 SKIP**
  — including the new "full-viewport × CN-EN × dark-light layout matrix" **52 sets** (13 widths 320→1920), criterion = no horizontal overflow + no element crossing the section's right edge, both categories all green.
- `i18n.mjs`: static four-way checks + runtime four-pass scans **all pass**

**Test infrastructure (new this round)**

- The probe-copy mechanism (zero pollution + byte-for-byte self-proof) replaces the practice of "stuffing code into the release artifact".
- Requirement ⑱ uses **pixel-level criteria**: scan 9 views (default + slight translations on four sides + corner zooms) over the 1px/3px bands outside the drawing area, requiring the count of high-saturation pixels to be 0 (inset 6px on both ends to avoid tick labels).
- Out-of-bounds criteria loosened to exclude 6 classes of **false positives** (`.bleed` / `.canvas-wrap.wide` / inside `.table-wrap` / `.sat-info` dragged out (explicitly allowed by V1.7.2 requirement 11) / `display:none`, `visibility:hidden` / zero size / resting entirely outside the viewport).

### Pre-release wrap-up (same day, fourth full regression pass)

This pass only does "**root-cause recurring false failures + remove machine traces + land the A＋B automation + clean the workspace**", without changing any page behavior.

**① Root-cause 3 false FAILs (`visual.mjs`, an assertion-selection issue, not a product regression)**

In the fourth full regression pass, `map` failed 3: "top-left corner can also be selected (info window does not block clicks)" + 2 cascading
"info window still present after selection then mouse moves away" / "info window width unchanged when dragged". After checking the evidence item by item, they were classified as **problems of the test itself**:

- In the same loop, "map: a clean click can select" and "map: still selectable after an 8px finger wobble on press" **both PASS** — these two go through a
  **full-canvas scan**, showing hit detection and the tap chain are completely fine; the failing one went through a
  restricted scan **deadlocked to the canvas's top-left 4/16 × 4/12**.
- CSCN inclination 50°, SpaceSail 89°: under equirectangular projection **the high-latitude band may simply have no satellites at all** — at that moment the top-left corner happened to be empty.
  This is neither a regression nor reproducible (two runs on the same day gave different results).
- Fix: `findPoint()`'s `cornerOnly` changed to **progressive expansion "top-left corner → top-left mostly → full canvas"**,
  and the actual landing point is written into the assertion hint; **only judge FAIL if the entire canvas has no light point**.
  The assertion name changed to the position-neutral "an on-chart light point is selectable (the hover tooltip does not block clicks)", to avoid the name masking the real landing point.
  In addition, the "top-left corner not covered by the info window" check was changed from "only the `!pc` branch" to **checked for all three charts every time**.
- Net effect: `globe` upgraded from "SKIP + 1" to a full 4, and `map`'s 3 false FAILs zeroed → **115 PASS / 0 FAIL / 0 SKIP**,
  and it **no longer depends on the luck of "there happens to be a satellite in the top-left corner at that moment"**.

**② Remove three machine-absolute paths (real leaks, caught by `build_release.mjs`'s privacy scan)**

| File | Was hard-coded | Now |
|---|---|---|
| `visual.mjs` | Browser path + a local `D:` path in the temp-directory candidates | Env var `CISTRACK_EDGE` (compatible with `EDGE_PATH`) → common install locations per platform → `PATH` |
| `mkmaker.mjs` | Same as above, and the profile directory hard-coded a local drive letter | Same as above (`CISTRACK_TMP` / `TEMP` / `TMP` driven) |
| `scripts/fetch_*.mjs` | A local `D:` path in the temp-directory candidates | Env-var driven |

**Root-cause fix**: `build_release.mjs`'s privacy scan previously covered only "root files + `data/`";
`scripts/*.mjs` and `.github/workflows/*.yml` **had never been scanned** — that is how the two above leaked out.
Both file classes are now included in the scan, and a "local temp directory" check was added.

**③ Internal process docs no longer enter the repository**

The three round documents that had mistakenly entered the repository (containing local absolute paths) were moved out and kept under the local `过程归档/历史清单/`;
`.gitignore` gained `*任务清单*.md` / `*验收检查清单*.md` rules, to prevent `git add -A` from bringing them in again.

**④ A＋B automation delivered (requirement 14 / Q7)**

- **A · Local task hardening**: `update_tle.bat` / `update_wiki.bat` rewritten — on failure **retry ≤3 times** (interval 90 s),
  the two tasks **share a `logs/git.lock` mutex** (stale lock auto-cleared after 5 minutes), `git pull --rebase --autostash` before pushing,
  explicit git identity (so commits work even when there is no global `user.name` on this machine), and the whole process logged to disk.
  The two scheduled tasks' **timeouts were relaxed from 45/20 minutes to 2 h / 45 min**, to avoid being hard-killed mid-retry (`StartWhenAvailable` was already on).
- **B · Cloud**: new `.github/workflows/update-tle.yml`, running every 12 hours (Beijing 16:00 / 04:00)
  `refresh → mkdata → build → release`, `concurrency` serialized, `pull --rebase` before pushing with one retry.
  The satellite-encyclopedia side stays local — it must pass Cloudflare's WAF, which data-center IPs cannot.

**⑤ Wording and consistency**

- README: the time-slider entry's "now" changed to **"Live"** (the button renamed in V1.8.0); the live-breathing-state description changed to
  "themed fill + breathing flash, text takes `--fg`"; added `i18n.mjs` / `.github/workflows/` / the list of files not committed to the repository;
  the browser env var changed from writing only `EDGE_PATH` to `CISTRACK_EDGE` (compatible with the old name).
- Browser env var names unified: `visual.mjs` / `mkmaker.mjs` use `CISTRACK_EDGE`, while the two fetch scripts used `EDGE_PATH`
  — now **both accept both names**.
- **The closing byline was only truly aligned this time**: requirement 10's promise to "align the closing byline with the in-page note" had only landed in `README.md` last round,
  while the same sentence in `app.js`'s `README_ZH` was missing the trailing "与布局。" (the in-page note was 4 characters shorter than the README).
  This round it was completed, and a `smoke.mjs` guard added — directly comparing "the last paragraph of the in-page `README_ZH`" against "the same paragraph in `README.md`",
  so that if they diverge again it is flagged immediately (assertion count thus 331 → **332**).
- The snapshot list in README's "repository structure" was completed to `CISTrack_v1.5.2 … v1.7.3.html`, no longer omitting v1.7.1 / v1.7.2.

**⑥ Cleanup and disk** (the user authorized a "large-scale cleanup" this round, especially the recycle bin)

- Deletions are redirected to the recycle bin by a `safe-delete` hook — **judging only by "the file is gone" would falsely report success**,
  and space is only really released after the recycle bin is emptied. After emptying accordingly: **C drive free 6.12 → 6.95 GB**,
  **D drive recycle bin 2.22 GB → 0.3 MB** (net release 2.21 GB).
- Source directory: `_tmp` 2.1 GB → 0, `过程归档` 116.2 → 21 MB, one-off probe scripts and `_probe_dbg.html` etc. moved out.

### Known TODOs (later versions)

- **Mixed search is not implemented yet** (carried over from V1.7.1).
- **On-device reproduction of the chapters 2/3 mobile tap** (once Q1 provides device info) — this round's two suspects, "window A eats clicks" and "synthetic-click dedup written once per chapter three times", remain unhandled.
- The "Dawn" / "Рассветы" byline has been unified across the README and the in-page note per Q8; if there is a third place (e.g. the export image bottom bar in English) that needs changing, please point it out.

---

## [V1.7.3] — 2026-10-07

> Round 8, 10 requirements (top-bar visual wrap-up + observatory hint slot + popup tinting + export band + fullscreen button-column unification + four independent times + fixed-width/Q-bounce time pill + non-linear slider tween).
> The list and resolutions are in `V1.7.3版本任务清单（第八轮）.md`; item-by-item measurements are in the probes `过程归档/cdp探针/v173b*.mjs`.

| # | Requirement | Delivery |
|---|------|------|
| 1 | Tint the two links inside the popup with the theme color + underline | `.modal-body a` changed to `var(--row-sel)` (the old `--accent` was always blue and did not follow the constellation/theme), adding `underline + 2px offset + 1px thickness`; hover `opacity:.72`; the blockquote's left line also tinted to `--row-sel`. The README CN/EN footers rewritten as "本页面由 小橙子的宇宙Jackoraniverse 使用 AI 工具生成，灵感与最初版本来自于 Где «Рассветы»" with dual links |
| 2 | Time-slider interaction animation | Clicking the orbit / keyboard / "Now" / restore-defaults → play the animation; **dragging does not play** (a >6px displacement immediately cancels the takeover); 42.5°… (the curve is the same global easeInOutCubic, duration 120–520ms proportional to distance). `attachSliderAnim()`: pointerdown pins back the original value and records the target, pointerup judges a tap (<450ms and ≤6px) before calling `animateTo`; the numeric box's commit / the "Now" button all go through `el.__animateTo` |
| 3 | pickHint fixed slot | The hint text moved into the always-present `#pickSlot` (inline in `.sec-tools`); `layoutPickSlot()` measures the row count via an offscreen clone + measures the existing spacing around the slot (inter-row gap and the margin below) as compensation, so entering/leaving placement mode has **pixel-zero jitter** (22px visible whitespace above and below, constant) |
| 4 | Fixed-length top-bar constellation buttons | `.seg.constel` fixed length 97px (golden-ratio 3.236×30px), three keys equal height 30px, `flex:1` evenly split; `tooTight()`'s shrink criterion merged into `layoutNav()` |
| 5 | Fullscreen button column unified across three chapters | Root cause: `fs-stuck` (the screen-off degraded path) had **no `.view-ctl` rule at all** → bottom 10px eaten by the phone's rounded corner ("the orbit chapter sticks out of the screen"), while `fs-mobile` was 38px ("the map chapter sits too high"). Unified into one variable `--fs-ctl-bottom: calc(24px + env(safe-area-inset-bottom))`, shared by both paths |
| 6 | Exported image hugging the canvas edge | Divider → top of row 3dpr; the old version unconditionally reserved `lineH*0.9`, leaving an empty strip at the bottom → after export, **crop** the canvas by the actual height returned by `drawShotBar` (only crop when `barH < pad-0.5`) |
| 7 | Non-fullscreen button column unified across three chapters (guard) | The probe shows the three chapters' canvas definitions are already unified 10/10; no code changed this round, only a guard assertion added (`b4_nonfs_uniform`) |
| 8 | Freeze semantics | Dragging the time slider = **frozen at an absolute instant** (`frozen = Date.now() + min*60000`), no longer "real time + offset keeps running"; restore-defaults / "Now" return to live |
| 9 | Four independent times | `S.time = { map:{off,frozen}, globe:{off,frozen} }` × CSCN/SpaceSail (the STORE snapshot mechanism carries this naturally) = **four fully independent times**. `loop()` made two-chapter: each keeps its own simulated time and SGP4 propagation cache (`frameStatesMap/Globe`); when the two chapters share a time they reuse the same propagation instead of recomputing; a frozen chapter's `sec` is constant → no recomputation (also saves power). Live state time status light = themed breathing border (`updateBreath()` driven per second inside rAF, lit on even seconds); frozen state = fixed yellow (consistent between the homepage `.time-val` and the fullscreen `.fs-clock.late`) |
| 10 | Fixed-width + Q-bounce time pill | The homepage `#clockPill` and the fullscreen `.fs-clock` are measured to a fixed width based on the **longer GMT+X form** (`fixPillWidths()` measures width via an offscreen clone → `min-width` + centered), leaving symmetric space on both sides when switching to the short form; both pill types get a `pillPop` Q-bounce animation on tap (scale rebound curve, `clockPill` with its own translateX compensation) |

**Real bug fixed (caught by a probe this round)**: `globeBlockHtml()` still referenced the old variable `frameStates` that had been split out (missed in batch 5's rename) → reading an undeclared variable threw a ReferenceError, silently swallowed by the mousemove path's try/catch → the globe chapter's hover info window never appeared (visual showed as "globe scan finds no point"). After switching to `frameStatesGlobe`, visual went all green.

**Regression**: smoke **0 errors**; visual **81 PASS / 0 FAIL**; batch 1 verification (top bar) ALL PASS; batch 2 verification (slot) ALL PASS; batch 3+4+9 guard probes **16 PASS / 0 FAIL** (four independent times, freeze does not drift, fixed-width pill, Q-bounce animation, popup tinting in CN/EN and both themes, export band cropping, fullscreen/non-fullscreen unification across three chapters).

**Investigation aside (recorded to avoid repeating)**: an independent probe once falsely reported "the whole app script does not execute" — the truth is ① app.js's scope is closed, so `typeof S` being always undefined is a long-standing phenomenon; ② `loadMask` has a 6s fallback collapse, while the probe waited only 4s; ③ `innerHTML.length` ≠ file byte count; ④ the 404 is CORS blocking of `wiki.json` under file:// (a fallback exists by design). The artifact script is actually complete (428,700 B).

### Known TODOs (V1.7.4+)

- **Mixed search is not implemented yet** (carried over from V1.7.1).
- **On mobile, chapter 1's fullscreen `#fsClock` prints over the text of the "batch/group" dropdown** (found in the V1.7.2 health check, awaiting the user's decision).

---

## [V1.7.2] — 2026-10-06

> Round 6, 13 requirements (4 real bugs + top-bar four-level degradation + info-window tri-state interaction + fullscreen dead zone + mobile swipe).
> Item-by-item measurements are in `V1.7.2验收检查清单.md`, a sibling of `V1.7.1验收检查清单.md`; the list and root causes are in `V1.7.2版本任务清单（第六轮）.md`.
> **V1.7.0 / V1.7.1 are both kept as baselines** (`archive/`) and were not touched this round.

### Round 7 (a patch round, same day) — 9 requirements + 2 additions

**9 requirements (8 delivered, 1 deferred to V1.7.3 as agreed)**

| # | Requirement | Delivery |
|---|------|------|
| 1 | Misaligned CS/SS button layout in the English version | The real culprit is that `.seg-slider` (the selected-state color block) was not recomputed after a language switch: the buttons went 54 → 44px while the block stayed 54px, overflowing the right edge by 9px onto the second button. Added `navFollowUp()`, calling `moveConstelSlider` at `layoutNav()`'s **L0 exit and regular exit**, and at the end of the language switch (after the top bar settles). Measured: CN/EN, 320→1440, the block overflows by ≤1px in all cases |
| 2 | Delete the top-bar section-switch buttons and the "update epoch" row | The five section links (duplicating the floating pill in the bottom-right) and the "element epoch" were removed from the DOM, and the accompanying three-step "top-bar middle overflow convergence" logic became dead code and was removed too. The epoch moved below the main title (`#pageEpoch`), **always shown** (CN/EN × all widths) |
| 3 | Excessive empty space at the top of the homepage | Added `layoutTitleGap()`: calibrates "main title **glyph** top → time pill bottom" to equal "pill top → top-bar bottom edge" (= 10px). Everything is converted to **document coordinates** (so recomputation mid-scroll cannot produce absurd values); the glyph top measures the text line box with a Range, which still works when the font size changes via `clamp()` |
| 4 | Info window: after a long-press drag, only the top edge of the themed border remains | `outline` is drawn outside the element and was clipped by `.si-body`'s `overflow:hidden`, leaving only the top edge. Changed to `border` + `box-sizing:border-box` (not shown when not dragging). **Three lines of defense for window B**: CSS forces `border/outline/box-shadow` all to zero + `--row-sel` to transparent + JS explicitly excludes `.floatwin` in the pointerdown drag logic (root-causes border leakage) |
| 5 | Align window B's top/bottom edges with window A's | The datum changed from "window A as a whole" to "window A's content area `.si-body`": top edges aligned, height = content-area height − the bottom drag-hint row height; keeps `auto` and does not clip when content does not fit. **Also added a `noHover()` gate** (do not pop when `(hover:hover)` is false): on pure-touch devices a tap synthesizes `mousemove` which calls window B out, and there is no real `mouseleave`, so on a narrow screen window B measured landing 251px below window A and never disappearing |
| 6 | The difference between "this satellite's epoch" and "TLE update epoch" | "This satellite's epoch" = the epoch of this satellite's own TLE (each satellite is updated at a different cadence); "TLE update time" = the **latest** element epoch in this constellation's catalog (the whole-package definition). This round unifies the definition per new requirement A: the info window and exported image keep only "this satellite's epoch"; "TLE update time" appears only in the single place below the main title |
| 7 | Mobile horizontal swipe to switch constellations did not cover chapter 0 | Removed `.sec-head` and `.hero` from the `SWIPE_BLANK_SEL` whitelist — those two selectors had marked the whole main-title/parameter-bar/search-box block as "not blank". The six anti-mistouch gates (touch and not fullscreen / \|dx\|≥72px / \|dx\|≥2.2\|dy\| / velocity / direction / defaultPrevented) are unchanged, and interactive elements are still stopped by other selectors |
| 8a | Selected satellites still draw orbits after turning off "show orbits" | The old implementation had only "draw all orbits" wrapped by `S.mapTrack`; the selected satellite (0.9) and the hovered satellite (0.75) segments **executed unconditionally**. Now all three segments are wrapped into the same toggle block, with semantics consistent with chapter 2 |
| 8b | The name toggle fails when a satellite is selected | `sel2` (already selected) written first in the `\|\|` chain short-circuited `S.names.map`. Moving the toggle to the outermost level: off = nothing shows (including selected and hovered), on = the original per-type rules. Fixed in both Map and Globe |
| 8c | On tap/search selection, both chapters' name toggles default to being synced on | A `LAST_SEL_SIG` selection signature + `syncNameBtns()`, hooked at one place — `syncSelInfo` (the convergence render point for all selection changes) — covers all six entry points. Rule: select a satellite → both turn on; turn one off while selected → only that one turns off; next selection → both turn on together again |
| 9 | Time-slider "jump" non-linear smooth animation | **Not done in this version, left for V1.7.3** (see the V1.7.3 TODO below) |

**Addition A (definition unification)**: the third line of the loading overlay deliberately uses "element epoch / Epoch" and **not** "TLE update time" — the latter, per the user's request, may appear only in the single place below the main title; the overlay is a transient cover layer, and saying "which version of elements this is" suffices.

**Addition B (cross-browser compatibility health check)**: Chromium (Edge 154) / Firefox 155 / WebKit (Safari 26.6 engine) three engines × 1440/1024/390/320 four viewports = **12 sets all consistent** — title gap gap=10, constellation block overflow 0, horizontal overflow 0, `scrollY=0`, the epoch below the main title always shown; frosted glass (WebKit uses `-webkit-backdrop-filter`), `user-select`, the Audiowide font, `startViewTransition`/`dvh`/`safe-area`/`color-mix` all supported by all three. The health check **also found and fixed one real defect**:

- **At 320px + English UI, the "batch/group" dropdown was clipped by 19px** (WebKit 25px). `.ctl` is a direct flex item of `.controls` (a flex-wrap row); `min-width:auto` resolves to min-content = the `<select>`'s intrinsic width (≈ the longest option text), so within the 288px available width it refused to shrink; and `html` also has `overflow-x:hidden`, so the right side was clipped and could not be scrolled to. Fix: at `≤400px`, `.controls .ctl{min-width:0}` + `select{max-width:100%}`. Measured at 360/375/390/414/480/620, the CN/EN text was already 0 across those, so this constraint is a no-op there
- During the health check, "scrollY is pushed up 18px by scroll anchoring after switching to English" was once misdiagnosed, then disproven with 13 control experiments: the real culprit was **the probe itself** — Playwright's `page.click()` first waits for the element to be interactive and does `scrollIntoViewIfNeeded`, while at that moment the `#loadMask` overlay (up to 6s) had not yet been removed, and at the removal instant the top bar was mid-animation at `translateY(-100%)`. After switching to native `page.mouse.click()`, 320/390/768/1440 all gave `y=0`, gap=10; scrolling to 300 first and then switching language kept `y` exactly at 300. **The page itself has no such defect, and no compensation code was written** (the reasoning is kept as a comment at the top of `playLangSwitch`, to stop later people from taking the same wrong path)

**Regression**: smoke **309 PASS / 0 FAIL** (including 3 new guards this round: ≤400px select constraint, no regression of scroll-anchoring compensation, the suspicion-record comment being in place), visual **81 PASS / 0 FAIL / 1 explicit SKIP** (the SKIP being the pre-existing "no satellite light point in the globe's top-left corner; this scenario does not apply"), cross-engine 12 sets all green.

**Workspace cleanup (Q7=A)**: 1030.2 MB / 3382 items → **25.7 MB / 293 items**. Emptied `junk/` (of which 945 MB was the Edge user-data directories `.edgeprof`/`.edgeprof2` left by two probe runs — pure browser cache, 100% regenerable; 58 MB was one-off screenshots and probe leftovers from 10-05); deleted 3 outdated screenshots (`shots/`) from the V1.3.9/V1.4.0 era and this round's debugging temp files. Kept the `archive/` version documents, `data/`, `build/`, and `过程归档/`'s numbered probes + JSON results + landing screenshots.

### Known TODOs (V1.7.3)

- **Time-slider "jump" non-linear smooth animation** (round-7 requirement 9, agreed not to be done this version): after clicking "jump", the slider plays a 520ms non-linear smooth animation proportional to the target distance (the same `cubic-bezier` slow-then-fast curve as the constellation/language/theme switches), with the animation getting faster the farther the distance but the duration unchanged.
- **Mixed search is not implemented yet** (carried over from V1.7.1): numeric fuzzy / rocket names / launch facilities / manufacturers / paired parenthetical annotations / search history, etc., see the TODO description in the V1.7.1 section.
- **(Found in the health check, awaiting the user's decision on whether to fix)** On mobile, in chapter 1's fullscreen control bar, the `#fsClock` clock pill overlays the selected text of the "batch/group" dropdown — reproduced at both 390px and 320px in English (less noticeable in Chinese because the text is shorter). It is a **pre-existing** phenomenon unrelated to this round's 320px fix; the idea for fixing it is to reserve the clock's height on the first row of the fullscreen control bar, or move the clock out of that row; since it involves a fullscreen layout change, it was not fixed opportunistically this round.

### The 4 real bugs fixed

**① The info window "wraps to a new column" on narrow screens — the shared root cause of requirements 1/2/3 (a landmine laid in V1.3.8)**
`.sat-info` used `flex-direction:column; flex-wrap:wrap; max-height:calc(100% - 32px)`.
**Once the content height exceeds max-height, `.si-body` does not scroll vertically but is pushed by `flex-wrap` into a "second column".**
Only the map chapter was affected, because it is the only container using `aspect-ratio:1325/620` (height drops linearly with width; at a 390px viewport the container is only 240px, while the info window's content is about 238px — an 18px difference triggers the column wrap); the orbit (680px) and inclination-distribution (480px) containers are fixed-height and never wrap.

One bug caused a **triple**:
- ① Both **vertical + horizontal** scrollbars appeared
- ② The element's width nearly doubled (measured 278 → 518px), with its left edge far to the left of the content — so one could long-press-drag in the "empty space far to the left of the info window", and it also covered the satellite light points below
- ③ The user dragged the ✕ once and it "went back to normal" — because after dragging, the `.si-drag` hint row was hidden, the content got 20px shorter, falling back within max-height

**Root-cause fix (three changes)**:
- `flex-wrap:nowrap` — never wrap to a new column
- **`max-height` changed from "computed from the container" to "computed from the viewport"** (`calc(100vh - 40px)`) —
  no matter how short the container, the info window is not squeezed. The cost is that on a narrow screen the window may be taller than its canvas container and cover content below (confirmed acceptable with the user:
  the info window is a floating window anyway, and it can be dragged away)
- `.si-head` pinned with `flex:0 0 auto` — **the × button is never squeezed away at any size** (explicitly requested by the user)
- Also added `@media (max-width:400px)`: `.si-block min-width:118px`, to avoid the two blocks overflowing horizontally side by side when extremely narrow

**Measured**: across 25 viewports (2560×1440 → 280×653), the three chapters' info windows are **all `sameCol:true`, with no horizontal or vertical scrollbars**.

**② The "Reset all default settings" button could never be clicked (a latent bug carried over from the previous version)**
In `prefSnap()`, `timeOffset` was hard-coded to 0, so `prefIsDefault()` always considered the time slider at its default value;
**selecting a satellite, flipping table pages, map zoom, and text in the search box also did not count as "changes"**.
Fixed: `prefSnap()` snapshots faithfully (restoring is still forced to zero by `prefApply`, keeping the two concerns separate),
and `prefIsDefault()` expanded to selection / batch / the two page numbers / search term / map zoom-pan / globe zoom
(⚠️ the globe's `yaw` auto-rotates every frame and is **deliberately excluded**, otherwise the button would always be lit).

**③ The English top bar pushed the three keys out of the viewport — the root cause is that `layoutNav()` was declared twice**
Function-declaration hoisting let **the later one override the earlier one** → the copy added in V1.7.1 **never executed**
(hard evidence: `.nav-actions`' inline `right` was `(none)`). At the time, "no overflow at 12 breakpoints" passed purely because the CSS fallback values happened to be correct. Now **merged into a single copy**, which both sets `--nav-h` (the clock pill's positioning depends on it) and lays out the three keys.

**④ The CSCN theme red occasionally "became vivid" (introduced in the previous version)**
`sweepBrandColor`'s `background-clip:text` gradient finished only via a single `setTimeout`;
when the tab went to the background / rAF was throttled / constellations were switched rapidly in succession, the finish did not execute → **inline `color:transparent` + a half-way gradient stayed on screen permanently**,
and the intermediate color mixed from the two colors was more vivid than `--row-sel`.
And **deeper still**: `--brand-c` was a thoroughly **dead variable** — `color` was written twice in the same CSS declaration block, and the latter `var(--row-sel)` always won; the values written by the two `setProperty('--brand-c')` calls in `app.js` were read nowhere.
Deleted it together with `syncBrandColor()`, leaving `--row-sel` as the only source of the brand color;
`sweepBrandColor` gained an idempotency guard + a `visibilitychange` fallback finish.

### Requirement 4 · Info-window tri-state interaction (the largest structural change this round)

The info window is split into **two roles** (two DOM elements per chapter: window A + floating window `#*InfoB`):

| State | Window A | Floating window (hover) |
|---|---|---|
| ① No satellite selected | None | Shown at the **default position**, **no ×**, content changes dynamically with the mouse; disappears when moving to blank space / off the chart |
| ② One or more satellites selected | Shows the one with the **smallest NORAD** (has ×, draggable) | **Hugging window A's right side** (turns to the left if it does not fit, then to the bottom), no ×, not draggable |
| ③ Selected but ✕ was pressed | None | **Neither is shown** (immersive viewing); only restored by "deselect → select a new satellite" |
| ④ Click another satellite while multi-selected | **Window A's content switches** (switching within the group), the highlight set unchanged | — |

- The floating window is `pointer-events:none` — this **also root-caused V1.7.1's "ghostly flickering"**:
  the old floating window would cover the mouse → the canvas fired `mouseleave` → it was dismissed → the mouse fell back onto the canvas → it showed again, **an infinite loop**
- The visual marker changed from `box-shadow: inset` to **a 3px themed bar on the left edge** — insets are drawn at the element's left inner edge,
  so once the element's geometry was abnormal (exactly the column-wrap bug above) it would run far to the left of the content, looking like "an unexplained red line on the left of the screen"
- All three `mouseleave` handlers changed to **dismiss only the floating window**; window A is managed persistently by `syncSelInfo`

### Requirements 5/9 · Top-bar fixed-width positioning + four-level degradation on extremely narrow screens

`.nav-actions` is absolutely positioned and pinned to the right (`right:24px; top:50%; translateY(-50%)`),
with `layoutNav()` giving `.nav-right` a compensating offset based on the measured width. Left/right padding unified to 24px,
so "the distance from the light/dark key to the right = the distance from CISTrack to the left".

**Four-level degradation on extremely narrow screens** (explicitly specified by the user; sacrificed in order on narrow screens):

| Level | Trigger | Action | Constraint |
|---|---|---|---|
| L0 | Viewport ≥ 480px | **Adjust nothing** | Both normal phone and desktop widths take this level |
| L1 | Does not fit | Narrow both keys **proportionally** (1:1) | **Font size unchanged**, text centered horizontally and vertically |
| L2 | L1 hits its lower limit | **Shrink CISTrack** (23 → 18px) | No distortion |
| L3 | L2 hits its lower limit | **Remove the button text, keep only the color block** | Can keep shrinking to 1:1, limit height:width 2:1 |

- The `font-size:10px` at each breakpoint was **deleted entirely** (the user required the font size to stay unchanged)
- Each level **resets before measuring** (otherwise repeatedly resizing the window would narrow it cumulatively)
- CSS `gap` and JS's `G` unified (12 on wide screens / 8 on narrow), so the two gaps are truly equal on extremely narrow screens
- The L3 color block keeps `title` / `aria-label`, so screen readers and hover tooltips are unaffected

### Requirement 6 · Remove the left/right dead zones in fullscreen

The three 12% dead zones (`chartHitZone` / `mapHitZone` / `touchZoom`'s `active`) all gained an `isFsMode()` short-circuit.
`isFsMode()` recognizes three forms of fullscreen: fullscreen / pseudo-fullscreen (`html.pseudo-full`) / section-level fullscreen (`section.fs-mobile`).
The dead zones originally existed so users could scroll the page vertically at the canvas's two sides; fullscreen already locks the page — they are purely in the way.

### Requirement 7 · "Data update" → "TLE update time"

Changed in **both** the info window and the exported image, **with English synced** (`TLE updated`). The shared i18n key `d_dataupd` was changed, so one change takes effect in both places.
The correspondence between that row in the info window and "this satellite's epoch" still holds (single-satellite epoch vs whole-package TLE time).

### Requirement 8 · Inclination limit 0–90° → 0–180°

`CHART_X_MAX` 90 → 180, accommodating retrograde orbits (inclination > 90°); the boundary line label `'90°'` → `'180°'`.
`chartAutoView()`'s viewport still hugs the data, so **there is no visual change**; only when zooming out with the wheel can it now zoom out to the full 180° range.

### Requirement 10 · After multi-select in the table, a single click = select just it (**table only**)

This is **two rules acting in different places**, distinct from requirement 2④'s "switching within the group":
- **Inside the satellite table**, clicking any one after multi-select → **deselect all and select only it**
- **On the chart / map / globe**, clicking one → **switch within the group** (`S.sel` unchanged, only window A's content changes)

`toggleSel`'s focus logic is kept as-is; the table click opens a separate branch.

### Requirement 11 · Restore the info window's ability to be dragged off the screen edge

V1.7.1 had tightened it to "must stay entirely within the viewport", which **overcorrected** while fixing requirement 2 —
the real root cause was the column wrap (abnormal element geometry), not the boundary clamp. Now **restored** to "keep at least 24px on screen",
while keeping the `pointerdown` visible-rectangle hit test added in V1.7.1. The two do not conflict:
the clamp governs "where it can be dragged to", the hit test governs "where the drag can start from". The page still does not stretch wide (`overflow-x:hidden` as the fallback).

### Requirement 12 · On mobile, swipe left/right in a blank area to switch constellations

**Shares the same entry point `switchConstel()` as clicking the top-bar button**, guaranteeing that the animation / state snapshot / scroll-position restore are fully consistent.
Six anti-mistouch gates (any failure aborts): touch and not fullscreen / the landing point is a blank element / `|dx| ≥ 72px` /
`|dx| ≥ |dy| × 2.2` / velocity `≥ 0.35 px/ms` / direction matches the current constellation.
In addition, if the gesture is `preventDefault`-ed by any component during the gesture (canvas zoom / drawer / table) it is immediately voided — **that means "someone else wants this gesture"**.
All four touch listeners are `passive: true`, so they do not block normal vertical page scrolling.

### Requirement 3 (continued) · Scheduled tasks and verification time

- **The TLE task's time changed from 06:10 to 00:00 and 12:00**, consistent with the two satellite-encyclopedia tasks (explicitly requested by the user)
- **The encyclopedia verification time changed to be precise to the hour and minute** (new `checkedAt`) — it runs twice a day, so showing only the date no longer distinguishes which run
- **The verification time advances only when both constellations were successfully read** — the user's own words: "as long as all the data that should be read was read successfully,
  this update's time should be shown too". When a constellation fails/degrades, the old value is kept, so it does not claim "verified today", which would be dishonest.

### Requirement 13 · Two real problems with the tests themselves

- **One assertion in `visual.mjs` was silently skipped by `if (pc)`** → when no point could be scanned, the whole block did not run,
  so the assertion count varied between runs (measured 83 vs 86), and **"not tested" was disguised as "passed"**. Changed to an explicit `SKIP` (not counted as PASS nor FAIL, but must be printed).
- **The globe's "top-left corner can also be selected" failed intermittently** — the root cause is that the **globe's rotation** moved satellites between the scan and the click.
  The old version was masked by that `if (pc)` above. Now: rotation is turned off before click-type tests start (making the test repeatable),
  and the one thing that assertion really needs to verify — "the tooltip does not block clicks" — is verified explicitly once with `elementFromPoint`.
- Also scanned out and cleared a **historically duplicated declaration**: `var MAP_AR = 1325 / 620;` appeared twice in the file (the values were the same so it never caused an error,
  but a duplicate `layoutNav` of the same kind had already cost one debugging session).

### Verification

- `smoke.mjs` **280 PASS / 0 FAIL** (30 new guards this round + 16 old V1.7.1 assertions rewritten)
- `visual.mjs` **84 PASS / 0 FAIL** (consistent over two consecutive runs; plus 1 explicit SKIP with a reason)
- Console errors **0**
- End-to-end probe `v172_verify.mjs`: 25 viewports × three chapters' info-window geometry + 20 breakpoints × **CN/EN bilingual** top bar + tri-state interaction + fullscreen dead zone + drag off screen

---

## [V1.7.1] — 2026-10-06

> Round 5, 12 requirements (8 features + a data-source report + top-bar revamp + wrap-up).
> **This round only does V1.7.1; V1.7.0 is kept as a baseline** (`archive/` already holds six `*_V1.7.0.*` files + artifact snapshots).
> Item-by-item measured data is in `V1.7.1验收检查清单.md`; technical details are in the `## V1.7.1` chapter of `PROCESS.md`.

### Fixed 4 real bugs

**① The satellite-table linkage "recurred" (a major bug reported by the user)**
After selecting a satellite, the launch history auto-highlighted it, **but the satellite table neither turned the page nor highlighted it**. The root cause is that **two pagination logics coexisted**:
`gotoSatInTable()` computed the page number using a **fixed 10 rows/page**, whereas since V1.7.0 the table had switched to paginating by **measured row height**
(`measureRowUnits` / `pageBounds`; manufacturer-column wrapping makes a row taller) → the page number was necessarily misaligned.
**Deleted `gotoSatInTable`**, routing everything through `renderTable({jump:true})` (which uses the correct `pageBounds`);
the `just-hit` highlight moved from "querySelector before render" (necessarily a miss) to the end of `renderTable`;
on `jump`, if the selected item is not found, reset the page number to 0; `afterConstelSwap` gained a recompute (the two constellations have different row counts, so an old page number would point to the wrong satellite).
Measured: selecting the satellite at the 75% position → auto-flipped to **page 14/19**, with both `focused` and `just-hit` landing on the target row.

**② After closing the info window, hovering "pinned" a new window (an interaction-logic error)**
`INFO_HIDDEN` **simultaneously carried the two semantics of "the user actively closed it" and "temporarily nothing to display"** —
after the user clicked ✕, as long as the mouse swept over any other satellite, `__lastId !== idKey` in `showInfo` held → `INFO_HIDDEN` was cleared to `false` → the window reappeared;
stacked on top of the canvas `mousemove`'s `else if (S.sel.length)` and the unconditional `syncSelInfo()` in `mouseleave` → the window was pinned back to the original satellite forever.
Now **split into three states**: `INFO_CLOSED` (the user's intent, only cleared by actually changing the selection) / `INFO_HIDDEN` (render) / `INFO_PREVIEW` (the hover temporary window).
Hovering always goes through a **pure preview**: default position, cleared drag offset, `cursor:default`, a thin themed bar on the left, **not draggable**, and disappearing immediately when the mouse moves to blank space / outside the chart.
Measured: close → hover another satellite (`previewClass:true`) → move away (`display:none`) → `mouseleave` (still `display:none`, **sel is still 1, not pinned**).

**③ The info window's drag-recognition space overflowed to the left**
The old rule allowed dragging the window until only 24px remained on screen (`minL = KEEP - drag.w`, `KEEP=24`); the wider the window, the more it overflowed —
chapter 01's `.chart-wrap` is the widest, and the info window could lay out 8 blocks horizontally (700px+), so its left edge could reach 700px off the viewport;
stacked with `setPointerCapture`, that "already off-screen" window kept receiving `pointermove`.
Changed to **the window as a whole must stay within the viewport** (`minL = 0 - wrap.left`), and a visible-rectangle hit test added to `pointerdown`.
Measured: dragged to the far left `left:0`, dragged to the bottom-right `right:1440 / bottom:1000` (exactly hugging the edge, never overflowing).

**④ The CSCN theme red occasionally "became vivid"**
`sweepBrandColor` used `background-clip:text` + a two-color gradient for the sweep animation, **finishing only via a single `setTimeout`** —
once the tab went to the background / rAF was throttled / constellations were switched rapidly in succession, the finish did not execute, and inline `color:transparent` + a half-way gradient **stayed on screen permanently**,
with the intermediate color mixed from the two colors more vivid than `--row-sel`.
Deeper hazard: **`--brand-c` was a thoroughly dead variable** — `template.html` wrote `color` twice in the same declaration block, and the latter `var(--row-sel)` always won.
Deleted the dead variable and `syncBrandColor()`, leaving a single source of the brand color; `sweepBrandColor` gained an idempotency guard + a `visibilitychange` fallback finish.
Measured: after manually attaching the gradient and calling `brandSweepFinish()` → all inline styles cleared, the color back to `rgb(255,107,107)`; after three rapid constellation switches, `sweeping:false`, no residue.

### Top-bar revamp (the user's proposal, better than the original suggestion)

- **Deleted the "（内置快照）" suffix** (in four places: top bar / loading page / info window / exported image). It was a developer marker that visitors could not understand, and hanging in the UI it looked like an error.
  The `TLE_LIVE` variable is kept (the in-page note and future statistics need it), it just no longer outputs text to the UI. The data source and offline fallback were rewritten into a dedicated chapter of the in-page note.
- **The three keys on the right changed to absolute positioning pinned to the right** (`position:absolute; right:24px; top:50%; translateY(-50%)`) —
  the old version arranged all three groups inside `.nav-right` with flex; in English, `.navlinks` at 652px pushed the buttons out of the viewport, and `overflow-x:hidden` meant no horizontal scrollbar → **completely invisible and unclickable**.
  New `layoutNav()` gives `.nav-right` a compensating `padding-right` based on the buttons' actual width, called in three places: `renderHeader` / `resetAllPrefs` / `resize`.
- **Top-bar left/right padding unified to 24px** → the distance from the light/dark toggle key to the right edge of the screen = the distance from CISTrack to the left.
- The three keys moved out of `.nav-right` (staying inside would let the parent's width pull them along).
- Measured **12 breakpoints (1680→390) all `overflow:false`**; in English the last link `right:1357` < buttons `left:1395`, **`overlap:false`**.

### Full restore = Chinese + CSCN + dark + all defaults (including the time slider)

The user explicitly said "do not exempt anything from restore": factory state = **CSCN + Chinese + dark + all defaults**.
`resetAllPrefs()` now also flips **constellation** and **language** back, **bypassing the switch animations** (restore is a correction action; a 0.5s animation would feel like "it hasn't taken effect yet");
the time slider **explicitly goes through `setOffset(0)`** (it previously only changed the `S.timeOffset` variable via `prefApply`, so the slider value / button text / `.shifted` highlight / the fullscreen pill's yellow frame did not revert).
The wording "Now" → "Live" (English `Now` unchanged), and the narrative copy was synced with the in-page note.
Measured: `R4_diff: []` — after restore, **zero field-by-field difference** from a "freshly reloaded clean baseline".

### A hidden bug fixed along the way

**The "Reset all default settings" button remained dim and unclickable after the user changed settings.**
In `prefSnap()`, `timeOffset` was hard-coded to 0 (a V1.3.6 "start from now on every open" measure placed in the wrong function), so `prefIsDefault()` always considered the time slider at its default value;
**selecting a satellite, flipping table pages, map zoom, and text in the search box also did not count as "changes"**.
Now `prefSnap()` faithfully snapshots `timeOffset` (restoring is still forced to zero by `prefApply`, keeping the two concerns separate),
and `prefIsDefault()` expanded its scope to selection / batch / page number / search / map zoom-pan / globe zoom
(**the globe's `yaw` auto-rotates every frame and cannot be included**, otherwise the button would always be lit).

### Other

- **The inclination-distribution dashed line changed to the constellation theme color**: `C.accent` (fixed blue) → `C.theme` (`--row-sel`, CSCN red / SpaceSail blue); the pending-catalog batches' altitude-range lines changed too. Measured CSCN `#ff6b6b`, SpaceSail `#4dabf7`.
- **The `?` tooltip changed to toggle semantics**: the old version "delete the old before creating the new" → clicking the same button looked unresponsive. Now clicking the same one = close, clicking another = switch.
- **Site-wide text deselection**: `body *:not(input):not(textarea)` as a fallback (covering `.seg` / `.sp-btn` / pagination / table text / top-bar date / fullscreen controls), while allowing **input boxes, the help popup, the ? tooltip, and the table data area** (the NORAD number can still be copied elsewhere to search).
- **Two real data-source problems** (see acceptance checklist §6):
  - The satellite encyclopedia **runs every day** (scheduled tasks 0:00 / 12:00), but the script "only writes the file when the statistics change" → `wiki.json`'s `asOf` semantics are "the date of the last **substantive change**". On 10-05 12:00 it actually fetched `asOf=2026-10-05` but did not write because the numbers were unchanged, so the page kept showing 9-30. **Changed to also write when asOf advances**.
  - The same script's 10-05 00:00 run failed to parse SpaceSail and directly `throw`-ed, crashing the whole script. **Changed to record it, skip that one, and process the other normally; only exit with code 1 if everything fails**.
  - **TLE never had any scheduled task** (only the encyclopedia had two) → the TLE in the release artifact froze at the packing moment. Added a `CISTrack TLE Update` task at 06:10 daily: `refresh → mkdata → build → build_release → git push`. Note that **visitors opening the web page fetch CelesTrak live anyway**; this task addresses "the offline visitor's fallback data must not be too old".
- **The in-page note** gained a "the two data sources, and how each is updated" chapter (one each in CN/EN), containing a data-source table and an explanation of the offline fallback.
- Version number `V1.7.1` (footer + exported image bottom bar + `package.json`).

### Verification

- `smoke.mjs` **249 PASS / 0 FAIL** (25 new guards this round, including two regression classes: "TLE_LIVE set timing" and "zero residue of deleted symbols")
- `visual.mjs` **80 PASS / 0 FAIL**
- Console errors **0**
- `v177_r1_verify.mjs` (a new CDP end-to-end probe): all eight requirements measured and passing
- `archive/` holds six V1.7.0 documents + five V1.7.1 documents

### Deferred to V1.7.2

**Swipe left/right on the mobile homepage's blank area to switch constellations** (original requirement 13). The user decided to schedule it as a separate round —
the page already has **six touch gestures** that would conflict: map pinch-zoom / globe one-finger pan / chart drag / drawer 520ms animation / table horizontal scroll / page vertical scroll,
and doing it badly would cause "a single swipe accidentally switching constellations". The proposal and the 6 strictly narrowed conditions are already written in `V1.7.1版本任务清单（第五轮）.md` §13,
to be reused directly when writing the V1.7.2 task list.

---

## [V1.7.0] — 2026-10-04

> This version completed two rounds following the user's new workflow of "request → task list → confirm → change → acceptance checklist":
> **Round 1: 19 items** (UI and export) + **Round 2: 9 items** (layering / animation / data / cleanup).
> Item-by-item comparison and measured numbers are in `V1.7.0验收检查清单.md`.

### Round 1 (19 items · UI and export)

**Layout**
- **The last two chapters' table-container height = 10 single-line rows (443px = header 33 + 10×41)**, with the pagination row immediately below, spaced 12px and centered; the two tables are consistent on desktop/mobile.
  `fixTableHeight` abandoned a fixed `height` (fixed height + `overflow:auto` would pull the pagination row up when fewer than 10 rows, measured −6px overlap),
  switching to `padding-bottom` to fill the shortfall + `box-sizing:border-box`; the table's own `margin-top` zeroed.
- **The first two chapters' fullscreen: removed the mistakenly added top border**, image filling the whole screen: changed to `position:absolute; inset:0; height:100vh` to fill.
  The selector must be `section#sec-map.fs-mobile` (two classes on the same element); writing `section.fs-mobile #sec-map` is a descendant selector and never matches.
- **The top-left × restored to its desktop relative size** (26px); the fullscreen search box is sized to "fully show the placeholder" (`min(56vw,300px)` / `max-width:calc(100vw-150px)`).
- **Removed the non-fullscreen print key**: in the first three chapters, the last print key is hidden when not fullscreen and the whole column shifts down automatically; fullscreen still keeps it.
- **The info window no longer covers the top bar while dragging**: `.sat-info.moving` at level 48 (< top bar 50); in fullscreen the right button column is raised to 52.

**Layering and motion**
- **The suggestion area yields to the bottom-right section pill**: the in-page suggestion area `z-index:62` < pill 75; translucent frosted glass (`blur(22px)`).
- **The fullscreen drawer opens/closes with a 520ms "slow-then-fast" non-linear curve** (the same curve as the constellation switch).

**Interaction**
- **The two constellations' scroll position / selection state / search input are triple-decoupled** (`S.scrollY = {gw,qf}` remembered individually; switching pages clears all info windows).
- **The info window's drag position is valid only for the current satellite**, resetting when the target changes.
- **Mobile selection returned to "tap"**: the touch side once had a hard-coded 4px threshold (a finger wobble necessarily exceeded it) → it appeared as "you must long-press to select";
  now unified to `TAP_SLOP`(14px), and any long-press timer implementation removed.
- **The fullscreen top-right clock pill is clickable to toggle GMT ⇄ local (GMT+8)**, GMT in short form, frosted glass.
- **Mobile orientation lock** unified entry `lockOrientation(mode)`: entering fullscreen locks landscape, exiting locks back to portrait, and on `load` it first locks portrait.

**Search**
- **Manufacturer pinyin fuzzy search**: `yinghe` / `yinghehangtian` / `yhht` / `Galaxy Space` all match (case-insensitive).
- The English suggestion's parenthetical keywords changed to English and **bolded**; all search-box placeholders unified to "supports fuzzy search"/`Fuzzy search`.

**Exported image**
- The divider and the `CISTrack` wordmark both take **the current constellation's theme color** (including the table's top-left) — fixing the issue of reading an undefined `S.net` and always showing CSCN red.
- First two chapters: `[+107 pts, 51.1°]` is appended only when a "minimum elevation" is set; chapter 3 drops the time item; the last two chapters' table top row writes only `(GMT+8 date)`.
- Fixed the overlap of the `CISTrack` row and the declaration row when too long (the declaration automatically starts a new line when space is insufficient).

### Round 2 (9 items · layering / animation / data / cleanup)

**Fixes**
- **The in-page search suggestion area is no longer covered by the next chapter's controls.** Root cause: `.search-wrap` had `backdrop-filter` → **establishing a stacking context**,
  so the child `.sug-list`'s `z-index` could not escape; and the homepage header precedes the chapters in the DOM, so at the same level 0 it is painted in DOM order,
  and the later-in-DOM `.sec-head`(44) ended up on top. Fix: give `.search-wrap` an **explicit `z-index:49`**
  (higher than page content 44/48, lower than the three exceptions: top bar 50, clock pill 70, section pill 75).
- **The fullscreen search box restored to `position:fixed`** (chapter 1 had been vertically centered as a whole). Two stacked root causes: V1.6.0's consolidation block wrote
  `.search-wrap, section.fs-mobile .fs-search-wrap` both as `position:relative` (same specificity, later wins → overriding `fixed`),
  so the search box fell back into normal flow, and was then dragged to the middle of the screen by `#sec-map:fullscreen`'s `justify-content:center`
  (measured y=464, whereas the × and clock on the same row were both at y=16). Fix: explicitly restore `position:fixed !important`, and delete that leftover flex centering.
- **The drawer's 520ms non-linear open/close finally took effect.** Root cause: `.panel-open` wrote both `left:0 !important` and `animation:drawerIn … !important`
  — ① **an author `!important` declaration outranks a CSS animation** → the keyframes were completely bypassed and there were no intermediate values when opening;
  ② **as long as an element has a running animation for `left`, the browser suppresses the `left` transition** → closing also did not move ⇒ no animation either way.
  Fix: delete `@keyframes drawerIn` and all `animation:` declarations, keeping only `left + transition`.
  Measured trajectory: open −470 → −463 → −443 → −388 → −242 → 0; close 0 → −7 → −27 → −82 → −228 → −470 (520ms, symmetric both ways).
- **The satellite table's search-box right edge aligned with the top search box.** Root cause: `.sec-head`'s `padding-right:52px` reserved for the top-right index
  (and on wide screens there was another 16px difference, section 40px vs hero 24px). Measured 68px to the left at 1440px. Fix: removed that reservation
  (the index is `position:absolute; top:14px`, on a different row from the search box, so it will not overlap) + a `-16px` compensation on wide screens → **the difference is 0 at all four widths**.
- **Exported image bottom bar: writes "Live" when the time slider was not dragged.** `shotTimeTagFront()` previously output `[0 min, X°]` when `off=0`,
  now changed to `[实时, X°]` / `[Live, X°]`; only when time was actually added/subtracted does it write `[+X min, …]` / `[−X min, …]`.

**New features**
- **Incompletely cataloged launch batches use a pale-yellow `#fddb26` frame.** The criterion **comes entirely from the data** (`launchCounts.n` / `pending` / `sats.length`),
  so as soon as the encyclopedia or TLE updates, the frame color, logic, and the "Pending catalog N" count all change automatically.
  Row classes `pend-part` (partially cataloged → tap selects all cataloged satellites) / `pend-none` (none cataloged → selects nothing), both with a yellow frame.
- **Mobile fullscreen fills the screen**: fullscreen height switched to `100dvh` (`100vh` fallback); the canvas keeps `inset:0` and is **not shrunk by safe-area**
  (no more whitespace on the punch-hole/notch side), with the safe area reserved only for controls; after entering real fullscreen it forces scroll to zero and recomputes sizes;
  when real fullscreen is rejected by the system, it no longer "does nothing when clicked", instead degrading to an in-page full-bleed screen **and showing a hint once**.

**Data and automation**
- **The local auto-update task fixed.** Investigation conclusion: the two scheduled tasks (00:00 / 12:00) did indeed fire every day, but **the result code was always
  `0x800710E0` (task refused to run)** — because `DisallowStartIfOnBatteries = true` (the laptop would not run when unplugged);
  and `scripts/fetch_wiki.mjs` depended on `playwright`, while the project **had no `node_modules`**, so even if it ran it would immediately
  `ERR_MODULE_NOT_FOUND`. Fix: ① both tasks changed to allow battery starts + start when missed (`StartWhenAvailable`)
  + a 20-minute execution limit; ② **the script rewritten to zero dependencies** (using Node's built-in `child_process` + built-in `fetch` + built-in `WebSocket` over CDP
  to launch the local Edge and pass the WAF), plus on-disk logging `logs/wiki_update.log`; ③ manual trigger verified **`Result = 0`**,
  the log showing both fetches succeeded and no commit was made because the numbers were unchanged.
- **Clarification**: these two tasks are "Wiki Update", managing only `wiki.json` (the top statistics numbers); **there is no local TLE task**;
  TLE is **fetched live in the browser when the page is opened** from CelesTrak (30-minute session cache, with a public-proxy fallback on failure),
  so online visitors already see the latest orbital elements, and `ct_*.tle` is only an offline fallback snapshot.
- **Privacy**: fetching accesses only two public encyclopedia entry pages (generic desktop UA, incognito context), producing only a set of public statistics;
  a full sensitive-information scan confirmed the release package contains no usernames / local paths / intranet addresses.

**Cleanup and engineering**
- Deleted the two never-executing copies among **3 duplicate `window.placeChartSearch`** (dead code left by historical overwrites).
- `package.json`'s version no longer pinned at 1.4.8 — the release script writes it automatically from `app.js`'s `VERSION`.
- Fixed the contradiction between the README and the repository reality (it said "build and test scripts are not committed", but they are actually all maintained with the repository).
- `.gitignore` completed: `logs/`, the probe scripts `v1??_*.mjs`, `_*.png` / `_*.txt`, `.edgeprof/` / `.edgecdp/` / `.cdp-*/`.
- The release script `build_release.mjs` changed to a **whitelist sync** and gained: producing a **version-less `CISTrack.html`** as well,
  syncing `scripts/`, syncing `package.json`'s version; the sensitive scan tightened (no longer misjudging the author's GitHub account `1471155912`
  as a local username).
- **Fixed online address**: `https://1471155912.github.io/CISTrack/CISTrack.html` (no version number, so the link stays the same across future releases);
  `index.html` changed to redirect to it.

### Regression guards (against recurrence)
- `smoke.mjs`: round 1's 10 + round 2's 8 (level 49 / fullscreen search box fixed / `@keyframes drawerIn` forbidden /
  pending-catalog yellow / export "Live" / `100dvh` / table right-edge alignment / `placeChartSearch` unique) → **179 PASS / 0 FAIL**.
- `visual.mjs`: added a **frame-by-frame trajectory** assertion (the number of intermediate frames in the drawer's open and close + "displacement < 45% of travel in the first 50% of time" = slow-then-fast),
  an in-page suggestion-area `elementFromPoint` sampling assertion, and a table search-box right-edge ≤2px alignment assertion → **0 FAIL** (stable over multiple runs).

### Round 3 (11 items · naming / state independence / screen-off / export / English UI)

> This round completed the "request → task list (with item-by-item side-effect review) → confirm → implement" workflow,
> with the list and item-by-item acceptance in `V1.7.0验收检查清单（第三轮）.md`.

**Rename: GuoWang → CSCN (complete, zero residue)**
- UI copy, top bar (GW→**CS**), chapter 0's main title (Guowang→**CSCN**), derived satellite display names
  (`国网低轨-172`→`星网低轨-172`, `Guowang LEO-172`→`CSCN LEO-172`),
  export watermark and filenames, and README / CHANGELOG / PROCESS all replaced.
- **English definition**: body text / notes / first occurrence use `CSCN` (with the full name *China Satellite Constellation Network* at first occurrence),
  **only the top-bar switch strip writes `CS`** (two letters, same width as the SpaceSail cell).
- **Kept unchanged**: original catalog names (`HULIANWANG DIGUI-178` etc.), external data-source identifiers
  (`GROUP=hulianwang`, `NAME=HULIANWANG|GUOWANG`, the `NAME_OK` regex), internal keys
  (`RAW.gw` / `S.key` / `data-c` / `--c-gw` / `ct_hulianwang.tle` / `cistrack.prefs`).
- The build artifact filename synced to `星网与千帆在轨追踪.html` (the historical snapshots in `archive/` were renamed too).
- Measured: repository-wide `国网|Guowang` hits **0**; the protected strings are still asserted one by one.

**Each constellation saves all its own state**
- New `STORE = {gw, qf}` snapshot: selection, toggles, inclination, observatory point, time progress, map view `S.mz`,
  globe view `G`, chart mode, sort, table page number…… **switching constellations no longer clears them**, but does "save → load".
- The selection is **stored by NORAD** (`S.sel` holds this constellation's array index, so restoring it directly across constellations would select the wrong satellite).
- On load, clear the observatory point's screen coordinates `mx/my` (belonging to the previous screen), `clamp` the page number, and redraw all three places at once (`afterConstelSwap()`),
  to avoid flashing one frame of "the other constellation's view".
- Persistence: `cistrack.store.v1`; when it cannot be read it falls back to defaults, without erroring or losing existing settings.

**Fixes**
- **Observatory-point visible-range dashed frame**: the theme color was cached (`TC`) and not invalidated on constellation switch → both sides showed red.
  Now `renderHeader()` calls `refreshTheme()` immediately after setting `--row-sel`; the inner fill is also unified to `C.theme` (α 0.12).
- **Drawer open animation**: switched to driving `transform: translateX()`. In the collapsed state, if `left` had pushed the drawer off-screen,
  the mobile compositor would **skip the animation** (this is exactly why "close had an animation, open did not"); now the element's layout stays on-screen,
  doing only a transform, with open and close sharing the same transition. The collapsed state gained `pointer-events:none`.
- **Freeze after screen-off unlock**: ① the `visibilitychange` listener was originally written **inside** `fullscreenchange`,
  registering one more each time fullscreen was entered/exited and never reclaiming them; ② after fullscreen re-entry was rejected, `html.pseudo-full`'s `overflow:hidden`
  locked the whole page's scrolling while the unlock code could never be reached. Now: the listener is hoisted out and registered only once; the degradation uses a **section-level `fs-stuck`**
  (keeping the fullscreen appearance, **without locking html/body**); a tap re-enters real fullscreen; a 15-second watchdog + self-healing fallback.
- **Orbit / inclination distribution on mobile required a long press to select**: the touch pan threshold was `moved > 4`, while tap required the accumulated displacement ≤ `TAP_SLOP`;
  a finger wobble would first rotate the globe / pan the chart, exceeding the limit → the tap was skipped (at map 1× pan is a no-op, so it was not visible).
  Now the threshold and tolerance are **unified to 16px**, and the tap decision uses "total displacement relative to the press point".
- **Long-press dragging the info window pops the mobile keyboard**: the project never called `blur()` → after selecting a suggestion, the input kept focus.
  Now focus is released both after selecting and when starting a drag (only the focus, without changing any layout).
- **Chapter 0's four gaps unified to 24px**: constellation-intro text→search box 46→24, search box→restore button 38→24,
  restore button→divider 61/33→24.
- **Chinese leaking into the English UI**: measured 36 places → all fixed. 34 `title` tooltips changed to `data-i18n-title` + i18n table entries in CN/EN;
  the loading mask's `lmTxt` wired into i18n; rules added for `试验星 KL-Alpha/Beta`; **"试验星XXX" unified to
  `Test Satellite XXX`** in English; `fetch_wiki.mjs`'s `toEn()` gained a translation for "theoretical value" and the existing `wiki.json` fixed accordingly.
  The suggestion area's parenthetical keywords were already handled by `localizeNote()`, and an assertion was added against regression.

**Mobile usability**
- The help button `?` **visually enlarged directly 15 → 22px** (the chart fullscreen control row 20px), the `?` font 10 → 13px.
  Its height is still smaller than the other controls on the row (25px), so the row height is unchanged and it stays vertically centered; `margin-right:7px` compensates on the right for the extra width
  → **the row layout is completely unchanged**, and it does not push away the adjacent buttons.
- The slider height was **not changed** per the user's decision.

**Export**
- Resolution: no longer copies screen pixels directly (which equals "screen resolution"; on a computer with dpr=1, exporting gives 1×).
  Changed to rebuilding and redrawing at a higher multiplier **within the same synchronous function**, restoring immediately after export → the page display is completely unchanged, with no flicker.
  The multipliers, high to low, are `[3, 2.5, 2, 1.75, 1.5, 1.25, 1]`, judged by `toBlob`'s **actual byte count**,
  **stepping up while ≤ 12MB and stopping once exceeded**; constrained by `CANVAS_MAX_SIDE=4096`, degrading automatically on failure.
- Naming: `CISTrack_星网_地图_2026-10-05_实时.png` / `CISTrack_CS_Map_2026-10-05_Live.png` /
  `CISTrack_SS_Orbit_2026-10-05_+12min.png`. English uses a **separate ASCII mapping table**
  (`CS`/`SS`/`Map`/`Orbit`/`IncDist`/`SatTable`/`Launch`), all symbols ASCII.

**Regression guards**
- `smoke.mjs` gained 13 round-3 assertions (rename zero residue + protected strings intact, all titles i18n'd, per-constellation state,
  theme-color cache invalidation, blur, no listener leak, fs-stuck, export naming and the 12MB multiplier, chapter 0 spacing, wiki.json zero Chinese in English)
  → **196 PASS / 0 FAIL**.
- `visual.mjs`'s drawer-trajectory assertion changed to **measured endpoints** (no longer hard-coded old values) → **80 PASS / 0 FAIL**.

### Round-3 final corrections (rework after the user's on-device feedback)

- **Satellite names reverted to "the source platform's original naming"**: the previous round had mistakenly put the constellation brand onto the satellite display names too. Now reverted to
  `HULIANWANG DIGUI-128` → **互联网低轨-128**, `HULIANWANG JISHU SHIYAN / HJS` → **互联网技术试验**;
  **English always shows the original catalog name** (no more rewrites like `CSCN LEO-174`). The constellation brand is used only for **UI copy** such as the top bar / title / notes.
- **Root cause of the two constellations' settings "linking"**: when the target constellation "had not yet built a snapshot", `applyConstel()` returned directly,
  so it **inherited** the current constellation's settings (change the minimum elevation, switch over, and the other changed too).
  Now at startup a **factory-default** snapshot is taken first (`initStore()` / `STORE_DEF`), falling back to factory defaults when there is no personal snapshot.
- **Export button does nothing / downloads a low-res old image (major)**: two root causes —
  ① `fitCanvas()` would scale the temporarily enlarged canvas **back down to screen resolution** per `devicePixelRatio` (now overridden with `EXPORT_DPR`);
  ② when redrawing, `drawMap()/drawGlobe()` did not pass `frameStates` → could not get satellite state and aborted (now passed the same way as the main loop);
  ③ plus a fallback: when all tiers fail, at least export the current frame, no longer "no response at all".
  The watermark still showed the old constellation name because `build/satdata.json` **had not been regenerated** (fixed).
- **Mobile tap still required a long press (root-caused)**: chapter 3 (inclination distribution) **previously had no `click` listener at all** —
  on mobile, tapping could only rely on the pointer path, and once the browser judged it a scroll gesture it could never be selected; the map/orbit both had a `click` fallback,
  so only chapter 3 had the problem. Now chapter 3 gets **exactly the same** `click` fallback as the map + 600ms timestamp dedup;
  and the globe's click changed from "looking only at `G.hover`" (touch has no hover at all) to **hitting directly by click position**.
- **Orientation lock re-hardened**: homepage fixed portrait, fullscreen landscape, exiting fullscreen back to portrait.
  `screen.orientation.lock()` takes effect only in fullscreen + a user gesture, so it is done in three tiers: lock if possible (with retry),
  show a "please rotate" hint bar if it cannot lock, and correct once more on rotation.
- **Reverted "mobile fullscreen fills the screen"**: the user confirmed the effect was poor, so `100dvh` and the related safe-area changes are **all reverted**, returning to pure `100vh`.

### Round-3 final, second-correction round (this round · export sharpness / truly independent settings / top-bar coloring / auto-cleanup)

> After re-verifying on a real device, the user still reported three places "not root-caused"; each was traced to its root cause and fixed; "auto-cleanup" and several improvements were also completed.
> Item-by-item comparison and measured numbers are in `V1.7.0验收检查清单（第三轮末）.md`.

**① Exported images "still only a few hundred KB" — the root cause is the multiplier ceiling, not a failure to redraw**
- The previous version did redraw, but the multiplier was hard-coded to `[3, 2.5, 2, …]`, so **the ceiling was only 3×**.
  On mobile the canvas's CSS width is about 358–390px, and 3× gives only 1077–1170px wide → the PNG is naturally only a few hundred KB.
- Now the maximum multiplier is **back-derived** from the geometry: `canvas CSS long side × multiplier ≤ 4096` (the GPU texture limit),
  plus a **total-pixel** safety line (16M, the mobile canvas area cap), so mobile can push the long side to 4096 just like desktop.
- The area budget **reserves the bottom info-bar's height** (`shotStepsFor(cv, 80)`), otherwise `{width×height + info bar}`
  would break the device's canvas area cap, wasting a high-multiplier redraw.
- The size definition is unified through `canvasBox()` (the same fallback set as `fitCanvas`), no longer using `cv.width` —
  before a map/orbit canvas has been drawn, its `width` is just the HTML default 300×150, and back-deriving from it would give absurd values like 13×.
- **The 12MB cap changed to "one more geometric midpoint between the over-limit and passing tiers"**: the tiers decrease geometrically by 0.78,
  so 4096 wide over-limit → 3195 wide passes, leaving a large stretch of sharpness unused near 12MB in between. Now one midpoint probe is added (only once, with a hard gate against lengthening),
  and the map measured going from 3195×2683 to **3619×3038 / about 11.0MB**.
- **The export instant now includes the time-slider offset**: the old version passed a bare `Date.now()`, so dragging to +120 minutes and exporting
  still showed the satellites at "now" on the chart, with only the bottom bar writing `[+120 min]` (mismatched image and text). Now it passes `Date.now() + offset`.
- **Measured** (headless Edge · mobile viewport 390×844 @3x, probe `过程归档/cdp探针/v176_expmeasure.mjs`):

  | View | Per-tier record | Final adopted |
  |---|---|---|
  | Map | `4096×3439 → 13.0MB` over-limit → `3195×2683 → 9.3MB` passes → **midpoint** `3619×3038 → 11.0MB` passes | **3619×3038 / ≈11.0MB** |
  | Orbit | `3195×3929 → 9.9MB` (first tier passes) | **3195×3929 / ≈9.9MB** |
  | Inclination Distribution | `3666×3906 → 0.58MB` (first tier passes) | **3666×3906 / 0.58MB** |
  | Table · current page | `4095×1071 → 0.58MB` | **4095×1071 / 0.58MB** |
  | Table · all | `2793×9876 → 4.8MB` | **2793×9876 / 4.8MB** |

  > The numbers **fluctuate slightly over time** (different satellite positions → different PNG compression), with the map re-measured at 11.01 / 11.08MB, which is normal.
  > **The inclination distribution / table being only 0.58MB is normal**: they are both ~14-megapixel images, but large flat-color backgrounds + thin lines
  > are naturally tiny after lossless PNG compression — judge by **pixel dimensions** (long side 3666 / 4095px), **not by file size**.
- Also fixed a bug that only surfaces when exporting on a real device: the time label in the filename was written as
  `+String.fromCharCode(43)`, and the unary `+` converted the string `"+"` into the number `NaN`,
  so exporting after dragging the time slider produced `CISTrack_星网_地图_…_NaN分.png`. It **only triggered when `off>0`**, and had never been found before.

**② The two constellations' settings are "thoroughly" independent — the time slider was just the most visible one**
- The time slider's root cause: `syncControlsFromS()` wrote back to `#sec-chart .time-r`,
  **but there is no such element on the page at all** (the real two are in the chapter 01 map / chapter 02 orbit sections). The control display values were never written back,
  so after switching constellations the two sliders still sat at the previous constellation's old value, and one drag wrote the old value back into `S.timeOffset` → appearing as "linking".
  Now unified through `setOffset(S.timeOffset)`, refreshing both sliders in one pass + the right-side "Now / +X min" text + the `shifted` highlight + the fullscreen clock state.
- **The color-mode segment buttons fell into the same trap**: the attribute template `[data-color-scope="X"]` did not exist at all,
  and the fallback `#sec-chart .seg-mini` was also wrong (chapter 3's container is `.seg`), so only the map/orbit of the three were written back.
  Now unified to `.seg[data-scope="X"]`.
- **The table sort header** (▲/▼ are class names, not values) was also not written back; now added.
- **The chart zoom/pan** was reset to "auto" by `chartAutoView()` on every constellation switch, which did not count as "saved per constellation".
  Now stored in the snapshot (`chartView`), and restored after `rebuild()` finishes (`pendingChartView`).
- Full re-verification (headless Edge, mobile viewport): CSCN changed to "time 77 min / min elevation 35° / observatory point 7° / all three toggles flipped /
  color all changed to batch / vertical axis perigee / Kepler / batch filter 23095 / sorted by inclination" → switch to SpaceSail (should be all factory defaults) →
  change SpaceSail to another set → switch back to CSCN → **item-by-item fully consistent**; switching to SpaceSail again is also fully consistent. CDP mechanical comparison 2/2 passed.

**③ The top bar's "CSCN / SpaceSail" button theme colors — suppressed by mutually overriding `!important`**
- Root cause: the old rules `.constel button.on{color:var(--bg)}` and `:not(.on){color:var(--dim)}` **both carried `!important`**,
  which entirely overrode the `[data-c="gw"]/[data-c="qf"]` tinting rules added in the previous round (which carried no `!important`),
  so whether selected or not, the user always saw "a background-colored word block" and "gray text", with no theme color at all.
- Now: ① the text is **permanently** tinted with its own theme color (with `!important`, ensuring it beats `.seg button.on`'s base coloring);
  ② the selected state uses a "theme-color tinted background + solid border" slider (`--c-gw-tint` / `--c-qf-tint`),
  so the colored text is legible whether selected or not; ③ the slider DOM moved **after** the two buttons,
  so a sibling selector `.constel button[data-c="gw"].on ~ .seg-slider` can pick the color in pure CSS, leaving no inline color and not failing when the theme changes.
- Measured computed styles: CSCN `rgb(255,107,107)`, SpaceSail `rgb(77,171,247)`; slider background `rgba(255,107,107,0.2)`, border `rgb(255,107,107)`;
  after switching to SpaceSail the slider becomes `rgba(77,171,247,0.2)`. CN/EN (CS / SS) use the same rule set.

**④ Auto-clean project files "unrelated to both the current and archived versions"**
- New `clean.mjs`: whitelist-based, **move-only, never delete** (hits are all moved into `junk/<timestamp>/`, and can be moved back wholesale at any time), **dry-run by default**.
  The current-version manifest (build inputs / data / docs / artifacts) + `archive/` snapshots + `过程归档/` are never touched;
  `_probe.html` / `_*.mjs` / `.*.txt` logs / headless-browser user-data directories / screenshots and export samples in `shots/` that are not current-version assets → moved away.
- Wired into two build flows: `build.mjs` auto-cleans before each build (`CISTRACK_NO_CLEAN=1` skips it, **never blocking the build**),
  and `build_release.mjs` cleans the source directory before syncing, then runs a read-only health check on the release area.
- Measured: **955 MB** cleaned out (the vast majority being the headless Edge user-data directories `.edgeprof` / `.edgeprof2`, about 450–500 MB each).
- `.gitignore` completed with these patterns; `package.json` gained two scripts, `clean` / `clean:apply`.
- ⚠️ An implementation pitfall: `clean.mjs` early on used `execFileSync` to spawn a child process to call itself,
  which **reliably reported EBUSY** (under Windows the same node.exe is occupied when spawned again).
  Now changed to an **in-module call** (`clean.mjs` exports `scan/applyMove/report`, and `build.mjs` imports it with `await import()`).

**⑤ Improvements along the way**
- Show a progress hint bar during export (redrawing is synchronously blocking and takes two or three seconds on mobile; without a hint users would think "clicking does nothing";
  on completion it shows the final pixel size, e.g. "exported 3619×3038").
- The table export's filename no longer repeats the section name (`…_卫星表格_卫星表格_p1…` → `…_卫星表格_p1…`).
- The table export also uses the same adaptive multiplier (the old version hard-coded 2×, which on mobile meant exporting a 390px-wide table at 780px).
- `visual.mjs`'s `findStablePoint` gained a null-pointer guard: on retry, if no candidate point could be scanned it would crash the whole test process; now it judges a failure and continues.
- The constellation switch called `afterConstelSwap()` twice by mistake (left by the same change); removed one.
- `package.json`'s `version` synced from 1.4.8 to 1.7.0 (the release script writes it automatically, but the source directory's copy should keep up too).
- The leftover "国网" in `index.html` / `package.json` changed to "星网" (previously missed, completing the zero-residue rename).

### Regression guards (8 new this round)
- Top-bar buttons permanently tinted with the theme color (and asserting the old `!important` rules **must not exist**),
  the top-bar slider's color picking (sibling selector + tinted-background variable + the slider must be `appendChild`-ed), the time-slider write-back (the old wrong selector must not exist),
  the color-mode segment selector matching the template class name, the sort header written back with the constellation, independent chart zoom,
  the export multiplier adaptive + 12MB + geometric midpoint + area budget including the info bar + unified size definition, the export instant with the time offset + progress hint,
  and the time label not being turned into NaN by the unary `+`.
- `smoke.mjs` → **209 PASS / 0 FAIL**; `visual.mjs` → **80 PASS / 0 FAIL**.

### Round 4 (8 items · epoch definition / chart limits / yellow frame / English title and intro / full restore / top-bar centering)

> Item-by-item comparison and measured numbers (including screenshots) are in `V1.7.0验收检查清单（第四轮）.md`.
> `smoke.mjs` → **224 PASS / 0 FAIL**; `visual.mjs` → **77 PASS / 0 FAIL**.

**Unified epoch definition (requirement 1)**
- The top bar / loading ring / info window / exported image's four epochs are **consistent for the first time**: all take "the catalog's latest epoch = TLE update time",
  and a single satellite's own epoch is on its own row labeled "this satellite's epoch"; the exported image's info line's last item changed to "data update <catalog latest epoch> UTC".
- New **`TLE_LIVE`** flag: on network failure, the top bar / loading ring / info window / exported image all carry "（built-in snapshot）",
  and the top bar's hover tooltip states "could not update online…" — **whether the data is actually up to date is visible for the first time**.
  (The old page gave no hint about this at all; the user seeing 9/29 instead of the current day was exactly the symptom of a network failure.)
- Fixed a timing bug introduced by this round itself: `TLE_LIVE = true` was originally written after `applyFresh()`, but
  `applyFresh → rebuild() → renderHeader()` reads it immediately → **a successful network update would be mislabeled as a snapshot too**. Changed to set it first, with a guard pinning the order.

**Chapter 0 (requirements 2 / 5a / 5b)**
- Added a "**Satwiki info update**" row below "first launch" (taking `wiki.json`'s `asOf`, formatted consistently with the row above),
  shifting the elements below it down by one row.
- The English main title dropped `Orbit`; the constellation names `CSCN`→**`CSCN/GW`**, `Qianfan`→**`SpaceSail/Qianfan`**;
  on narrow screens (≤1100px) it breaks into three lines `constellation name / Constellation / Live Status`.
  **Fixed a concatenation bug**: a `display:none` `<br>` produces no space, so wide screens rendered `CSCN/GWConstellation` —
  changed to "a space + a hideable `<br>`", giving a space on wide screens and the trailing space eaten by CSS on narrow screens.
- The four intro paragraphs rewritten per the specified text (CN/EN × CSCN/SpaceSail), with bold and theme-color tinting strictly within the specified range (organizer/operator are bolded only, not tinted).

**Inclination-distribution limits (requirement 3)**
- Added physical boundaries `0–90°` × `0–36500 km` (GEO) and `clampChartView()`, wired into **all 8** zoom/pan paths;
  when a boundary falls within the viewport, a dashed boundary line is drawn labeled `90°` / `36500 km (GEO)`. Measured: after zooming out ×70 with the wheel, the view is pinned to the full range and cannot zoom further out.

**Launch-history uncataloged rows (requirement 4)**
- Deleted the three "overcorrecting" tint/dim rules (`.ltable td.pend`, `.pend-*/.tag` tinting),
  keeping only the amber border + first-column color bar when selected. Measured: a selected uncataloged row and a selected normal row are **identical item by item except for the border color**
  (text color / weight / opacity / background all the same).

**Full restore (requirement 6)**
- `storeSave`/`storeLoad` deprecated: state now travels only through an in-memory snapshot within the session (constellation switches do not interfere), no longer persisted; startup clears leftover old keys.
- `resetAllPrefs()` upgraded to a **full restore**: the three chart views, selection and batch, both tables' page numbers, all search boxes and suggestion areas, observatory point,
  time offset, globe attitude, map zoom-pan, chart view, **the two constellations' session snapshots**, and **theme** all reset to zero.
- Extracted `setTheme()` shared by the theme button and the restore button; **measured zero field-by-field difference between the three restore paths (click button / refresh / re-open link) and a clean baseline**.
- Deleted the dead code `prefLoad()` / `prefSave()` (zero call sites since V1.4.1, and the only remaining localStorage writes in the whole file)
  and the theme button's never-read `localStorage.setItem('theme', …)`.
- The in-page README's CN/EN descriptions of "settings written to localStorage / remembered" changed to "effective globally within the session, fully restored in all three cases"
  (the original text directly contradicted requirement 6).

**Top-bar button centering (requirement 7)**
- `.nav-actions .seg.constel button` changed to `inline-flex + align-items:center + padding-bottom:2px`,
  with `.cn` adding `margin-right:-0.16em` to offset the last character's letter-spacing. Measured: the ink center is 1px higher than the button center (a deliberate CJK/all-caps optical compensation),
  with consistent deviation across all four CN/EN buttons.

**Project review (requirement 8)**
- 🔴 **Found that the English UI's top bar pushes the right-side buttons (constellation switch / EN / theme) off the screen at widths ~1151–1680px**,
  with `overflow-x:hidden` and no horizontal scrollbar → completely invisible and unclickable. The root cause is the long English section names
  (`Inclination Distribution` alone is 209px) + `letter-spacing:.14em` + `gap:28px`, while the breakpoint hiding the nav links is at 1150px.
  `visual.mjs`'s "no element crossing the right edge" only scans `<section>`, **not covering the top bar**, so it was never detected.
  The proposed fix (not implemented) is in acceptance checklist §10.
- The `visual.mjs` "click-select on the three charts" suite's intermittent FAIL was confirmed to be **a race in the test itself** (the first hit point is always on the ellipse's outer edge + the info window returns to the landing point before the click),
  unrelated to the version; and "top-left corner can also be selected" was silently skipped when no point could be scanned, causing the total assertion count to differ between runs (83 vs 77).

---

## [V1.6.3] — 2026-10-04

### Fixes
- **Many launch-history records were unclickable**: when clicking a pending-catalog / no-TLE batch, `selectGroup` could not find the satellites → no feedback at all.
  Now a row-level selected state is given; and each batch is **back-filled with its count** (data source `launchCounts`), so even without a TLE it shows "N sats" (writing 1 sat even when there is one).
- **Chinese residue in the English UI**: `cnName`/`batchName` completed with `试验星XX` → `Test Sat XX`, `高轨XX星` → `High-Orbit Sat XX`
  (the data contains both "试验星03组" and "试验星03" without "组", all covered).
- **The first three chapters' print key was damaged**: the square-button style was previously **global** `.shot`, which mistakenly hit the first three chapters' SVG print key; now scoped to the table export key.
- **Mobile non-fullscreen leaked the triangle key**: `.fs-panel-btn` was `display:flex` by default; changed to `none` by default, shown only under `.fs-mobile`.
- **The table collapsed when not full / page 2 was pushed out with whitespace**: `fixTableHeight` switched to a fixed row-height baseline;
  pagination changed from "fixed row count" to "fixed row units" (a long-content row counts as 2 units), making each page's total height consistent (measured spread 1px).
- **The homepage pill was simplified**: `tickClock`'s narrow-screen short format had affected the homepage pill; now the homepage always uses the full format,
  and **a single space** is used between the date and time (no longer "T"), shortening the pill length and keeping it centered.
- **Text invisible in light mode**: 4 hard-coded `color:#fff` (help key, print-popup button, page-number input) changed to `var(--fg)`.
- **Clicking a batch in the suggestion area did nothing**: the batch item's `data-lk` mistakenly used `cospar` (`2023-095`), while `selectGroup` expected a bare number (`23095`) → changed to `launch.key`.

### New features
- **Manufacturer fuzzy search delivered**: the real cause was that `makers`' key (a bare number) did not match `L.cospar` (with the `20` prefix) →
  changed to compare against `L.key`, and to match bidirectionally using **all** of the institution's aliases.
  Measured: `histarlink` / `微小卫星` / `shanghaiweixiao` / `五院` / `银河航天` all return results.
- **Multiple selections show only one info window**: `syncSelInfo` changed to take the one with the **smallest NORAD number** (no more overlapping windows).
- **The inclination-distribution batch frame auto-reverts**: automatically returns to "all" after selecting a satellite; the label renamed to "batch/group" / `Batch/Group`.
- **Mobile fullscreen info window**: `syncSelInfo` dropped the `!frameStates` condition (in fullscreen that value may not have been recomputed yet, causing it to never show).
- **The language-switch animation changed to a brightness transition**: new overlay `#langVeil` (z-index 78, higher than the pills 70/75, lower than the top bar) —
  the main content and the pills together "dim to black/white → swap the copy → gradually reveal", starting and ending simultaneously with the top bar's retract-and-drop, two symmetric segments, slow-then-fast.
- **Image output reworked**: the band moved below the image (not covering the frame) + a themed thin divider; `CISTrack` uses the same font as the logo and is tinted with the theme color;
  the parts now separated by `|`; after the time it labels `[实时]`/`[Live]` or `[+X min]`; when satellites are selected it first writes a satellite-info row (one per satellite);
  the last two chapters drop the duplicated bottom row, keeping only the bottom-right declaration, with the page count merged into the top row.
- **Unified info-window format**: the order is fixed to NORAD → batch/group → perigee×apogee → inclination → period → launch date → update epoch;
  removed "semi-major axis" and "catalog name"; consistent across CN/EN, light/dark, and fullscreen. The info window switches language with the language switch.
- **Mobile fullscreen layout**: the inclination-distribution × has equal top/bottom and left/right margins, the control row shifts left accordingly, and the search box lengthens; the first two chapters' search boxes are shortened further to avoid pressing the pill.
- **Table pagination key**: height unified to 26px, text centered both ways; the export key changed to a 26×26 square icon (text removed).

---

## [V1.6.2] — 2026-10-03

### Fixes
- **The fullscreen drawer open/close animation finally right**: the real culprit was the \`visibility:hidden\` added in the previous round as a "do not expose" fallback —
  it had no transition, hiding immediately on collapse, so it looked like "instantly disappearing"; meanwhile the two displacement mechanisms \`transform\` and \`left\`
  stacked, and the former was suppressed by the CSS keyframes, making opening stiff. Now **only the \`left\` mechanism is kept** (520ms "slow-then-fast"),
  and all visibility fallbacks are deleted — the whole open/close process is visible.
  Measured close sequence: left -50.8 → -128.8 → -430 (slow-then-fast).

### Changes (mobile)
- **The fullscreen search box lengthened** (\`min(42vw,236px)\`, measured 164px), so the placeholder "supports fuzzy and mixed search" shows fully;
  a **44px** gap is kept from the right pill.
- **The time pill uses the short format on narrow screens**: \`GMT+8 HH:MM:SS\` (live region, bold, measured width 104px),
  with the border-color change logic unchanged (turning to a yellow breath when the time is pushed away from "now"); desktop still shows the full date and time.
- **The brand name enlarged to 27px** (keeping vertical centering and left alignment unchanged, still leaving a gap from the constellation buttons on the right).

### Known TODOs (next version)
- **Mixed search is not implemented yet**: at present search still only does a simple filter by satellite name; the user's requests —
  "numeric fuzzy (name number → group/batch → COSPAR rocket → NORAD)", "rocket names (CN/EN full/short/alias/pinyin + model serial)"
  "launch facilities (spaceport / pad / launch ship / sea area, fault-tolerant input + multi-language)", "manufacturers (multi-language + support for combining multiple manufacturers)",
  as well as paired parenthetical annotations (bold, ellipsized when too long), search history (per-constellation, shared across CN/EN, cleared on refresh, most recent 6, with dividers)
  — are all **still to be implemented**. This is a fairly large change requiring an alias/pinyin mapping table and a rewritten suggestion engine, to be done specifically in the next version.

---

## [V1.6.1] — 2026-10-02

### Fixes
- **The fullscreen drawer was exposed when collapsed** (desktop and mobile, affecting map/orbit/inclination distribution): it previously used
  \`translateX(-102%)\` (a percentage of its own width, so it did not collapse cleanly on narrow widths), and was suppressed by keyframe animations (transform) such as
  \`.reveal\`. Now changed to a **\`left:calc(-100% - 40px)\`** position (unaffected by animations)
  with **\`visibility:hidden\`** as a second safety net — **nothing is exposed at all** when collapsed, and it shows normally when open.
- **A "mysterious drawer" appearing in the orbit-distribution chapter in fullscreen**: the same root cause, eliminated by the above fix.

### Changes
- **Chapter 03 orbit-distribution fullscreen layout**: the search box moved to the **end** of the control row (swapping positions with "by batch"); the **× button merged into the same row's**
  start (no longer occupying the top-left corner alone), on the same baseline as the whole row's buttons.
- **Mobile brand name**: font size set to 30px with a locked line height of 32px, flush with the right button's top and bottom edges.
- **The mobile map/orbit chapters' fullscreen search boxes** narrowed to 148px (26vw), leaving a gap from the right time pill and staying centered;
  this layout is **fixed** this round, not to be changed later.
- **Light/dark switch**: changed to an independent duration (560ms, slightly shorter than the language switch) and explicitly uses a "slow-then-fast" easing; also suppressed the browser's
  default fade, keeping only the circular wipe expanding from the top-right button.

### Language switch (redone)
- The top bar changed to **"retract upward as a whole → expand downward"**: in the first 310ms the whole top bar moves off the top of the screen while the page is wiped from the bottom up;
  at the halfway point the copy is updated uniformly (at this time the top bar is off-screen and the page fully wiped, so any jump is invisible); in the last 310ms the top bar
  drops back down from above while the page grows from the bottom up. **Both start and end together**, both easing "slow-then-fast".
- Measured: top-bar Y displacement -2 → -11 → -62 → (halfway) → -58 → -41 → 0; page clipping 2.9% → 17% → 100% → 93% → 66% → 0.

### Known issues (recorded honestly)
- The visual regression's 3 globe (orbit chart) selection cases and 1 map finger-wobble case **failed twice in a row this round**;
  they depend on the relatively fragile operation path of "scan the canvas for a satellite point, then click". It is **not yet determined** whether this is related to this round's
  unification of the 26 rules' scope from \`:fullscreen\` to \`.fs-mobile\`. Manual verification: open the page, scroll to
  the "orbit situation" chapter, click a satellite point on the canvas, and see whether the info window pops up. **If it fails, that batch of replacements will be reverted immediately.**

---

### V1.6.1 addendum (fullscreen interaction details)
- **The drawer open/close animation restored**: after switching to the \`left\` transition, the transition was forgotten, turning open/close into a teleport. Now the
  "slow-then-fast" transition is added, and the \`visibility\` switch is delayed until the animation ends — the whole close/open process is fully visible.
- **The × button returns to its original position in the screen's top-left** (it had been moved into the control row, shifting the whole block right); keeping only "vertically aligned with the control row's first line".
- **The control row is symmetrically padded left and right** (a distance from the × right edge), so the two mobile control rows align at the right end; meanwhile the row's scrolling is removed,
  its height hugging the content, with the bottom edge flush against the second control row.
- **Search-box position**: on desktop it is placed last in the control row; on mobile it is placed between "by batch" and "default settings" (distinguished by DOM position + CSS
  \`order\`).
- **Deleted the orbit-distribution "reset view" button**; and added a null check to its event binding (after the button was removed the original code would throw a null reference).
- **Mobile (including landscape, breakpoint relaxed to 900px)**: the first two chapters' fullscreen search boxes narrowed (measured 140px), leaving a gap from the right time pill
  (measured 101px); the time pill and search box have the same height (36px) and aligned top edges, and this fine-tuning also applies to desktop.
- To be confirmed: on **narrow portrait (390px)**, the time pill may still overlap the search box when its content is long; it needs on-device confirmation before deciding
  (optional approach: on narrow screens keep only the time part of the pill).

---

## [V1.6.2] — 2026-10-03 wrap-up

### Fixes
- **Drawer open animation**: the `left` transition had no starting value "when the element is first shown" and did not trigger, so opening was always a jump.
  Changed to \`@keyframes drawerIn\` (with an explicit 0% start point), 520ms "slow-then-fast" like the close.
- **The launch-history list was entirely unselectable**: the `#launchBody` click handler returned directly upon encountering a `<tr>`,
  while the row itself carried \`data-lk\`, so the whole table did nothing when clicked. Now changed to selecting the corresponding batch by row.
- **Chinese residue in the English UI**: completed the satellite-name English rules (`试验星 XX` → \`Test Sat XX\`, `高轨 XX 星` → \`High-Orbit Sat XX\`).

### Changes
- **Chapter 03 renamed "Inclination Distribution"** (English \`Inclination Distribution\`), with the top-bar jump and page title synced.
- **The table's "export image" changed to a square icon button** (text removed in both languages, accessibility label kept), the same height (26×24) as
  "first/last page" on the same row, with the bottom-right position unchanged.
- The header "manufacturer" unified to **Manufacturer** (consistent across CN/EN).

### Known uncompleted
- **Manufacturer fuzzy search still does not work**: the data is in place (\`SATDATA.gw.makers\` 40 entries / qf 19 entries,
  the data-generation script rerun), and the alias table was rebuilt from the manually supplemented list (15 entries with CN/EN and pinyin),
  but the runtime cannot retrieve the records — located to `cur()` being outside the closure and the internal CONST build possibly discarding `makers`,
  requiring further reading of the CONST build logic. The three search classes of rocket / launch site / numeric chain are all measured working.

---

### V1.6.1 addendum two (mobile layout final)
- **The drawer open/close animation is finally noticeable**: it previously used a \`left\` transition (260ms), but the whole CSCN↔SpaceSail switch is 520ms,
  and the drawer was only half of it, so it felt like a teleport. Now changed to **520ms** (\`--anim-t\`) + "slow-then-fast", the same length as the page switch.
  Measured close process left: -7.6 → -54 → -176 → -528 → -1305 (slow-then-fast clearly visible).
- **Mobile top bar**: the brand name shrunk to 20px and moved left, **10px from the left**; the constellation switch button shortened to 56×30 and
  equal height (30px) with the CN/EN and light/dark buttons, with the three's top edges on the same line; **the light/dark button's right edge is 10px from the screen edge** — symmetric with the brand's left
  distance. Desktop also shortens the constellation button. (The light/dark animation and expansion origin are unchanged, still taking the button's geometric center.)
- **The first two chapters' mobile fullscreen search box**: no longer centered, **left-aligned 14px from the × button's right side**, width \`min(32vw,200px)\` (measured 125px,
  **not crossing the screen's midline**); × / search box / time pill **all the same height 36px, top edges aligned**; on narrow screens the time pill narrows to 132px
  (font 9.5px), leaving a **55px gap** from the search box.
- **Orbit-distribution mobile**: the default-settings group moved to the end of the first row, and the search box occupies the second row alone and lengthens (measured width 300px, 20px from the right).

---

## [V1.6.0] — 2026-10-02

### New: non-linear animation system (a product-level upgrade)

Unified parameters: total duration **520ms** (all motions start together and end together); "slow-then-fast" = `cubic-bezier(.92,.02,.98,.46)`,
"fast-then-slow" = `cubic-bezier(.02,.72,.16,1)`.

**① CSCN ⇄ SpaceSail switch (horizontal)** — four motions synchronized:
- The constellation button's inverted color block changed to a **slider** that moves to the target item smoothly and non-linearly (no more instant on/off);
- The page's main content slides out first and the new content slides in from the opposite side (simulating "the new page pushing the old one away");
- The top-bar CISTrack is swept by a tight two-color gradient of the **constellation theme colors** (CSCN red ⇄ SpaceSail blue), mirrored with the switch direction;
- The bottom-right section pill's border color **switches off then lights up** in the new color.
- Direction: CSCN on the left, SpaceSail on the right → CSCN→SpaceSail is "right to left", the reverse fully symmetric.

**② CN/EN switch (vertical)** — same parameters as the constellation switch:
- The **entire top bar** does a two-row up/down roll (the old copy slides out as a whole, the new slides in as a whole, avoiding jitter from each button's width changing);
- The main content is **wiped from the bottom up → grows from the bottom up** (`clip-path`, slow-then-fast), with the charts and tables inside it too;
- The GW/SS and CSCN/SpaceSail buttons are unified to equal width and position; CN→EN bottom-up, EN→CN symmetric reverse.

**③ Suggestion-area open/close animation**: the search suggestion area's expand/collapse changed to a non-linear transition (slow-then-fast), and **all five search boxes**
(page top, satellite table, three fullscreen chapters) support it: click blank space to collapse, click the input again to collapse, blur to collapse.

### Fixes
- **The fullscreen search box and suggestion area pinned to the top** (z-index 78 / 79) and unified to **translucent frosted glass** (the same background as the top bar + 22px blur),
  no longer covered by satellite orbits or the visible area.
- **The fullscreen control panel's width adapts to its content** (measured from 1137px down to 547px), hugging the rightmost control on the right with only the inner padding as distance;
  this rule applies to all three chapters' fullscreen small windows.
- Long English nav copy pushed the brand name onto two lines → the brand area does not wrap and does not shrink.

### Quality
- Smoke **162 items**, visual **77 items** all passing; five viewport tiers (desktop/tablet/portrait phone/landscape phone/small screen)
  with zero horizontal overflow, zero element overlap, and **zero console errors**.
- All motions measured with computed values: slider displacement, the `clip-path` sequence, the gradient `background-position` curve,
  the top-bar two-row displacement, etc., confirming "slow-then-fast" and synchronization.

---

### V1.6.0 addendum (fullscreen layout and switch animation)
- **Chapter 03 orbit-distribution fullscreen**: the search box merged into the control row, placed on the same baseline after "model (Brouwer/Kepler)", with the row's controls unified to equal height;
  on mobile, when it wraps to two rows the search box falls to the second row and centers; exiting fullscreen moves it back automatically.
- **Fullscreen × button**: unified across the three chapters to 26px and centered; the control area shifts right as a whole (measured 44px of clearance), no longer covered by the ×.
- **Language switch**: a separate milder duration (760ms); the top bar's "change text then move" is completely eliminated (the first 380ms is carried by the old copy layer, the
  real top bar hidden, and only at the halfway point is the copy swapped and slid in); the easing is the same "slow-then-fast" as the constellation switch.
- **Light/dark switch**: changed to a **circular wipe** expanding from the top-right button (View Transitions + `clip-path:circle`),
  with duration and easing as above; it has idempotency and a fallback, so it still switches normally when VT is unavailable.
- Engineering note: fullscreen-specific styles always use the `.fs-mobile` class rather than the `:fullscreen` pseudo-class (the latter does not match in headless/simulated environments,
  which once caused two "appears not to take effect" cases).

---

## [V1.5.3] — 2026-10-02

### Fixes
- **The main-page and table search boxes lost their suggestions**: the previous version placed the "fullscreen search box registration" code **after** the binding loop,
  so once the registration threw, it affected the subsequent binding too. Now the registration is moved before the binding loop, and the main page's two search boxes
  (top / table) share the same binding set as the fullscreen search box — measured, all three places' suggestions and selection work normally (18 candidates each).
- **Mobile fullscreen no longer forces landscape**: the fullscreen transition is asynchronous, and the lock was often rejected by the browser at that instant. Changed to
  **retrying 5 times (150ms apart)** after fullscreen takes effect, ensuring the landscape lock really takes.

### Changes
- **Removed the "reset view" button** (fullscreen top-left and the section control area): the bottom-right button column already has "restore initial view", so the function was duplicated.
- **Satellite table**: removed the "all columns" toggle and the "default settings" button; the table **always shows all columns**.
- **The search box above the table moved to the right**, aligned with the page-top search box.
- **The three chapters' info windows unified in appearance**: the special-case styles of the 01 map and 03 orbit-distribution chapters were removed, all adopting chapter 02's
  set (border, size cap, inner padding, and top-right close button fully consistent).
- **Mobile adaptation**: the top bar keeps the CISTrack logo; the fullscreen top search box narrows to 200px (the search key scaled to 22%),
  keeping a distance from the top-right time pill; the fullscreen × button font enlarged to 22px and the △ icon to 19px, for easier finger tapping.

### Quality
- Smoke 153 items, visual checks all passing; five viewport tiers (desktop/tablet/portrait phone/landscape phone/small screen) with no horizontal overflow,
  no element overlap, and **zero console errors**; the three info windows' computed styles compared consistent.

---

### Addendum (the real root cause of the fullscreen search-box binding)
- The previous version **mistakenly inserted the "fullscreen search box registration" code into the body of `saveSearchText()`** — it only ran when switching constellations,
  so the three fullscreen search boxes were never registered at initialization and had no event bindings. Now moved out of the function, placed before the unified binding loop, with
  try/catch isolation. Measured: all five search boxes (top / table / three fullscreen) produce suggestions correctly when typed into character by character (18 candidates each).

---

### Addendum two (search pill and suggestion area final)
- **The search box restored to pill shape**: the search key previously had three rules overriding each other (the last had no rounded corners), and the input had its own solid background
  covering the pill's rounded corners. Now unified into one rule set: the pill and the input/search-key three parts each fully rounded, the input transparent with no border.
- **The suggestion area changed to translucent frosted glass and stacked on top**: its z-index was only 60, so when expanded it interleaved and overlapped the page's buttons and labels.
  Now the whole search box is raised to z-index 150 and the suggestion area to 220, with the background changed to the same translucent `--nav-bg` as the top bar +
  `backdrop-filter: blur(14px)`, and a larger shadow — clearly readable over any page content.
  Measured (hit test): the hits on both sides of the suggestion area are the suggestion items themselves, no longer penetrated by other controls.
- Added three assertions against regression, one of which specifically checks "the style must be written inside `</style>`" — this round had appended the style after
  `</html>`, which invalidated the whole block.

---

### Addendum three (leaked style and English check)
- **Fixed the style leaking outside the page**: the narrow-screen adaptation CSS was appended after \`</html>\`, so the browser rendered it as text and
  a large block of CSS code appeared at the bottom of the page. Now moved back inside \`<style>\`, with a general assertion added: **there must be no content after the end of the HTML**.
- **The loading-overlay copy follows the language**: switching the language also refreshes the two lines "updated to the latest orbital elements / element epoch"
  (previously written only once at load, leaving the old language after a switch).
- **Full check in English mode**: no key in the i18n table has an English value that is still Chinese; scanning the English-mode UI element by element,
  only the "中" character of the language-switch button and the footer's author byline remain Chinese (both intentionally kept).

---

### Addendum four (the top edge of the fullscreen control panel)
- The fullscreen control panel previously **started at the top of the screen** with the frosted glass (enclosing the top-left × and △ too). Now changed so that
  the top edge falls below the three keys (\`top: calc(total height of three keys + gap)\`, measured 112px), the panel height adapts to its content,
  and the right side is rounded — the title no longer hugs the edge, and no large blank area is blurred. The same rule set on desktop and mobile.

---

## [V1.5.2] — 2026-10-02

### Fixes
- **The fullscreen top search box produced no suggestions when clicked**: it had only styling, no event binding — now registered into the search-box linkage system,
  sharing the full behavior set with the main-page search box (live suggestions, history, cross-box sync, satellite selection).
- **The fullscreen top-left buttons disappeared**: △ and "reset view" were previously inside .fs-bar (with its own stacking and positioning context),
  and were covered after the control drawer was expanded. Now hoisted to a direct child of the section, in the same stacking environment as ×, visible in any state.
- **Mobile fullscreen no longer forces landscape**: the landscape lock was previously written in the same tick as requestFullscreen (when fullscreen had not yet taken effect,
  so it necessarily failed); now moved into the fullscreenchange callback.

### New
- **Locking back to portrait before exiting fullscreen** (attempting lock('portrait') while still fullscreen and the permission is available, unlocking back to the system on failure),
  to avoid the phone staying in landscape browsing the main page after exiting.
- **Secondary correction of the scroll position on exiting fullscreen**: rotation and layout reflow are asynchronous, so in addition to the immediate restore, it corrects again at 120ms / 420ms,
  ensuring a return to the position before entering fullscreen (fixing "jumping up a stretch / to the top of the page after exiting").

### Regression inspection
- Added a one-off full inspection: key elements (5 chapters, canvases, tables, jump pills, each search box),
  interactions (switching constellation/language, searching "长八甲Y10", expanding the control drawer), and console-error monitoring —
  result: zero console errors, all elements and interactions normal.

---

## [V1.5.1] — 2026-10-02

### Fixes (severe)
- **Opening suggestions threw `curKey is not defined`**: the search history used a non-existent function to get the current constellation,
  while the correct one is `S.key` / `cur()`. All corrected and an assertion added.
- **A function called but not defined**: `saveSearchText`/`loadSearchText` were called only at the constellation switch, but their definitions were not written into the file
  — it would throw a ReferenceError again. Now completed, with a symbol check on the built file.

### Changes
- **Suggestion-item layout**: the satellite name is followed immediately by a parenthetical annotation (normal color, not tinted with the theme color), with NORAD shown fixed on the far right (batch items show the count).
- **Search box**: deleted the ⌕ round button at the top of fullscreen; the fullscreen search box changed to **always visible**; a **geometric magnifier search key**
  (SVG, theme color, both in and outside fullscreen) was added to the box's right; the placeholder when empty is unified to "supports fuzzy and mixed search" (with an English counterpart).
- **CSCN and SpaceSail no longer interfere**: switching constellations saves the current page's search term, clears the selection and info windows, then loads the other constellation's own search term.
- **Fullscreen top-left three-key layout**: × moved to the top-left (16px to accommodate a large radius), the △ that expands controls directly below ×,
  and reset-view on the same baseline as × — the three points forming a right triangle.
- **The fullscreen control small window** no longer fills the screen; it now hugs just below the top-left corner, sized adaptively to its content.

---

### Addendum (same version)
- The fullscreen three keys changed to fixed positioning (previously absolute relative to .fs-bar's flex row, which could not align strictly);
- The fullscreen search box narrowed to 240px and moved to the right of reset-view, on the same baseline;
- The main page's two search boxes also unified their placeholder and gained search keys;
- All search boxes (in and out) changed to the same translucent frosted glass as the top bar.

---

### Addendum two (same version)
- The fullscreen control drawer (the remodeled .sec-head) restored to display — the previous round had mistakenly added display:none, hiding the whole drawer;
  meanwhile remodeled per request: adaptive height (up to 62vh, no longer filling to the bottom), content starting below the top-left three keys, and no search box inside the drawer.
- The △ button and × unified at 36px, their centers strictly on the same vertical line.
- Fullscreen symbols enlarged: × 18px, △ icon 17px, bottom-right ＋/－ 20px (kept centered).
- The search key's width changed to 15% of the search box (minimum 44px), scaling proportionally with the search box, with the magnifier kept centered.
- The main page's top search box placed to the right, with the "搜索卫星" text label removed.

---

### Addendum three (same version)
- **The fullscreen map no longer has black bars**: it previously could only maintain a "normal ratio" via the canvas ratio, necessarily leaving black at the top/bottom (or left/right) in fullscreen.
  Now changed to a cover rule: in fullscreen the map canvas is set to a size of max(viewport width, viewport height×1325/620) and centered,
  with the excess clipped by the fullscreen container's overflow:hidden — **filling the screen while keeping the ratio undistorted**;
  it recomputes automatically when the window size changes, and restores the original size on exiting fullscreen.

---

### Addendum four (same version)
- **The fullscreen map changed to "album-style"**: it initially keeps the 1325:620 ratio, **centered horizontally and vertically**, filling whichever of width/height is filled first
  (portrait fills left/right first, leaving top/bottom empty; landscape fills top/bottom first, leaving left/right empty); on wheel/pinch zoom the content naturally grows,
  proportionally, into the empty area until it is full — matching the feel of viewing a photo in a phone album. (The previous cover approach would clip from the start, pointing the wrong way.)
- **Fixed the disappearing fullscreen buttons**: the previous cover version stretched the canvas to 1400px wide and centered it, pushing the canvas's right side (including the bottom-right zoom/export
  button column) off-screen; and the canvas stacking covered the top-left three keys. Now the canvas only fills the viewport, z-index reset to zero,
  and all buttons are visible normally.

---

## [V1.5.0] — 2026-10-01

### Fixes
- **Touch required a long press to select satellites**: the tap threshold in `touchZoom` was hard-coded to 4px, while the mouse side used
  TAP_SLOP(14px) — a finger wobble far exceeds 4px, so the tap never fired and only a long press (almost no movement) selected.
  Now unified to TAP_SLOP, with a regression assertion added, preventing two threshold sets from emerging again.
- **An extra `>` appeared before the section title**: the previous version's insertion of the fullscreen exit button left a stray angle bracket, now cleared and an assertion added.

### New
- **Fullscreen forces landscape** (mobile; unlocked when exiting fullscreen; silently fails on desktop and iOS Safari).
- **Search capabilities fully upgraded**: **alias and pinyin** input for rockets / launch facilities / manufacturers, numeric suggestions in four layers
  (name → batch number → COSPAR-corresponding rocket → NORAD), **searching multiple manufacturers at once**,
  results sorted by "proximity → newest to oldest", with the matched field annotated in parentheses after the satellite name (bold, ellipsized when too long),
  and on empty input showing the **most recent 6 browsing records** (per-constellation, shared across CN/EN, cleared on refresh), with dividers between suggestion items.
- **The search round button at the top-middle of fullscreen** (⌕, the same style as × on the left): clicking expands it non-linearly into an input, collapsing after selection,
  with up to 6 suggestions (3 on short screens), and the selected result remains effective after exiting fullscreen.
- **Clicking the top-bar CISTrack logo jumps to the project homepage** (no blue focus ring), and the README's top also gives repository and online-version links.

### Changes
- **The chart's bottom-right buttons** changed to "color on click, fade on release" (:active), no longer responding with a blue ring.
- **The active state restored to inverted** (white block black text on a dark base / black block white text on a light base), and explicitly overrides the map chapter's ghost.tgl and the fullscreen small-window controls.
- **Floating controls unified to frosted glass**: the section jump pill, the chart's bottom-right button column, fullscreen × / ⌕ / △ / reset view / time window.
- **Orbit-distribution chart**: recovered the left whitespace on narrow screens, making room for the button column on the right.
- **The map chapter fixed aspect ratio** (1325:620, the same as fullscreen), undistorted across screen ratios.

---

## [V1.4.9] — 2026-10-01

### New
- **Fullscreen exit button**: in the first three chapters, when fullscreen, a 36px circular "×" button appears at the screen's left-middle (vertically centered) (slightly larger than
  the in-page 32px square button); clicking it exits fullscreen, and Esc/back still works as before. Consistent on desktop and mobile, in CN and EN.
- **Screen stays awake during fullscreen (Wake Lock)**: automatically requested on entering fullscreen, released on exit, and re-requested when returning to the foreground while still in fullscreen.
  On mobile, "screen-off auto-exits fullscreen" is a mobile-browser system behavior (screen-off releases fullscreen; the web page cannot stop it);
  keeping the screen on during fullscreen avoids it at the source; the cost is the screen staying on during fullscreen.

### Changes
- **Bottom-right tier bar**: the Chinese UI shows "↑图轨角星箭↓" (图=map 轨=orbit 角=orbit distribution 星=satellite table 箭=launch history),
  while the English UI remains "↑MOISL↓"; both use font size 13px (buttons fixed at 26×24, the pill itself unchanged);
  the default color changed from gray to the foreground color (white in the dark theme, black in the light theme); horizontally centered within the column, with `line-height:1` correcting the glyph offset.
- **Info-window dragging**: restored the symmetric rule of "keep 24px within the viewport" — on both sides the window can be partially dragged off-screen,
  with the excess clipped, and the page is not stretched wide (overflow-x fallback, introduced in V1.4.5).
- **Info-window drag hint**: removed the spaces around the slash; the color changed to **the current constellation's theme color** (CSCN red / SpaceSail blue);
  moved up by about 9px to hug the info window's lower edge; the English UI shows `Click/long-press to drag freely`.

### Notes
- The fullscreen exit button's × no longer goes through data-i18n (it was previously overwritten into text by the static language replacement).

---

## [V1.4.8] — 2026-10-01

### Changes
- **English launch sites now use "comma + space" to separate the center from the pad**: `JSLC, LC-43/94`, `HCSLS, LCC-1`,
  `JSLC, CACL LCC`; at sea, `South China Sea, HOS`, `South China Sea, BO RUN JIU ZHOU`,
  `East China Sea` (sea area + ship name under the same rule).
- **OMSP reserved**: if the Oriental Spaceport has a land pad in the future (e.g. LCC-1), the English convention is `OMSP, LCC-1`.

### Release preparation
- **All build scripts changed to relative paths** (`ROOT = path.dirname(fileURLToPath(import.meta.url))`),
  so the repository can run directly wherever it is cloned.
- **Dependencies changed to the standard `require('jsdom')` / `require('ws')`** (removing local absolute paths);
  run `npm install jsdom ws` before testing.
- Privacy cleanup: removed local usernames, install paths, intranet IPs, and other traces; internal process docs are not committed to the repository.
- The main file renamed to `CISTrack_v1.4.8.html` (from then on, each version is named with its version number).

---

## [V1.4.7] — 2026-10-01

### New (English UI)
- **Official English conventions for launch sites**: land centers use an abbreviation + space + pad number
  (Jiuquan JSLC / Xichang XSLC / Taiyuan TSLC / Wenchang WSLC / Hainan Commercial HCSLS, e.g. `TSLC LC-9A`);
  at sea, "English sea-area name + space + English ship name" (South China Sea / East China Sea /
  Yellow Sea / Bohai Sea; 东方航天港号 HOS, 东方航天港一号 HOS-1, 泰瑞号 TAI RUI,
  德渤3号 DE BO 3, 德浮15002 DE FU 15002, 博润九州号 BO RUN JIU ZHOU, 德浮15001 DE FU 15001);
  Jiuquan's commercial pad = `JSLC CACL LCC`; unnumbered aprons uniformly `Launch Pad Apron`.
  Measured: all 11 site types correct (including `South China Sea HOS`, `BO RUN JIU ZHOU`).
- The launch-time label `Launch time (Beijing)` → `Launch time (GMT+8)`.

### Changes
- **The launch-history table (CN and EN) headers and data are all centered**, consistent with the satellite table.
- **The mobile top-bar CISTrack's three font tiers each +3px** (26 / 25 / 23px).

### Notes
- User question: opening the HTML directly inside QQ shows plain text — the reason and the countermeasure are in the delivery notes (the file:// protocol is not rendered;
  it is recommended to host it and open it inside QQ via an https link).

---

## [V1.4.6] — 2026-10-01

> This version **replaced** the same-numbered previous version: the "degrade frosted glass on scroll" approach measured no obvious effect, so it was reverted wholesale to V1.4.5
> and redone (the V1.4.5 snapshot is kept in the archive as requested by the user). `PERF_NOTES.md`'s performance-analysis data is kept for reference.

### Fixes (manufacturer column)
- **The link style was suppressed**: `.ltable td a` (white text, no underline) had higher specificity than `.maker-link`,
  so the abbreviation looked like "no tint and no underline". Changed to `.ltable td a.maker-link` (the same style as the satellite name `.sat-link`),
  measured `color: rgb(255,107,107)` (CSCN red) + underline taking effect.
- **Only the first of multiple developers was clickable**: in the entry cell each institution has its own link,
  but the fetch took only the first `<a>`. Now `mkmaker.mjs` captures **all links** in the cell
  (`links: [{n, u}, ...]`), and the front-end pairs them by mutual inclusion of the institution's full name, so **each jumps to its own entry page independently**.
  Measured: all five of "中国商星、鸿擎科技、航天二院、中国电科、氦星光联" are individually clickable.

### New
- **The English UI shows institutional abbreviations**: 航天五院 CAST, 航天八院 SAST, 银河航天 Galaxy Space,
  上海微小 Microsat, 长光卫星 ChangGuang, 微纳星空 Mino Space, 中国商星 CACS,
  工大卫星 HIT Satellite, 北京邮电 BUPT, 格思航天 **Genesat**, 中国电科 CETC,
  氦星光联 **Histarlink**, 鸿擎科技 **HongQing Tech**, 航天二院 **CASIC Acad.2nd**, 垣信科技 **SpaceSail**.
  The layout rule is the same as Chinese: all listed, at most two per row, centered within the row.
- **The English column label changed from Maker to Manufacturer**; the abbreviation "垣信卫星" corrected to "垣信科技".
  The layout rule is the same as Chinese: all listed, at most two per row, centered within the row.

### Fixes (theme flicker + 2nd Academy English correction)
- **Black-white flicker when opening the page**: the first frame was the browser's default white background before CSS took effect. A three-part fix:
  `<html>` gained an inline `background:#050505` (black even before CSS takes effect),
  a new `<meta name="color-scheme" content="dark">` (UA components such as scrollbars also use dark), 
  and confirmed no code path writes the light theme again. CDP burst capture verified: after load, the frames at 100/300/800ms are all dark,
  and the loading page is black from the first frame.
- **The 2nd Academy's English corrected** to `Acad. 2nd, CASIC`.

### Fixes (the disabled zone mistakenly blocking tap selection)
- The disabled zone previously also blocked "tap to select a satellite" — the globe's orbit ring (about 1.27 Earth radii) extends beyond the globe's tangent,
  so satellites in the top-left/top-right corners fell in the disabled band and could never be selected (a recurrence of the old issue fixed in V1.3.8).
  Now the disabled zone blocks only **wheel zoom and pan/rotate**, and **tap selection is no longer restricted**.

### Revert notes
- V1.4.6 (old) "degrade frosted glass + passive on scroll" reverted wholesale: after measurement the user judged the effect poor;
  the passive part is harmless but was withdrawn with the revert, and can be applied separately later.

---

## [V1.4.5] — 2026-10-01

### Fixes
- **On mobile, "the globe, once zoomed, bounces back to the initial view after a while"**: the root cause is that a line in the `resize` handler zeroed the radius,
  and **on mobile, scrolling collapses/expands the address bar, which triggers resize**. The zoom changed to storing a **multiple relative to the baseline radius** (no longer absolute pixels),
  so it survives any size change; `resize` also no longer clears the already-propagated satellite positions (the propagation result is independent of the canvas size; clearing it just wastes a full SGP4 pass).
- **On mobile, dragging the info window stretched the page wide**: the drag's right boundary forgot to subtract the window width, so after the window crossed the viewport's right edge the body gained a horizontal scrollbar,
  and the top clock pill and the bottom-right section pill were pushed right along with it. Now the boundary is computed correctly, and a horizontal-overflow fallback was added to `html/body`.

### Changes
- **The orbit (globe) side disabled zones now follow the globe**: the valid zone = the globe's bounding box + a margin (current radius ×1.12),
  so when zoomed the globe grows and the usable zone grows with it — no more intuitive conflict of "zoomed in but there is still a large disabled zone".
- **The redraw during rotation reduced from 30fps to 20fps**: each frame redraws 400+ satellites and orbit rings, which is the largest cost during rotation.
- **The mobile help popup capped at 72vh** (it was 88vh, almost filling the screen in portrait).
- **The help popup's close key moved left** (`right: 10px → 24px`), no longer overlapping the page scrollbar.

### Notes
Satellite positions are **propagated** once per second anyway (`sec !== lastSec` before recomputing), so there was never a problem of "60 propagations per frame";
the stutter the user felt came mainly from the full redraw during rotation, which this round reduced to 20fps.

### On-device verification (390×844 @dpr2)
- Dragging the info window to the far right of the screen: `scrollWidth 390 = innerWidth 390`, the page was not stretched wide ✓
- Zooming the globe then changing the viewport height (simulating the address bar collapsing): the globe's pixel count 6050 → 6089, **the zoomed state was preserved** ✓

---

## [V1.4.4] — 2026-10-01

### Fixes
- **The disabled bands on the map's two sides were restored**: after V1.4.2 shrank the map to 92vw, the whitespace fell **outside** the canvas,
  while the canvas's interior was still draggable throughout — the user felt "the disabled zone is gone". Now the map is unified with "03 orbit distribution" and "02 orbit":
  **12%** on each side is a disabled band, where a wheel/finger swipe only flips the page, and only the middle 76% operates the map.

### Appendix: reference-site performance measurement
See `PERF_NOTES.md` — an empirical analysis of `findrassvet.ru` (this project's visual and structural reference):
the reason it is smooth is not "using advanced techniques" but **doing far less per frame** (no hand-drawn rendering, no persistent frame loop, no HiDPI canvas).
Each point is listed with "this project's current state / recommendation / side effects", for decision-making.

---

## [V1.4.3] — 2026-10-01

### Fixes
- **The map was off to one side**: the centering was originally "push 50% of the width, then pull back half with transform", which was overridden by two
  negative-margin rules in the narrow-screen breakpoint, leaving only half the displacement — the whole container ran off the left side of the screen (normal at 1440, skewed at ≤1300).
  Changed to the plainest block-level auto left/right margins; measured across the five viewports 1200/1000/860/760/390,
  the map container's and the "02 orbit" chapter's chart's **left and right edges are fully identical**.
- **The manufacturer column's links and coloring**: the code read `m.url`, while the field name stored in the data is `u` —
  so the abbreviation had no theme color, no underline, and was not clickable. After fixing, the first cell has a clickable link.
- The header's first column was overridden by `:first-child { text-align:left }`, making headers like "manufacturer" hug the left — now all unified centered.

### New
- **All launch sites are clickable**: the site links changed to the "launch base / launch site" column captured from the entries (also captured by mkmaker.mjs),
  and all 15 launch-site types **hit** their corresponding entry page (Jiuquan / Taiyuan / Xichang / Wenchang / Hainan Commercial / Haiyang Oriental Spaceport…),
  where the two sea-platforms "South China Sea 东方航天港号" and "South China Sea 博润九州号" point, as requested, to the **Haiyang Oriental Spaceport** entry.
- **The orbit-distribution (chart) also carves out 12% disabled bands on both sides**: within these two bands a wheel/swipe always flips the page,
  and only the middle 76% is used to zoom and pan the chart (consistent with the map and globe).

### Changes
- **Manufacturer layout**: no longer writes "and N others", instead **listing all**, at most two per row, centered within the row
  (1 centered / 3 = 2+1 / 5 = 2+2+1).
- **Header items all centered** (satellite table and launch-history table).
- **Desktop canvas sampling multiplier 2 → 1.5** (pixel count down about 44%), touch devices stay at 2.
- **Mouse-hover hit detection throttled to about 30Hz** (not throttled while dragging, to keep it responsive).

---

## [V1.4.2] — 2026-10-01

### New
- **The satellite table gained a "manufacturer" column** (between batch/group and semi-major axis, and "batch" renamed to "batch/group").
  The data is taken from the encyclopedia entry table's "R&D institution / developer" column, matched exactly by COSPAR (falling back to the launch date when there is no match):
  40/41 batches for CSCN, 19/19 for SpaceSail have values. The entries use full names, while the UI uniformly abbreviates
  (上海微小 / 格思航天 / 航天五院 / 航天八院 / 银河航天 / 长光卫星 / 中国商星 / 工大卫星 /
  北京邮电 / 中国电科 / 氦星光联 / 洪擎科技 / 航天二院), and clicking jumps to the corresponding institution page in the entry (underline + theme color).
  When one launch assembles multiple institutions, the table shows the first two + "and N others", with the full list in the hover tooltip.
- **A hint when newly cataloged satellites are detected**: after opening the page and refreshing online, it compares the online NORAD catalog with the page's built-in snapshot,
  and if new satellites appear (≈ another launch), a dismissible neutral hint floats at the top.
- **Script errors are visible from now on**: any JS error / unhandled Promise shows a red hint bar at the top of the page,
  with "copy diagnostic info" (page version, browser UA, viewport, canvas size, number of bad satellites, error details).
  When the SGP4 library fails to load this is also clearly reported.

### Fixes
- **A problem with a single satellite's orbital elements no longer drags down the whole chart**: `propagateAll` / `mapTracks` / `globeTracks` /
  `twoline2satrec` all changed to per-satellite try/catch. Previously it was a bare loop, and **any bad satellite would throw from the whole propagation function**,
  leaving nothing on the map and globe — this is exactly the symptom the user reported as "after opening in Chrome there are no satellites or light points on the map".
- **Canvas size and pixel-cap fallback**: when the container size is not yet computed, fill in a reasonable value from the parent container (older browsers that do not support
  `aspect-ratio` would fail to compute the height), and cap the canvas's single side at 4096 px (the texture limit of many GPUs;
  a 4K screen + dpr2 exceeds it, and beyond it the whole canvas fails to draw).
- Styles changed to traditional forms: `inset:0` → `top/right/bottom/left` (Chrome 87 and below).

### Changes
- **The map no longer bleeds to the edges**: changed to the same width as the "02 orbit" chapter's chart (92vw centered), with the whitespace at the two sides not belonging to the canvas,
  so a finger swipe on it scrolls the page; the height is computed directly with `vw`, no longer relying on `aspect-ratio`.
- **The large blank areas on both sides of the globe no longer swallow swipes**: when not zoomed, only the area near the sphere (widened to a central vertical band when zoomed) responds to
  wheel zoom and drag rotation, while gestures landing on the blank area are all handed back to page scrolling.

---

## [V1.4.1] — 2026-09-30

### New
- An **"include all columns" toggle** added at the bottom of the export popup (on by default): when on, the exported image includes the hidden columns (ascending node / eccentricity / BSTAR),
  and only when off does it export only the columns visible on screen.
- The export popup's page-number input now supports **Enter** to trigger "export multiple pages".
- This `CHANGELOG.md` file itself.

### Changes
- **Every open starts from the default initial state**: the theme and settings are no longer carried across sessions — opening gives dark + default configuration + the live instant.
  In-session changes still take effect normally, and each chapter's "default settings" button still works; it just returns to defaults after a refresh.
  (The time slider has already zeroed every time since V1.3.6.)
- **Top-bar frosted glass redone**: opacity 0.88 → 0.62, blur 8px → 18px plus `saturate(180%)`,
  adding the missing `-webkit-backdrop-filter` (which previously did not take effect at all on Safari), with a very faint highlight and shadow added at the bottom.
- The map-compliance wording unified into one bold sentence: **the map is only a rough schematic outline of the Earth's continental coastlines and cannot accurately represent the actual projection.**
  (Synced between the in-page note and the repository README)

---

## [V1.4.0] — 2026-09-30

### New
- **Export popup**: the table's export key changed to open a small window with three buttons centered vertically —
  export current page / [input] export multiple pages / export all pages. An invalid input or a page count out of range → the input turns red and nothing is exported.
  Multiple/all pages are stitched directly into one long image, with the filename carrying the page range (`p1-3`).
- **Export bottom bar redone**: the time is **the instant the page is currently simulating** (including the time-slider offset),
  format `GMT 2026/09/30_20:18:00（+8 04:18:00）`; a disclaimer added at the bottom-right; the whole bottom bar changed to **white text**;
  the version number shares the same source as the page.
- **TLE session cache**: the same batch of orbital elements is not refetched within 30 minutes.
- **English title Title Case**: `Orbit Distribution` / `Satellite Table` / `Launch History`
  (the top-bar labels and section titles share the same copy).
- Files needed for open-sourcing: `README.md` / `LICENSE`(MIT) / `.gitignore`.

### Fixes
- Null-value protection completed: `showMapInfo` / `showChartInfo` no longer throw and break the whole frame at the instant data is rebuilt.
- The export bottom bar's font size changed to take the **canvas's real scaling** (the map canvas is 1x, the table 2x); previously the line on the map was larger than the image,
  and the right-side declaration was squeezed out.
- Archive slimming: cleaned up per "keep only the previous + current version", deleting 40 old files and releasing 6.9 MB;
  the test scripts were also included in the archive.

### Notes
- Entry counts changed to be overridable by the `wiki.json` in the same directory (editing the numbers in the JSON updates it site-wide, without rebuilding the HTML).
  The page's automatic entry fetching measured unworkable: direct connection 403, CORS proxy 522 timeout, MediaWiki `api.php` also blocked.

---

## [V1.3.9] — 2026-09-30

- The satellite table is **sorted by NORAD descending by default**.
- Fixed "update epoch" being too far from the main title on narrow screens: the real culprit was **CSS order** — the 1300px breakpoint's rule was written after the 820px one,
  overriding the narrow-screen override. The narrow-screen override moved to the end of the stylesheet, spacing 40px → 10px.
- Top-bar CISTrack 26 → 32px (keeping the top bar at 62px by tightening the padding).
- The loading page's first line no longer repeats the epoch; the epoch stays only on the line below the loading ring.
- Cleaned up redundancy: `mapSec` / `glSec` / `S.obs` / `.br-narrow`.

---

## [V1.3.8] — 2026-09-30

- **Table header and data alignment**: `thead th`'s right alignment was overridden by the later-written `.ltable th` per CSS specificity,
  causing the visual misalignment of headers hugging the left and numbers hugging the right. Numeric columns unified right-aligned, the first column left-aligned; the launch-history table fully left-aligned.
- **The info window no longer disappears after selecting a satellite**: the map / globe chapters lacked the logic of "falling back to the selected item when the hover moves away"
  (the chart chapter had it long ago); three places added.
- **Top-bar font changed to Audiowide** (SIL OFL 1.1, woff2 embedded as base64 for offline use), font size 32px.
- **Globe rotation changed to be time-based**: the old version added a fixed 0.0008 radians per frame, tied to the frame rate — when no satellite was selected the frame rate was low and it looked stopped,
  and once selected the frame rate doubled and it spun fast. Now a fixed angular velocity, independent of frame rate.
- The top-bar switch strip changed to the new section names and new order; the search box in the notes area stretched to the right edge; the narrow-screen epoch spacing tightened.

---

## [V1.3.7] — 2026-09-30

- **Multi-source TLE fetching**: beyond the CelesTrak grouping, added a query by name prefix and a reverse lookup by number,
  recovering the early test satellites (CSCN 181 → 186).
- **Batch metadata completed**: parsed from the entry's launch-records table for CSCN's 12 test-satellite launches (including one marked as failed),
  3 high-orbit satellites, and 6 SpaceSail test satellites, aligning the launch history and the entries' 41 / 19 launches.
- **TLE packed by batch diff**: `satdata.json` 110 KB → 61 KB (-44%), with the HTML shrinking accordingly.
- Restored the ⧾/⧿ zoom keys; new image export (chart + table); the two top items "in orbit / launched" break into two lines in both CN and EN;
  chart→table linkage; mobile font sizes clamped; cleaned up 11 unused i18n keys; tests split into two suites, smoke / visual.

---

## [V1.3.6] — 2026-09-30

20 secondary updates: Chinese by default and the time slider zeroed every time; top-bar CISTrack 22px; the fullscreen bottom-right buttons moved up;
English right-edge alignment; the pagination control on one row on wide screens / two on narrow; the info-window drag hint; the section reorder to
01 map / 02 orbit / 03 orbit distribution / 04 satellite table / 05 launch history, and the tier bar `↑MOISL↓`;
the inclination-distribution chapter redone (horizontal axis changed to inclination, the vertical quantity selectable); satellite-name links to satcat.com; the table module's fixed height;
the mobile epoch moved to the top.
The top three counts changed to **be based on the encyclopedia entries** (CSCN 248 / 244, 40/41; SpaceSail 262 / 262, 19/19).

---

## [V1.3.5] — 2026-09-29 late night

Info window pinned display (not collapsing even when the mouse moves away), draggable past the chart boundary; batch focus; the fullscreen time pill
(live as a thin border, turning to a yellow breath when pushed off "now"); the jump pill auto-showing/hiding; mobile font size raised one tier.

## [V1.3.4] — 2026-09-29

CISTrack branding; info-window revamp ("perigee × apogee" merged into one line); settings persistence and a "default settings" button;
satellite selection in observatory-point mode; whole-row selection of launch batches; a three-segment footer.

## [V1.3.3] — 2026-09-29

The three info windows unified and a "launch time" row added; a 450 ms long press before entering drag mode; the theme color running through the selected row, links, and the selection band;
the top three statistics; fullscreen layout unified.

## [V1.3.2] — 2026-09-29

Tracing pending-catalog satellites (NORAD temporary range 100203–100799, landing as a catalog digest after multi-source verification);
orbit-ring coordinate system corrected (previously the orbit rings and sub-satellite points were not in the same coordinate system, a visible misalignment).

## [V1.3.1] — 2026-09-29

The satellite info overlay is draggable / independently closable / screen-adaptive; the orbit chapter's info bar gained live sub-satellite latitude/longitude.

## [V1.3.0] — 2026-09-29 afternoon

17 interaction and display corrections: zoom levels subdivided; the top bar no longer overlapping; a restore-original-ratio button; removed Ctrl multi-select and added the top search;
whole-batch selection; mobile fullscreen.

## [V1.2.0] — 2026-09-29

A unified gesture zoom / pan / tap layer for the three charts; fixed section numbering; default elevation 35°; observatory-point mode no longer misselects satellites;
globe altitude-shell exaggeration (2.4×); the clock pill fixed; the bottom-right section jump pill.

## [V1.1.0] — 2026-09-29

Fourteen feature upgrades: main-title line spacing and coloring; the hero intro replaced with the two constellations' official intros; CN/EN switching;
map coverage area redone; map zoom; section numbering aligned; globe visibility cone.

## [V1.0.0] — 2026-09-28

The first deliverable version: main title rewritten; rocket links added to the launch-batch table; the footer byline; **opening the page refreshes the orbital elements online**
(falling back to the built-in snapshot on failure, with no loss of functionality); three responsive breakpoints.

