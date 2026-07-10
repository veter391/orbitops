# Contributing to OrbitOps

Thanks for your interest in making OrbitOps better. 🛰️

1. **No fake numbers.** The project's credibility is its honesty: no invented
   metrics, everything unshipped is labelled `PLANNED`, real math or a clearly
   marked demo, humans always approve. See [docs/PHILOSOPHY.md](../docs/PHILOSOPHY.md)
   — it is binding.
2. **No build step (frontend)** — `index.html` + `src/` is hand-written JS / CSS.
   Don't introduce a bundler, framework, or package that requires building. PRs
   that add `webpack`, `vite`, `react`, `next`, `vue`, etc. will be closed. The
   frontend also carries **no runtime dependencies** (its `package.json` is dev
   tooling only; Three.js is vendored).
3. **Backend (`backend/`)** — Node 22 + TypeScript (Fastify). It *does* have real
   runtime deps and its own scripts. Boots on local pglite with no keys:
   `cd backend && cp .env.example .env && npm install && npm run migrate && npm run dev`.
4. **Match the style** — `npm run lint` (ESLint) and `npm run format` (Prettier)
   must pass, and `npm test` (node:test) must stay green, for whatever you touch.

## How to contribute code

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run `npm run lint` and `npm run format`
5. Open a PR with a clear description
6. Reference any related issue

## How to contribute non-code

- **Bug reports** — open a GitHub issue with reproduction steps
- **Feature requests** — open a GitHub issue with the user story (not the spec)
- **Documentation** — small fixes via PR, larger rewrites please discuss first
- **Translations** — we accept translations of the docs into other languages
- **Security issues** — see [SECURITY.md](SECURITY.md), do not open a public issue

## Commit messages

We follow conventional commits:

```
feat: add conjunction screening integration with LeoLabs
fix: thermal anomaly detector was firing on eclipse transitions
docs: clarify HITL approval flow in ARCHITECTURE.md
style: format with prettier
refactor: extract telemetry normalisation into separate module
test: add unit tests for manoeuvre planner
chore: bump dependency versions
```

## Code style

- `'use strict';` at the top of every module
- `const` over `let`; never `var`
- Two-space indent, single quotes, semicolons required
- Public APIs get JSDoc comments
- ES modules (`import` / `export`)
- No magic numbers — name them
- One responsibility per file
- Tests for any logic with branches

## What we are currently working on

Check the open issues and milestones for current priorities, and mention what
you're picking up in your PR description.

## Domain expertise

We especially welcome contributions from:
- Flight dynamics engineers
- Satellite operators
- Regulatory experts (FCC, FAA, ITU)
- Cybersecurity professionals
- ML / AI researchers focused on time-series anomaly detection

If you have domain expertise but no time to code, open an issue. We will buy
you coffee.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be excellent to each other.
Space is hard enough without people being jerks.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License, same as the project.