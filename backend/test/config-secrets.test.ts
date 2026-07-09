import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSecretsFromFiles } from '../src/config.js';

// A fake file reader so the test touches no real filesystem.
function reader(files: Record<string, string>) {
  return (path: string): string => {
    if (!(path in files)) throw new Error(`ENOENT: ${path}`);
    return files[path]!;
  };
}

test('<NAME>_FILE resolves the secret from the file, trimmed', () => {
  const out = resolveSecretsFromFiles(
    { AUDIT_HMAC_KEY_FILE: '/run/secrets/hmac' },
    reader({ '/run/secrets/hmac': '  s3cr3t-key-value\n' }),
  );
  assert.equal(out.AUDIT_HMAC_KEY, 's3cr3t-key-value');
});

test('the file wins when both <NAME> and <NAME>_FILE are set', () => {
  const out = resolveSecretsFromFiles(
    { AUDIT_HMAC_KEY: 'inline', AUDIT_HMAC_KEY_FILE: '/run/secrets/hmac' },
    reader({ '/run/secrets/hmac': 'from-file' }),
  );
  assert.equal(out.AUDIT_HMAC_KEY, 'from-file');
});

test('without <NAME>_FILE the inline var is left untouched', () => {
  const out = resolveSecretsFromFiles({ AUDIT_HMAC_KEY: 'inline-only' }, reader({}));
  assert.equal(out.AUDIT_HMAC_KEY, 'inline-only');
});

test('an empty secret file is refused (fail closed, not a blank secret)', () => {
  assert.throws(
    () => resolveSecretsFromFiles({ AUDIT_HMAC_KEY_FILE: '/run/secrets/hmac' }, reader({ '/run/secrets/hmac': '   \n' })),
    /empty — refusing to boot/,
  );
});

test('resolution covers every file-backed secret and mutates nothing else', () => {
  const env = {
    OPENROUTER_API_KEY_FILE: '/s/or',
    DATABASE_URL_FILE: '/s/db',
    UNRELATED: 'keep-me',
  };
  const out = resolveSecretsFromFiles(env, reader({ '/s/or': 'or-key', '/s/db': 'postgres://x' }));
  assert.equal(out.OPENROUTER_API_KEY, 'or-key');
  assert.equal(out.DATABASE_URL, 'postgres://x');
  assert.equal(out.UNRELATED, 'keep-me');
  // input object is not mutated
  assert.equal((env as Record<string, string>).OPENROUTER_API_KEY, undefined);
});
