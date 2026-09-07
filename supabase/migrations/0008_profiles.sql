-- Nexa — user profile: what onboarding collects, once, about an account.
--
-- Authentication answers who is calling; this answers what Nexa has learned
-- about them. Exactly three fields exist because onboarding asks for exactly
-- three things — first name, username, date of birth — and nothing here
-- should accrete a fourth without a real product reason.
--
-- `user_id` is the primary key, not a separate id: an account has at most one
-- profile, ever, so there is nothing a second id would distinguish. Holds the
-- Supabase `auth.uid()` from a verified token's `sub`, exactly as every other
-- table's `user_id` does — no foreign key into `auth.users`, for the same
-- reason 0004 gives.
--
-- `completed_at` is the one source of truth for "has this account finished
-- onboarding" — not a separate boolean, which could only ever mean "all
-- three fields are set" and would then risk disagreeing with them. It is set
-- the moment all three first become non-null, and is never cleared
-- afterwards — see `profiles_completed_requires_all_fields_check` below and
-- the application code that sets it: a later edit (once an edit flow exists)
-- changes a field, not this account's onboarding history.
--
-- Nothing here is fabricated: every column starts null, stays null until the
-- account actually supplies it, and this table has no default that invents a
-- name, a handle, or a birth date.

create table if not exists profiles (
  user_id         text        primary key,

  first_name      text,
  username        text,
  date_of_birth   date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Null until first_name, username and date_of_birth are all set; see above.
  completed_at    timestamptz,

  constraint profiles_first_name_shape_check
    check (first_name is null or length(first_name) between 1 and 50),

  -- Mirrors the application's own username rule: 3-20 characters, starts
  -- with a letter, the rest letters/digits/underscore. Enforced here too —
  -- see the module doc on why client-side validation is never trusted alone
  -- for something a unique index also depends on being well-shaped.
  constraint profiles_username_shape_check
    check (username is null or username ~ '^[A-Za-z][A-Za-z0-9_]{2,19}$'),

  constraint profiles_completed_requires_all_fields_check
    check (completed_at is null
           or (first_name is not null and username is not null and date_of_birth is not null))
);

-- Case-insensitive uniqueness: the account's own casing is stored and shown
-- (see `first_name`/`username` above — no lower() applied to the stored
-- value itself), but two accounts may not register the same handle under
-- different capitalisation. Partial on `username is not null`, so the many
-- accounts that have not chosen one yet — all null — never collide with
-- each other.
create unique index if not exists profiles_username_ci_idx
  on profiles (lower(username))
  where username is not null;

-- Locked to the backend, exactly as every other table in this schema is.
-- Enabled with no policies: there is nothing a client should read here
-- directly, and the backend connects as the owner.
alter table public.profiles enable row level security;
