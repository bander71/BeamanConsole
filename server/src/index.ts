import { createApp } from './app.ts';
import { config } from './config.ts';
import { pool } from './db.ts';

const server = createApp().listen(config.port, () => {
  console.log(`Beaman Console API listening on http://localhost:${config.port}/api`);
});

const shutdown = () => {
  server.close(() => void pool.end());
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
