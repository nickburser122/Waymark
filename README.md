# Waymark

A care-routing demo where every feature runs through one shared six-stage pipeline: demand → capacity → queue → gate/risk → score → decision.

## Entry points
- `index.html#route`: referral routing on a map of the region
- `index.html#clinic`: clinic flow, with a queue heatmap, weak points and a fix plan
- `index.html#eq`: the equations, with buttons to copy each one as plain text or LaTeX
- `legacy/v1.html`: the previous single-file version, kept for reference

## Files
- `js/engine.js`: the pipeline maths and the sample data
- `js/app.js`: draws the screens and the map
- `css/style.css`: styles, using calm low-saturation persimmon, teal, saffron and iris colours

## Map (brought over from v1)
Dotted curved roads, a river, soft colour washes, large italic labels for the main towns and small labels for villages. Each facility has a ring showing how full its bookings are. The best route is drawn as an animated path, and the recommended site gets a name tag. The patient marker pulses and can be dragged. Clicking a facility sets it as the place the patient was treated before.

## Storage
Settings are saved in the browser (`localStorage` key `waymark.v2`).
