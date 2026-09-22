/**
 * Express application factory.
 *
 * The app is created by a function rather than at module load so that the test
 * suite can build an isolated instance per test file, with its own data file and
 * a stubbed upstream client.
 */

const path = require('path');
const express = require('express');
const { createApiRouter } = require('./routes/api');
const { WatchlistStore } = require('./services/watchlistStore');

function createApp({ dataFile, fetchImpl } = {}) {
  const app = express();
  const store = new WatchlistStore(dataFile || path.join(__dirname, '..', 'data', 'watchlist.json'));

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', createApiRouter({ store, fetchImpl }));

  // Unknown API paths return JSON, not the static 404 page.
  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: 'Unknown endpoint' });
  });

  // Central error handler. Errors thrown by the services carry a `.status`;
  // anything else is treated as a server fault and logged rather than leaked.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[airwatch]', err);
    res.status(status).json({ ok: false, error: status >= 500 ? 'Unexpected server error' : err.message });
  });

  return app;
}

module.exports = { createApp };
