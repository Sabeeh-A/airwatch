/**
 * JSON API used by the browser front-end.
 *
 * Every route returns `{ ok: true, ... }` on success and `{ ok: false, error }`
 * on failure, so the client has a single shape to branch on.
 */

const express = require('express');
const { fetchAirQuality, bandFor } = require('../services/airQuality');

// The store and the HTTP client are passed in rather than imported directly,
// which is what lets the test suite run the real routes against a temporary
// file and a stubbed upstream API.
function createApiRouter({ store, fetchImpl }) {
  const router = express.Router();

  // Health probe, used by the README's smoke test.
  router.get('/health', (req, res) => {
    res.json({ ok: true, status: 'up' });
  });

  // Dynamic aspect 1: live air-quality lookup. GET /api/air?q=Berlin
  router.get('/air', async (req, res, next) => {
    try {
      const result = await fetchAirQuality(req.query.q, { fetchImpl });
      res.json({ ok: true, location: result });
    } catch (err) {
      next(err);
    }
  });

  // Dynamic aspect 2: the persisted watchlist, returned with a live reading for
  // each saved location. Readings are fetched concurrently; a location whose
  // upstream call fails is still returned, flagged with `reading: null`, so one
  // bad response cannot blank the whole dashboard. GET /api/watchlist
  router.get('/watchlist', async (req, res, next) => {
    try {
      const entries = await store.all();
      const withReadings = await Promise.all(
        entries.map(async (entry) => {
          try {
            const live = await fetchAirQuality(entry.name, { fetchImpl });
            return { ...entry, reading: live.reading, band: live.band };
          } catch {
            return { ...entry, reading: null, band: null };
          }
        })
      );
      res.json({ ok: true, entries: withReadings });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/watchlist — save a location.
  router.post('/watchlist', async (req, res, next) => {
    try {
      const { id, name, country, latitude, longitude } = req.body || {};
      if (!id || !name || typeof latitude !== 'number' || typeof longitude !== 'number') {
        return res.status(400).json({ ok: false, error: 'id, name, latitude and longitude are required' });
      }
      const { created, entries } = await store.add({ id, name, country: country || '', latitude, longitude });
      res.status(created ? 201 : 200).json({ ok: true, created, count: entries.length });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/watchlist/:id — remove a saved location.
  router.delete('/watchlist/:id', async (req, res, next) => {
    try {
      const { removed } = await store.remove(req.params.id);
      if (!removed) return res.status(404).json({ ok: false, error: 'Location not on the watchlist' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/bands — the legend, so the colour scale lives in one place only.
  router.get('/bands', (req, res) => {
    res.json({ ok: true, bands: [10, 30, 50, 70, 90, 110].map((v) => bandFor(v)) });
  });

  return router;
}

module.exports = { createApiRouter };
