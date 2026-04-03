import knex from 'knex';
import config from './knexfile.cjs';
import cfg from './config/index.js';

const env = cfg.env;
const db = knex(config[env] || config.development);

// Verify connection
db.raw('SELECT 1')
  .then(() => {
    console.log(`[DB] Connected to PostgreSQL (${cfg.db.host}:${cfg.db.port}/${cfg.db.name})`);
  })
  .catch((e) => {
    console.error('[DB] Connection error:', e.message);
  });

export default db;