CREATE TABLE IF NOT EXISTS urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  segment TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  ip TEXT NOT NULL,
  click_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  clicked_at TEXT DEFAULT (datetime('now')),
  ip TEXT NOT NULL,
  referer TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_urls_ip ON urls(ip);
CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at);
CREATE INDEX IF NOT EXISTS idx_stats_url_id ON stats(url_id);
