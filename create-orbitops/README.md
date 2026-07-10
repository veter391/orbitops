# create-orbitops

Scaffold a self-hosted [OrbitOps](https://github.com/veter391/orbitops) — the
open-source, human-in-the-loop mission-control cockpit for satellite
constellations. Real orbital mechanics in the browser, an AI that proposes and a
human who approves, a tamper-evident audit log.

## Usage

```bash
npm create orbitops@latest my-mission-control
# or
npx create-orbitops my-mission-control
```

Then:

```bash
cd my-mission-control
npm run dev            # static server on http://localhost:8080
```

That's it — no build, no signup, no keys. The flight-dynamics engine is fully
deterministic and runs offline. Add a model (OpenAI, xAI/Grok, Groq, OpenRouter,
or any OpenAI-compatible endpoint) in the first-run wizard or Settings to enable
the AI advisory layer.

### Optional backend

A Node + TypeScript API (real telemetry ingest, HMAC audit chain, the LangGraph
multi-agent copilot). Boots on local pglite with no keys:

```bash
cd my-mission-control/backend
cp .env.example .env && npm install && npm run migrate && npm run dev
```

## What it does

- Clones the public OrbitOps repository into a fresh directory.
- Switches it into **operator (app) mode**: boots straight to the dashboard,
  hides the marketing routes, and never fetches the landing/pricing modules.
- Detaches from the upstream git history and removes internal working files.

The shared demo OpenRouter key is never part of a self-hosted copy — you run the
deterministic engine with no key, or bring your own.

## Options

| Flag | Description |
|---|---|
| `<dir>` | Target directory (default: `orbitops-app`) |
| `--repo <url>` | Clone source (default: the public OrbitOps repo; accepts a fork or a local path) |
| `--site` | Keep full site mode (marketing visible) instead of app mode |
| `-h`, `--help` | Show help |

`ORBITOPS_REPO` works the same as `--repo`.

## Requirements

- **Node.js ≥ 18**
- **git** on your PATH (used to fetch the repo; zero npm dependencies otherwise)

## License

MIT — see [LICENSE](LICENSE).
