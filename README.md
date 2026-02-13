Original credit: <https://ducode.org/url-shortener-in-node-js-express-js-mysql-tutorial-learning-by-doing.html>.

## Getting Started

### Run locally

1. Copy `.env.example` to `.env` and adjust values
2. `npm install`
3. `npm start`

The SQLite database is created automatically on first run.

### Run with Docker Compose

```
docker compose up -d
```

Edit the `environment` section in `docker-compose.yml` to customize settings. To stop:

```
docker compose down
```

### Run with Docker

Build the image:

```
docker buildx build -t urlshortener .
```

Run it:

```
docker run -p 3500:3500 -v urlshortener-data:/data urlshortener
```

The `-v urlshortener-data:/data` flag creates a named volume so the SQLite database persists across container restarts.

To customize settings, pass environment variables with `-e`:

```
docker run -p 3500:3500 -v urlshortener-data:/data \
  -e ROOT_URL=https://short.example.com/ \
  -e NUM_OF_URLS_PER_HOUR=1000 \
  urlshortener
```

Available environment variables (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3500` | Server port |
| `ROOT_URL` | `http://localhost:3500/` | Base URL for generated short links |
| `DB_PATH` | `./urlshortener.db` | Path to SQLite database |
| `MIN_VANITY_LENGTH` | `4` | Minimum length for vanity segments |
| `NUM_OF_URLS_PER_HOUR` | `5000` | Rate limit per IP |

## API

### Create a short URL

```
POST /add
Content-Type: application/json

{"url": "https://example.com"}
```

With a vanity segment:

```
POST /add
Content-Type: application/json

{"url": "https://example.com/page", "vanity": "mylink"}
```

### Redirect

```
GET /:segment
```

### Stats

```
GET /whatis/:segment
```
