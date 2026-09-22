/**
 * AirWatch front-end.
 */

(function () {
  'use strict';

  const els = {
    form: document.getElementById('search-form'),
    input: document.getElementById('search-input'),
    button: document.getElementById('search-button'),
    searchStatus: document.getElementById('search-status'),
    searchResult: document.getElementById('search-result'),
    watchlist: document.getElementById('watchlist'),
    watchlistStatus: document.getElementById('watchlist-status'),
    refresh: document.getElementById('refresh-button'),
    legend: document.getElementById('legend')
  };

  /**
   * Call a JSON endpoint and unwrap the standard `{ ok }` envelope.
   *
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<object>} The parsed body when `ok` is true.
   * @throws {Error} Carrying the server's message when `ok` is false.
   */
  async function api(url, options) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error('The server sent a response the app could not read');
    }
    if (!res.ok || !body.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  /**
   * Set a status line, optionally as an error.
   * @param {HTMLElement} el
   * @param {string} message
   * @param {boolean} [isError]
   */
  function setStatus(el, message, isError) {
    el.textContent = message;
    el.classList.toggle('error', Boolean(isError));
  }

  /**
   * Build the shared reading block used by both the search result and the cards.
   *
   * @param {object} location A location with `reading` and `band`.
   * @param {object} [opts]
   * @param {'save'|'remove'|null} [opts.action] Which button to render.
   * @param {(location: object) => void} [opts.onAction]
   * @returns {DocumentFragment}
   */
  function renderReading(location, opts = {}) {
    const frag = document.createDocumentFragment();
    const box = document.createElement('div');
    box.className = 'reading';

    const dial = document.createElement('div');
    dial.className = 'dial';
    const text = document.createElement('div');

    const title = document.createElement('h3');
    title.textContent = location.country ? `${location.name}, ${location.country}` : location.name;
    text.appendChild(title);

    if (location.reading && location.band) {
      dial.style.backgroundColor = location.band.colour;
      dial.textContent = String(location.reading.aqi);
      dial.setAttribute('aria-label', `European Air Quality Index ${location.reading.aqi}`);

      const band = document.createElement('p');
      band.className = 'band';
      band.textContent = location.band.label;
      band.style.color = location.band.colour;
      text.appendChild(band);

      const advice = document.createElement('p');
      advice.className = 'advice';
      advice.textContent = location.band.advice;
      text.appendChild(advice);
    } else {
      dial.style.backgroundColor = '#8a958f';
      dial.textContent = '–';
      const advice = document.createElement('p');
      advice.className = 'advice';
      advice.textContent = 'No current reading available for this location.';
      text.appendChild(advice);
    }

    box.append(dial, text);

    if (location.reading) {
      const pollutants = document.createElement('ul');
      pollutants.className = 'pollutants';
      const rows = [
        ['PM2.5', location.reading.pm25, 'µg/m³'],
        ['PM10', location.reading.pm10, 'µg/m³'],
        ['Ozone', location.reading.ozone, 'µg/m³']
      ];
      rows.forEach(([label, value, unit]) => {
        if (value === null || value === undefined) return;
        const li = document.createElement('li');
        li.textContent = `${label} ${value} ${unit}`;
        pollutants.appendChild(li);
      });
      if (pollutants.childElementCount) box.appendChild(pollutants);
    }

    if (opts.action) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      const btn = document.createElement('button');
      btn.type = 'button';
      if (opts.action === 'save') {
        btn.textContent = 'Add to watchlist';
      } else {
        btn.textContent = 'Remove';
        btn.className = 'danger';
      }
      btn.addEventListener('click', () => opts.onAction(location, btn));
      actions.appendChild(btn);
      box.appendChild(actions);
    }

    frag.appendChild(box);
    return frag;
  }

  /** Dynamic aspect 1 — look a place up through the back-end. */
  async function handleSearch(event) {
    event.preventDefault();
    const query = els.input.value.trim();
    if (query.length < 2) {
      setStatus(els.searchStatus, 'Please enter at least two characters.', true);
      return;
    }

    els.button.disabled = true;
    setStatus(els.searchStatus, `Looking up ${query}…`);
    els.searchResult.hidden = true;

    try {
      const { location } = await api(`/api/air?q=${encodeURIComponent(query)}`);
      els.searchResult.replaceChildren(
        renderReading(location, { action: 'save', onAction: saveLocation })
      );
      els.searchResult.hidden = false;
      setStatus(els.searchStatus, '');
    } catch (err) {
      setStatus(els.searchStatus, err.message, true);
    } finally {
      els.button.disabled = false;
    }
  }

  /**
   * Persist a location, then refresh the list so the two views cannot drift.
   * @param {object} location
   * @param {HTMLButtonElement} button
   */
  async function saveLocation(location, button) {
    button.disabled = true;
    try {
      const body = await api('/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          id: location.id,
          name: location.name,
          country: location.country,
          latitude: location.latitude,
          longitude: location.longitude
        })
      });
      setStatus(
        els.searchStatus,
        body.created ? `${location.name} added to your watchlist.` : `${location.name} is already on your watchlist.`
      );
      await loadWatchlist();
    } catch (err) {
      setStatus(els.searchStatus, err.message, true);
    } finally {
      button.disabled = false;
    }
  }

  /**
   * Remove a location and refresh.
   * @param {object} location
   * @param {HTMLButtonElement} button
   */
  async function removeLocation(location, button) {
    button.disabled = true;
    try {
      await api(`/api/watchlist/${encodeURIComponent(location.id)}`, { method: 'DELETE' });
      setStatus(els.watchlistStatus, `${location.name} removed.`);
      await loadWatchlist();
    } catch (err) {
      setStatus(els.watchlistStatus, err.message, true);
      button.disabled = false;
    }
  }

  /** Dynamic aspect 2 — load the saved list with a live reading for each entry. */
  async function loadWatchlist() {
    setStatus(els.watchlistStatus, 'Loading your saved locations…');
    try {
      const { entries } = await api('/api/watchlist');
      els.watchlist.replaceChildren();

      if (!entries.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'Nothing saved yet. Search for a place above and add it.';
        els.watchlist.appendChild(li);
        setStatus(els.watchlistStatus, '');
        return;
      }

      entries.forEach((entry) => {
        const li = document.createElement('li');
        li.appendChild(renderReading(entry, { action: 'remove', onAction: removeLocation }));
        els.watchlist.appendChild(li);
      });
      setStatus(els.watchlistStatus, `${entries.length} location${entries.length === 1 ? '' : 's'} saved.`);
    } catch (err) {
      setStatus(els.watchlistStatus, err.message, true);
    }
  }

  /** Render the colour legend from the server, so the scale is defined once. */
  async function loadLegend() {
    try {
      const { bands } = await api('/api/bands');
      els.legend.replaceChildren();
      bands.forEach((band) => {
        const li = document.createElement('li');
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = band.colour;
        const label = document.createElement('span');
        label.textContent = `${band.label} — ${band.advice}`;
        li.append(swatch, label);
        els.legend.appendChild(li);
      });
    } catch {
      els.legend.replaceChildren();
    }
  }

  els.form.addEventListener('submit', handleSearch);
  els.refresh.addEventListener('click', loadWatchlist);

  loadLegend();
  loadWatchlist();
})();
