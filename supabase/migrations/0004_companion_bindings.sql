-- Nexa — which account may act as which companion.
--
-- The second half of the authentication boundary. A verified `user_id` alone
-- makes memory safe, because every memory query already filters on it. Body
-- state does not: it is keyed on the companion alone, since one companion has
-- one body, so without this a correctly authenticated person could still post
-- action outcomes to somebody else's character.
--
-- `CompanionBinding` has been in the domain model since before authentication
-- existed, documented for exactly this — "the same person may eventually have a
-- companion on their glasses and another at their desk with different
-- histories". This is that join made physical.
--
-- ## Why the account is not a foreign key yet
--
-- `user_id` holds the Supabase `auth.uid()` of the account. It is deliberately
-- not `references auth.users(id)`: `auth` is Supabase's schema, and a hard
-- foreign key into it couples this migration to a platform detail that a
-- self-hosted or migrated deployment would not have. The application already
-- treats the verified subject as authoritative, and the uniqueness constraint
-- below is what actually prevents two accounts claiming one companion.

create table if not exists companion_bindings (
  user_id       text        not null,
  companion_id  text        not null,

  bound_at      timestamptz not null default now(),

  -- False when the user has paused this companion without deleting it. Reads
  -- filter on it, so pausing is a real revocation rather than a decoration.
  active        boolean     not null default true,

  primary key (user_id, companion_id)
);

-- One companion belongs to one account. Without this, two people could each
-- hold a binding to the same body and both be told they are allowed to move it.
-- Partial, so a released companion can be re-bound to someone else later.
create unique index if not exists companion_bindings_one_owner_idx
  on companion_bindings (companion_id)
  where active;

-- The read every authenticated request performs: "may this user act as this
-- companion?" It runs before any cognitive work, so it must be an index hit.
create index if not exists companion_bindings_user_idx
  on companion_bindings (user_id)
  where active;

-- Locked to the backend, exactly as the memory tables are. Enabled with no
-- policies: there is nothing a client should read here directly, and the
-- backend connects as the owner. When the backend stops being the owner — see
-- 0002 — this table needs a policy alongside the others.
alter table public.companion_bindings enable row level security;
