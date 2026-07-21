// Unit tests for the streaming primitives in core/openrouter-client.js:
// the incremental SSE parser and the partial-JSON string-field extractor that
// powers token-by-token narrative rendering in the agent console.
'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, extractJsonStringField } from '../src/core/openrouter-client.js';

test('SSE parser: complete events in one chunk', () => {
  const p = createSseParser();
  const events = p.push('data: {"a":1}\n\ndata: {"b":2}\n\n');
  assert.deepEqual(events, ['{"a":1}', '{"b":2}']);
});

test('SSE parser: an event split across chunk boundaries is held until complete', () => {
  const p = createSseParser();
  assert.deepEqual(p.push('data: {"choices":[{"del'), []);
  assert.deepEqual(p.push('ta":{"content":"hi"}}]}\n'), []);
  assert.deepEqual(p.push('\n'), ['{"choices":[{"delta":{"content":"hi"}}]}']);
});

test('SSE parser: CRLF separators and [DONE] sentinel', () => {
  const p = createSseParser();
  const events = p.push('data: {"x":1}\r\n\r\ndata: [DONE]\r\n\r\n');
  assert.deepEqual(events, ['{"x":1}', '[DONE]']);
});

test('SSE parser: non-data lines (comments, event names) are ignored', () => {
  const p = createSseParser();
  const events = p.push(': keep-alive\nevent: message\ndata: {"y":2}\n\n');
  assert.deepEqual(events, ['{"y":2}']);
});

test('extractor: grows as the field streams in and stops at the closing quote', () => {
  const field = 'thinkNarrative';
  assert.equal(extractJsonStringField('{"thinkNar', field), '');
  assert.equal(extractJsonStringField('{"thinkNarrative": "', field), '');
  assert.equal(extractJsonStringField('{"thinkNarrative": "The conj', field), 'The conj');
  assert.equal(
    extractJsonStringField('{"thinkNarrative": "The conjunction is real.", "riskLevel": "high"}', field),
    'The conjunction is real.',
  );
});

test('extractor: handles escaped quotes, backslashes and newlines', () => {
  const s = '{"notes": "He said \\"go\\" — path C:\\\\ops\\nline two"}';
  assert.equal(extractJsonStringField(s, 'notes'), 'He said "go" — path C:\\ops\nline two');
});

test('extractor: an escape split across the chunk boundary waits instead of corrupting', () => {
  // The buffer ends mid-escape ("\") — the extractor must not emit a lone backslash.
  assert.equal(extractJsonStringField('{"notes": "before \\', 'notes'), 'before ');
});

test('extractor: missing field returns empty string', () => {
  assert.equal(extractJsonStringField('{"other": "x"}', 'notes'), '');
});
