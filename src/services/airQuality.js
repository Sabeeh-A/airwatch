/**
 * Air-quality domain logic.
 *
 * This module is deliberately free of HTTP and I/O concerns so that the banding
 * rules can be unit-tested without touching the network. The only exported
 * side-effecting function is `fetchAirQuality`, which is injected with a `fetch`
 * implementation so tests can supply a stub.
 */

/**
 * European Air Quality Index bands, ordered from best to worst.
 * Upper bounds are inclusive. Source of the band boundaries: the European
 * Environment Agency EAQI definition used by the Open-Meteo air-quality API.
 * @type {ReadonlyArray<{max: number, label: string, colour: string, advice: string}>}
 */
const EAQI_BANDS = Object.freeze([
  { max: 20, label: 'Good', colour: '#3f8f5b', advice: 'Air quality is good. Enjoy the outdoors.' },
  { max: 40, label: 'Fair', colour: '#7fa63f', advice: 'Air quality is acceptable for most people.' },
  { max: 60, label: 'Moderate', colour: '#d9a441', advice: 'Sensitive groups should limit long outdoor exertion.' },
  { max: 80, label: 'Poor', colour: '#d1673f', advice: 'Reduce prolonged outdoor exertion.' },
  { max: 100, label: 'Very poor', colour: '#b5453f', advice: 'Avoid prolonged outdoor exertion.' },
  { max: Infinity, label: 'Extremely poor', colour: '#7d3a5c', advice: 'Stay indoors where possible.' }
]);

/**
 * Map a numeric European AQI value onto its band.
 *
 * Values are clamped rather than rejected: the upstream API occasionally returns
 * small negative numbers for very clean air, and treating those as an error
 * would hide an otherwise valid reading from the user.
 *
 * @param {number} value European AQI value.
 * @returns {{label: string, colour: string, advice: string}} The matching band.
 * @throws {TypeError} If `value` is not a finite number.
 */
function bandFor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('AQI value must be a finite number');
  }
  const clamped = Math.max(0, value);
  const band = EAQI_BANDS.find((b) => clamped <= b.max);
  return { label: band.label, colour: band.colour, advice: band.advice };
}

/**
 * Reduce the upstream Open-Meteo payload to the shape the front-end needs.
 *
 * The front-end never sees the raw upstream response. Keeping the transformation
 * on the server means the browser contract stays stable even if the upstream
 * field names change, and it satisfies the project constraint that external APIs
 * are consumed by the back-end only.
 *
 * @param {object} payload Raw Open-Meteo air-quality response.
 * @returns {{aqi: number, pm25: (number|null), pm10: (number|null), ozone: (number|null), observedAt: (string|null)}}
 * @throws {Error} If the payload carries no usable current reading.
 */
function normaliseReading(payload) {
  const current = payload && payload.current;
  if (!current || typeof current.european_aqi !== 'number') {
    throw new Error('Upstream response contained no current air-quality reading');
  }
  const orNull = (v) => (typeof v === 'number' ? v : null);
  return {
    aqi: Math.round(current.european_aqi),
    pm25: orNull(current.pm2_5),
    pm10: orNull(current.pm10),
    ozone: orNull(current.ozone),
    observedAt: typeof current.time === 'string' ? current.time : null
  };
}

/** Open-Meteo endpoints. Both are free and require no API key or registration. */
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Resolve a place name to coordinates, then fetch its current air quality.
 *
 * @param {string} query Free-text place name entered by the user.
 * @param {object} [deps] Injected dependencies.
 * @param {typeof globalThis.fetch} [deps.fetchImpl] HTTP client, injectable for tests.
 * @returns {Promise<object>} A location with its current reading and band.
 * @throws {Error} Tagged with `.status` (404 unknown place, 502 upstream failure).
 */
async function fetchAirQuality(query, { fetchImpl = globalThis.fetch } = {}) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) {
    const err = new Error('Please enter at least two characters');
    err.status = 400;
    throw err;
  }

  const geoRes = await fetchImpl(
    `${GEOCODE_URL}?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`
  );
  if (!geoRes.ok) {
    const err = new Error('Location lookup failed upstream');
    err.status = 502;
    throw err;
  }
  const geo = await geoRes.json();
  const place = geo && Array.isArray(geo.results) ? geo.results[0] : null;
  if (!place) {
    const err = new Error(`No place found matching "${trimmed}"`);
    err.status = 404;
    throw err;
  }

  const airRes = await fetchImpl(
    `${AIR_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=european_aqi,pm10,pm2_5,ozone&timezone=auto'
  );
  if (!airRes.ok) {
    const err = new Error('Air-quality lookup failed upstream');
    err.status = 502;
    throw err;
  }

  const reading = normaliseReading(await airRes.json());
  return {
    id: `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`,
    name: place.name,
    country: place.country || '',
    latitude: place.latitude,
    longitude: place.longitude,
    reading,
    band: bandFor(reading.aqi)
  };
}

module.exports = { EAQI_BANDS, bandFor, normaliseReading, fetchAirQuality };
