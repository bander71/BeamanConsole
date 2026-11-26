import { homedir } from 'node:os';
import { join } from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy server/.env.example to server/.env and fill it in.`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 3001),
  /** The app's data folder: the database, backups and stored files (such as past invoices' PDFs). */
  dataDir: process.env.BEAMAN_DATA_DIR || join(process.env.USERPROFILE || homedir(), 'BeamanConsoleData'),

  /** Where people open the app. Microsoft sends them back to <appUrl>/api/auth/callback. */
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  /** Microsoft sign-in (an app registration in Entra ID). Sign-in with Microsoft is off until all three are set. */
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID ?? '',
    clientId: process.env.ENTRA_CLIENT_ID ?? '',
    clientSecret: process.env.ENTRA_CLIENT_SECRET ?? '',
  },
  /** Emails that become admins the first time they sign in, if no user has that email yet. */
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  /**
   * "Sign in as" any user without Microsoft, for development on this computer only.
   * Refused from anywhere but localhost, and always off on Azure App Service.
   */
  devLogin: process.env.AUTH_DEV_LOGIN === 'true' && !process.env.WEBSITE_SITE_NAME,
  /** Signed-in sessions end after this many hours without use, and after 7 days regardless. */
  sessionIdleHours: Number(process.env.SESSION_IDLE_HOURS ?? 12),
};

export const entraConfigured = () => !!(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret);
