#!/usr/bin/env node
// @ts-check
/**
 * create-orbitops — scaffold a self-hosted OrbitOps.
 *
 *   npm create orbitops@latest my-mission-control
 *   npx create-orbitops my-mission-control
 *
 * Clones the public OrbitOps repository into a fresh directory and switches it
 * into operator (app) mode: it boots straight to the dashboard, hides the
 * marketing routes, and never fetches the landing/pricing modules. Then it
 * prints how to run it. Zero npm dependencies — only Node built-ins and `git`.
 *
 * The shared demo OpenRouter key is NEVER part of this — a self-hosted copy runs
 * the deterministic engine with no key, or you bring your own in Settings / the
 * first-run wizard.
 */

'use strict';

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import process from 'node:process';

const DEFAULT_REPO = 'https://github.com/veter391/orbitops.git';
const DEFAULT_DIR = 'orbitops-app';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};
/** @param {string} s @param {keyof typeof c} col */
const paint = (s, col) => `${c[col]}${s}${c.reset}`;
/** @param {string} s */
const info = (s) => console.log(s);
/** @param {string} s */
const die = (s) => {
  console.error(`\n${paint('✗', 'red')} ${s}\n`);
  process.exit(1);
};

function help() {
  info(`
${paint('create-orbitops', 'bold')} — scaffold a self-hosted OrbitOps

${paint('Usage', 'dim')}
  npm create orbitops@latest ${paint('<dir>', 'cyan')}
  npx create-orbitops ${paint('<dir>', 'cyan')}

${paint('Options', 'dim')}
  <dir>            Target directory (default: ${DEFAULT_DIR})
  --repo <url>     Clone source (default: the public OrbitOps repo)
  --site           Keep full site mode (marketing visible); default is app mode
  -h, --help       Show this help

${paint('Env', 'dim')}
  ORBITOPS_REPO    Same as --repo (a fork, or a local path for testing)
`);
}

/** @param {string[]} argv @returns {{dir: string, repo: string, appMode: boolean}} */
function parseArgs(argv) {
  let dir = '';
  let repo = process.env.ORBITOPS_REPO || DEFAULT_REPO;
  let appMode = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      help();
      process.exit(0);
    } else if (a === '--repo') {
      repo = argv[++i] || repo;
    } else if (a === '--site') {
      appMode = false;
    } else if (a.startsWith('-')) {
      die(`Unknown option: ${a}  (try --help)`);
    } else if (!dir) {
      dir = a;
    }
  }
  return { dir: dir || DEFAULT_DIR, repo, appMode };
}

/** @returns {boolean} whether `git` is available. */
function hasGit() {
  const r = spawnSync('git', ['--version'], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

/** Recursively delete a path if it exists. @param {string} p */
function removeIfPresent(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

/**
 * Flip the compile-time APP_MODE default to `true` in the cloned app so it boots
 * into the operator surface. Verifies the substitution actually happened.
 * @param {string} root
 */
function enableAppMode(root) {
  const cfg = join(root, 'src', 'core', 'app-config.js');
  if (!existsSync(cfg)) {
    info(paint('  ! src/core/app-config.js not found — skipping app-mode switch', 'yellow'));
    return;
  }
  const src = readFileSync(cfg, 'utf8');
  const next = src.replace(
    /export const APP_MODE = false;/,
    'export const APP_MODE = true; // set by create-orbitops (self-host build)',
  );
  if (next === src) {
    info(paint('  ! could not switch APP_MODE automatically — set it in src/core/app-config.js', 'yellow'));
    return;
  }
  writeFileSync(cfg, next);
}

function main() {
  const { dir, repo, appMode } = parseArgs(process.argv.slice(2));
  const target = resolve(process.cwd(), dir);
  const name = basename(target);

  info(`\n${paint('◇ create-orbitops', 'bold')} ${paint('· self-hosted mission control', 'dim')}\n`);

  if (existsSync(target) && readdirSync(target).length > 0) {
    die(`Target directory ${paint(dir, 'cyan')} already exists and is not empty.`);
  }
  if (!hasGit()) {
    die(
      `git is required but was not found on PATH.\n` +
        `  Install git, or download the repo manually:\n` +
        `  ${paint(repo.replace(/\.git$/, ''), 'cyan')}`,
    );
  }

  info(`  ${paint('→', 'cyan')} cloning ${paint(repo.replace(/^https:\/\//, ''), 'dim')} …`);
  const clone = spawnSync('git', ['clone', '--depth', '1', '--quiet', repo, target], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
  });
  if (clone.status !== 0) {
    die(`clone failed:\n${(clone.stderr || '').trim() || 'unknown git error'}`);
  }

  // Strip repo/dev-only artifacts and detach from the upstream history.
  removeIfPresent(join(target, '.git'));
  removeIfPresent(join(target, 'internal'));

  if (appMode) {
    enableAppMode(target);
    info(`  ${paint('✓', 'green')} operator (app) mode — boots to the dashboard, marketing hidden`);
  } else {
    info(`  ${paint('✓', 'green')} full site mode (marketing visible)`);
  }

  info(`  ${paint('✓', 'green')} scaffolded into ${paint(name, 'cyan')}\n`);
  info(paint('  Next steps', 'bold'));
  info(`    ${paint('cd', 'dim')} ${dir}`);
  info(`    ${paint('npm run dev', 'cyan')}          ${paint('# static server on http://localhost:8080', 'dim')}`);
  info(`    ${paint('# or:', 'dim')} npx serve .`);
  info('');
  info(`  Optional backend (real API, telemetry, audit chain):`);
  info(`    ${paint('cd', 'dim')} ${dir}/backend`);
  info(`    ${paint('cp .env.example .env && npm install && npm run migrate && npm run dev', 'cyan')}`);
  info('');
  info(
    `  No key needed — the flight-dynamics engine is fully deterministic. Add a\n` +
      `  model (OpenAI, xAI, Groq, OpenRouter, or any OpenAI-compatible endpoint) in\n` +
      `  the first-run wizard or Settings to enable the AI advisory layer.\n`,
  );
}

main();
