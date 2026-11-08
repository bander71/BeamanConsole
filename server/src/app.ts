import express from 'express';
import { crudRouter } from './crud.ts';
import { pool } from './db.ts';
import { errorHandler, HttpError } from './errors.ts';
import { resourceDefs } from './resources.ts';
import { extraRoutes } from './routes/extra.ts';
import { timesheetRoutes } from './routes/timesheets.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();

  api.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  api.use(extraRoutes);
  api.use(timesheetRoutes);
  for (const def of resourceDefs) api.use(def.path, crudRouter(def));

  api.use((req) => {
    throw new HttpError(404, `No endpoint for ${req.method} ${req.originalUrl}`);
  });

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
