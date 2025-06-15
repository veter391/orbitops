# Changelog

All notable changes to OrbitOps are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and we adhere to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- This repository, with marketing site and embedded product demo
- AI agent reasoning engine (in-browser, deterministic)
- Anomaly detector over synthetic telemetry stream
- Maneuver planner with simplified orbital mechanics
- 3D cockpit with 50 simulated satellites
- Audit log with hash-chained entries
- HITL approval flow UI

## [0.1.0] — 2025-06-15 — "First Light"

### Added
- Initial public release
- Mission, philosophy, brand, positioning, roadmap, security documentation
- Landing page with embedded product cockpit
- Browser-based AI agent with 5 pre-built scenarios:
  - Conjunction warning response
  - Battery degradation prediction
  - Thermal anomaly investigation
  - Maneuver planning request
  - Station-keeping adjustment
- Synthetic telemetry generator covering 10 subsystems
- SGP4-lite orbit propagator
- 50-satellite demo constellation with realistic TLEs

### Notes
- This is a **pre-launch** release — the backend is not yet available
- The AI agent runs entirely in the browser with deterministic reasoning
- All telemetry is synthetic; production telemetry ingestion is in development
- See ROADMAP.md for what is coming next