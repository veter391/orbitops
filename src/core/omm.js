// @ts-check
/**
 * CCSDS OMM (Orbit Mean-elements Message) ingest — the modern standard that
 * replaces the raw TLE, per CCSDS 502.0-B-2. CelesTrak and Space-Track both
 * serve OMM (JSON and KVN); an operator's feed may be OMM rather than TLE.
 *
 * No permissive browser SGP4 lib reads OMM directly (the vendored satellite.js
 * only exposes `twoline2satrec`), so we bridge OMM → the two TLE lines it does
 * read: OMM carries exactly the mean elements a TLE encodes (NORAD id, epoch,
 * inclination, RAAN, eccentricity, arg-of-perigee, mean anomaly, mean motion,
 * B*), so the conversion is lossless within TLE's fixed precision. Deterministic,
 * dependency-free.
 *
 * @module core/omm
 */

'use strict';

/**
 * @typedef {Object} OmmRecord
 * @property {string} OBJECT_NAME
 * @property {string} [OBJECT_ID]
 * @property {string} EPOCH             ISO-8601 UTC epoch
 * @property {number} MEAN_MOTION       revolutions / day
 * @property {number} ECCENTRICITY
 * @property {number} INCLINATION       degrees
 * @property {number} RA_OF_ASC_NODE    degrees
 * @property {number} ARG_OF_PERICENTER degrees
 * @property {number} MEAN_ANOMALY      degrees
 * @property {number} NORAD_CAT_ID
 * @property {number} [BSTAR]
 * @property {number} [MEAN_MOTION_DOT]
 * @property {number} [MEAN_MOTION_DDOT]
 * @property {number} [ELEMENT_SET_NO]
 * @property {number} [REV_AT_EPOCH]
 * @property {string} [CLASSIFICATION_TYPE]
 * @property {number} [EPHEMERIS_TYPE]
 */

/** TLE checksum: sum of digits (a minus sign counts as 1), mod 10. @param {string} line */
export function tleChecksum(line) {
  let s = 0;
  for (const c of line.slice(0, 68)) {
    if (c >= '0' && c <= '9') s += Number(c);
    else if (c === '-') s += 1;
  }
  return s % 10;
}

/** Right-justify an integer in `w` columns (space-padded). @param {number} n @param {number} w */
function ri(n, w) {
  return String(Math.trunc(n)).padStart(w, ' ').slice(-w);
}

/**
 * TLE "assumed-decimal exponential" field, e.g. 2.5302e-5 → " 25302-4", 0 → " 00000-0".
 * @param {number} v @returns {string} 8 chars: sign, 5-digit mantissa, exp sign, 1-digit exp
 */
function tleExp(v) {
  if (!Number.isFinite(v) || v === 0) return ' 00000-0';
  const sign = v < 0 ? '-' : ' ';
  let a = Math.abs(v);
  let exp = 0;
  while (a >= 1) { a /= 10; exp += 1; }
  while (a < 0.1) { a *= 10; exp -= 1; }
  let m = Math.round(a * 1e5);
  if (m >= 100000) { m = Math.round(m / 10); exp += 1; } // rounding carried the mantissa to 1.0
  // TLE encodes a single-digit exponent; a value that needs |exp|>9 is either
  // negligibly small or physically absurd for a B*/mean-motion-ddot — degrade to 0
  // rather than emit a mis-aligned field.
  if (exp > 9 || exp < -9) return ' 00000-0';
  const mant = String(m).padStart(5, '0').slice(0, 5);
  const es = exp < 0 ? '-' : '+';
  return `${sign}${mant}${es}${Math.abs(exp)}`;
}

/** TLE first-derivative field " .NNNNNNNN" (leading decimal, 8 digits). @param {number} v */
function tleDec8(v) {
  if (!Number.isFinite(v)) v = 0;
  const sign = v < 0 ? '-' : ' ';
  const d = String(Math.round(Math.abs(v) * 1e8)).padStart(8, '0').slice(0, 8);
  return `${sign}.${d}`;
}

/** ISO epoch → { yy, ddd } TLE epoch parts (YY, DDD.DDDDDDDD). @param {string} iso */
function tleEpoch(iso) {
  // OMM EPOCH is UTC; a bare ISO string (no 'Z'/offset) would be parsed as local
  // time, shifting the epoch — force UTC.
  const s = String(iso);
  const utc = s.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const d = new Date(utc);
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = (d.getTime() - startOfYear) / 86400000 + 1;
  const ddd = dayOfYear.toFixed(8).padStart(12, '0'); // "045.18587073"
  return { yy, ddd };
}

/** International designator "1998-067A" → "98067A  " (8 cols). @param {string} [objId] */
function intlDesignator(objId) {
  const m = /^(\d{4})-(\d{1,3})([A-Z]{0,3})$/.exec(objId || '');
  if (!m) return '        ';
  return (m[1].slice(2) + m[2].padStart(3, '0') + m[3].padEnd(3, ' ')).slice(0, 8);
}

/** Fixed-width angle field NNN.NNNN (8 cols, right-justified). @param {number} deg */
function angle(deg) {
  const v = ((Number(deg) % 360) + 360) % 360;
  return v.toFixed(4).padStart(8, ' ').slice(-8);
}

/**
 * Convert one OMM record to a TLE record (name + two lines + NORAD id), ready for
 * `makeSat` / `twoline2satrec`. The two lines carry correct CCSDS/NORAD checksums.
 * @param {OmmRecord} o
 * @returns {{name: string, line1: string, line2: string, noradId: number}}
 */
export function ommToTle(o) {
  // Every orbital element must be finite and the epoch a valid date — otherwise
  // we would emit a fabricated NaN TLE. Throw so the caller skips the record
  // (never fabricate; drop instead).
  const orbital = [
    o.NORAD_CAT_ID,
    o.MEAN_MOTION,
    o.ECCENTRICITY,
    o.INCLINATION,
    o.RA_OF_ASC_NODE,
    o.ARG_OF_PERICENTER,
    o.MEAN_ANOMALY,
  ];
  if (orbital.some((x) => !Number.isFinite(Number(x)))) {
    throw new Error('OMM record has non-finite orbital elements');
  }
  if (!Number.isFinite(new Date(String(o.EPOCH).endsWith('Z') ? String(o.EPOCH) : `${o.EPOCH}Z`).getTime())) {
    throw new Error('OMM record has an unparseable EPOCH');
  }

  const satnum = ri(o.NORAD_CAT_ID, 5);
  const cls = (o.CLASSIFICATION_TYPE || 'U').slice(0, 1);
  const intl = intlDesignator(o.OBJECT_ID);
  const { yy, ddd } = tleEpoch(o.EPOCH);
  const ndot = tleDec8(o.MEAN_MOTION_DOT ?? 0);
  const nddot = tleExp(o.MEAN_MOTION_DDOT ?? 0);
  const bstar = tleExp(o.BSTAR ?? 0);
  const ephem = String(o.EPHEMERIS_TYPE ?? 0).slice(0, 1);
  const elset = ri(o.ELEMENT_SET_NO ?? 999, 4);

  // Eccentricity: 7 digits, leading decimal assumed (0.0004885 → "0004885").
  const ecc = String(Math.round(Math.abs(Number(o.ECCENTRICITY)) * 1e7)).padStart(7, '0').slice(0, 7);
  const incl = angle(o.INCLINATION);
  const raan = angle(o.RA_OF_ASC_NODE);
  const argp = angle(o.ARG_OF_PERICENTER);
  const manom = angle(o.MEAN_ANOMALY);
  const mm = Number(o.MEAN_MOTION).toFixed(8).padStart(11, ' ').slice(-11); // NN.NNNNNNNN
  const rev = ri(o.REV_AT_EPOCH ?? 0, 5);

  let l1 = `1 ${satnum}${cls} ${intl} ${yy}${ddd} ${ndot} ${nddot} ${bstar} ${ephem} ${elset}`;
  let l2 = `2 ${satnum} ${incl} ${raan} ${ecc} ${argp} ${manom} ${mm}${rev}`;
  l1 = l1.slice(0, 68) + tleChecksum(l1);
  l2 = l2.slice(0, 68) + tleChecksum(l2);

  return { name: String(o.OBJECT_NAME || `NORAD ${o.NORAD_CAT_ID}`), line1: l1, line2: l2, noradId: Number(o.NORAD_CAT_ID) };
}

/**
 * Parse OMM-JSON (CelesTrak / Space-Track `FORMAT=json`): an array of OMM
 * objects, or a single object. Returns TLE records. Malformed entries are skipped.
 * @param {string} text
 * @returns {Array<{name: string, line1: string, line2: string, noradId: number}>}
 */
export function parseOmmJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(data) ? data : [data];
  /** @type {Array<{name: string, line1: string, line2: string, noradId: number}>} */
  const out = [];
  for (const o of arr) {
    if (!o || typeof o !== 'object') continue;
    if (o.NORAD_CAT_ID == null || o.MEAN_MOTION == null || o.INCLINATION == null || !o.EPOCH) continue;
    try {
      const rec = ommToTle(/** @type {OmmRecord} */ (o));
      if (Number.isFinite(rec.noradId)) out.push(rec);
    } catch {
      /* skip a malformed record — never fabricate */
    }
  }
  return out;
}

/**
 * Parse OMM-KVN (`CCSDS_OMM_VERS = 1.0` … Keyword=Value blocks, one per object).
 * A blank line or a new `CCSDS_OMM_VERS` starts a new object. Returns TLE records.
 * @param {string} text
 * @returns {Array<{name: string, line1: string, line2: string, noradId: number}>}
 */
export function parseOmmKvn(text) {
  /** @type {Array<Record<string, string>>} */
  const blocks = [];
  /** @type {Record<string, string>} */
  let cur = {};
  const flush = () => {
    if (Object.keys(cur).length) blocks.push(cur);
    cur = {};
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; } // a blank line also delimits objects
    if (line.startsWith('COMMENT')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    const value = line.slice(eq + 1).replace(/\[[^\]]*\]\s*$/, '').trim();
    if (key === 'CCSDS_OMM_VERS' && Object.keys(cur).length) flush();
    cur[key] = value;
  }
  flush();

  /** @type {Array<{name: string, line1: string, line2: string, noradId: number}>} */
  const out = [];
  for (const b of blocks) {
    if (!b.NORAD_CAT_ID || !b.MEAN_MOTION || !b.INCLINATION || !b.EPOCH) continue;
    /** @type {any} */
    const o = {
      OBJECT_NAME: b.OBJECT_NAME,
      OBJECT_ID: b.OBJECT_ID,
      EPOCH: b.EPOCH,
      MEAN_MOTION: Number(b.MEAN_MOTION),
      ECCENTRICITY: Number(b.ECCENTRICITY),
      INCLINATION: Number(b.INCLINATION),
      RA_OF_ASC_NODE: Number(b.RA_OF_ASC_NODE),
      ARG_OF_PERICENTER: Number(b.ARG_OF_PERICENTER),
      MEAN_ANOMALY: Number(b.MEAN_ANOMALY),
      NORAD_CAT_ID: Number(b.NORAD_CAT_ID),
      BSTAR: b.BSTAR !== undefined ? Number(b.BSTAR) : 0,
      MEAN_MOTION_DOT: b.MEAN_MOTION_DOT !== undefined ? Number(b.MEAN_MOTION_DOT) : 0,
      MEAN_MOTION_DDOT: b.MEAN_MOTION_DDOT !== undefined ? Number(b.MEAN_MOTION_DDOT) : 0,
      ELEMENT_SET_NO: b.ELEMENT_SET_NO !== undefined ? Number(b.ELEMENT_SET_NO) : 999,
      REV_AT_EPOCH: b.REV_AT_EPOCH !== undefined ? Number(b.REV_AT_EPOCH) : 0,
      CLASSIFICATION_TYPE: b.CLASSIFICATION_TYPE,
      EPHEMERIS_TYPE: b.EPHEMERIS_TYPE !== undefined ? Number(b.EPHEMERIS_TYPE) : 0,
    };
    try {
      out.push(ommToTle(o));
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * Detect whether a feed body is OMM (JSON or KVN) rather than raw TLE.
 * @param {string} text
 */
export function isOmm(text) {
  const t = text.trimStart();
  if (t.startsWith('[') || t.startsWith('{')) return /"NORAD_CAT_ID"|"MEAN_MOTION"/.test(t);
  return /CCSDS_OMM_VERS/i.test(t);
}

/**
 * Parse an OMM feed body (JSON or KVN) into TLE records. Returns [] if it is not
 * recognizable OMM. @param {string} text
 */
export function parseOmm(text) {
  const t = String(text).trimStart();
  return t.startsWith('[') || t.startsWith('{') ? parseOmmJson(text) : parseOmmKvn(text);
}
