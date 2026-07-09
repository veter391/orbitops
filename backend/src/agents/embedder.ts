// Pluggable embeddings for similarity recall (the semantic-memory layer).
//
// The vector store + cosine retrieval (see memory.ts, migration 009) are
// backend-agnostic and work on pglite and Postgres alike — pgvector is only a
// prod-side ACCELERATION of the same math, never a correctness requirement, so
// the feature is not blocked on it. What plugs in here is HOW a situation string
// becomes a vector:
//
//   • LexicalEmbedder (default) — deterministic, offline, no API key, no cost.
//     A hashed token-frequency vector (bag of uni- + bi-grams), L2-normalized.
//     This is LEXICAL similarity (shared vocabulary), not neural semantics; it
//     is honest about that. It is enough to surface "we have seen this kind of
//     situation before" from structured signal strings, and it makes the whole
//     feature testable with zero external dependencies.
//
//   • A model-backed Embedder (optional) — inject any object satisfying the
//     interface (e.g. an OpenAI/Cohere embeddings call) for true semantic recall.
//     The store and retrieval code do not change; only the vectors get better.

export interface Embedder {
  /** Stable identifier (model/algorithm + dim) recorded alongside stored vectors. */
  readonly id: string;
  readonly dim: number;
  /** Map text to a unit-length vector of length `dim`. */
  embed(text: string): Promise<number[]>;
}

/** FNV-1a 32-bit hash — small, fast, deterministic, no dependencies. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // h *= 16777619, kept in 32-bit unsigned range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Deterministic, offline lexical embedder. Hashes unigrams and bigrams into a
 * fixed-width vector by their frequency, then L2-normalizes so cosine similarity
 * is a dot product. Same input → same vector, on every machine, forever.
 */
export class LexicalEmbedder implements Embedder {
  readonly id: string;
  constructor(readonly dim = 256) {
    this.id = `lexical-fnv1a-${dim}`;
  }

  async embed(text: string): Promise<number[]> {
    const vec = new Array<number>(this.dim).fill(0);
    const tokens = tokenize(text);
    const grams: string[] = [...tokens];
    for (let i = 0; i + 1 < tokens.length; i += 1) {
      grams.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
    for (const g of grams) {
      const slot = fnv1a(g) % this.dim;
      vec[slot] = (vec[slot] ?? 0) + 1;
    }
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vec; // empty/whitespace text → zero vector (cosine 0 with everything)
    for (let i = 0; i < this.dim; i += 1) vec[i]! /= norm;
    return vec;
  }
}

/**
 * Cosine similarity of two equal-length vectors. Both are unit-length coming
 * from an {@link Embedder}, so this is a dot product; the explicit form keeps it
 * correct for any (non-normalized) caller and guards mismatched dimensions.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
