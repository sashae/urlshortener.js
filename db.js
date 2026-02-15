const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Add title column for existing databases
try {
  db.exec("ALTER TABLE urls ADD COLUMN title TEXT DEFAULT ''");
} catch (err) {
  // Column already exists, ignore
}

// Add expires_at column for existing databases
try {
  db.exec("ALTER TABLE urls ADD COLUMN expires_at TEXT DEFAULT NULL");
} catch (err) {
  // Column already exists, ignore
}

// Add og_image column for existing databases
try {
  db.exec("ALTER TABLE urls ADD COLUMN og_image TEXT DEFAULT ''");
} catch (err) {
  // Column already exists, ignore
}

// Add og_description column for existing databases
try {
  db.exec("ALTER TABLE urls ADD COLUMN og_description TEXT DEFAULT ''");
} catch (err) {
  // Column already exists, ignore
}

const stmts = {
  getUrlBySegment: db.prepare('SELECT * FROM urls WHERE segment = ?'),
  getUrlByUrl: db.prepare('SELECT * FROM urls WHERE url = ?'),
  insertUrl: db.prepare('INSERT INTO urls (url, segment, ip, title, expires_at, og_image, og_description) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  countRecentUrlsByIp: db.prepare(
    "SELECT COUNT(*) AS count FROM urls WHERE ip = ? AND created_at >= datetime('now', '-1 hour')"
  ),
  insertClick: db.prepare('INSERT INTO stats (url_id, ip, referer) VALUES (?, ?, ?)'),
  incrementClicks: db.prepare('UPDATE urls SET click_count = click_count + 1 WHERE id = ?'),
  getAllStats: db.prepare(`
    SELECT u.url, u.segment, u.title, u.click_count, u.created_at, u.expires_at,
           MAX(s.clicked_at) AS last_clicked_at
    FROM urls u
    LEFT JOIN stats s ON s.url_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `),
};

module.exports = {
  getUrlBySegment(segment) {
    return stmts.getUrlBySegment.get(segment);
  },

  getUrlByUrl(url) {
    return stmts.getUrlByUrl.get(url);
  },

  insertUrl(url, segment, ip, title, expiresAt, ogImage, ogDescription) {
    const info = stmts.insertUrl.run(url, segment, ip, title || '', expiresAt || null, ogImage || '', ogDescription || '');
    return { id: info.lastInsertRowid, url, segment, ip };
  },

  countRecentUrlsByIp(ip) {
    return stmts.countRecentUrlsByIp.get(ip).count;
  },

  insertClick(urlId, ip, referer) {
    stmts.insertClick.run(urlId, ip, referer || '');
  },

  incrementClicks(id) {
    stmts.incrementClicks.run(id);
  },

  getAllStats() {
    return stmts.getAllStats.all();
  },

  close() {
    db.close();
  },
};
