// Minimal static server for the e2e suite: serves the repo root with correct
// MIME types, an SPA fallback (History-API deep links like /docs/going-live
// must load index.html), and no-store caching so a re-run never sees stale ES
// modules. Zero dependencies — the frontend dev rule (no runtime deps) extends
// to its test tooling.
'use strict';

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.E2E_PORT || 8123);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    // Resolve inside the repo root only (normalize strips any ../ escapes).
    const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let filePath = join(ROOT, safePath);
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      // SPA fallback: any path that isn't a real file serves the app shell,
      // mirroring Cloudflare's `not_found_handling = "single-page-application"`.
      filePath = join(ROOT, 'index.html');
      body = await readFile(filePath);
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`e2e static server on http://127.0.0.1:${PORT} (root: ${ROOT})`);
});
