# Deploying OrbitOps

OrbitOps is a **zero-build static SPA** with one small dynamic edge function. It
deploys to **Cloudflare Workers** (Static Assets + a `/api/ai` proxy). No build
step, no bundler — the source is what ships.

## What deploys

| Part | How it's served |
|------|------------------|
| The SPA (`index.html`, `src/`, `public/`, `robots.txt`, `sitemap.xml`, `llms.txt`, `.well-known/`) | Cloudflare **Static Assets** (`[assets]` in `wrangler.toml`) |
| `POST /api/ai` | `worker.js` — proxies to OpenRouter with a server-only key (shared, no-BYOK live-AI mode) |
| Everything else | falls through to Static Assets (`env.ASSETS.fetch`) |

`.assetsignore` keeps the backend, docs, and tooling out of the public upload.
The app also runs fully **without** the Worker — in demo mode and BYOK mode the
browser talks to the model (or the deterministic fallback) directly, so a plain
static host works too; the Worker only adds the optional shared live-AI key.

> **Deploy from a clean checkout.** Cloudflare Static Assets caps a project at
> 20,000 files. A clean `git` checkout of this repo is **189 files** (well under
> the cap); a *dirty* working tree that still has `node_modules/` and backend
> `.data/` installed is ~50k files and would be rejected. The Git-integration
> build (below) always builds from a clean checkout, so it's the safe default.
> (Note: current `wrangler` does not apply `.assetsignore` when the assets
> directory is the repo root, so don't rely on it to trim a dirty local tree —
> deploy from clean, or `git clone` to a fresh dir and deploy there.)

## One-time setup

```bash
npm i -g wrangler          # or use npx wrangler …
wrangler login             # authorize your Cloudflare account
```

## Deploy

```bash
wrangler deploy            # or: npm run deploy
```

That uploads `worker.js` + the static assets and prints the `*.workers.dev` URL
(bind a custom domain in the Cloudflare dashboard). Validate the config without
deploying first with:

```bash
wrangler deploy --dry-run
```

## Shared live-AI key (optional)

For the shared, no-BYOK "AI: LIVE" mode, store an OpenRouter key as a secret —
it lives ONLY as a Cloudflare secret, never in source or the bundle:

```bash
wrangler secret put OPENROUTER_KEY
```

Without it, `/api/ai` returns a clean error and the app falls back to the
operator's own key (BYOK, set in Settings) or the deterministic demo output.
The optional per-IP rate limit (`AI_RATE_LIMITER` in `wrangler.toml`) protects
the shared key; remove that block if your account lacks the rate-limiting binding.

## Continuous deploys

Connect the GitHub repo to the Cloudflare **Workers & Pages** dashboard (Git
integration) for a deploy on every push to the default branch — build command:
none, output: the repo root. `.github/workflows/backend-ci.yml` already gates the
backend on every PR; a matching `wrangler deploy` step (with a `CLOUDFLARE_API_TOKEN`
repo secret) can automate the frontend deploy if you prefer Actions over the
dashboard integration.

## GitHub

The repo is the source of truth (`github.com/veter391/orbitops`). Push commits,
then deploy from a clean checkout so what ships is exactly what's in git.
