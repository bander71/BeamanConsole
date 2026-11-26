import express from 'express';
import { auditChanges, authenticate, authorize, sameOriginWrites } from './auth/session.ts';
import { crudRouter } from './crud.ts';
import { pool } from './db.ts';
import { errorHandler, HttpError } from './errors.ts';
import { resourceDefs } from './resources.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { contactImportRoutes } from './routes/contactImport.ts';
import { extraRoutes } from './routes/extra.ts';
import { outlookImportRoutes } from './routes/outlookImport.ts';
import { invoiceRoutes } from './routes/invoices.ts';
import { reportRoutes } from './routes/reports.ts';
import { timesheetRoutes } from './routes/timesheets.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();

  // Who is asking, then whether their role allows it (rules in auth/permissions.ts).
  // /auth (sign-in) and /health are the only things open without signing in.
  api.use(authenticate);
  api.use(sameOriginWrites);
  api.use(auditChanges);
  api.use(authRoutes);
  api.use(authorize);

  api.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  api.use(adminRoutes);
  api.use(contactImportRoutes);
  api.use(outlookImportRoutes);
  api.use(extraRoutes);
  api.use(timesheetRoutes);
  api.use(invoiceRoutes);
  api.use(reportRoutes);
  for (const def of resourceDefs) api.use(def.path, crudRouter(def));

  api.use((req) => {
    throw new HttpError(404, `No endpoint for ${req.method} ${req.originalUrl}`);
  });

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
