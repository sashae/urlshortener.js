Original credit: <https://ducode.org/url-shortener-in-node-js-express-js-mysql-tutorial-learning-by-doing.html>.

## Setup

1. Copy `.env.example` to `.env` and adjust values
2. `npm install`
3. `npm start`

The SQLite database is created automatically on first run.

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
