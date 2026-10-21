# CISTrack · Satellite Tracking for GuoWang (SatNet) and Qianfan


<div align="center">
  <!-- V1.9.8：这里**必须用 Pages 绝对地址**，不能写相对路径 assets/cistrack-logo.gif。
       原因（2026-10-17 实测）：GitHub 渲染 README 时会把相对路径转成
       github.com/.../raw/main/... → 302 → raw.githubusercontent.com，而该 CDN 对这个文件
       持续返回 502（连续 3 次全 502）→ 页面顶部的大 GIF 显示为裂图。
       Pages 地址（项目自己的在线版，同仓库同内容，md5 与本地一致）稳定 200。 -->
  <img src="https://1471155912.github.io/CISTrack/assets/cistrack-logo.gif" alt="CISTrack 顶栏字标 · 星网↔千帆切换时的非线性变色扫过" width="720">
</div>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0.630-ff6b6b?style=flat-square" alt="version">
  <a href="https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91"><img src="https://img.shields.io/badge/%E6%98%9F%E7%BD%91-CSCN-ff6b6b?style=flat-square" alt="SatNet"></a>
  <a href="https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7"><img src="https://img.shields.io/badge/%E5%8D%83%E5%B8%86-G60-4dabf7?style=flat-square" alt="Qianfan"></a>
  <img src="https://img.shields.io/badge/license-MIT-4dabf7?style=flat-square" alt="license">
</p>

> 🌐 [中文](README.md) | **English**

> **Project home (GitHub)**: https://github.com/1471155912/CISTrack
> **Online page**: https://1471155912.github.io/CISTrack/CISTrack.html
> **Mirror in mainland China (Gitee)**: https://gitee.com/Jackoraniverse/CISTrack
>
> ⚠️ **How the two repos relate**: GitHub is the primary repository and Gitee is a **content-identical mirror**;
> every commit is **pushed to both** (same commit hash, byte-for-byte identical content).
> Because Gitee Pages was officially shut down in 2024–2025 ([official notice](https://gitee.com/help/articles/4228), issue #IK5SM4 "no plan to bring it back"),
> **Gitee hosts code only and serves no web preview**; the online page is served exclusively by GitHub Pages.
> The Gitee mirror exists for **faster cloning/downloading from mainland China** and as an off-site backup of the primary repo.
> Clicking the **CISTrack** wordmark at the top-left opens a small chooser that takes you to either repository home — **GitHub** or **Gitee** (since V1.9.9.630; before that it went straight to GitHub).


A **pure front-end, server-less** tracker for China's LEO internet constellations. It uses real public orbit data
(the NORAD catalogue / TLEs) to compute and visualise, live in your browser:

- **GuoWang / SatNet (CSCN)** — China Satellite Network Group
- **Qianfan / Thousand Sails (SpaceSail, G60)** — Shanghai Yuanxin Satellite

### What this project actually is (so there is no misunderstanding)

It has **no server-side backend** — no accounts, no database, no API server, and it uploads nothing about you.
But it is **no longer "one file and nothing else"** either. There are two shapes:

| Shape | What it is | What you need |
|---|---|---|
| **① Single file** (minimum) | A ~1.6 MB `CISTrack.html` with satellite data and coastlines embedded — **double-click, works fully offline** | Just a browser |
| **② Full shape** (data can auto-update) | The whole repo: HTML + `wiki.json` + `history/` shards + the Node build chain + `deploy/` one-click update and scheduling | A browser; add Node 18+ only if you want automatic refresh |

So the accurate description is **"pure front-end plus an optional data pipeline"**:

- **The page does go online by itself**: on open it fetches the latest TLEs and reads the wiki stats from a sibling file
  (or from the official Pages URL), falling back to the bundled snapshot.
- **Want it fully offline, or always current?** Use the `deploy/` scripts to refresh and repackage on your own machine
  (an optional daily scheduled task is included).
- **On the repo side**: GitHub Actions refreshes TLEs and repackages every 12 hours — that is **CI**, not a runtime backend.

Open one HTML file and everything is there — **no server, and no build step for you as a user**.

When online, the page fetches the latest orbital elements itself in the browser, loads the historical-orbit shards on demand and reads `wiki.json` next to it for the headline figures; with **no network at all** it still opens, falling back to the snapshot and condensed history bundled at build time, and every chapter keeps working.

> Unofficial project. Data comes from the public NORAD space-object catalogue and the satellite wiki; it is intended for outreach and observation reference only and **must not be used for orbit prediction, engineering, or research**.

## 🌟 Project origin & thanks

This page was created by [小橙子的宇宙 Jackoraniverse](https://space.bilibili.com/455972735) with AI tooling.

The idea — and the very first version — came from **[findrassvet.ru](https://findrassvet.ru/)**
(by [V. Bulybenko, GitHub @vbklgd](https://github.com/vbklgd)), a site tracking Russia's
**[Rassvet](https://sat.huijiwiki.com/wiki/%E9%BB%8E%E6%98%8E%E6%98%9F%E5%BA%A7)** (Бюро 1440) constellation.
Seeing that form, we realised Chinese space enthusiasts needed the same thing for GuoWang (CSCN) and Qianfan (G60)
— and CISTrack started there. The author also published the full methodology behind the orbit-raising rate
(RATE / ТЕМП) metric in
**[METHODOLOGY.md](https://github.com/vbklgd/findrassvet/blob/main/METHODOLOGY.md)** — the 2-day OLS window,
the Kozai → Brouwer semi-major axis, and the finding that J₂ nodal regression explains the plane spreading.
We used it to audit CISTrack's own conventions (the specific points we adopted are listed under
"🧭 Methodology & acknowledgements" below). Our sincere thanks to the original author, and we encourage
everyone to read the document itself — citation guidance is at the end of it.

Without the sources below, this page could not draw a single dot. **Listed in order of importance:**

1. **[Satellite Wiki](https://sat.huijiwiki.com/)** — the source this project leans on most. The SatNet and Qianfan
   articles give the batch breakdown, launch dates, launch vehicles, sites, developers, full and Chinese satellite
   names; the three counters at the top (launched / in orbit / launches) and the "mission result" column in
   chapter 07 are taken from the same articles. Its content is shared under
   [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.en)
   ([copyright page](https://sat.huijiwiki.com/wiki/Project:%E7%89%88%E6%9D%83)): we **credit it and link the
   licence** and reproduce factual entries only; if you republish from this page, keep the same licence.
2. **[CelesTrak](https://celestrak.org/)** — day-to-day distributor of the orbital elements (TLEs). Every page
   open and every 12-hour automated refresh pulls the two current groups from it; the **upstream source** is the
   public catalogue of the US Space Force **18 SDS**, distributed via Space-Track. We fetch per CelesTrak's
   [usage policy](https://celestrak.org/usage-policy.php) (on their cadence, only what we need).
3. **[Space-Track.org](https://www.space-track.org/)** — 18 SDS's GP history set. The historical orbit database
   behind chapter 04 "Orbit Change Status" is loaded from it at build time; ordinary users need no account.
4. **[findrassvet.ru](https://findrassvet.ru/)** — the inspiration, and our reference for orbit-raising
   methodology (see above and the dedicated section below). Its text and charts are
   [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.en), credit `findrassvet.ru, V. Bulybenko`.
5. **[satellite-js](https://github.com/shashwatak/satellite-js)** (MIT) — the SGP4 propagator the page runs on.
6. **[Spacetrack Report #3 / CSSI verification cases](https://celestrak.org/NORAD/documentation/)** — our
   **numerical yardstick** for SGP4 (33 scenarios, 667 expected positions and velocities). The originals were
   obtained via the [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) (MIT) distribution, and the
   tolerance (`error = 2e-7`) follows its tests. `data/cssi/` keeps the originals; test use only.
7. **[Natural Earth](https://www.naturalearthdata.com/)** — the coastline basemap (public domain, no credit needed).
8. **[Kayhan Space's sgp4gl](https://github.com/Kayhan-Space/sgp4gl)** (MIT) — a few engineering approaches
   (e.g. splitting orbit rings into front and back halves) follow this open-source implementation.
9. **[Audiowide](https://fonts.google.com/specimen/Audiowide)** (SIL OFL 1.1) — the typeface of the CISTrack
   wordmark, embedded as base64; thanks also to Google Fonts for distributing it.

Finally, our thanks to **everyone who sent in comments and suggestions before the 1.9.9.630 stable release** —
on Bilibili, in GitHub Issues, in Gitee Issues, or anywhere else. The bugs you found, the interactions that felt
wrong and the conventions that made no sense: many of them are fixed in this version, and the rest are recorded
in the [1.9.9.630 release notes](https://github.com/1471155912/CISTrack/releases) under "Roadmap". This page was
picked apart by all of you — thank you.


## 🚀 Quick start

Two ways to use it — **pick either one**.

### ① Online (easiest, recommended)

Just open **<https://1471155912.github.io/CISTrack/CISTrack.html>** — that is this repository's
GitHub Pages. It updates on every release, nothing to download.

### ② Local (single file, double-click to run)

1. Download `CISTrack_v1.9.9.630.html` (the [latest Release attachment](https://github.com/1471155912/CISTrack/releases/latest);
   the repository's `index.html` also redirects to the latest build)
2. Double-click to open it in a browser (Chrome / Edge / Firefox / Safari all work)

That is all. On first open it tries to fetch the latest TLEs; if that fails it falls back to the bundled snapshot and everything still works.

> **What can actually update (clarified in V1.9.8)**:
> - **TLE (positions/orbits)**: the single file updates too — it fetches from CelesTrak on open.
> - **Wiki stats (launched / in orbit / launches)**: previously readable **only** from a sibling `wiki.json`, so a **downloaded single file kept them frozen**;
>   there is now an **official Pages fallback**: when no local `wiki.json` exists, the page fetches
>   `https://1471155912.github.io/CISTrack/wiki.json` once (needs network) and falls back to the bundled values otherwise.
> - Fully offline: both use the snapshot bundled at build time; everything still works.

> **What can actually update (clarified in V1.9.8)**:
> - **TLE (positions/orbits)**: the single file updates too — it fetches from CelesTrak on open.
> - **Wiki stats (launched / in orbit / launches)**: previously readable **only** from a sibling `wiki.json`, so a **downloaded single file kept them frozen**;
>   there is now an **official Pages fallback**: when no local `wiki.json` exists, the page fetches
>   `https://1471155912.github.io/CISTrack/wiki.json` once (needs network) and falls back to the bundled values otherwise.
> - Fully offline: both use the snapshot bundled at build time; everything still works.

> Want **scheduled automatic updates on your own machine** (periodically pull fresh orbital elements
> and repackage the HTML)? See the dedicated **「🖥️ Local deployment (with scheduled updates)」** chapter below.


## ✨ What it does

| Section | Contents |
|---|---|
| **01 Map** | Each satellite's current sub-satellite point, ground coverage (adjustable minimum elevation) and half an orbit of ground track before/after; you can pin a ground station and highlight the satellites visible from it |
| **02 Orbits** | 3D globe: inclinations, coverage cones and the separation between different launch batches at a glance (altitudes are drawn exaggerated 2.4× above 8000 km so the shells are easy to tell apart) |
| **03 Inclination distribution** | X = orbital inclination, Y = semi-major axis / apogee / perigee; one chart shows which orbital planes the constellation uses. When the data spans LEO and GEO, an **axis break** is applied (the LEO upper bound and the GEO lower bound are aligned on the canvas and the altitudes in between are treated as non-existent) — the two regions form one **continuous** chart, so zooming and panning move as a single rigid body with no jump at the seam |
| **04 Orbit Change Status** | Each satellite's **semi-major-axis climb** from insertion to its working orbit (driven by a self-built historical orbit database; pick a batch or a single satellite to plot it; re-entered satellites are flagged red). Climb rate = least squares over a ±2 day window; **status rule: \|rate\| > 0.5 km/day ⇒ "burning", ≤ 0.5 km/day while outside the working-altitude band (±30 km) ⇒ "coasting"** (the same sentence sits under the chart in that chapter); **the Y axis hugs the selected batch's actual altitude range** (magnifying inter-satellite differences) and the X axis runs from launch day to the last data point; two modes (semi-major axis / climb rate), image export with a Δ column, and two-way sync with the global selection. **Right-hand labels are short names** (`A124` / `S03` / `G01` / `A27A`, identical in both languages) and **clicking or tapping a label selects that satellite** across chapters; the **full official name** (wiki article name / English `WHJSW-<serial>`) appears in the info-panel title and the satellite table, while the raw TLE name stays in the "catalog name" row |
| **05 Network progress** | Two cumulative curves over time (X axis by week, labelled with the matching date): **launches** = cumulative satellites launched (stowaways and the upper stage of the same launch are excluded), **in orbit** = satellites with a TLE available; three time-range presets (all / this year / last 3 months) |
| **06 Satellite table** | Orbital elements for every in-orbit satellite (batch/group, manufacturer, **status**, semi-major axis, apogee/perigee, inclination, period, days in orbit, RAAN, eccentricity, BSTAR, epoch) — sortable, searchable, exportable as an image. Eccentricity and BSTAR use **standard scientific notation** (`1.23×10⁻⁵`). Manufacturers come from the satellite wiki, shortened, and link out |
| **07 Launch history** | Batch / rocket / launch time / site / **target inclination** / **satellites** / mission result per launch. The satellite count is this constellation's own; when the launch also carried others it reads `M/N` (M = this constellation's, N = the whole launch), and failed launches show `-` in both columns. Rockets and sites link to the satellite wiki, satellite names link to satcat.com |

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



## 🖥️ Local deployment (with scheduled updates)

Besides "just double-click the single HTML file", you can put the whole repository on your own machine
and have it **periodically** pull fresh orbital elements and repackage the page. Ideal if you want the
data always current without manually downloading anything.

### Prerequisites

| Item | Requirement |
|---|---|
| Node.js | **18 or newer** (<https://nodejs.org/>). The build chain has **zero npm dependencies** — once Node is installed you are done, no `npm install` |
| Network | Only the "update data" step needs the internet (`celestrak.org`); everyday viewing is fully offline |
| Disk | About 20 MB |

### Step 1: get the repository

Either way works:

- **Download the Release zip** (`CISTrack_v2.0.0.630_local-deploy.zip` from the [latest Release](https://github.com/1471155912/CISTrack/releases/latest)) — unzip and go; **this is the complete package for local deployment**;
- or `git clone https://github.com/1471155912/CISTrack.git`

### Step 2: pick the usage that fits

#### A. Just use the page as-is (install nothing)

Double-click `CISTrack.html`. The page tries to update itself online when opened, and falls back to the bundled data.

#### B. Update manually whenever you want

| OS | Command |
|---|---|
| Windows | Double-click `deploy\update.bat` (or run `deploy\update.bat` from a console) |
| macOS / Linux | `./deploy/update.sh` |

It does four things in order: fetch the latest orbital elements → rebuild the bundled data →
repackage the single-file HTML → sync the versioned snapshot. Then double-click the new `CISTrack.html`.

#### C. Update automatically every day (scheduled task)

| OS | Register | Remove |
|---|---|---|
| Windows | Double-click `deploy\schedule-install.bat` (daily at 06:00) | Double-click `deploy\schedule-remove.bat` |
| macOS / Linux | `./deploy/schedule-install.sh` (daily at 06:00 via crontab) | `./deploy/schedule-remove.sh` |

On Windows the job appears in Task Scheduler (`taskschd.msc`) as `CISTrack-Update`;
on macOS/Linux check it with `crontab -l`. Logs go to `deploy/update.log`.

### Data & privacy

- Updating talks **only** to `celestrak.org` (the public NORAD satellite catalog) and the satellite wiki.
  Nothing is uploaded; there are no accounts, keys or telemetry.
- The page **writes nothing to browser storage**: settings, views and page numbers reset on refresh (by design).
- The scheduled task runs locally only, and writes only local files.

### ❓ Local deployment Q&A

**Q1: Can I use it without Node.js?**
Yes. Without Node you are in "option A" — just double-click `CISTrack.html`, and the page tries to update
itself online when opened. Node is only needed when you want to **repackage** (bake new TLEs into the single file).

**Q2: What if the scheduled update fails?**
Almost always the network was unreachable (CelesTrak). This **does not** affect the existing page:
bundled data keeps working, and the page retries the online update on next open. Check `deploy/update.log` for the reason.

**Q3: Does updating overwrite my previous page?**
Yes. `deploy/update.bat` / `update.sh` regenerate `CISTrack.html` (and keep a `CISTrack_v<version>.html`
snapshot). Copy the old one somewhere first if you want to keep it.

**Q4: Why is updating sometimes seconds and sometimes minutes?**
Slow runs are usually waiting on CelesTrak (it retries a few times). The build itself is pure local computation and takes seconds.

**Q5: Can I run it on a server / NAS / Docker?**
Yes — it is just "Node scripts + static files". Put the repository anywhere, run `deploy/update.sh`, then
serve `CISTrack.html` + `wiki.json` + `history/` with any static server (Nginx, `python -m http.server`).
Note: over `http(s)://` the page can also load `wiki.json` and the history shards; over `file://` those two
are skipped (satellite positions and elements are unaffected — only the top counters and chapter 04 history curves).

**Q6: On Windows the bat window flashes and disappears?**
Then it has already finished (both success and failure `pause` for a keypress; if it still flashes,
right-click → run from a console to see the output). The bat files here are written as CRLF + pure ASCII
to avoid encoding problems.

**Q7: Is the scheduled job noisy?**
No popups (Task Scheduler and cron both run in the background); it only appends to `deploy/update.log`.

---

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
node mkmanufacturers.mjs        # scrape the "developer" table of the wiki articles (cached; --force to refetch)
node mkdata.mjs         # build build/satdata.json (per-batch delta packing) and build/wiki.json
node build.mjs          # assemble the single-file HTML and copy wiki.json next to it
node smoke.mjs          # logic smoke test (jsdom, no external dependencies)
node visual.mjs         # optional: real-browser layout and interaction checks (needs a local Edge + ws)
```

> `mkmanufacturers.mjs` has to get past the article WAF: it opens a real browser and polls the title until the challenge page clears itself (20–35 s in practice). The result is cached in `data/manufacturers.json`, so routine rebuilds do not need it.


**Before publishing / when troubleshooting: is the platform down, or is it us? (added in V1.9.9)**

```bash
node scripts/check_gh_status.mjs            # GitHub status for Pages / Actions / API Requests
node scripts/check_gh_status.mjs --verify   # also compare the live version (one shot, no retries)
node scripts/check_gh_status.mjs --json     # machine-readable
```

- **Read-only, single-shot, hard timeouts**: 8 s for the status API and 10 s for the page — **no polling loop**;
- Exit codes double as a gate: `0` OK | `7` degraded | `8` outage | `2` platform OK but the site is stale | `9` status API unreachable;
- On `DEGRADED` / `OUTAGE` the script says **do not wait**: at that moment "the site did not update / the build failed"
  is most likely on GitHub's side (this happened on 2026-10-19: Pages reported `Page build failed` with duration 0
  during the `Degraded availability for GitHub Actions, GitHub Pages and Webhooks` incident).
## 🔄 Where the data comes from · how it is updated

**In one sentence**: the orbital elements (TLEs) are fetched by **the visitor's own browser** when the page opens, so anyone online always sees the newest data; everything else (the satellite wiki statistics and metadata, per-launch mission results, the coastline, the SGP4 implementation) is fetched or bundled at **build time**. GitHub Pages has no database and simply serves the repository as-is, so "updating the site" comes down to these two routes.

| Source | Used for | How to update it | Local task needed? |
|---|---|---|---|
| **CelesTrak / NORAD orbital elements (TLE)** | Where satellites are now, ground coverage, orbit shape | **Fetched live in the visitor's browser** on page open (several sources, public-proxy fallback, 30-minute session cache) | **No** (online visitors are always current) |
| **Space-Track GP history** | The semi-major-axis climb curves of **04 Orbit Change Status** (historical orbit database) | Bulk-fetched at build time (login + `gp_history`, `format=tle`) into `data/history/`; `refresh.mjs` appends each day's elements; `mkdata.mjs` samples and packs them into the published `history/` shards | A local task (quota-limited, not suitable for CI) |
| **Satellite wiki "GuoWang / Qianfan" articles** | The three header statistics (launched / in orbit / launch success) | Scraped once at build time; a scheduled task can also run `scripts/fetch_wiki.mjs` (zero dependencies) and commit the result | Optional (header numbers only) |
| **Satellite wiki yearly launch-record pages** | The mission-result column of the launch history chapter and the vertical definition of 05 Network progress | Run `scripts/fetch_launch_results.mjs` at build time; the result lands in `wiki_launches.json` and is merged by `mkdata.mjs` | Optional (best run together with the TLE task) |
| **Natural Earth coastline** | Land outlines on the map | Downloaded and bundled at build time | No |
| **satellite-js (SGP4)** | Propagating positions from a TLE | Bundled at build time | No |

`data/ct_*.tle` is only an **offline fallback snapshot** and can be refreshed periodically with `refresh.mjs`.

### The satcat catalogue: why it needs special handling (since V2.0.0.630)

Besides the public elements above, the project also depends on CelesTrak's **`pub/satcat.csv`** (the NORAD
space-object catalogue — about 6.4 MB / 70k rows). It plays **no part in orbit propagation**, but it
backs four things:

1. **Per-launch satellite counts** — the `M/N` figure in the header and the launch history;
2. **Re-entry markers** — the "re-entered" state and decay dates;
3. **Search pools** — "already re-entered" and "not yet catalogued" objects have no TLE, so without this
   **searching by name or NORAD finds nothing**;
4. **Pending-summary data** — the hover tooltip behind the "pending" tag in the launch history.

The problem is **size**: 6.4 MB is not something to commit every day. So it is split in two:

| File | Size | In the repo? | Produced by |
|---|---|---|---|
| `data/satcat.csv` (full) | 6.4 MB | **no** (`.gitignore`) | `refresh.mjs`, re-downloaded daily |
| `data/satcat_slim.csv` (**this project's subset**) | **~110 KB** | **yes** | `refresh.mjs`, exported from the full file each run |

The subset contains **every row of this project's 60 launch batches** (measured: 1275 rows), and it
deliberately keeps rideshare payloads and R/Bs — the "N = how many payloads that launch carried" needs
them, and keeping only our own constellation's rows would under-count `M/N`. **Its header and column
order are identical to the full file**, so every downstream consumer works unchanged.

At read time, `scripts/satcat_src.mjs` decides **which copy to use**: whichever is newer, with the full
file winning ties. Three details are recorded here so they are not "simplified away" later:

- **The subset's freshness comes only from the `exported` timestamp in `satcat_slim.meta.json`**, never
  from the file's mtime — `git checkout` rewrites mtime to the checkout time, so using it would treat a
  three-month-old subset as brand new.
- **A subset is exported only when the full file is present *and* genuinely fresh (≤2 days).** If
  restricted network access leaves the full file days old, exporting would stamp stale data with today's
  date — worse than not exporting at all (silently false freshness).
- **If the exported subset loses a batch, the run fails explicitly with exit code 9**: a batch dropping
  out of the subset is exactly the silent defect this mechanism exists to prevent.

One limitation to know: **the subset can never discover a new launch batch** (it is filtered by existing
batch prefixes). New batches still require one `refresh.mjs` run in an environment that can reach
CelesTrak — which the CI does on a daily basis.

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

The curves in the **04 Orbit Change Status** chapter are driven by a self-built historical orbit database. The design goal: keep working as the two constellations grow from a few thousand to **tens or hundreds of thousands** of satellites, and be hostable on GitHub as part of an open-source project.

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

## 🛰️ How the in-orbit status is derived (four states since V2.0.0)

> **The most important sentence first: every statement this project makes about a satellite's
> "in-orbit status" is a statistical estimate inferred from public TLEs — not the satellite's real
> state. It does not represent the actual situation and must not be used for mission decisions,
> fault diagnosis, insurance or legal purposes.** See "Disclaimer" at the end.

In the *Orbits Change* section (04) and the *Satellite Table* section (06) every satellite carries a
status tag. **Before V2.0.0** that tag had only a coarse two or three buckets
(in orbit / raising / re-entered), and "in orbit" lumped together satellites **sitting on their
intended working orbit** with those **parked long-term in the wrong place**. V2.0.0 splits it into
**four states**:

| Tag | Meaning |
|---|---|
| **In orbit · normal** | Holding (or essentially holding) the intended working orbit for its launch |
| **In orbit · possibly anomalous** | Parked long-term at a **non-intended** altitude/orbit while other satellites from the same launch have already arrived |
| **Raising · burning** | Still actively raising/lowering, with measurable thrust |
| **Raising · coasting** | Still heading for the target, but currently moving very slowly (creeping near the layer, or paused) |
| **Re-entered** | Already left orbit (with a decay date) |

### Step 1 — find the working "layers" from the data (they are not hard-coded)

Layers are **clustered from the actual altitude distribution of the satellites**, not configured by hand:

1. **Pick stable seeds**: only satellites that are *not* currently raising are used to build layers —
   2-day rate ≤ `0.5 km/day`, 30-day net rise < `10 km`, and enough history points.
   **Building layers from stable satellites only** is essential: include the still-climbing ones and
   they line up in a vertical column that gets mistaken for a "layer".
2. **Cluster by inclination band + altitude**: within one inclination band (`0.5°`), sort by altitude and
   **break the chain whenever the gap exceeds 30 km**; a group needs at least `8` members, and its
   altitude standard deviation must be ≤ `8 km`.
   *That σ cap specifically blocks fake layers made of satellites that merely happen to line up*:
   measured, 31 Qianfan satellites sit stably between 800 and 974 km (σ = 57.7 km) — without the cap
   they would be taken as one 174 km-thick "working layer".
3. **Layer altitude = the modal 10-km bucket**: heights are rounded to 10 km, voted, and the most
   frequent bucket wins — so layer altitudes are always round tens (1150 / 1170 / 510 / 1070 km),
   never an averaged number with decimals.
4. **Assign each satellite**: compare only against layers in its **own inclination band**, take the
   nearest one; "on the layer" requires a distance ≤ `30 km`.

> Measured today: CSCN has 4 layers (1150/50°×117, 1170/86.5°×61, 1100/50°×11, 510/55°×9);
> Qianfan has 1 (1070/89°×197). These numbers are computed, not configured.

### Step 2 — tag each satellite (the order of the rules matters)

```
(1) Is it GEO?                        → separate thresholds (rate 3.0 km/day, since GEO station-keeping moves anyway)
(2) Too few history points (< 4)?     → insufficient data, conservatively "raising" (never falsely claim "arrived")
(3) |2-day rate| > 0.5 km/day?        → raising · burning
(4) Off every layer, or > 30 km away? → raising · coasting
(5) On a layer, but 7-day rise ≥ 3 km?→ raising · coasting (creeping near the layer)
(6) otherwise                         → in orbit
```

Rule (5), the "creeping near the layer" fallback, is **necessary**: some satellites move so little per
day that the 2-day rate stays under the 0.5 detection line, yet a 3 km rise over 7 days is visible
(stable satellites' p99 noise on the same measure is only 0.54 km/14 days, so it does not misfire).
Conversely you **cannot** use "30-day net rise ≥ 10 km" directly: satellites that arrived less than
30 days ago still have the climb inside that window (measured: Qianfan 69857/69860/69865 show a 24.9 km
30-day rise but ≈ 0 over 7 days — they stopped long ago).

### Step 3 — separate "possibly anomalous" out of "in orbit"

This is the strictest rule set — **all three conditions must hold** before we dare tag it:

1. It is genuinely static: altitude drift ≤ `5 km` across a `60`-day span
   (only a satellite that has really stopped somewhere gives us grounds to say it "is parked there";
   anything still moving is never guessed at)
2. It sits **more than 100 km away from every working layer** of its constellation
   (closer than that might just be an imprecise layer height; further away is clearly "not the working orbit")
3. **Other satellites from the same launch have already arrived** (at least one layer member from that batch)
   (if the whole batch has not arrived yet, it is just "this launch went higher / has not finished
   manoeuvring", not a single-satellite anomaly)

**If any of the three fails, the satellite is filed as "in orbit · normal".** Why so conservative: the
label carries an implication of "anomaly", so a false positive wrongly accuses a healthy satellite,
while a false negative merely withholds a hint. **Better to say nothing than to say it wrong.**

> Measured (V2.0.0): 422 in orbit · normal / 17 in orbit · possibly anomalous / 75 raising / 1 re-entered.
> All 17 are Qianfan (zero for CSCN).

### Step 4 — "re-entered" is handled separately, and must never be given fabricated orbital data

Re-entered objects (`DECAY_DATE` non-empty in `satcat`) **bypass every rule above** and get
`re-entered` plus the decay date. That sounds obvious, but V2.0.0 fixed a real defect here: the old code
excluded them from the rule inputs, so they **fell into the "insufficient data" fallback** and were
given fabricated `raising + 510 km` data — and 510 km happens to equal one of CSCN's layer altitudes,
so a relaxed rule would have counted them as members of that layer.

### Known limitations (stated plainly)

- **TLE only**: TLEs are public, coarse mean elements. A satellite's real attitude, payload state or
  whether it has failed **cannot be derived at all**. Holding the right altitude does not mean it works;
  a wrong altitude does not necessarily mean a fault (it may simply not be finished yet).
- **"Possibly anomalous" covers one shape only**: parked long-term at the wrong altitude. Other anomaly
  shapes (inclination drift, phase dispersion, conjunction risk within a plane) are **not** judged.
- **Fresh launches must wait**: the rules need history, so a satellite launched days ago will only get
  "raising" — that is correct conservatism, not a miss.
- **The thresholds are empirical**: `0.5 km/day`, `60 days`, `100 km` come from the measured distribution
  of current data and may need retuning as the constellations grow or operations change.
- **The sources themselves lag**: `satcat` is roughly daily, TLE batches roughly every 12 hours. Upstream
  delay shows up directly as "this judgement is a little behind reality".

> **Once more: all of the above is a rough estimate reverse-engineered from public data and does not
> represent the satellites' actual in-orbit status.** The same statement appears on the page below the
> *Orbits Change* and *Satellite Table* charts, and is embedded in the exported images.

## 📊 Data sources

- [CelesTrak](https://celestrak.org/) — public orbital elements (TLEs) from the NORAD space-object catalogue
- [Space-Track.org](https://www.space-track.org/) — 18 SDS GP history (the source of the historical orbit database)
- [Satellite wiki](https://sat.huijiwiki.com/) — article-level launch/in-orbit statistics, batch names, launch vehicles and sites
- [Natural Earth](https://www.naturalearthdata.com/) — coastline (public domain)
- [satellite-js](https://github.com/shashwatak/satellite-js) — MIT-licensed SGP4 implementation
- [Spacetrack Report #3 / CSSI official verification cases](https://celestrak.org/NORAD/documentation/) — the **numerical regression baseline** for SGP4 (33 scenarios / 667 expected positions and velocities; the verbatim files live in `data/cssi/` and are used for testing only). The files come from the [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) (MIT) source distribution, which ships the verbatim official copies; the tolerance convention (`error = 2e-7`) comes from its test suite as well.
- [findrassvet.ru METHODOLOGY.md](https://github.com/vbklgd/findrassvet/blob/main/METHODOLOGY.md) — orbit-raising rate (RATE/ТЕМП) methodology (our project's origin; see the thanks section at the top)
- [Audiowide](https://fonts.google.com/specimen/Audiowide) — SIL OFL 1.1, embedded as base64

## ⚠️ Disclaimer

- This project is **unofficial** and is not affiliated with China Satellite Network Group Co., Ltd. or Shanghai Yuanxin Satellite Technology Co., Ltd.
- The propagation is based on public TLEs and carries inherent error; the positions shown are **simulated** and do not represent reality.
- **The map is only a rough outline of continental coastlines and does not accurately represent any actual projection.**
- Neither the generated images nor the page may be used for any professional purpose.

## 🔗 Sources and attribution

| Item | We take it from | Upstream source | License / terms |
|---|---|---|---|
| Orbital elements (TLEs) | CelesTrak | US Space Force **18 SDS** (distributed via Space-Track) | CelesTrak [usage policy](https://celestrak.org/usage-policy.php) |
| Batches / vehicles / sites / developers / Chinese names / article links | Satellite Wiki (SatNet & Qianfan articles) | Community editors | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.en) ([copyright page](https://sat.huijiwiki.com/wiki/Project:%E7%89%88%E6%9D%83)) |
| Coastlines | Natural Earth (embedded) | Natural Earth | [Terms](https://www.naturalearthdata.com/about/terms-of-use/) (public domain) |
| SGP4 | satellite.js (MIT) | Spacetrack Report #3 / CSSI | [satellite-js](https://github.com/shashwatak/satellite-js) |
| SGP4 regression vectors | [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) (MIT, ships the verbatim official files) | Spacetrack Report #3 / [CSSI official verification cases](https://celestrak.org/NORAD/documentation/) | Official test data, kept verbatim in the repo (`data/cssi/`); test-only, never shipped to the page |
| Font | Audiowide (embedded base64) | Google Fonts / Astigmatic | SIL [OFL 1.1](https://openfontlicense.org/) |
| Orbit-raising methodology | findrassvet.ru | same | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.en), credit `findrassvet.ru, V. Bulybenko` |
| Engineering approaches | Kayhan Space open source | same | [MIT](https://github.com/Kayhan-Space/sgp4gl) |
| This page | — | — | [MIT](LICENSE) |

## 📜 Disclaimer and privacy

- **Accuracy**: data comes from third-party catalogues and a community wiki; it may contain errors and lag. TLE / SGP4 are **not suitable for conjunction assessment, flight operations or business decisions**; nothing here is professional advice.
- **Availability**: provided "as is"; upstream changes may leave the data stale.
- **AI involvement**: parts of the code, documentation and scripts are **AI-assisted** (vibe coding). The author has tested and reviewed them, but gives **no warranty against residual defects**; the Chinese text is authoritative for translations.
- **Privacy**: **nothing is collected or uploaded** — no accounts, cookies, analytics, ads or third-party scripts. Settings and a 30-minute element cache live locally only and can be cleared anytime. At runtime the page requests same-origin `wiki.json` / `history/` and may contact `celestrak.org` (**that site sees your IP**; on failure it falls back to public CORS proxies, which also see it). GitHub Pages logs access under its own privacy statement.
- **Unofficial**: a personal hobby project, **not affiliated with or authorised by** any space agency or constellation operator.

## ⚖️ License

[MIT](LICENSE) — free to use, modify and distribute (commercial use included), as long as the copyright and license notice are kept.

## Repository layout

```
CISTrack.html           ★ latest build (no version in the name) — use it for the stable link:
                          https://1471155912.github.io/CISTrack/CISTrack.html
CISTrack_v1.9.9.630.html    snapshot of the current version
CISTrack_v1.9.8.html    snapshot of the previous version (for rollback / comparison)
                        ↑ older ones are **trimmed automatically** by `release.mjs` (current + previous only)
index.html              entry page (an 811-byte redirect to CISTrack.html)
assets/                 assets used by the READMEs (the wordmark animation cistrack-logo.gif)
deploy/                local-deployment scripts: one-click update + schedule register/remove (.bat / .sh, zero-dependency; see "Local deployment")
README.md / README.en.md
                        this documentation: Chinese (default) / English (split out in V1.9.1 A16, cross-linked at the top)
CHANGELOG.md / CHANGELOG.en.md
                        changelogs (per-version changes and data-source changes; Chinese / English)
LICENSE                 MIT
package.json / package-lock.json
                        dependency manifest (jsdom / ws are needed for the tests only; the build itself needs only Node)
history/                published shards of the historical orbit database (the data behind 04 Orbit Change Status, loaded on demand; see "Historical orbit database")
app.js / template.html  sources (the single-file build = these two + data/, packed by build.mjs)
data/                   satellite data (manufacturer table, offline TLE fallback snapshot, coastline data, history source store data/history/)
wiki.json               cached satellite-wiki statistics (the source of the header counters; the page reads it at runtime)
wiki_launches.json      per-launch mission results for both constellations (the "result" column in Launch history + the basis of 05 Network progress)
build.mjs / mk*.mjs     build scripts (pack the sources into the single-file HTML):
                          mkdata.mjs           TLEs + batch metadata → build/satdata.json (delta-encoded)
                          mkcoast.mjs          Natural Earth coastlines → data/coast.js.txt (selectable tiers; see the script header)
                          mkmanufacturers.mjs  manufacturer / developer cache (self-expires after 3 days)
                          refresh.mjs          fetches the current TLEs
release.mjs             path-independent artifact sync (writes the CISTrack_v<version>.html snapshot, package.json version
                        and README badges, and **trims** older versioned artifacts down to current + previous)
smoke.mjs               tests: logic and source assertions (jsdom) — **the suite CI runs**
                        ↑ development/verification tools (`clean.mjs` / `i18n.mjs` / `visual.mjs` / `scripts/audit_tle.mjs`)
                          have lived **outside the repository** since V1.9.5
scripts/fetch_wiki.mjs          fetches and updates wiki.json (zero dependencies; see "Updating the data")
scripts/fetch_launch_results.mjs fetches the wiki's yearly launch pages → wiki_launches.json (zero dependencies)
scripts/fetch_history.mjs       bulk historical TLE fetch (for seeding / backfilling; not needed for routine maintenance; see "Historical orbit database")
scripts/histstore.mjs           history source store: read/write plus capacity governance (mergeInto / pruneRecords)
scripts/histpack.mjs            history published-shard packing (v2 encoding + change-driven sampling)
scripts/omm.mjs                 6-digit catalog numbers (CelesTrak 100000+) and TLE epoch conversion
scripts/audit_refs.mjs          reference-integrity check ("a test references a file that is not in the repository")
scripts/privacy_check.mjs       de-sensitisation gate (author-private environment narrative → hard fail)
scripts/repo_hygiene.mjs        repository-hygiene gate (root allowlist + process-file blocklist → hard fail)
scripts/cdp.mjs                 **shared browser-scraping base** (extracted in V1.9.9.630): find a browser /
                                start CDP / the challenge-page predicate live in exactly one place. All four
                                fetch scripts depend on it — they each used to implement their own copy with
                                differing strictness, which is why the same class of bug kept coming back.
scripts/e2e_adversarial.mjs     **adversarial tests** (new in V1.9.9.630): feed the pipeline bad data and see
                                whether it *rejects it properly* or *quietly writes a broken artifact*.
                                Fully offline; 62 assertions across six layers.
scripts/import_history.mjs etc. see each script's header (history import / climb-algorithm self-test / search pools / offline e2e / temp-root resolution)
.github/workflows/      cloud automation: update-tle.yml refreshes the TLEs and rebuilds every 12 hours
```




## 🧭 Three kinds of "altitude": where each is used and how it is computed (V1.9.8)

The numbers labelled "altitude" are **not the same quantity** — do not convert one into another. All three come from the public TLEs; none is a hand-entered design value. The in-app "Readme → Accuracy → Three kinds of altitude" section carries the same text.

**① Semi-major-axis altitude** (table / chart Y axis / the "orbit distribution" row / the climb curves in 04): `h = a_Brouwer − 6378.135 km`. `a_Brouwer` is the catalog mean motion with the WGS-72 J2 secular terms removed (what SGP4 recurses with), minus the WGS-72 equatorial radius. It is a **geometric scale**, independent of which latitude the satellite flies over.

**② Instantaneous altitude** (info panel of 01 Map / 02 Globe, refreshed every second): **geodetic height above the WGS-84 ellipsoid** (sea level). SGP4 gives ECI → ECEF → solve the **geodetic latitude** `φ` iteratively (`p=√(x²+y²)`, `z`; Bowring form, 20 iterations) → `h = p/cosφ − N(φ)` with `N(φ)=a/√(1−e²sin²φ)`, `a=6378.137 km`, `b=6356.7523142 km`, `f=1/298.257223563`, `e²=2f−f²=0.00669437999014`. It excludes terrain elevation and atmospheric refraction.

**③ Geocentric radius** (internal only): `r=|position|`. The difference from ② is exactly "Earth is not a sphere".

**Why ② swings by 20-odd kilometres**: for a circular orbit `r` barely changes, but the ellipsoid sits **21.4 km lower at the poles** (`a−b`) — a satellite at 1,150 km reads ≈1,150 km over the equator and ≈1,171 km over the poles. That is geometry, not jitter; on top of it sits **±a·e** (≈±1.4 km). The sub-satellite latitude is geodetic, not geocentric (they differ by ≈0.19° near 45°). **Coverage zones / elevation / visibility cones still use a geocentric sphere** (6378.135 km) — a deliberate approximation worth under 0.3% at a 10° mask.

## 🧭 Methodology credits (V1.9.8)

The **orbit computation, altitude and sub-satellite point** in this project follow, in method, the open
**[findrassvet](https://findrassvet.ru)** project (by V. Bulybenko, which tracks the orbit-raising of Bureau 1440's
Rassvet constellation). Its methodology is public:
[vbklgd/findrassvet · METHODOLOGY.md](https://github.com/vbklgd/findrassvet/blob/main/METHODOLOGY.md).

Three points adopted (each with the quantitative reason it gives):

| Adopted | Why (their measurement) | Where it applies here |
|---|---|---|
| **Semi-major axis via Kozai→Brouwer** (the three `sgp4init` steps, WGS-72) instead of plain `a=(μ/n²)^⅓` | The plain formula is systematically **+3.03 / +3.04 km high at 82.3° / 97.4° inclination** and only −0.50 km at 51.6° | This project's computation model defaults to **Brouwer**, matching |
| **Orbit-raising rate from a 2-day least-squares window**, never adjacent-set differencing | Single-set noise σ = 0.166 km with a median 7.5 h spacing → adjacent differencing gives ≈ **0.75 km/day** of noise, enough to make passive flight (−0.05 km/day) look like thrusting; the 2-day window cuts it to 0.11 km/day, with the **"thrusting" threshold at 0.5 km/day ≈ 4.5σ** (lowered from 0.8 on 2026-10-17; measured to reclassify exactly one extra satellite, with no false positives) | The "raising · burning / coasting / in orbit" classification and the rate (`rr`) |
| **A slow climb cannot be caught by a rate test alone** — a **rate-independent** altitude band runs alongside it | "A tiny gain every day, accumulating over weeks" is invisible to any per-day rate threshold; being **more than ±30 km away from the group working altitude** does not depend on rate at all, so accumulated drift eventually trips it | The fallback for "raising" (and the rule behind the "coasting" state); the cost is that up to **30 km of drift stays invisible** (≈ 2.6% at 1,150 km) |
| **Instantaneous altitude ≠ semi-major axis altitude**: it is **WGS-84 geodetic height** (above the ellipsoid). For a circular orbit the same geocentric radius reads **21.4 km lower over the equator than over the poles** (a−b), plus **±a·e** (≈ ±1.4 km at e≈2e-4) | Orbit raising is only cleanly visible in the semi-major axis; the instantaneous altitude genuinely swings along an orbit — the ellipsoid term is an order of magnitude larger than the eccentricity term | The live-ticking altitude in the info panel (the swing is **physical**, not jitter); see "Three kinds of altitude" below |

> Citation: findrassvet's methodology text and figures are **CC BY 4.0**. If you cite this project's implementation
> of those methods, please also credit **"findrassvet.ru, V. Bulybenko"**.
> This project is not affiliated with findrassvet or Bureau 1440; both use the public NORAD catalog.


### 🔐 About the third-party CORS proxies (disclosed, V1.9.8)

If a direct browser request to `celestrak.org` is blocked by CORS or the local network, the page **falls back to two
public CORS proxies**:

- `api.allorigins.win`
- `api.codetabs.com`

**What that means, plainly**: when the proxy path is used, the target URL and **your IP** pass through those two
third-party services. This project sends no personal data — the proxies only relay public TLE requests — but **if you
do not want traffic to go through a third party**, keep the direct path working (or use the local-deployment +
scheduled-task setup so data is refreshed on your own machine).

> Planned after V1.9.8: a **direct-only** switch (direct by default; ask before using a proxy) and the actual network
> footprint listed in the in-app About panel.
