const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const RESERVED_SEGMENTS = new Set(['add', 'whatis']);
const MAX_RETRIES = 3;

function generateSegment() {
  return crypto.randomBytes(4).toString('base64url');
}

function getIP(req) {
  return req.ip || req.connection.remoteAddress;
}

function timeSince(dateStr) {
  const then = new Date(dateStr + 'Z');
  const seconds = Math.floor((Date.now() - then) / 1000);

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
  ];

  for (const { label, seconds: s } of intervals) {
    const count = Math.floor(seconds / s);
    if (count >= 1) {
      return `${count} ${label}${count > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

function addUrl(req, res) {
  const rawUrl = req.body.url;
  const vanity = req.body.vanity;

  if (!rawUrl) {
    return res.status(400).json({ error: 'The "url" parameter is required' });
  }

  let url;
  try {
    url = decodeURIComponent(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL encoding' });
  }

  if (url.length > 1000) {
    return res.status(400).json({ error: 'URL cannot be longer than 1000 characters' });
  }

  if (/^https?:\/\/localhost/i.test(url)) {
    return res.status(400).json({ error: 'Localhost URLs are not allowed' });
  }

  // Validate vanity early, before any DB lookups
  let segment;
  if (vanity) {
    if (/[^A-Za-z0-9_-]/.test(vanity)) {
      return res.status(400).json({ error: 'Vanity URL contains invalid characters' });
    }
    if (vanity.length > 15) {
      return res.status(400).json({ error: 'Vanity URL cannot be longer than 15 characters' });
    }
    if (config.minVanityLength > 0 && vanity.length < config.minVanityLength) {
      return res.status(400).json({ error: `Vanity URL must be at least ${config.minVanityLength} characters` });
    }
    if (RESERVED_SEGMENTS.has(vanity.toLowerCase())) {
      return res.status(400).json({ error: 'That vanity URL is reserved' });
    }
    segment = vanity;
  }

  const ip = getIP(req);

  const recentCount = db.countRecentUrlsByIp(ip);
  if (recentCount >= config.numOfUrlsPerHour) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }

  const existing = db.getUrlByUrl(url);
  if (existing) {
    return res.status(200).json({ url: config.rootUrl + existing.segment, segment: existing.segment });
  }

  if (vanity) {
    const taken = db.getUrlBySegment(vanity);
    if (taken) {
      return res.status(400).json({ error: 'That vanity URL is already taken' });
    }
  }

  // Verify URL is reachable
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
    .then((fetchRes) => {
      clearTimeout(timeout);
      if (fetchRes.status >= 400) {
        return res.status(400).json({ error: 'The URL is not reachable' });
      }

      if (!segment) {
        for (let i = 0; i < MAX_RETRIES; i++) {
          const candidate = generateSegment();
          try {
            const row = db.insertUrl(url, candidate, ip);
            return res.status(201).json({ url: config.rootUrl + row.segment, segment: row.segment });
          } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && i < MAX_RETRIES - 1) {
              continue;
            }
            throw err;
          }
        }
      } else {
        try {
          const row = db.insertUrl(url, segment, ip);
          return res.status(201).json({ url: config.rootUrl + row.segment, segment: row.segment });
        } catch (err) {
          if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'That vanity URL is already taken' });
          }
          throw err;
        }
      }
    })
    .catch((err) => {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        return res.status(400).json({ error: 'The URL is not reachable (timeout)' });
      }
      return res.status(400).json({ error: 'The URL is not reachable' });
    });
}

function getUrl(req, res) {
  const segment = req.params.segment;
  const row = db.getUrlBySegment(segment);

  if (!row) {
    return res.status(404).json({ error: 'Short link not found' });
  }

  try {
    const referer = req.headers.referer || '';
    db.insertClick(row.id, getIP(req), referer);
    db.incrementClicks(row.id);
  } catch (err) {
    console.error('Failed to record click:', err.message);
  }

  res.redirect(301, row.url);
}

function whatIs(req, res) {
  let segment = req.params.segment || '';
  segment = segment.replace(config.rootUrl, '');

  const row = db.getUrlBySegment(segment);
  if (!row) {
    return res.status(404).json({ error: 'Short link not found' });
  }

  res.status(200).json({
    url: row.url,
    segment: row.segment,
    shortUrl: config.rootUrl + row.segment,
    clicks: row.click_count,
    created: timeSince(row.created_at),
  });
}

module.exports = { addUrl, getUrl, whatIs };
