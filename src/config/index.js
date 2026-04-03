const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const config = {
  env,
  isProd,

  server: {
    port: parseInt(process.env.PORT) || 4000,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  },

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'hotel_pms',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres123',
    url: process.env.DATABASE_URL || null,
    ssl: isProd,
    pool: { min: 2, max: isProd ? 20 : 5 },
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_CHANGE_IN_PRODUCTION_min32chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  gst: {
    roomRate: parseInt(process.env.GST_ROOM_RATE) || 12,
  }
};

export default config;