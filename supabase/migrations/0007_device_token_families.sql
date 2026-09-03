-- Nexa — bounding a headset's refresh-token lifetime.
--
-- `device_tokens` has existed since 0005, unused by any code until now: one
-- row per issued refresh credential, with `replaced_by` already forming a
-- rotation chain. What that chain cannot do on its own is answer "when did
-- this family of tokens first begin" without walking it — `replaced_by`
-- only points forward, to whatever replaced a row, never backward to what
-- came before it. Every refresh needs that answer, to enforce a lifetime
-- that rotation is expressly forbidden from extending.
--
-- Two columns, both denormalised onto every row in a family rather than
-- read via a join, for the same reason `device_tokens.user_id` already is
-- — see 0005's own comment: "so the refresh path is a single row read on
-- the hot path." A family's root row is its own `family_id`; every
-- descendant copies the value unchanged, so revoking or measuring a whole
-- family is one indexed predicate, never a recursive walk.
--
-- No backfill: `device_tokens` has zero rows in production as of this
-- migration — confirmed immediately beforehand, read-only, the same way
-- every prior migration's precondition has been checked — so both columns
-- can be added `not null` directly.
--
-- 0001–0006 are untouched.

alter table public.device_tokens
  add column if not exists family_id text references device_tokens (id),
  add column if not exists family_issued_at timestamptz;

-- A two-step add (nullable, then not null) is unnecessary here specifically
-- because the table is empty — an ordinary `not null` addition against zero
-- rows never needs a default. Stated as two ALTERs anyway, matching the
-- self-documenting style the rest of this migration set uses, so a reader
-- does not have to already know the table was empty to see that this is
-- deliberate rather than incidental.
alter table public.device_tokens
  alter column family_id set not null,
  alter column family_issued_at set not null;

-- The absolute ceiling, enforced by the database and not only by whatever
-- application code happens to compute — the same belt-and-suspenders
-- reasoning `pairing_sessions_redeemed_check` already uses. No rotation, no
-- bug, no future code path can insert a row promising more than 90 days
-- from the family's own start; the constraint does not know or care how
-- `expires_at` was arrived at, only that it obeys the bound.
alter table public.device_tokens
  add constraint device_tokens_family_lifetime_check
    check (expires_at <= family_issued_at + interval '90 days');

-- "Revoke everything in this family" — the response to detecting a rotated
-- refresh token presented a second time (see PairingSessionStore's redeem
-- and the new refresh implementation). Partial on the live subset for the
-- same reason `device_tokens_device_idx` already is: a family already fully
-- revoked has nothing further this index needs to serve.
create index if not exists device_tokens_family_idx
  on device_tokens (family_id)
  where revoked_at is null;
