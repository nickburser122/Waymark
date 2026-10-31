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
- **Data.** Eleven tables, each with a template, CSV/TSV/JSON upload, paste from a spreadsheet, a column mapper and a grid editor with per-cell validation. A failed upload leaves the last valid data active. Undo and redo cover 50 steps.
- **Equations.** Plain sentences or live-value formulas, copied as text, LaTeX or Markdown, with every parameter taken from the same registry the engine reads.
- **Plain / Formula** switch in the header changes every explanation in the app.

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

Staffing may also be uploaded wide (`station_id`, then `h08`, `h09`, …). Quality must run from 0 to 1; a 1–5 or percent scale is offered for conversion. Limits: 5 MB per file, 10 000 patients, 1 000 facilities, 200 stations.

## Storage

- `localStorage` key `waymark.v3`: view, modes, explanation style, applied fixes and every parameter. A `waymark.v2` key is read once and migrated, and left in place.
- IndexedDB database `waymark`, store `datasets`, key `active`: the eleven tables, where each came from and the uploaded file names. If it is unavailable, work continues in memory and the Data tab says so.

## Tests

Open `tests.html` (add `?seed=123` to fix the random seed). It runs golden vectors, property tests on 200 random cases each, data-layer and security tests, mounts every view with hostile names, and lints every shipped file for comments, native browser UI and engine purity. The list of linted files is `js/tests/manifest.js`.

## Files

- `js/core/*`: the pure engine (queue maths, route, batch, flow, risk, plan, parameter registry). No DOM and no storage.
- `js/data/*`: CSV, schema, validation, samples, IndexedDB store, migration, exports.
- `js/ui/*`: components, map, grid, explanations and the four views.
- `js/worker/batch-worker.js`: batch placement off the main thread.
- `css/*`: tokens, components, views.

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
| `waitCap` | W_cap | Wait ceiling | 365 d | 1 to 3650 |
| `qualityFallback` | q_0 | Fallback quality prior | 0.75 | 0 to 1 |
| `defaultComplexity` | κ_default | Default complexity | 1 | 0.1 to 5 |
| `batchOrder` | order | Batch order | 0 | Regret / As listed |
| `fwR` | vR | Risk removed weight | 40 | 0 to 100 |
| `fwO` | vO | Overload relief weight | 30 | 0 to 100 |
| `fwP` | vP | Patient reach weight | 20 | 0 to 100 |
| `fwB` | vB | Breadth weight | 10 | 0 to 100 |
| `season` | season | Demand multiplier | 1 × | 0.5 to 2 |
| `budget` | B | Fix budget | no limit k | 0 to 10000 |
| `bucketMin` | Δ | Time bucket | 60 min | 30 min / 60 min |
| `cRhoMax` | ρ_max,clinic | Clinic load limit | 0.98 | 0.5 to 0.999 |
| `waitMax` | W_max | Wait ceiling | 240 min | 10 to 1440 |
| `kappa` | κ | Overload risk factor | 2 | 0 to 10 |
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
