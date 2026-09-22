# AirWatch

A small web application for checking the current air quality of any place in the
world and keeping a personal watchlist of the locations you care about.

Built as the portfolio project for **DLBCSPJWD01 – Project Java and Web
Development** at IU International University of Applied Sciences.

---

## What it does

- **Search any place.** Type a city name; the server geocodes it, fetches the
  current European Air Quality Index and returns a banded, colour-coded reading
  together with PM2.5, PM10 and ozone concentrations.
- **Keep a watchlist.** Save locations; they persist on the server between
  sessions and are re-checked with live readings every time the list loads.
- **Read it anywhere.** The layout is fluid and reflows from a single column on a
  phone to a card grid on a desktop.

## Requirements

- **Node.js 18 or newer** (developed on Node 22). Node 18+ is required because
  the server uses the built-in global `fetch`.
- npm (ships with Node).
- An outbound internet connection, for the upstream air-quality API.

No database server, API key or account registration is needed. The upstream
service ([Open-Meteo](https://open-meteo.com/)) is free and keyless for
non-commercial use, and the watchlist is stored in a local JSON file.

## Installation

```bash
git clone <URL-OF-THIS-REPOSITORY>
cd airwatch
npm install
```

## Running the application

```bash
npm start
```

Then open **http://localhost:3000** in a browser.

To use a different port:

```bash
PORT=8080 npm start
```

Quick check that the server is alive:

```bash
curl http://localhost:3000/api/health
# {"ok":true,"status":"up"}
```

## Running the tests

```bash
npm test
```

29 tests run in two suites. They need **no network access**: the upstream
air-quality service is stubbed, and the integration tests write to a temporary
directory that is removed afterwards.

- `tests/airQuality.test.js` — unit tests for AQI banding, payload normalisation
  and upstream error mapping.
- `tests/api.test.js` — integration tests driving the real Express routes and the
  real JSON store over HTTP.

## Project structure

```
airwatch/
├── server.js                     Process entry point; binds the port
├── package.json
├── public/                       Front-end, served as static files
│   ├── index.html                Markup and page structure
│   ├── styles.css                Responsive stylesheet
│   └── app.js                    Browser logic; talks only to /api
├── src/
│   ├── app.js                    Express app factory + error handler
│   ├── routes/
│   │   └── api.js                JSON API routes
│   └── services/
│       ├── airQuality.js         AQI banding + upstream client
│       └── watchlistStore.js     JSON-file persistence
├── tests/
│   ├── airQuality.test.js        Unit tests
│   └── api.test.js               Integration tests
└── data/
    └── watchlist.json            Created on first save (git-ignored)
```

## API reference

All endpoints return `{ "ok": true, ... }` on success and
`{ "ok": false, "error": "..." }` on failure.

| Method | Path                  | Purpose                                            |
|--------|-----------------------|----------------------------------------------------|
| GET    | `/api/health`         | Liveness probe                                     |
| GET    | `/api/air?q=Berlin`   | Geocode a place and return its current reading     |
| GET    | `/api/watchlist`      | Saved locations, each with a live reading          |
| POST   | `/api/watchlist`      | Save a location (duplicates ignored)               |
| DELETE | `/api/watchlist/:id`  | Remove a saved location                            |
| GET    | `/api/bands`          | The colour legend                                  |

Example:

```bash
curl "http://localhost:3000/api/air?q=Krakow"
```

## Design decisions

**Vanilla front-end, no build step.** HTML, CSS and JavaScript are served
directly. A framework would have added a toolchain without changing what the two
screens do, and `git clone && npm install && npm start` is a materially simpler
install for whoever has to run this.

**External API on the server only.** The browser never contacts Open-Meteo. The
server geocodes, fetches, and reduces the upstream payload to a small stable
shape. This satisfies the project constraint, keeps the browser contract stable
if upstream field names change, and leaves one place to add caching later.

**JSON file instead of a database.** A single-user watchlist of a few dozen rows
does not need a database server, and requiring one would mean the grader has to
provision it. Writes go to a temporary file and are renamed into place, so a
crash mid-write cannot leave truncated JSON. The trade-off — no concurrent-write
safety and no query language — is accepted deliberately.

**Dependency injection at the seams.** The Express app, the API router and the
upstream client all take their dependencies as arguments. That is what lets the
integration tests run the real routes against a temporary file and a stubbed
upstream, with no mocking framework reaching into module internals.

**DOM construction over HTML strings.** The front-end builds nodes with
`createElement` and `textContent`, so place names returned by the geocoder cannot
be injected into the page as markup.

## Known limitations

- Single shared watchlist — there are no user accounts.
- No caching: every watchlist load re-queries upstream, which is fine at this
  scale but would need a short-lived cache under real traffic.
- Upstream readings are hourly, so the value shown can be up to an hour old.

## Licence

MIT.
