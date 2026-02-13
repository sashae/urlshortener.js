require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3500,
  rootUrl: process.env.ROOT_URL || 'http://localhost:3500/',
  dbPath: process.env.DB_PATH || './urlshortener.db',
  minVanityLength: parseInt(process.env.MIN_VANITY_LENGTH, 10) || 4,
  numOfUrlsPerHour: parseInt(process.env.NUM_OF_URLS_PER_HOUR, 10) || 5000,
};

// Ensure rootUrl ends with /
if (!config.rootUrl.endsWith('/')) {
  config.rootUrl += '/';
}

module.exports = config;
