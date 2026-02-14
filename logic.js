const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const RESERVED_SEGMENTS = new Set(['add', 'whatis', 'stats', 'shorten']);
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
  const daysActive = req.body.days_active;

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

  let expiresAt = null;
  if (daysActive && Number(daysActive) > 0) {
    const days = Number(daysActive);
    expiresAt = new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  }

  // Verify URL is reachable
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
    .then(async (fetchRes) => {
      clearTimeout(timeout);
      if (fetchRes.status >= 400) {
        return res.status(400).json({ error: 'The URL is not reachable' });
      }

      let title = '';
      try {
        const contentType = fetchRes.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          const body = await fetchRes.text();
          const match = body.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (match) title = match[1].trim();
        }
      } catch {}

      if (!segment) {
        for (let i = 0; i < MAX_RETRIES; i++) {
          const candidate = generateSegment();
          try {
            const row = db.insertUrl(url, candidate, ip, title, expiresAt);
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
          const row = db.insertUrl(url, segment, ip, title, expiresAt);
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
    return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PLAYER NOT FOUND</title>
  <style>
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Regular.otf') format('opentype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Bold.otf') format('opentype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
    body { background: #000; color: #00cc88; font-family: 'Offlig', 'Courier New', monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    h1 { font-size: 4rem; font-weight: 700; margin: 0; text-shadow: 0 0 20px rgba(0,204,136,0.5); }
    .subtitle { font-size: 1.2rem; margin-top: 1rem; color: #009966; }
    .prompt { margin-top: 2rem; font-size: 1.1rem; animation: blink 1.5s step-end infinite; }
    .prompt a { color: #00cc88; text-decoration: none; }
    .prompt a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>PLAYER NOT FOUND</h1>
  <p class="subtitle">NO SAVE FILE FOR THIS LEVEL</p>
  <p class="prompt"><a href="/shorten">CONTINUE? &gt;</a></p>
</body>
</html>`);
  }

  if (row.expires_at && new Date(row.expires_at + 'Z') < new Date()) {
    return res.status(410).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GAME OVER</title>
  <style>
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Regular.otf') format('opentype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Bold.otf') format('opentype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
    body { background: #000; color: #00cc88; font-family: 'Offlig', 'Courier New', monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    h1 { font-size: 4rem; font-weight: 700; margin: 0; text-shadow: 0 0 20px rgba(0,204,136,0.5); }
    p { font-size: 1.2rem; margin-top: 1rem; animation: blink 2s step-end infinite; }
  </style>
</head>
<body>
  <h1>GAME OVER</h1>
  <p>INSERT QUARTER TO START</p>
</body>
</html>`);
  }

  try {
    const referer = req.headers.referer || '';
    db.insertClick(row.id, getIP(req), referer);
    db.incrementClicks(row.id);
  } catch (err) {
    console.error('Failed to record click:', err.message);
  }

  res.redirect(302, row.url);
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

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr + 'Z');
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statsJson(req, res) {
  const rows = db.getAllStats();
  const data = rows.map((row) => ({
    url: row.url,
    title: row.title || '',
    segment: row.segment,
    shortUrl: config.rootUrl + row.segment,
    click_count: row.click_count,
    created_at: formatDate(row.created_at),
    last_clicked_at: row.last_clicked_at ? formatDate(row.last_clicked_at) : 'Never',
    expires_at: row.expires_at ? formatDate(row.expires_at) : null,
  }));
  res.json(data);
}

function stats(req, res) {
  const rows = db.getAllStats();

  const tableRows = rows.map((row) => {
    const title = escapeHtml(row.title || '');
    const displayTitle = title || '<em>Untitled</em>';
    const shortUrl = config.rootUrl + row.segment;
    return `<tr>
      <td><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.url)}</a></td>
      <td>${displayTitle}</td>
      <td><a href="${escapeHtml(shortUrl)}" target="_blank" rel="noopener">${escapeHtml(row.segment)}</a></td>
      <td>${row.click_count}</td>
      <td>${formatDate(row.created_at)}</td>
      <td>${row.last_clicked_at ? formatDate(row.last_clicked_at) : 'Never'}</td>
      <td>${row.expires_at ? formatDate(row.expires_at) : 'Never'}</td>
    </tr>`;
  }).join('\n');

  const hostname = (() => { try { return new URL(config.rootUrl).hostname; } catch { return config.rootUrl; } })();

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>URL Shortener Stats</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Regular.otf') format('opentype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Bold.otf') format('opentype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    body { font-family: 'Archivo', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; background: #111; color: #e0e0e0; }
    .header h1 { font-family: 'Offlig', 'Courier New', monospace; font-weight: 700; font-size: 2.2rem; margin: 0; color: #e0e0e0; }
    .header .subtitle { font-family: 'Offlig', 'Courier New', monospace; font-size: 1rem; color: #777; margin-top: 0.25rem; }
    nav { margin-bottom: 1rem; }
    nav a { color: #00cc88; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    .header { margin-bottom: 1.5rem; }
    .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { border-collapse: collapse; width: 100%; background: #1a1a1a; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #333; }
    th { background: #222; color: #e0e0e0; position: sticky; top: 0; font-weight: 600; }
    tr:hover { background: #252525; }
    td { font-family: 'Offlig', 'Courier New', monospace; }
    td a { color: #00cc88; text-decoration: none; word-break: break-all; }
    td a:hover { text-decoration: underline; }
    .count { text-align: center; }
    td:nth-child(4) { text-align: center; }
    .empty { text-align: center; padding: 2rem; color: #777; font-family: 'Archivo', sans-serif; }
    @media (max-width: 768px) {
      body { margin: 1rem; }
      th, td { padding: 0.5rem 0.6rem; font-size: 0.85rem; }
    }
  </style>
</head>
<body>
  <nav><a href="/shorten">&rarr; Shorten an URL</a></nav>
  <div class="header">
    <h1>${escapeHtml(hostname)}</h1>
    <div class="subtitle">url shortener stats</div>
  </div>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Original URL</th>
          <th>Title</th>
          <th>Short Link</th>
          <th>Clicks</th>
          <th>Created</th>
          <th>Last Clicked</th>
          <th>Expires</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || '<tr><td colspan="7" class="empty">No URLs yet</td></tr>'}
      </tbody>
    </table>
  </div>
  <script>
    (function() {
      function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      }

      function refreshStats() {
        fetch('/stats/json')
          .then(function(res) { return res.json(); })
          .then(function(rows) {
            const tbody = document.querySelector('tbody');
            if (!rows.length) {
              tbody.innerHTML = '<tr><td colspan="7" class="empty">No URLs yet</td></tr>';
              return;
            }
            tbody.innerHTML = rows.map(function(row) {
              const title = escapeHtml(row.title);
              const displayTitle = title || '<em>Untitled</em>';
              return '<tr>' +
                '<td><a href="' + escapeHtml(row.url) + '" target="_blank" rel="noopener">' + escapeHtml(row.url) + '</a></td>' +
                '<td>' + displayTitle + '</td>' +
                '<td><a href="' + escapeHtml(row.shortUrl) + '" target="_blank" rel="noopener">' + escapeHtml(row.segment) + '</a></td>' +
                '<td>' + row.click_count + '</td>' +
                '<td>' + escapeHtml(row.created_at) + '</td>' +
                '<td>' + escapeHtml(row.last_clicked_at) + '</td>' +
                '<td>' + escapeHtml(row.expires_at || 'Never') + '</td>' +
                '</tr>';
            }).join('');
          })
          .catch(function() {});
      }

      setInterval(refreshStats, 3000);

      document.querySelector('tbody').addEventListener('click', function(e) {
        var link = e.target.closest('a');
        if (!link) return;
        var tr = link.closest('tr');
        if (!tr) return;
        var clickTd = tr.children[3];
        if (clickTd) {
          clickTd.textContent = parseInt(clickTd.textContent, 10) + 1;
        }
      });
    })();
  </script>
</body>
</html>`);
}

function shorten(req, res) {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shorten an URL</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Regular.otf') format('opentype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Offlig';
      src: url('/fonts/Offlig-Bold.otf') format('opentype');
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    body { font-family: 'Archivo', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 2rem; background: #111; color: #e0e0e0; }
    h1 { margin-bottom: 1rem; font-weight: 700; font-family: 'Offlig', 'Courier New', monospace; font-size: 1.8rem; }
    form { background: #1a1a1a; padding: 1.5rem; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); max-width: 500px; }
    label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
    input[type="text"], input[type="url"], input[type="number"] { width: 100%; padding: 0.5rem; margin-bottom: 1rem; border: 1px solid #444; border-radius: 4px; font-size: 1rem; box-sizing: border-box; background: #222; color: #e0e0e0; }
    input::placeholder { color: #777; }
    button { background: #00cc88; color: #111; border: none; padding: 0.6rem 1.5rem; border-radius: 4px; font-size: 1rem; cursor: pointer; font-weight: 600; }
    button:hover { background: #00e699; }
    #result { margin-top: 1rem; max-width: 500px; }
    .success { background: rgba(0,204,136,0.1); border: 1px solid #00cc88; padding: 1rem; border-radius: 6px; }
    .success a { color: #00cc88; font-weight: 600; word-break: break-all; }
    .error { background: rgba(204,0,0,0.1); border: 1px solid #cc0000; padding: 1rem; border-radius: 6px; color: #ff6666; }
    nav { margin-bottom: 1rem; }
    nav a { color: #00cc88; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    @media (max-width: 768px) {
      body { margin: 1rem; }
    }
  </style>
</head>
<body>
  <nav><a href="/stats">&larr; Stats</a></nav>
  <h1>Shorten an URL</h1>
  <form id="shorten-form">
    <label for="url">URL to shorten</label>
    <input type="url" id="url" name="url" placeholder="https://example.com" required>
    <label for="vanity">Custom short code (optional)</label>
    <input type="text" id="vanity" name="vanity" placeholder="my-link" maxlength="15">
    <label for="days_active">Days active (optional)</label>
    <input type="number" id="days_active" name="days_active" min="1">
    <button type="submit">Shorten</button>
  </form>
  <div id="result"></div>
  <script>
    document.getElementById('shorten-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var resultDiv = document.getElementById('result');
      resultDiv.innerHTML = '';
      var url = document.getElementById('url').value;
      var vanity = document.getElementById('vanity').value;
      var daysActive = document.getElementById('days_active').value;
      var body = { url: url };
      if (vanity) body.vanity = vanity;
      if (daysActive) body.days_active = daysActive;
      fetch('/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
        .then(function(result) {
          if (result.data.error) {
            resultDiv.innerHTML = '<div class="error">' + result.data.error + '</div>';
          } else {
            resultDiv.innerHTML = '<div class="success">Shortened: <a href="' + result.data.url + '" target="_blank" rel="noopener">' + result.data.url + '</a></div>';
          }
        })
        .catch(function() {
          resultDiv.innerHTML = '<div class="error">Something went wrong. Please try again.</div>';
        });
    });
  </script>
</body>
</html>`);
}

module.exports = { addUrl, getUrl, whatIs, stats, statsJson, shorten };
