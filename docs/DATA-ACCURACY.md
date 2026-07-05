# Data sources & accuracy

OrbitOps shows real orbital data wherever a public source exists, and labels
everything else. This page states exactly where each number comes from and how
far to trust it.

## Orbital elements — CelesTrak
TLEs come from CelesTrak GP groups (starlink, oneweb, stations), fetched from
your browser. CelesTrak refreshes on a ~2-hour cycle; OrbitOps caches each
group in localStorage for 2h. The UI shows which layer served the data:
LIVE (just fetched) · CACHED (<2h local copy) · SNAPSHOT (bundled fallback).
SNAPSHOT may be days old — positions stay mathematically real but stale.

## Propagation — SGP4, honestly bounded
All catalog positions use SGP4 (vendored satellite.js). What SGP4 does NOT give:
- Element-set age is the dominant error: km-level fresh, growing km/day; pass
  timings drift by minutes within days (the pass predictor prints TLE age).
- No manoeuvre knowledge: a sat that burned after epoch is somewhere else.
- Screening, not operations: nothing here replaces CDMs/covariance/Pc. Demo
  mini-tools on the simplified Kepler engine are labelled on-page.
Rule of thumb: good enough to point a camera or antenna; verify with a fresh
element set before pointing anything expensive.

## What is simulated (and says so)
Per-satellite health telemetry and fuel have no public feed. Where shown they
are modelled values with a SIMULATED label. They never mix into real readouts.

## Imagery credits
- Earth landmass raster (particle continents): NASA Blue Marble / Visible
  Earth — used for geography sampling only; the photo itself is not displayed.
- Country borders: public-domain world boundaries GeoJSON, hairline vectors.
- Everything else is drawn procedurally — no stock imagery.

## Offline behaviour
With no network, OrbitOps falls back to the bundled TLE snapshot and marks
every affected view SNAPSHOT. It never fabricates fresher data than it has.
