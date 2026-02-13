const config = require('./config');
const express = require('express');
const db = require('./db');
const router = require('./router');

const app = express();

app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(router);

const server = app.listen(config.port, () => {
  console.log(`URL shortener listening on port ${config.port}`);
});

function shutdown() {
  console.log('Shutting down...');
  server.close(() => {
    db.close();
    console.log('Closed database and server.');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
