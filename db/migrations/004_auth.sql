-- Sign-in and roles.
--
-- People sign in with their Microsoft work account (Entra ID). An admin adds
-- each person under Users first; the first sign-in links the Microsoft account
-- (entra_oid) to that user by email.
--
-- Each user has one role. A role either is an admin role (everything, including
-- managing users and roles) or has a row per area of the app saying whether it
-- may create, read, update and delete there. `own_only` limits Timesheet and
-- Mileage to the user's own records (the resource linked to the user).
--
-- The built-in roles and their starting permissions are written by the server
-- (src/auth/permissions.ts, ensureDefaultRoles) so the list of areas lives in
-- one place.

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  is_admin     boolean NOT NULL DEFAULT false,
  built_in     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX roles_name_key ON roles (lower(name));
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE role_permissions (
  role_id     uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  area        text NOT NULL,
  can_create  boolean NOT NULL DEFAULT false,
  can_read    boolean NOT NULL DEFAULT false,
  can_update  boolean NOT NULL DEFAULT false,
  can_delete  boolean NOT NULL DEFAULT false,
  own_only    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, area)
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  name             text NOT NULL DEFAULT '',
  role_id          uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  -- The timesheet/mileage person this user is. Needed for "own records only".
  resource_id      uuid REFERENCES resources (id) ON DELETE SET NULL,
  entra_oid        text UNIQUE,
  active           boolean NOT NULL DEFAULT true,
  last_sign_in_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_resource_key ON users (resource_id) WHERE resource_id IS NOT NULL;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The browser holds a random token in an http-only cookie; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Every change made through the API: who, what and when.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  user_email  text NOT NULL DEFAULT '',
  method      text NOT NULL,
  path        text NOT NULL,
  status      integer NOT NULL
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
