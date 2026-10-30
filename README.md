# Waymark — one pipeline for care routing & clinic flow

This rebuilds https://github.com/nickburser122/Waymark. The original was one 197 KB file with two separate apps inside it. Now both examples run through **one engine** with six shared stages.

`Demand → Capacity → Queue → Gate/Risk → Score → Decision`

## Files
- `index.html`: the page layout. Hash links: `#route`, `#clinic`, `#eq`
- `js/engine.js`: the single pipeline, all data and all equations. No code that draws the page.
- `js/app.js`: the user interface. Both examples call the same engine functions.
- `css/style.css`: light, warm colour palette (cream paper, persimmon, lagoon, saffron, iris, rose)

## Two calculations both examples share
- `W.queueWait`: queue wait time for a service point with several staff or slots. It uses a standard approximation (Allen–Cunneen / Sakasegawa, G/G/c) and carries over backlog when a station is overloaded.
- `W.score`: a score that is zero if any hard rule fails, otherwise a weighted sum of 0–1 sub-scores. The weights are rescaled so they always add up to 1.

## What changed in the algorithms
**① Referral routing**
- Raw distance is replaced by **time to care**: travel time plus the expected queue wait. It is compared against a target time that depends on urgency.
- Quality ratings are pulled toward an average when a facility has few reviews, so a small clinic with a handful of good reviews doesn't outrank a large proven one.
- New **continuity** factor: a bonus for the facility where the patient was treated before.
- The load factor looks at free capacity *after* this patient is added.
- The result shows how far ahead the winner is, as a confidence label: clear winner / moderate lead / near tie.
- The 120-patient cohort test now adds each placement to the facility's load as it goes, compared against "send to the nearest facility".
- If no single facility can cover all needs, the plan splits across several, picking the best-scoring facility for each remaining need.

**② Clinic flow**
- Patient demand flows from station to station by hour, and every station uses the shared queue calculation.
- Risk score: RPN* = I·F·P·√D, multiplied by two factors. One grows when the station is already near full capacity at peak; the other grows with the share of patients who pass through it.
- Fix priority = value ÷ √effort. Each fix's value is measured as the improvement **on top of fixes already applied** (the pipeline is re-run each time), so overlapping fixes aren't counted twice.
- Season slider; hour-by-hour heatmap of how busy each station is; you can tick fixes to apply them.

## Equations
The Equations tab shows every equation with **Copy** (plain text), **LaTeX**, and **Copy all** buttons.

## Storage
Settings are saved in the browser (localStorage key `waymark.v2`). All data is made up for the demo.

## Next steps
- Load real facility and clinic data from a JSON file
- Export the decision log
