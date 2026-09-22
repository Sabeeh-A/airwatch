/**
 * Unit tests for the air-quality domain logic.
 * These run without network access: the upstream client is stubbed.
 */

const { bandFor, normaliseReading, fetchAirQuality } = require('../src/services/airQuality');

describe('bandFor', () => {
  test.each([
    [0, 'Good'],
    [20, 'Good'],
    [21, 'Fair'],
    [40, 'Fair'],
    [55, 'Moderate'],
    [80, 'Poor'],
    [95, 'Very poor'],
    [140, 'Extremely poor']
  ])('maps AQI %i to "%s"', (value, expected) => {
    expect(bandFor(value).label).toBe(expected);
  });

  test('clamps small negative readings to the best band instead of failing', () => {
    expect(bandFor(-3).label).toBe('Good');
  });

  test('rejects values that are not finite numbers', () => {
    expect(() => bandFor('12')).toThrow(TypeError);
    expect(() => bandFor(NaN)).toThrow(TypeError);
  });

  test('every band carries a colour and an advice line', () => {
    [10, 30, 50, 70, 90, 130].forEach((v) => {
      const band = bandFor(v);
      expect(band.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(band.advice.length).toBeGreaterThan(10);
    });
  });
});

describe('normaliseReading', () => {
  test('reduces the upstream payload to the front-end contract', () => {
    const out = normaliseReading({
      current: { european_aqi: 27.4, pm2_5: 8.1, pm10: 14, ozone: 61, time: '2026-09-06T10:00' }
    });
    expect(out).toEqual({ aqi: 27, pm25: 8.1, pm10: 14, ozone: 61, observedAt: '2026-09-06T10:00' });
  });

  test('returns null for pollutants the upstream omitted', () => {
    const out = normaliseReading({ current: { european_aqi: 30 } });
    expect(out.pm25).toBeNull();
    expect(out.observedAt).toBeNull();
  });

  test('throws when there is no usable reading', () => {
    expect(() => normaliseReading({})).toThrow(/no current air-quality reading/i);
    expect(() => normaliseReading({ current: {} })).toThrow();
  });
});

describe('fetchAirQuality', () => {
  /** Build a stub `fetch` that answers the geocoder then the air-quality API. */
  const stubFetch = (geo, air) =>
    jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => geo })
      .mockResolvedValueOnce({ ok: true, json: async () => air });

  test('resolves a place and returns a banded reading', async () => {
    const fetchImpl = stubFetch(
      { results: [{ name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 }] },
      { current: { european_aqi: 33, pm2_5: 9, pm10: 15, ozone: 55, time: '2026-09-06T10:00' } }
    );
    const out = await fetchAirQuality('Berlin', { fetchImpl });

    expect(out.name).toBe('Berlin');
    expect(out.id).toBe('52.520,13.405');
    expect(out.reading.aqi).toBe(33);
    expect(out.band.label).toBe('Fair');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('rejects a query shorter than two characters before any request', async () => {
    const fetchImpl = jest.fn();
    await expect(fetchAirQuality('B', { fetchImpl })).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('reports 404 when the geocoder finds nothing', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    await expect(fetchAirQuality('Xyzzyville', { fetchImpl })).rejects.toMatchObject({ status: 404 });
  });

  test('reports 502 when the upstream service errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(fetchAirQuality('Berlin', { fetchImpl })).rejects.toMatchObject({ status: 502 });
  });
});
