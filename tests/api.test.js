/**
 * Integration tests: the real Express routes and the real JSON store, driven
 * over HTTP by supertest. Only the upstream air-quality service is stubbed, so
 * these tests exercise routing, validation, persistence and error handling
 * together without needing network access.
 */

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');

/** Answer any geocode call with Berlin and any air call with a fixed reading. */
function stubUpstream() {
  return jest.fn(async (url) => {
    if (String(url).includes('geocoding-api')) {
      return {
        ok: true,
        json: async () => ({
          results: [{ name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 }]
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        current: { european_aqi: 45, pm2_5: 12, pm10: 20, ozone: 70, time: '2026-09-06T10:00' }
      })
    };
  });
}

describe('AirWatch API', () => {
  let app;
  let dataFile;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'airwatch-'));
    dataFile = path.join(tmpDir, 'watchlist.json');
    app = createApp({ dataFile, fetchImpl: stubUpstream() });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('GET /api/health reports the service is up', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true, status: 'up' });
  });

  test('GET /api/air returns a banded reading for a known place', async () => {
    const res = await request(app).get('/api/air?q=Berlin').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.location.name).toBe('Berlin');
    expect(res.body.location.band.label).toBe('Moderate');
  });

  test('GET /api/air validates the query string', async () => {
    const res = await request(app).get('/api/air?q=B').expect(400);
    expect(res.body.ok).toBe(false);
  });

  test('the watchlist starts empty even though no data file exists yet', async () => {
    const res = await request(app).get('/api/watchlist').expect(200);
    expect(res.body.entries).toEqual([]);
  });

  test('a saved location is persisted and returned with a live reading', async () => {
    await request(app)
      .post('/api/watchlist')
      .send({ id: '52.520,13.405', name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 })
      .expect(201);

    const res = await request(app).get('/api/watchlist').expect(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].name).toBe('Berlin');
    expect(res.body.entries[0].reading.aqi).toBe(45);

    const onDisk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    expect(onDisk[0].id).toBe('52.520,13.405');
    expect(typeof onDisk[0].addedAt).toBe('string');
  });

  test('saving the same location twice does not duplicate it', async () => {
    const body = { id: '52.520,13.405', name: 'Berlin', latitude: 52.52, longitude: 13.405 };
    await request(app).post('/api/watchlist').send(body).expect(201);
    const second = await request(app).post('/api/watchlist').send(body).expect(200);

    expect(second.body.created).toBe(false);
    expect(second.body.count).toBe(1);
  });

  test('POST /api/watchlist rejects an incomplete body', async () => {
    const res = await request(app).post('/api/watchlist').send({ name: 'Berlin' }).expect(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('DELETE removes a saved location and 404s the second time', async () => {
    const body = { id: '52.520,13.405', name: 'Berlin', latitude: 52.52, longitude: 13.405 };
    await request(app).post('/api/watchlist').send(body).expect(201);

    await request(app).delete('/api/watchlist/52.520,13.405').expect(200);
    await request(app).delete('/api/watchlist/52.520,13.405').expect(404);

    const res = await request(app).get('/api/watchlist').expect(200);
    expect(res.body.entries).toEqual([]);
  });

  test('a watchlist entry whose upstream call fails is still returned, flagged', async () => {
    const failing = jest.fn(async (url) => {
      if (String(url).includes('geocoding-api')) return { ok: false, json: async () => ({}) };
      return { ok: false, json: async () => ({}) };
    });
    await request(app)
      .post('/api/watchlist')
      .send({ id: '52.520,13.405', name: 'Berlin', latitude: 52.52, longitude: 13.405 })
      .expect(201);

    const degraded = createApp({ dataFile, fetchImpl: failing });
    const res = await request(degraded).get('/api/watchlist').expect(200);

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].reading).toBeNull();
  });

  test('unknown API paths return JSON rather than the static 404 page', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body).toEqual({ ok: false, error: 'Unknown endpoint' });
  });

  test('the front-end is served as static files', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('AirWatch');
  });
});
