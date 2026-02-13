const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const stmts = {
  getUrlBySegment: db.prepare('SELECT * FROM urls WHERE segment = ?'),
  getUrlByUrl: db.prepare('SELECT * FROM urls WHERE url = ?'),
  insertUrl: db.prepare('INSERT INTO urls (url, segment, ip) VALUES (?, ?, ?)'),
  countRecentUrlsByIp: db.prepare(
    "SELECT COUNT(*) AS count FROM urls WHERE ip = ? AND created_at >= datetime('now', '-1 hour')"
  ),
  insertClick: db.prepare('INSERT INTO stats (url_id, ip, referer) VALUES (?, ?, ?)'),
  incrementClicks: db.prepare('UPDATE urls SET click_count = click_count + 1 WHERE id = ?'),
};

module.exports = {
  getUrlBySegment(segment) {
    return stmts.getUrlBySegment.get(segment);
  },

  getUrlByUrl(url) {
    return stmts.getUrlByUrl.get(url);
  },

  insertUrl(url, segment, ip) {
    const info = stmts.insertUrl.run(url, segment, ip);
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

  close() {
    db.close();
  },
};
