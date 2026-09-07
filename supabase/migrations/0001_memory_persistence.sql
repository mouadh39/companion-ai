-- Nexa — durable memory.
--
-- Four tables, one rule: every row is owned by a (companion_id, user_id) pair
-- and no read is expressible without both. The cross-user leak this replaces
-- was a Map keyed on the companion alone, so the constraint is deliberately in
-- the schema rather than only in the application.
--
-- No foreign keys to users/companions yet: there is no authentication, so
-- there is no users table to point at. Adding one now would invent an identity
-- model ahead of the step that earns it.

-- ── long-term memory ────────────────────────────────────────────────────────
create table if not exists memories (
  id                    text primary key,
  companion_id          text not null,
  user_id               text not null,

  type                  text not null,
  subject               text not null,
  content               text not null,
  created_at            timestamptz not null,
  importance            double precision not null,
  confidence            double precision not null,
  valence               double precision not null,
  source                text not null,

  -- Expiry is a reason to stop retrieving, never a delete. Nullable means
  -- "never expires".
  expires_at            timestamptz,
  reinforcement_count   integer not null default 0,
  last_reinforced_at    timestamptz,

  tags                  jsonb not null default '[]'::jsonb,
  related_to            jsonb not null default '[]'::jsonb,

  -- Step 3 fills these. Null until a memory has been embedded, which is the
  -- domain's existing "readable before searchable" gap made physical. No
  -- vector column and no pgvector yet, on purpose.
  embedding_vector_id   text,
  embedding_model       text,
  embedding_dimensions  integer,
  embedding_at          timestamptz,

  metadata              jsonb not null default '{}'::jsonb
);

-- Candidate generation is "this owner's most recent N".
create index if not exists memories_owner_recent_idx
  on memories (companion_id, user_id, created_at desc);

create index if not exists memories_owner_expiry_idx
  on memories (companion_id, user_id, expires_at);

-- ── reflection output ───────────────────────────────────────────────────────
create table if not exists insights (
  id                    text primary key,
  companion_id          text not null,
  user_id               text not null,

  key                   text not null,
  kind                  text not null,
  topic_key             text not null,
  topic                 text not null,
  polarity              text not null,
  statement             text not null,
  status                text not null,
  certainty             text not null,
  confidence            double precision not null,
  evidence_confidence   double precision not null,
  stability             double precision not null,

  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  last_supported_at     timestamptz not null,
  expires_at            timestamptz,

  revision              integer not null default 0,
  supersedes            text,
  superseded_by         text,

  -- Bounded, nested, never filtered on. Columns would buy nothing.
  supporting            jsonb not null default '[]'::jsonb,
  opposing              jsonb not null default '[]'::jsonb,
  history               jsonb not null default '[]'::jsonb,
  retirement            jsonb,
  provenance            jsonb not null default '{}'::jsonb
);

create index if not exists insights_owner_status_idx
  on insights (companion_id, user_id, status);

-- `key` is `kind:topicKey`, documented as unique among a user's *live*
-- insights. Retired and superseded rows stay readable as history, so the
-- constraint is partial rather than total.
create unique index if not exists insights_owner_live_key_idx
  on insights (companion_id, user_id, key)
  where status in ('active', 'contested');

-- ── the pair record ─────────────────────────────────────────────────────────
create table if not exists relationships (
  id                    text primary key,
  companion_id          text not null,
  user_id               text not null,

  type                  text not null,
  dimensions            jsonb not null,
  interaction_count     integer not null default 0,
  first_met_at          timestamptz not null,
  last_interaction_at   timestamptz not null,
  inferred_style        text,
  boundaries            jsonb not null default '[]'::jsonb,
  counters              jsonb not null,
  metadata              jsonb not null default '{}'::jsonb
);

-- One record per pair. This replaces the `${companionId}:${userId}` string key,
-- which collides whenever an id contains the separator.
create unique index if not exists relationships_owner_idx
  on relationships (companion_id, user_id);

-- ── working memory ──────────────────────────────────────────────────────────
create table if not exists conversation_turns (
  id                    bigserial primary key,
  companion_id          text not null,
  user_id               text not null,

  role                  text not null,
  content               text not null,
  at                    timestamptz not null
);

-- The only read is "this owner's last N, oldest first". The cap that used to
-- trim the array on write is now a LIMIT on read.
create index if not exists conversation_turns_owner_idx
  on conversation_turns (companion_id, user_id, id desc);
