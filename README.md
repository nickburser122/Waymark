# Waymark

A care-routing and clinic-flow tool. Every feature runs through one shared six-stage pipeline: demand → capacity → queue → gate or risk → score → decision. It is a static site with no server and no build step.

## Run it

Serve the folder over HTTP and open `index.html` (modules and the batch worker do not load from `file://`):

```
python3 -m http.server 8000
```

## Features

- **Routing, Single.** Pick a patient, drag them on the map, read one headline sentence, the contribution bars, the ranking, a robustness check and a Why not list.
- **Routing, Batch.** Place a whole patients table in a Web Worker. Urgent patients go first, then those with most to lose (regret order). Split plans cover needs no single site offers. A comparison card shows the result against the nearest feasible site, with site load rings and a virtualised, exportable results table.
- **Clinic, Single.** A fluid queue model per station and hour, with a utilisation heatmap, weak point risk, a ranked fix plan that re-ranks after each fix, and Auto-plan within a budget.
- **Clinic, Batch.** One row per site, with a drill-in.
- **Data.** One tab for both models, split into Routing data (4 tables) and Clinic data (7 tables), each with its own summary. Browse as cards or as table tabs with the grid open inline. Every table has a template, CSV/TSV/JSON upload, paste from a spreadsheet, a column mapper and a grid editor with per-cell validation. A failed upload leaves the last valid data active. Undo and redo cover 50 steps.
- **Equations.** Plain sentences or live-value formulas, copied as text, LaTeX or Markdown, with every parameter taken from the same registry the engine reads.
- **Plain / Formula** switch in the header changes every explanation in the app.
- **Theme**: System, Light or Dark from the header. System follows the operating system and updates live; the choice is remembered.

## Clinic governance

Optional columns keep old uploads valid: `fixes.needs` (any of `space`, `budget`, `staff`, `approval`), `fixes.alternative_to` (another fix at the same site) and `weak_points.category` (`oversight`, `information`, `alternative`, `dependency`, `bottleneck`; the v2 codes `ctrl`, `info`, `alt`, `dep`, `neck` are accepted).

- **Resources card:** four switches. Switching one off blocks every fix that needs it. Every resource is on by default, so results match earlier versions until you change one.
- **Marks:** a fix can be marked "Tried, no effect" or "Other blocker". Marks are stored per site and block the fix.
- **Blocked fixes** sit in their own list with the reasons, and with "Instead: …" when the alternative fix is feasible. Auto-plan only uses feasible fixes, and each step has a phase (Now, Next or Later by terciles).
- **KPIs:** risk now, after feasible fixes, with unlimited resources, and lost to resource limits.
- **Does the order hold?** shows the top 3 fixes under each preset, with a Use chip.
- **Uncovered bottlenecks** lists stations at or above full load that no fix targets.
- Selecting a weak point also lists the stations downstream of it.
- Weak points can be filtered by category. Hover the I, F, P and D headings for the rating anchors, which are also listed in the Equations risk block.
- Plan CSVs gain `phase`, `feasible` and `blocked_by`, and the clinic Batch table gains Blocked fixes and Lost to limits.

## Batch comparison and synthetic patients

The Batch comparison adds total cost, public room used (public stops over the free public slots before the run), load spread (standard deviation of site load after the run) and a stacked tier bar for Waymark against the nearest baseline. On the Data tab, the patients table has "Generate patients…": a seeded generator that places patients near sites in proportion to capacity, with 1 to 3 needs and a 70/23/7 routine, soon and urgent mix. It replaces or appends through the normal apply step, so it is validated and can be undone in one step.

## Audit

Every Single decision has a run ID, an 8 digit FNV-1a fingerprint of the engine version, the patient, every parameter, the data tables and any capacity counting. The same inputs and data always give the same run ID. The Decision card can copy a Markdown decision record and log the decision to a local ledger. The Audit card lists seven integrity checks, how long the evaluation took, and the ledger, which can be exported as CSV or JSON.

## Explanations in Single

- **Why this one and not that one:** diverging bars show how each score term moves the winner against the runner-up. They add up to the margin, and the biggest gap is named the decisive term in the Decision card and the record.
- **Nearest feasible:** the Decision card compares the pick with the closest site that passes every gate.
- **Explain this to the patient:** a plain-language note with a copy button. It states the recommended site, travel, wait and cost, and never promises that nothing extra is owed.
- **Why not:** a gate funnel (all sites, offer every need, meet the deadline, within reach, below the load limit, free slots, scored), and failed sites grouped by the first gate they fail. A "Near full" tag marks ranked sites at or above the near-full load.

- **Rank-flip thresholds:** one strip per weight shows who wins as that weight sweeps from 0 to 100 points, with the other weights rescaled in proportion. Scores are straight lines in the swept weight, so the breakpoints are computed exactly, not sampled.

## Strict public-first

With the lock on, private and contracted sites are used only when no public site passes every gate. It applies in Single, Batch (including the regret scan and the nearest baseline) and split plans, which fill from public sites first. Sites held back by the lock appear in Why not with a "held back" chip. The Public-first preset only changes weights, so the lock is a separate switch.

## Patient choice override

`patients.requested_site` is an optional column naming the site the patient asked for (unknown ids raise a warning and are ignored). Single preselects it for that patient. Batch judges every request with the same seven rules, against the final placements and without using the override token, then reports the tally under the comparison (same, approved, co-pay, sign-off, waitlisted, denied, and total co-pays). Each batch row shows the verdict as a tag, and the batch CSV gains `requested_site`, `override_outcome` and `override_copay`. Requests never change where anyone is placed.

In Single, "Patient asks for" judges a requested site with seven rules: clinical fit, clinical deadline, slot reserve, override reach, override token, score tolerance and cost gap. The outcome is one of same, approved, co-pay, sign-off, waitlist or denied, using the three `override*` parameters. The request and token are part of the run ID and the decision record, are not saved between sessions, and do not affect Batch.

## Entry paths

`index.html#route`, `index.html#clinic`, `index.html#data`, `index.html#eq`. The pipeline strip links each stage to its equation.

## Tables and templates

Columns can be named with common synonyms; anything else goes through the mapper. Clinic tables take an optional `site` column for several sites.

| Table | Required columns | Optional columns | Template |
| --- | --- | --- | --- |
| `facilities` | id, name, tier, services, capacity_per_day, price_multiplier, and lat + lon or x + y | lat, lon, x, y, referrals_per_day, waitlist, quality, reviews | [`templates/facilities.csv`](templates/facilities.csv) |
| `services` | id, name, base_price | complexity | [`templates/services.csv`](templates/services.csv) |
| `patients` | id, needs, urgency, and lat + lon or x + y | name, lat, lon, x, y, previous_site | [`templates/patients.csv`](templates/patients.csv) |
| `travel` | patient_id, facility_id, minutes |  | [`templates/travel.csv`](templates/travel.csv) |
| `stations` | id, name, service_min | service_cv2, site | [`templates/stations.csv`](templates/stations.csv) |
| `staffing` | station_id, hour, servers | site | [`templates/staffing.csv`](templates/staffing.csv) |
| `arrivals` | hour, arrivals | arrival_cv2, site | [`templates/arrivals.csv`](templates/arrivals.csv) |
| `routes` | from, to, share | site | [`templates/routes.csv`](templates/routes.csv) |
| `weak_points` | id, station_id, title, impact, frequency, unpredictability, detectability | site | [`templates/weak_points.csv`](templates/weak_points.csv) |
| `fixes` | id, title, effort | cost_k, site | [`templates/fixes.csv`](templates/fixes.csv) |
| `fix_effects` | fix_id, kind, target, delta | field, from_hour, to_hour, site | [`templates/fix_effects.csv`](templates/fix_effects.csv) |

In `fix_effects`, `to_hour` is exclusive: an effect with `from_hour` 9 and `to_hour` 12 covers hours 9, 10 and 11. A `from_hour` at or above `to_hour` does nothing and raises a warning.

Staffing may also be uploaded wide (`station_id`, then `h08`, `h09`, …). Quality must run from 0 to 1; a 1–5 or percent scale is offered for conversion. Limits: 5 MB per file, 10 000 patients, 1 000 facilities, 200 stations.

## Storage

- `localStorage` key `waymark.v3`: view, modes, explanation style, theme, data layout, applied fixes and every parameter. A `waymark.v2` key is read once and migrated, and left in place.
- IndexedDB database `waymark`, store `datasets`, key `active`: the eleven tables, where each came from and the uploaded file names. If it is unavailable, work continues in memory and the Data tab says so.
- IndexedDB keys `quarantine-<timestamp>`: a copy of saved data that failed validation on load. The data stays editable in the Data tab, and each copy can be downloaded as JSON. They are never deleted automatically.
- IndexedDB key `ledger`: the decision ledger (newest first, at most 5 000 entries, no patient names unless switched on in the Audit card). An older ledger in `localStorage` key `waymark.ledger.v1` is moved over the first time the Audit card loads and then removed. If IndexedDB is unavailable (for example in some private-browsing modes) the ledger stays in that `localStorage` key instead and nothing is moved or deleted. The ledger can be exported as CSV or JSON and a JSON export can be imported back; duplicates are skipped by run ID and malformed rows are dropped.
- Backups of saved data that failed validation can be downloaded or deleted one at a time or all at once in the Data tab, each after a confirmation.
- Old keys `meridian.state`, `meridian.ledger` and `waymark.clinic` from the v2 app may still exist in the browser. They are ignored, because their models do not map to v3. `meridian.theme` is read once, when no v3 or v2 settings exist, and all old keys are left in place.
- `settings.resources` and `settings.fixMarks` (`{ siteId: { fixId: 1 | 2 } }`) hold the clinic governance switches and marks.
- `settings.applied` is stored per site, as `{ siteId: [fixId, …] }`. An older flat list migrates to the `main` site.

## Development

`npm install` pulls the dev dependencies only; the app itself has no build step and no runtime dependencies.

- `npm test` runs the whole suite in Node with jsdom. Pass a seed: `npm test -- 123`.
- `npm run test:browser` runs `tests.html` in a real headless Chromium for one or more seeds (`npm run test:browser -- 123,7`), then checks that fonts load, nothing leaves the app, the route animation keeps running across a repaint and the slider keeps focus.
- `npm run regression` drives the real app in Chromium: dragging and keyboard-moving the patient, selecting a site on the map, the pipeline buttons, and that theme, weights and the ledger survive a reload.
- `npm run a11y` runs axe-core in Chromium over every view in light and dark, plus Formula mode, Batch and the Data grid, and fails on any serious or critical finding.
- `npm run perf` drags sliders in Chromium and reports frame times and long tasks for Routing and Clinic.
- `npm run profile -- route 0` CPU-profiles a slider drag in Chromium and lists the functions with the most self time (view name, then the index of the slider).
- `npm run screenshots` captures every view at desktop and phone width in light and dark into `screenshots/` and fails on sideways scrolling or console errors.
- `npm run serve` serves the folder on port 8080.
- `.github/workflows/ci.yml` runs all of the above on every push.

## Decisions and assumptions

Choices made where the port plan left a question open. Each is easy to change:

- **Override reserve.** A request may not take the last `max(1, ceil(slots × override reserve))` slots of a site. Parameter `overrideReserve`, default 0.1.
- **Override reach and tolerance.** Requests may reach `overrideReachMult` times the normal reach (1.5) and are approved without sign-off up to `overrideTolerance` below the best score (0.15).
- **Override token.** One use per quarter is tracked by a switch in Single only. Batch never spends it.
- **Requests and placement.** A request never changes where Batch places a patient. It is judged afterwards against the final loads.
- **Ledger privacy.** Patient names are not stored in the ledger unless the switch in the Audit card is on.
- **Public-first.** It is a separate switch, not part of the Public-first weight preset, so presets only ever change weights.
- **Waitlist.** With a blank referral rate the booked share is `(waitlist + 1) / (slots × horizon)` and the estimated inflow only drives the queue wait.
- **Fonts.** Self-hosted variable fonts, Latin plus Latin Extended (and Greek for the mono face).

## Tests

Open `tests.html` (add `?seed=123` to fix the random seed). It runs golden vectors, property tests on 200 random cases each, data-layer and security tests, mounts every view with hostile names, and lints every shipped file for comments, native browser UI and engine purity. The list of linted files is `js/tests/manifest.js`. Add `?big=1` to also run the documented 10 000 patient by 1 000 site regret batch, which takes about 30 seconds.

## Keyboard shortcuts

- `1` to `4`: Routing, Clinic, Data, Equations.
- `t`: cycle the theme (System, Light, Dark).
- Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl+Y: undo and redo, on the Data tab only.

Shortcuts are ignored while typing in a field, a select or a slider, and when Ctrl, Cmd or Alt is held.

## Other Equations and Single additions

- **Try another value:** four sub-score curves (time for three urgencies, cost, load, quality) in the Equations tab, drawn with the same functions the engine uses. Each slider shows the points earned at the current weight.
- **Worked equation:** in Formula mode, Single shows the selected site, the best rival and the nearest excluded site as `S = G × [ŵ·s …]`.
- **Glossary:** key terms in card text carry a hover and focus definition. It is a static list, not a rewrite of rendered text.
- **Map:** labels try eight positions to avoid overlapping nodes and each other, and hover cards show services (needed ones in brackets), load, price, quality, wait and the score or the reasons a site is ruled out.

## Behaviour changes

Engine version 3.1.0.

- **Waitlist counted once.** When `referrals_per_day` is blank, the booking load is now `U = (B + 1) / (c·H)` with `B` the waitlist plus patients placed. Before, the waitlist entered twice and such sites looked about twice as booked. The inflow estimate `waitlist / H` still drives ρ and the queue wait, and the Data tab warns about it. Batch site-load rings use the same rule.
- **Gaps in clinic hours.** Hours missing between the first and last arrivals row are filled with 0 arrivals, so backlog drains through them instead of jumping across. A warning names the gap.
- **Fair nearest baseline.** In Batch, patients the nearest-feasible baseline cannot place with one site now get the same split-plan fallback, using the nearest site that covers the most remaining needs. Baseline numbers (Unplaced, averages) change accordingly, and a Split plans row shows both sides.
- **Single and Batch agree.** Opening a patient from a batch row now counts the other placements of that run and shows an "As placed in batch" chip. The Single decision card has a "Count this week's capacity" switch, off by default.
- **Undo shortcut.** Ctrl/Cmd+Z, Shift+Z and Ctrl+Y act only on the Data tab, outside inputs, and say what they undid.
- **Patients in Single.** The selected patient reloads when its data changes, a "More patients" picker reaches patients beyond the first eight, and the choice is remembered.
- **Ties and order.** Facilities are sorted by id, so equal scores break by facility id. In Batch, equal regret or equal priority breaks by patient id.
- **Regret batch speed and memory.** The regret placement keeps only the sites that cover every need for each patient and picks the next patient with a heap, instead of scanning all patients each time. Results are identical to the earlier linear scan. On a synthetic 10 000 patient by 1 000 site batch it ran in about 27 s against 39 s before, with the process using about 425 MB against 488 MB; the saving in memory depends on how many sites cover each patient's needs.
- **Smoother repaints.** Parameter changes repaint at most once per animation frame, and settings are saved 250 ms after the last change (and when the page is hidden). The map reuses its elements, so the route dashes and the patient pulse keep running, rings animate to new loads and a focused site stays focused. Every view keeps keyboard focus, inner scroll position and page scroll across a repaint, the pipeline strip updates in place, the long batch table redraws only when its visible window moves, and tooltips hide or update when their element changes.
- **Clinic speed.** Clinic simulations are cached per site, set of applied fixes and every parameter except the four fix weights, so moving a fix weight or switching presets no longer re-runs the flow model, and the Does-the-order-hold card reuses the same results. Cached results are identical to cold runs.
- **Measured against the previous version.** In Chromium, with the same fonts and the same 40-keystroke slider drag, steady-state main-thread time is about a third lower than before in Routing and Clinic (for example 142 ms against 212 ms for a Routing weight). The very first drag after a page load costs roughly 10% more than before because there are more cards to lay out the first time.
- **Sentence-case confidence.** Confidence labels are "Only option", "Clear lead", "Moderate lead", "Near tie", "Split plan" and "None" everywhere, including CSV exports.

## Files

- `js/core/*`: the pure engine (queue maths, route, override judge, batch, flow, risk, plan, parameter registry, hashing and the engine version). No DOM and no storage.
- `js/data/*`: CSV, schema, validation, samples, synthetic patients, IndexedDB store, migration, exports, decision records and the ledger.
- `js/ui/*`: components, map, grid, explanations, curves, shortcuts and the four views.
- `js/worker/batch-worker.js`: batch placement off the main thread.
- `css/*`: tokens, components, views.

## Fonts

The three families are served from `fonts/` as variable `woff2` files (Latin, plus Latin Extended for Instrument Sans and JetBrains Mono and Greek for JetBrains Mono), declared in `css/fonts.css`, so the app makes no font requests to other hosts and works offline. They are Instrument Sans, Fraunces (with its optical size axis) and JetBrains Mono, taken from the `@fontsource-variable` packages, and each is under the SIL Open Font License 1.1; the licence texts are `fonts/OFL-*.txt`. Characters outside those subsets fall back to the system stacks in `css/tokens.css`.

## Parameters

Every number the engine uses is one entry in `js/core/params.js`. Weights and a few basics are on the main panels; the rest are under Advanced.

| Key | Symbol | Meaning | Default | Range |
| --- | --- | --- | --- | --- |
| `wT` | wT | Time to care weight | 35 | 0 to 100 |
| `wC` | wC | Cost weight | 15 | 0 to 100 |
| `wP` | wP | Public first weight | 10 | 0 to 100 |
| `wL` | wL | Load balance weight | 10 | 0 to 100 |
| `wQ` | wQ | Quality weight | 20 | 0 to 100 |
| `wK` | wK | Continuity weight | 10 | 0 to 100 |
| `tauRoutine` | τ_routine | Time half-life, routine | 7 d | 0.05 to 90 |
| `tauSoon` | τ_soon | Time half-life, soon | 2 d | 0.05 to 90 |
| `tauUrgent` | τ_urgent | Time half-life, urgent | 0.25 d | 0.05 to 90 |
| `deadlineRoutine` | D_routine | Deadline, routine | 42 d | 0.1 to 365 |
| `deadlineSoon` | D_soon | Deadline, soon | 7 d | 0.1 to 365 |
| `deadlineUrgent` | D_urgent | Deadline, urgent | 1 d | 0.1 to 365 |
| `reachRoutine` | R_routine | Reach, routine | 120 km | 1 to 1000 |
| `reachSoon` | R_soon | Reach, soon | 90 km | 1 to 1000 |
| `reachUrgent` | R_urgent | Reach, urgent | 60 km | 1 to 1000 |
| `shareRoutine` | share_routine | Class share, routine | 0.65 | 0 to 1 |
| `shareSoon` | share_soon | Class share, soon | 0.25 | 0 to 1 |
| `shareUrgent` | share_urgent | Class share, urgent | 0.1 | 0 to 1 |
| `betaRoutine` | β_routine | Backlog ahead, routine | 1 | 0 to 1 |
| `betaSoon` | β_soon | Backlog ahead, soon | 0.5 | 0 to 1 |
| `betaUrgent` | β_urgent | Backlog ahead, urgent | 0.1 | 0 to 1 |
| `eta` | η | Detour index | 1.3 | 1 to 3 |
| `speed` | v | Travel speed | 45 km/h | 5 to 130 |
| `rhoMax` | ρ_max | Load limit | 0.98 | 0.5 to 0.999 |
| `horizon` | H | Booking horizon | 7 d | 1 to 30 |
| `shrinkK` | k | Quality prior weight | 50 reviews | 0 to 1000 |
| `caSq` | c_a² | Arrival variability | 1 | 0 to 4 |
| `csSq` | c_s² | Service variability | 0.5 | 0 to 4 |
| `tierPublic` | tier_public | Public tier value | 1 | 0 to 1 |
| `tierContracted` | tier_contracted | Contracted tier value | 0.6 | 0 to 1 |
| `tierPrivate` | tier_private | Private tier value | 0.25 | 0 to 1 |
| `costLow` | P_low | Cost low percentile | 10 % | 0 to 49 |
| `costHigh` | P_high | Cost high percentile | 90 % | 51 to 100 |
| `marginClear` | m_clear | Clear lead margin | 0.08 | 0 to 1 |
| `marginModerate` | m_mod | Moderate lead margin | 0.03 | 0 to 1 |
| `robustStep` | Δw | Robustness step | 10 | 1 to 50 |
| `nearFull` | U_near | Near-full threshold | 0.9 | 0.5 to 1 |
| `maxStops` | S_max | Split plan stops | 3 | 1 to 6 |
| `waitCap` | W_cap | Referral wait ceiling | 365 d | 1 to 3650 |
| `qualityFallback` | q_0 | Fallback quality prior | 0.75 | 0 to 1 |
| `defaultComplexity` | κ_default | Default complexity | 1 | 0.1 to 5 |
| `publicLock` | L_pub | Strict public-first | 0 | Off / On |
| `overrideReserve` | r_res | Override slot reserve | 0.1 | 0 to 0.5 |
| `overrideReachMult` | m_R | Override reach multiplier | 1.5 × | 1 to 3 |
| `overrideTolerance` | Δ_tol | Override score tolerance | 0.15 | 0 to 1 |
| `batchOrder` | order | Batch order | 0 | Regret / As listed |
| `fwR` | vR | Risk removed weight | 40 | 0 to 100 |
| `fwO` | vO | Overload relief weight | 30 | 0 to 100 |
| `fwP` | vP | Patient reach weight | 20 | 0 to 100 |
| `fwB` | vB | Breadth weight | 10 | 0 to 100 |
| `season` | season | Demand multiplier | 1 × | 0.5 to 2 |
| `budget` | B | Fix budget | no limit | 0 to 10000 |
| `bucketMin` | Δ | Time bucket | 60 min | 30 min / 60 min |
| `cRhoMax` | ρ_max,clinic | Clinic load limit | 0.98 | 0.5 to 0.999 |
| `waitMax` | W_max | Clinic wait ceiling | 240 min | 10 to 1440 |
| `kappa` | ω | Overload risk factor | 2 | 0 to 10 |
| `rhoStar` | ρ* | Load knee | 0.85 | 0.3 to 1 |
| `deltaShare` | δ | Exposure factor | 0.5 | 0 to 5 |
| `rhoClip` | ρ_clip | Load ceiling for risk | 2 | 1 to 5 |
| `alpha` | α | Effort exponent | 0.5 | 0 to 2 |
| `gamma` | γ | Cost exponent | 0 | 0 to 2 |
| `costRef` | C_ref | Reference cost | 10 k | 0.1 to 1000 |
| `riskHigh` | band_high | High risk from | 60 | 1 to 1000 |
| `riskMedium` | band_medium | Medium risk from | 25 | 1 to 1000 |
| `defaultServiceCv2` | c_s²_default | Default service variability | 0.5 | 0 to 4 |
| `defaultArrivalCv2` | c_a²_default | Default arrival variability | 1 | 0 to 4 |
