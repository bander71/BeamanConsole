// Signed-in sessions and the middleware that checks every API request.
//
// The browser keeps a random token in an http-only cookie (scripts on the page
// can't read it). The database keeps only the token's SHA-256, so a copy of the
// database can't be used to sign in.

import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config.ts';
import { pool, query } from '../db.ts';
import { HttpError } from '../errors.ts';
import { type Action, type Area, AREAS, allows, can, loadPermissions, type Permissions, ruleFor } from './permissions.ts';

export const SESSION_COOKIE = 'bc_session';
const MAX_AGE_DAYS = 7;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  resourceId: string | null;
}

export interface AuthInfo {
  user: SessionUser;
  permissions: Permissions;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthInfo;
  }
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const secureCookies = () => config.appUrl.startsWith('https:');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore a malformed cookie
    }
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAgeSeconds?: number; path?: string } = {}): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secureCookies() ? ['Secure'] : []),
    ...(opts.maxAgeSeconds !== undefined ? [`Max-Age=${opts.maxAgeSeconds}`] : []),
  ].join('; ');
}

/** Starts a session for the user and returns the token to put in the cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hash(token), userId, config.sessionIdleHours],
  );
  await pool.query('UPDATE users SET last_sign_in_at = now() WHERE id = $1', [userId]);
  return token;
}

export function setSessionCookie(res: Response, token: string) {
  res.append('Set-Cookie', cookie(SESSION_COOKIE, token, { maxAgeSeconds: MAX_AGE_DAYS * 86400 }));
}

export async function endSession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
  res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAgeSeconds: 0 }));
}

/** Ends every session a user has (after they're turned off or their role changes). */
export async function endSessionsFor(userId: string) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

async function lookup(token: string): Promise<AuthInfo | null> {
  const [row] = await query(
    `SELECT s.token_hash, s.last_seen_at, u.id, u.email, u.name, u.role_id, u.resource_id, r.name AS role_name
     FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
       AND s.created_at > now() - make_interval(days => $2) AND u.active`,
    [hash(token), MAX_AGE_DAYS],
  );
  if (!row) return null;
  // Slide the idle timeout forward, at most once a minute.
  if (Date.now() - new Date(row.lastSeenAt as string).getTime() > 60_000) {
    await pool.query(
      `UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(hours => $2) WHERE token_hash = $1`,
      [row.tokenHash, config.sessionIdleHours],
    );
  }
  const user: SessionUser = {
    id: row.id as string, email: row.email as string, name: row.name as string,
    roleId: row.roleId as string, roleName: row.roleName as string, resourceId: (row.resourceId as string | null) ?? null,
  };
  return { user, permissions: await loadPermissions(user.roleId) };
}

/** Reads the session cookie and sets req.auth when it's a live session. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) req.auth = (await lookup(token)) ?? undefined;
  next();
};

/**
 * Refuses changes sent from other websites. The SameSite cookie already stops
 * most of these; this also checks the Origin header browsers send.
 */
export const sameOriginWrites: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (origin && origin !== new URL(config.appUrl).origin && origin !== `${req.protocol}://${req.get('host')}`) {
    throw new HttpError(403, 'Changes must come from the Beaman Console itself');
  }
  if (req.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Changes must come from the Beaman Console itself');
  next();
};

/** Checks the request against the endpoint rules in permissions.ts. Mount after authenticate. */
export const authorize: RequestHandler = (req, _res, next) => {
  const rule = ruleFor(req.method, req.path);
  if (rule?.kind === 'public') return next();
  if (!req.auth) throw new HttpError(401, 'Please sign in');
  if (!allows(req.auth.permissions, rule)) {
    throw new HttpError(403, rule?.kind === 'area' ? `Your role (${req.auth.user.roleName}) can't ${rule.action} ${areaLabel(rule.areas[0]!)}` : "Your role doesn't allow this");
  }
  next();
};

const areaLabel = (key: Area) => AREAS.find((a) => a.key === key)?.label ?? key;

/** For checks a route makes itself (e.g. "create" when a save makes a new record). */
export function requirePermission(req: Request, area: Area, action: Action) {
  if (!req.auth) throw new HttpError(401, 'Please sign in');
  if (!can(req.auth.permissions, area, action)) {
    throw new HttpError(403, `Your role (${req.auth.user.roleName}) can't ${action} ${areaLabel(area)}`);
  }
}

/**
 * Which records of an "own only" area the user may touch:
 * null = everyone's; otherwise only this resource's (a user with no linked resource gets '').
 * `widerAreas` lift the limit, e.g. Approvals lets a user read everyone's timesheets.
 */
export function ownScope(req: Request, area: Area, widerAreas: { area: Area; action: Action }[] = []): string | null {
  const p = req.auth?.permissions;
  if (!p || p.isAdmin) return null;
  if (widerAreas.some((w) => can(p, w.area, w.action))) return null;
  if (!p.areas[area]?.ownOnly) return null;
  return req.auth!.user.resourceId ?? '';
}

/** Records each change (and failed attempt) in audit_log. */
export const auditChanges = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    const u = req.auth?.user;
    pool
      .query('INSERT INTO audit_log (user_id, user_email, method, path, status) VALUES ($1, $2, $3, $4, $5)', [
        u?.id ?? null, u?.email ?? '', req.method, req.originalUrl.slice(0, 1000), res.statusCode,
      ])
      .catch((err) => console.error('audit_log:', err.message));
  });
  next();
};
