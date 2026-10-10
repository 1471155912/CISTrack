# CISTrack · Satellite Tracking for GuoWang (SatNet) and Qianfan

![version](https://img.shields.io/badge/version-1.9.1-ff6b6b?style=flat-square) ![license](https://img.shields.io/badge/license-MIT-4dabf7?style=flat-square) [![星网](https://img.shields.io/badge/%E6%98%9F%E7%BD%91-CSCN-ff6b6b?style=flat-square)](https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91) [![千帆](https://img.shields.io/badge/%E5%8D%83%E5%B8%86-G60-4dabf7?style=flat-square)](https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7)


<div align="center">
  <img src="assets/cistrack-logo.gif" alt="CISTrack 顶栏字标 · 星网↔千帆切换时的非线性变色扫过" width="720">
</div>

> 🌐 [中文](README.md) | **English**

> **Project home**: https://github.com/1471155912/CISTrack
> **Stable URL**: https://1471155912.github.io/CISTrack/CISTrack.html (no version in the path — it never changes on update)
> The **CISTrack** wordmark at the top-left links to the project home.


A **single-file, zero-backend** web page that uses real public orbit data (the NORAD catalogue / TLEs) to compute and visualise, in real time, two Chinese low-Earth-orbit internet constellations:

- **GuoWang / SatNet (CSCN)** — China Satellite Network Group
- **Qianfan / Thousand Sails (SpaceSail, G60)** — Shanghai Yuanxin Satellite

Just open the HTML file — **no server and no build step**. When online, the page fetches the latest orbital elements itself in the browser, loads the historical-orbit shards on demand and reads `wiki.json` next to it for the headline figures; with **no network at all** it still opens, falling back to the snapshot and condensed history bundled at build time, and every chapter keeps working.

> Unofficial project. Data comes from the public NORAD space-object catalogue and the satellite wiki; it is intended for outreach and observation reference only and **must not be used for orbit prediction, engineering, or research**.


## ✨ What it does

| Section | Contents |
|---|---|
| **01 Map** | Each satellite's current sub-satellite point, ground coverage (adjustable minimum elevation) and half an orbit of ground track before/after; you can pin a ground station and highlight the satellites visible from it |
| **02 Orbits** | 3D globe: inclinations, coverage cones and the separation between different launch batches at a glance (altitudes are drawn exaggerated 2.4× above 8000 km so the shells are easy to tell apart) |
| **03 Inclination distribution** | X = orbital inclination, Y = semi-major axis / apogee / perigee; one chart shows which orbital planes the constellation uses |
| **04 Orbits Change Status** | Each satellite's **semi-major-axis climb** from insertion to its working orbit (driven by a self-built historical orbit database; pick a batch or a single satellite to plot it; re-entered satellites are flagged red). Climb rate = least squares over a ±2 day window; Y axis 0–2000 km; two modes (semi-major axis / climb rate), image export with a Δ column, and two-way sync with the global selection |
| **05 Network progress** | Two cumulative curves over time (X axis by week, labelled with the matching date): **launches** = cumulative satellites launched (stowaways and the upper stage of the same launch are excluded), **in orbit** = satellites with a TLE available |
| **06 Satellite table** | Orbital elements for every in-orbit satellite (batch/group, manufacturer, **status**, semi-major axis, apogee/perigee, inclination, period, days in orbit, RAAN, eccentricity, epoch) — sortable, searchable, exportable as an image. Manufacturers come from the satellite wiki, shortened, and link out |
| **07 Launch history** | Batch / rocket / launch time / site / design inclination / mission result per launch; rockets and sites link to the satellite wiki, satellite names link to satcat.com |

Extras: bilingual UI (Chinese / English), light and dark themes, full screen (auto landscape on mobile with the screen kept awake), timeline playback (±180 minutes, independent per map/orbit chapter × constellation, with non-linear smooth animation; in live state the "Now" button fills with the accent colour and breathes, and once pushed off live it turns into a fixed amber status light), chart↔table linking, and PNG export (with a footer carrying the simulated time and a disclaimer).

## 🔎 Search (since V1.5.0)

The four search boxes (top bar / table / the two full-screen panels) stay in sync and offer live suggestions:

| What to search | How to type it |
|---|---|
| **Satellite name / NORAD** | Chinese or English names, NORAD numbers; digits match in order: name contains the digits → batch number contains them → the COSPAR sequence maps to every satellite of that launch → NORAD contains them |
| **Launch vehicle** | Full name, abbreviation, alias or pinyin in either language: `长征八号甲`, `长八甲`, `CZ-8A`, `CZ8A`, `LongMarch-8A`, `Changzheng8jia`; append a serial to pin one rocket: `长八甲Y10`, `长征八号甲遥十`, `CZ8AY10` |
| **Launch facility** | Site, pad, launch ship, sea area — Chinese, English or pinyin, any separator: `酒泉 LC-96A`, `酒泉，LC-96A`, `酒泉卫星发射中心96A`, `JSLC`, `Jiuquan`, `东方航天港`, `HOS`, `南海`, `South China Sea` |
| **Manufacturer** | Full name, abbreviation, alias or pinyin in either language: `上海微小`, `微小卫星创新研究院`, `Microsat`, `Histarlink`; **several manufacturers can be searched at once**: `Histarlink hangtianeryuan` = satellites from either Histarlink or CAST-502 |

- Results are ordered by closeness, then newest first; the matched field is shown in brackets after the satellite name (keyword in bold, truncated when long)
- Clicking an empty box shows the **last 6** satellites you viewed in that constellation during this session (independent per constellation, shared between languages, cleared on reload)
- Input and selection survive entering/leaving full screen, switching language and toggling controls



## 🚀 Quick start

1. Download `CISTrack_v1.9.0.html` (or the same-named attachment from a Release; the repository's `index.html` redirects to the latest build)
2. Double-click to open it in a browser (Chrome / Edge / Firefox / Safari all work)

That is all. On first open it tries to fetch the latest TLEs; if that fails it falls back to the bundled snapshot and everything still works.

## 🔄 Updating the data

**Option 1 — change only the statistics (easiest, no toolchain needed)**

The header counters (launched / in orbit / launch success) can be overridden by a `wiki.json` next to the page.
Put that JSON beside the HTML (for example, publish both to GitHub Pages); after that you only need to edit the numbers in the JSON and save — **every visitor sees the new figures on refresh**.

```json
{
  "asOf": "2026-09-30",
  "gw": { "launched": { "n": 248, "...": "..." }, "inOrbit": { "n": 244 }, "launches": "40/41" },
  "qf": { "launched": { "n": 262 }, "inOrbit": { "n": 262 }, "launches": "19/19" }
}
```

> Why not scrape it in the browser? The satellite wiki's WAF returns 403 to non-browser requests and its responses carry no CORS headers, so a browser cannot read them. Hosting a JSON is the compromise.

**Option 1b — update `wiki.json` with a script (zero dependencies, since V1.7.0 round 2)**

```bash
node scripts/fetch_wiki.mjs        # drives a local Edge/Chrome past the WAF → parses the stats → writes wiki.json only if changed
```

- **Zero dependencies**: it uses only what Node ships with (`child_process` + built-in `fetch` + built-in `WebSocket` over CDP), so `playwright` is no longer required — it runs even in an environment with no `node_modules`, such as a Windows scheduled task.
- The browser executable is discovered in the usual locations; override it with the `CISTRACK_EDGE` environment variable (the old name `EDGE_PATH` still works).
- When nothing changed it **writes nothing**, so `git` can tell whether a commit is needed.
- On failure (WAF, parse error) it exits with a **non-zero status code**, so a scheduled task or CI can flag it.
- **Privacy**: it only visits two public article pages on `sat.huijiwiki.com` with a generic desktop Chrome UA; it sends no local information and its only output is a set of public statistics.

> If you run this script from a Windows scheduled task: the task must be allowed to start **on battery** (`DisallowStartIfOnBatteries = false`), otherwise the system silently refuses to run it the moment the laptop is unplugged.

**Option 2 — full rebuild (requires Node.js 18+)**

```bash
node refresh.mjs        # fetch the latest TLEs (four sources merged) and the full NORAD catalogue
node mkmaker.mjs        # scrape the "developer" table of the wiki articles (cached; --force to refetch)
node mkdata.mjs         # build build/satdata.json (per-batch delta packing) and build/wiki.json
node build.mjs          # assemble the single-file HTML and copy wiki.json next to it
node smoke.mjs          # logic smoke test (jsdom, no external dependencies)
node visual.mjs         # optional: real-browser layout and interaction checks (needs a local Edge + ws)
```

> `mkmaker.mjs` has to get past the article WAF: it opens a real browser and polls the title until the challenge page clears itself (20–35 s in practice). The result is cached in `data/makers.json`, so routine rebuilds do not need it.

## 🔄 Where the data comes from · how it is updated

**In one sentence**: the orbital elements (TLEs) are fetched by **the visitor's own browser** when the page opens, so anyone online always sees the newest data; everything else (the satellite wiki statistics and metadata, per-launch mission results, the coastline, the SGP4 implementation) is fetched or bundled at **build time**. GitHub Pages has no database and simply serves the repository as-is, so "updating the site" comes down to these two routes.

| Source | Used for | How to update it | Local task needed? |
|---|---|---|---|
| **CelesTrak / NORAD orbital elements (TLE)** | Where satellites are now, ground coverage, orbit shape | **Fetched live in the visitor's browser** on page open (several sources, public-proxy fallback, 30-minute session cache) | **No** (online visitors are always current) |
| **Space-Track GP history** | The semi-major-axis climb curves of **04 Orbits Change Status** (historical orbit database) | Bulk-fetched at build time (login + `gp_history`, `format=tle`) into `data/history/`; `refresh.mjs` appends each day's elements; `mkdata.mjs` samples and packs them into the published `history/` shards | A local task (quota-limited, not suitable for CI) |
| **Satellite wiki "GuoWang / Qianfan" articles** | The three header statistics (launched / in orbit / launch success) | Scraped once at build time; a scheduled task can also run `scripts/fetch_wiki.mjs` (zero dependencies) and commit the result | Optional (header numbers only) |
| **Satellite wiki yearly launch-record pages** | The mission-result column of the launch history chapter and the vertical definition of 05 Network progress | Run `scripts/fetch_launch_results.mjs` at build time; the result lands in `wiki_launches.json` and is merged by `mkdata.mjs` | Optional (best run together with the TLE task) |
| **Natural Earth coastline** | Land outlines on the map | Downloaded and bundled at build time | No |
| **satellite-js (SGP4)** | Propagating positions from a TLE | Bundled at build time | No |

`data/ct_*.tle` is only an **offline fallback snapshot** and can be refreshed periodically with `refresh.mjs`.

**Automation (two-track A+B since V1.8.0)**

- **A · Local scheduled tasks**: `update_tle.bat` / `update_wiki.bat` run `refresh → mkdata → build → build_release → git push`.
  - Every step checks its exit code and **retries up to 3 times** (90 s apart); the whole run is appended to `logs/tle_refresh.log` / `logs/wiki_refresh.log`;
  - The two tasks **share the `logs/git.lock` mutex** (both fire at 00:00 and 12:00) so they never commit on top of each other; a lock older than 5 minutes is treated as stale and removed;
  - Before pushing they run `git pull --rebase --autostash` (the cloud may have pushed just before);
  - Both tasks are set to "run as soon as possible after a missed start" with the timeout relaxed to 2 h (TLE) / 45 min (wiki) so a retry is never hard-killed.
- **B · The TLE chain on GitHub Actions** (`.github/workflows/update-tle.yml`): every 12 hours the cloud refreshes the TLEs and rebuilds
  (CelesTrak does not block datacentre IPs). **The satellite wiki part stays local** — it has to pass
  Cloudflare's WAF, which datacentre IPs cannot (`update-wiki.yml` therefore only keeps a manual trigger).
- So even while the machine is off for a long time, the online page still gets reasonably fresh TLEs, while the article statistics and mission results are filled in from the local machine.
- Visitors fetch fresh TLEs themselves on page open anyway, so both chains really only keep the **offline fallback snapshot** fresh (at most half a day old), not what online visitors see.


## ⭐ Each constellation keeps its own state

Switch to the other constellation and back, and **the satellites you selected, every chapter's toggles and inclinations, your ground station, the time offset,
the map/orbit zoom and pan, and the table page are all still there**; the two constellations never interfere and each is persisted separately.

## ✨ Non-linear motion (since V1.6.1)

- **Switching constellation**: the inverted slider slides, the page content is pushed out horizontally, the accent colour sweeps the top bar and the chapter pill borders fade out and back — all four start and end together (520 ms).
- **Switching language**: the top bar collapses upwards and unfolds downwards while the page is wiped away bottom-to-top and grows back, in sync (620 ms).
- **Switching theme**: a circular reveal expanding from the button in the top-right corner (560 ms, same easing as the language switch).
- **Suggestion list**: expands and collapses with a non-linear transition; clicking elsewhere, re-focusing the input or blurring all collapse it.
- **Time slider**: click / keyboard jumps / the "Now" reset are tweened over 120–520 ms depending on distance (including a chapter's "Default settings" button tweening the slider back to live); dragging stays glued to the pointer (V1.7.3).
- **Toggles in sync with the canvas** (V1.8.0): for the four toggles (names / orbits / coverage cone / visible inclinations), the matching canvas elements tween their opacity over 520 ms while the button background transitions along, all with the same time constant.
- **Interpolated colour modes** (V1.8.0): switching between "by constellation / by batch / by inclination" interpolates the point colours frame by frame instead of flipping in one step.
- **Ground station in and out** (V1.8.0): entering/leaving ground-station mode cross-fades the coverage area and the visible satellites.
- **Table paging** (V1.8.0): on page change the old content fades out first and the new content fades in afterwards (260 ms) instead of being swapped instantly.
- Easing: "slow then fast" `cubic-bezier(.92,.02,.98,.46)`; "fast then slow" `cubic-bezier(.02,.72,.16,1)`.

## 📱 Full screen and gestures (V1.5.3)

- On a phone, entering full screen **switches to landscape automatically** (the lock is retried after full screen takes effect so it really applies); leaving it locks back to portrait first and returns to the previous scroll position.
- The three top items in full screen (×, centred search box, right-hand time pill) share one height and baseline; on narrow screens the search box shrinks so it never collides with the time pill.



- **Entering full screen**: turns to landscape on phones; on exit it locks back to portrait first and restores the previous page position.
- **Map in full screen**: keeps the 1325:620 ratio, centred, filling whichever of width/height runs out first; zooming with the wheel or two fingers lets the content grow into the remaining space until it fills it (the same feel as viewing a photo in a phone gallery).
- **Three buttons top-left**: × leaves full screen, △ expands/collapses the control drawer (on some chapters), and reset-view; the search box and the time pill sit top-right on the same baseline.
- **Control drawer**: sized to its content (it does not fill the screen) and no longer repeats the search box.
  Expanding and collapsing are both a **520 ms "slow then fast" non-linear slide** (the same curve as the constellation switch), symmetric in both directions.
- **Search box position**: in 01 Map and 02 Orbits the full-screen search box is pinned to the **top of the viewport**, on the same row as × and the clock pill;
  in 03 Inclination distribution it is **inline in the top control row** (wrapping with the controls).
  The difference is **deliberate** (that row is already busy, and a separate row for the search box would eat the canvas), not a bug.
- When **real full screen is refused** by the system (some browsers or policies) it degrades to an in-page full-screen mode with a one-off notice; the content still fills the viewport, but the phone's status bar or browser toolbar may remain as a strip.

## 🧩 How it is put together

```
template.html   # layout and styles (with the Audiowide font inlined)
app.js          # all the logic: SGP4 propagation, drawing, interaction, i18n
data/           # satellite.min.js (SGP4), coastline, TLE snapshot, NORAD catalogue
mkdata.mjs      # data build: per-batch TLE delta packing + article metadata
build.mjs       # injects the pieces above into template → single-file HTML
```

A few design notes worth mentioning:

- **All orbit maths happens in the browser**: satellite-js runs SGP4 (WGS-72), with zero API calls.
- **TLEs are delta-packed per batch**: satellites from one launch share most characters in their two lines, so a character-level template keyed on the COSPAR prefix makes `satdata.json` about 44% smaller.
- **TLEs merged from several sources**: CelesTrak's groupings miss early test satellites, so the build also queries by name prefix and by catalogue number, keeping the newest epoch for each object.
- **The HTML alone is enough**: every piece of data fetched at runtime is an enhancement, not a precondition — with no network the page falls back to the snapshot and condensed history bundled at build time, and every chapter still works.

## 🗄️ Historical orbit database (since V1.9.0)

The curves in the **04 Orbits Change Status** chapter are driven by a self-built historical orbit database. The design goal: keep working as the two constellations grow from a few thousand to **tens or hundreds of thousands** of satellites, and be hostable on GitHub as part of an open-source project.

**Where the data comes from**: Space-Track.org's **GP history set** (`class/gp_history`) — the many sets of orbital elements 18 SDS republishes for each satellite day by day. The script logs in with an official account and queries in bulk (10 objects per request, windowed by year, `format=tle`), parses each TLE's epoch and mean motion and converts it to a semi-major axis with the **Brouwer model** (the same convention as the page and SGP4), storing each satellite from its first post-launch element onwards. **Only the Brouwer semi-major axis is stored** — one model, one value, no mixed conventions.

**Structure (two layers)**:

| Layer | Location | Format | Who writes / reads it |
|---|---|---|---|
| Source store | `data/history/<batch>.json` | v1 triples `[norad, epoch ms, semi-major axis]`, at most 2 records per day | `refresh.mjs` appends daily (idempotent, de-duplicated by (norad, epoch)) |
| Published store | `history/index-*.json` + `history/<batch>-<link no.>.json` | v2 compact encoding: the NORAD is stored once, day indices are relative (`t0` + an offsets array), the semi-major axis is fixed-point (`base`+`prec` written into the shard header to prevent mismatch between the two ends) | `mkdata.mjs` samples and packs it; the page **loads on demand** (only the index on first paint, a shard once a batch is selected, LRU cache of 24 shards) |

Loading degrades through **three levels**: external published shards → a bundled 60-day condensed fallback (so there is still a chart offline) → "no historical data yet".

**Why it scales to tens of thousands of satellites**: the key insight is that "storing a point every day once a satellite has reached its working orbit is pure waste". The sampling strategy is **change-driven + tiered + a quota for the stable phase** — dense during orbit raising (daily change ≥ 0.05 km), 1–2 points per month once stable with at most 24 points per satellite. Measured: 244 points in one year per satellite, and **only 39 points over 20 years**, about 440 bytes per satellite; **100,000 satellites × 20 years ≈ 42 MB** (the naive daily scheme would need 2.26 GB — a 54× reduction). A single shard is capped at 4 MB, which browsers load without trouble.

**Routine maintenance**: none needed by hand —

1. `refresh.mjs` (local scheduled task, every 12 hours) appends that day's elements to the source store while fetching the latest TLEs;
2. `mkdata.mjs` (at build time) samples the source store into published shards, which `build.mjs` copies into the output directory;
3. The source store has capacity governance as a backstop (≤3000 points per satellite, 24 MB per store), so it can never grow without bound;
4. A newly launched batch appears in the index automatically — no code change needed.

**If a batch's curve does not show up** (its history holds only one or two isolated points), the history is
"too thin" rather than missing — run `node scripts/fetch_history.mjs --missing`. It **finds by itself**
the satellites whose history span is less than half their time in orbit, and **queries only their own
year windows** (measured: 33 satellites → 13 requests; the older `--net` rescanned all 50 blocks across
their whole year range, 200–400 requests). Add `--net` to actually go online (a Space-Track account is
needed; credentials come from the `SPACETRACK_USER` / `SPACETRACK_PASS` environment variables and are
never written to disk); without it the raw message pool in `data/history_cache/` is re-parsed **offline**
with 0 requests. Run `--prune` afterwards for capacity governance.

## 📊 Data sources

- [CelesTrak](https://celestrak.org/) — public orbital elements (TLEs) from the NORAD space-object catalogue
- [Space-Track.org](https://www.space-track.org/) — 18 SDS GP history (the source of the historical orbit database)
- [Satellite wiki](https://sat.huijiwiki.com/) — article-level launch/in-orbit statistics, batch names, launch vehicles and sites
- [Natural Earth](https://www.naturalearthdata.com/) — coastline (public domain)
- [satellite-js](https://github.com/shashwatak/satellite-js) — MIT-licensed SGP4 implementation
- [Audiowide](https://fonts.google.com/specimen/Audiowide) — SIL OFL 1.1, embedded as base64

## ⚠️ Disclaimer

- This project is **unofficial** and is not affiliated with China Satellite Network Group Co., Ltd. or Shanghai Yuanxin Satellite Technology Co., Ltd.
- The propagation is based on public TLEs and carries inherent error; the positions shown are **simulated** and do not represent reality.
- **The map is only a rough outline of continental coastlines and does not accurately represent any actual projection.**
- Neither the generated images nor the page may be used for any professional purpose.

## ⚖️ License

[MIT](LICENSE) — free to use, modify and distribute (commercial use included), as long as the copyright and licence notice are kept.

---

This page was generated by [小橙子的宇宙 Jackoraniverse](https://space.bilibili.com/455972735) with AI tooling; the inspiration and the first version came from a site tracking Russia's **[Rassvet constellation](https://sat.huijiwiki.com/wiki/%E9%BB%8E%E6%98%8E%E6%98%9F%E5%BA%A7)** — **[findrassvet.ru](https://findrassvet.ru/)**.


## Repository layout

```
CISTrack.html           ★ latest build (no version in the name) — use it for the stable link:
                          https://1471155912.github.io/CISTrack/CISTrack.html
CISTrack_v1.9.1.html    snapshot of the current version
CISTrack_v1.9.0.html    snapshot of the previous version (for rollback / comparison)
index.html              entry page (redirects to CISTrack.html)
assets/                 assets used by the READMEs (the wordmark animation cistrack-logo.gif)
README.md / README.en.md
                        this documentation: Chinese (default) / English (split out in V1.9.1 A16, cross-linked at the top)
history/                published shards of the historical orbit database (the data behind 04 Orbits Change Status, loaded on demand; see "Historical orbit database")
app.js / template.html  sources (the single-file build = these two + data/, packed by build.mjs)
data/                   satellite data (manufacturer table, offline TLE fallback snapshot, history source store data/history/)
wiki.json               cached satellite-wiki statistics (the source of the header counters; the page reads it at runtime)
wiki_launches.json      per-launch mission results for both constellations (the "result" column in Launch history + the basis of 05 Network progress)
scripts/fetch_wiki.mjs          fetches and updates wiki.json (zero dependencies; see "Updating the data")
scripts/fetch_launch_results.mjs fetches the wiki's yearly launch pages → wiki_launches.json (zero dependencies)
scripts/fetch_history.mjs       bulk historical TLE fetch (for seeding / backfilling; not needed for routine maintenance; see "Historical orbit database")
scripts/histstore.mjs           history source store: read/write plus capacity governance (mergeInto / pruneRecords)
scripts/histpack.mjs            history published-shard packing (v2 encoding + change-driven sampling)
smoke.mjs / visual.mjs  tests: logic and source assertions / real-browser layout checks
i18n.mjs                bilingual copy audit (four static checks + four runtime passes)
build.mjs / mk*.mjs     build scripts (pack the sources into the single-file HTML)
release.mjs             path-independent artifact sync (CISTrack.html + CISTrack_v<version>.html + package.json version)
.github/workflows/      cloud automation: update-tle.yml refreshes the TLEs and rebuilds every 12 hours
```

> **Files not in the repository** (see `.gitignore`): `PROCESS.md` and the per-round "task list / acceptance checklist"
> are internal process documents (they contain local paths and working notes); `archive/` holds local version snapshots;
> `build/`, `data/satcat.csv` and `data/wiki_cache/` are regenerable intermediates; `junk/` is a staging area for one-off artifacts.

> **About the link**: GitHub Pages addresses are `https://<user>.github.io/<repo>/<file>`,
> so as long as the repository contains **`CISTrack.html`**, the link is always
> `https://1471155912.github.io/CISTrack/CISTrack.html` — **it will not change when you update the version**.
> **From V1.9.1 only two versioned HTML files are kept — the current one and the previous one.**
> The repository root used to carry eight older snapshots (v1.5.2 – v1.8.0, about 5 MB) which every
> clone had to download; they have been removed, and rollback is now covered by **git history**
> plus the local `archive/` baseline snapshot (not committed). Use `git log` to reach an older version.

> The build and test scripts (`build.mjs` / `mk*.mjs` / `smoke.mjs` / `visual.mjs` / `scripts/*.mjs`)
> **are maintained together with the repository** so that anyone can rebuild and re-test locally; running the tests needs `jsdom` and `ws`
> (`npm i -D jsdom ws`). The build itself only needs Node and `data/`.
