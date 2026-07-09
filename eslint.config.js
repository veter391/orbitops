const BROWSER_GLOBALS = {
  AudioContext: 'readonly',
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  getComputedStyle: 'readonly',
  HTMLElement: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  FormData: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  WebSocket: 'readonly',
  MessageChannel: 'readonly',
  broadcastChannel: 'readonly',
  crypto: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  OffscreenCanvas: 'readonly',
  Image: 'readonly',
  DataTransfer: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  MutationObserver: 'readonly',
  Three: 'readonly',
  THREE: 'readonly',
};

// Cloudflare Workers runtime globals (service-worker style + fetch/Web APIs).
const WORKER_GLOBALS = {
  addEventListener: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

const SHARED_RULES = {
  'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-var': 'error',
  'prefer-const': 'warn',
  // Strict equality everywhere, except the idiomatic `x != null` / `x == null`
  // check (matches both null and undefined) — the standard, safe exception.
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
};

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: BROWSER_GLOBALS },
    rules: SHARED_RULES,
  },
  {
    // The one real trust-boundary file (holds the OpenRouter key, rate-limits,
    // validates untrusted request bodies) — it must get the same static checks.
    files: ['worker.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: WORKER_GLOBALS },
    rules: SHARED_RULES,
  },
];
