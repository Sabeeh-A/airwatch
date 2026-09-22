/**
 * Persistence for the user's saved locations.
 *
 * A JSON file is used rather than a database server so that the application can
 * be installed and run with `npm install && npm start` alone, with no external
 * service to provision. The trade-off — no concurrent-write safety beyond the
 * atomic rename below, and no query language — is acceptable for a single-user
 * application and is documented in the README.
 */

const fs = require('fs/promises');
const path = require('path');

class WatchlistStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  // A missing file is treated as an empty list rather than an error so that a
  // fresh checkout runs without a setup step.
  async all() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  // Insert an entry, ignoring duplicates by `id`.
  async add(entry) {
    const entries = await this.all();
    if (entries.some((e) => e.id === entry.id)) {
      return { created: false, entries };
    }
    const next = [{ ...entry, addedAt: new Date().toISOString() }, ...entries];
    await this.#write(next);
    return { created: true, entries: next };
  }

  // Remove an entry by id.
  async remove(id) {
    const entries = await this.all();
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) {
      return { removed: false, entries };
    }
    await this.#write(next);
    return { removed: true, entries: next };
  }

  // Write the list atomically: to a temporary file, then renamed into place,
  // so a crash mid-write cannot leave a truncated JSON file that the next
  // read would reject.
  async #write(entries) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}

module.exports = { WatchlistStore };
