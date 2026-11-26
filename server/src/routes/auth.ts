// Sign-in, sign-out and "who am I".
//
// GET  /auth/options        which sign-in methods are on
// GET  /auth/login          sends the browser to Microsoft (?returnTo=/path)
// GET  /auth/callback       Microsoft sends the browser back here
// POST /auth/logout
// GET  /auth/me             the signed-in user, their role and permissions
//
// Development only (AUTH_DEV_LOGIN=true, from this computer):
// GET  /auth/dev/users      users you can sign in as
// POST /auth/dev/login      { userId } or, while there are no users yet, { email, name } to make the first admin

import { Router, type Request } from 'express';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { config, entraConfigured } from '../config.ts';
import { pool, query } from '../db.ts';
import { HttpError } from '../errors.ts';
import { AREAS } from '../auth/permissions.ts';
import { cookie, createSession, endSession, parseCookies, setSessionCookie } from '../auth/session.ts';

export const authRoutes = Router();

const LOGIN_COOKIE = 'bc_login';
const callbackUrl = () => `${config.appUrl}/api/auth/callback`;

let entraPromise: Promise<oidc.Configuration> | null = null;
function entra(): Promise<oidc.Configuration> {
  entraPromise ??= oidc
    .discovery(new URL(`https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`), config.entra.clientId, config.entra.clientSecret)
    .catch((err) => {
      entraPromise = null; // try again next time
      throw err;
    });
  return entraPromise;
}

const isLoopback = (req: Request) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && ['localhost', '127.0.0.1', '[::1]'].includes(req.hostname);
const devLoginAllowed = (req: Request) => config.devLogin && isLoopback(req);

/** A path inside the app to return to after signing in. */
const safeReturn = (raw: unknown) => (typeof raw === 'string' && /^\/(?![/\\])/.test(raw) ? raw : '/');

const backToApp = (path: string, error?: string) =>
  config.appUrl + (error ? `/?signin_error=${encodeURIComponent(error)}` : path);

authRoutes.get('/auth/options', (req, res) => {
  res.json({ data: { microsoft: entraConfigured(), dev: devLoginAllowed(req) } });
});

// ---- Microsoft ---------------------------------------------------------------------

authRoutes.get('/auth/login', async (req, res) => {
  if (!entraConfigured()) throw new HttpError(404, 'Sign-in with Microsoft is not set up');
  const cfg = await entra();
  const verifier = oidc.randomPKCECodeVerifier();
  const pending = { state: oidc.randomState(), nonce: oidc.randomNonce(), verifier, returnTo: safeReturn(req.query.returnTo) };
  const url = oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: callbackUrl(),
    scope: 'openid profile email',
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state: pending.state,
    nonce: pending.nonce,
    prompt: 'select_account',
  });
  res.append('Set-Cookie', cookie(LOGIN_COOKIE, JSON.stringify(pending), { maxAgeSeconds: 600, path: '/api/auth' }));
  res.redirect(url.href);
});

authRoutes.get('/auth/callback', async (req, res) => {
  res.append('Set-Cookie', cookie(LOGIN_COOKIE, '', { maxAgeSeconds: 0, path: '/api/auth' }));
  if (!entraConfigured()) throw new HttpError(404, 'Sign-in with Microsoft is not set up');
  let pending: { state: string; nonce: string; verifier: string; returnTo: string };
  try {
    pending = JSON.parse(parseCookies(req.headers.cookie)[LOGIN_COOKIE] ?? '');
  } catch {
    return res.redirect(backToApp('/', 'expired'));
  }
  if (typeof req.query.error === 'string') return res.redirect(backToApp('/', 'cancelled'));

  let claims: oidc.IDToken;
  try {
    const cfg = await entra();
    const here = new URL(callbackUrl() + new URL(req.originalUrl, 'http://x').search);
    const tokens = await oidc.authorizationCodeGrant(cfg, here, {
      pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce, idTokenExpected: true,
    });
    claims = tokens.claims()!;
  } catch (err) {
    console.error('Microsoft sign-in failed:', (err as Error).message);
    return res.redirect(backToApp('/', 'failed'));
  }
  if (claims.tid !== config.entra.tenantId) return res.redirect(backToApp('/', 'wrong_tenant'));

  const oid = String(claims.oid ?? '');
  const emails = [claims.email, claims.preferred_username].filter((e): e is string => typeof e === 'string' && e.includes('@')).map((e) => e.toLowerCase());
  const name = typeof claims.name === 'string' ? claims.name : '';
  if (!oid || !emails.length) return res.redirect(backToApp('/', 'failed'));

  const userId = await findOrLinkUser(oid, emails, name);
  if (userId === 'inactive') return res.redirect(backToApp('/', 'inactive'));
  if (!userId) return res.redirect(backToApp('/', 'not_added'));
  setSessionCookie(res, await createSession(userId));
  res.redirect(backToApp(pending.returnTo));
});

/** Finds the user for a Microsoft account: by account id, then by email (linking it), then an ADMIN_EMAILS first sign-in. */
async function findOrLinkUser(oid: string, emails: string[], name: string): Promise<string | null | 'inactive'> {
  let [u] = await query('SELECT id, active FROM users WHERE entra_oid = $1', [oid]);
  if (!u) {
    [u] = await query('SELECT id, active, entra_oid FROM users WHERE lower(email) = ANY($1) ORDER BY entra_oid NULLS FIRST LIMIT 1', [emails]);
    if (u?.entraOid) return null; // that email belongs to a different Microsoft account
    if (u) await pool.query(`UPDATE users SET entra_oid = $2, name = CASE WHEN name = '' THEN $3 ELSE name END WHERE id = $1`, [u.id, oid, name]);
  }
  if (!u) {
    const adminEmail = emails.find((e) => config.adminEmails.includes(e));
    if (!adminEmail) return null;
    [u] = await query(
      `INSERT INTO users (email, name, role_id, entra_oid)
       SELECT $1, $2, id, $3 FROM roles WHERE is_admin ORDER BY built_in DESC, created_at LIMIT 1
       RETURNING id, active`,
      [adminEmail, name, oid],
    );
    if (!u) return null;
  }
  return u.active ? (u.id as string) : 'inactive';
}

// ---- development sign-in ------------------------------------------------------------

function requireDev(req: Request) {
  if (!devLoginAllowed(req)) throw new HttpError(404, `No endpoint for ${req.method} ${req.originalUrl}`);
}

authRoutes.get('/auth/dev/users', async (req, res) => {
  requireDev(req);
  const users = await query(
    `SELECT u.id, u.email, u.name, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.active ORDER BY u.name, u.email`,
  );
  const [{ n }] = (await query('SELECT count(*) AS n FROM users')) as [{ n: number }];
  res.json({ data: users, needsFirstAdmin: n === 0 });
});

const devLoginBody = z.union([
  z.strictObject({ userId: z.uuid() }),
  z.strictObject({ email: z.email().max(320), name: z.string().trim().max(200).optional() }),
]);

authRoutes.post('/auth/dev/login', async (req, res) => {
  requireDev(req);
  const body = devLoginBody.parse(req.body ?? {});
  let userId: string;
  if ('userId' in body) {
    const [u] = await query('SELECT id FROM users WHERE id = $1 AND active', [body.userId]);
    if (!u) throw new HttpError(404, 'User not found');
    userId = u.id as string;
  } else {
    const [{ n }] = (await query('SELECT count(*) AS n FROM users')) as [{ n: number }];
    if (n > 0) throw new HttpError(409, 'Users exist already; sign in as one of them');
    const [u] = await query(
      `INSERT INTO users (email, name, role_id) SELECT $1, $2, id FROM roles WHERE is_admin ORDER BY built_in DESC LIMIT 1 RETURNING id`,
      [body.email.toLowerCase(), body.name ?? ''],
    );
    userId = u!.id as string;
  }
  setSessionCookie(res, await createSession(userId));
  res.status(204).end();
});

// ---- session -------------------------------------------------------------------------

authRoutes.post('/auth/logout', async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

authRoutes.get('/auth/me', (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Please sign in');
  res.json({ data: { user: req.auth.user, permissions: req.auth.permissions, areas: AREAS } });
});
