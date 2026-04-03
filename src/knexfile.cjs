const path = require('path');
require('dotenv').config();

const base = {
  client: 'pg',
  migrations: { directory: path.join(__dirname, '../migrations') },
  seeds: { directory: path.join(__dirname, '../seeds') },
};

const isProd = process.env.NODE_ENV === 'production';

const connection = process.env.DB_URL
  ? {
      connectionString: process.env.DB_URL,
      ssl: isProd ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'postgres',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'hotel_pms',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres123',
    };

module.exports = {
  development: { ...base, connection },
  production: {
    ...base,
    connection,
    pool: {
      min: Number(process.env.DB_POOL_MIN || 2),
      max: Number(process.env.DB_POOL_MAX || 10),
    },
    acquireConnectionTimeout: 10000,
  },
};