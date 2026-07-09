// @ts-check
'use strict';

/**
 * A network of REAL, publicly-documented ground stations used by the pass
 * predictor. Coordinates are the published approximate site locations of these
 * well-known stations (KSAT, ESA ESTRACK, NASA NEN, SSC) — real geography, used
 * to compute real pass geometry from live TLEs via SGP4. Not a live antenna
 * booking system; it is the station set an operator picks a contact site from.
 *
 * `minElevationDeg` is a representative horizon mask (real stations use ~5–10°);
 * a pass below the mask is not a usable contact. Heights are site elevations (km).
 *
 * @typedef {Object} GroundStation
 * @property {string} id
 * @property {string} name
 * @property {string} network
 * @property {number} latDeg
 * @property {number} lonDeg
 * @property {number} heightKm
 * @property {number} minElevationDeg
 */

/** @type {GroundStation[]} */
export const GROUND_STATIONS = [
  // High-latitude sites see almost every LEO/SSO pass — the workhorses.
  { id: 'svalsat', name: 'Svalbard (SvalSat)', network: 'KSAT', latDeg: 78.23, lonDeg: 15.39, heightKm: 0.46, minElevationDeg: 5 },
  { id: 'troll', name: 'Troll, Antarctica (TrollSat)', network: 'KSAT', latDeg: -72.01, lonDeg: 2.53, heightKm: 1.27, minElevationDeg: 5 },
  { id: 'kiruna', name: 'Kiruna, Sweden', network: 'ESA ESTRACK', latDeg: 67.86, lonDeg: 20.96, heightKm: 0.39, minElevationDeg: 5 },
  { id: 'esrange', name: 'Esrange, Sweden', network: 'SSC', latDeg: 67.88, lonDeg: 21.07, heightKm: 0.3, minElevationDeg: 5 },
  { id: 'fairbanks', name: 'Fairbanks, Alaska', network: 'NASA NEN', latDeg: 64.97, lonDeg: -147.51, heightKm: 0.28, minElevationDeg: 5 },
  // Equatorial / mid-latitude coverage.
  { id: 'kourou', name: 'Kourou, French Guiana', network: 'ESA ESTRACK', latDeg: 5.25, lonDeg: -52.8, heightKm: 0.01, minElevationDeg: 7 },
  { id: 'wallops', name: 'Wallops Island, USA', network: 'NASA NEN', latDeg: 37.94, lonDeg: -75.46, heightKm: 0.01, minElevationDeg: 5 },
  { id: 'hartebeesthoek', name: 'Hartebeesthoek, South Africa', network: 'SSC', latDeg: -25.89, lonDeg: 27.69, heightKm: 1.55, minElevationDeg: 5 },
  // Southern-hemisphere sites.
  { id: 'newnorcia', name: 'New Norcia, Australia', network: 'ESA ESTRACK', latDeg: -31.05, lonDeg: 116.19, heightKm: 0.25, minElevationDeg: 7 },
  { id: 'dongara', name: 'Dongara, Australia', network: 'SSC', latDeg: -29.05, lonDeg: 115.35, heightKm: 0.25, minElevationDeg: 5 },
  { id: 'awarua', name: 'Awarua, New Zealand', network: 'KSAT', latDeg: -46.53, lonDeg: 168.38, heightKm: 0.01, minElevationDeg: 5 },
  { id: 'puntaarenas', name: 'Punta Arenas, Chile', network: 'KSAT', latDeg: -52.94, lonDeg: -70.85, heightKm: 0.04, minElevationDeg: 5 },
  { id: 'santiago', name: 'Santiago, Chile', network: 'SSC', latDeg: -33.15, lonDeg: -70.67, heightKm: 0.73, minElevationDeg: 5 },
];

/** The default site the pass predictor opens on (broad LEO visibility). */
export const DEFAULT_STATION_ID = 'svalsat';

/** @param {string} id @returns {GroundStation | undefined} */
export function stationById(id) {
  return GROUND_STATIONS.find((s) => s.id === id);
}
