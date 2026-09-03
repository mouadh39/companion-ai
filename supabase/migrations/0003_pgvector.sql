-- Nexa — semantic memory.
--
-- Additive and nullable throughout. A memory exists and is readable before it
-- is searchable, which is the gap `Memory.embedding` has modelled since before
-- there was a database; this migration is where that gap becomes physical.
-- Nothing here changes what an existing row means or how it is retrieved.
--
-- 1536 dimensions: `text-embedding-3-small`. Under pgvector's 2000-dimension
-- HNSW ceiling, so no `halfvec` indirection is needed. The dimension is fixed
-- in the column type, so a model change with a different width is a migration
-- rather than a silent corruption — which is exactly why
-- `EmbeddingReference.dimensions` is compared before any cosine is taken.

create extension if not exists vector with schema extensions;

alter table public.memories
  add column if not exists embedding extensions.vector(1536);

-- HNSW over cosine distance, matching the metric `@nexa/retrieval` already uses
-- in `cosine()`. ivfflat would need a populated table to build sensible lists;
-- HNSW builds incrementally and is the right default for a table that grows one
-- memory at a time.
--
-- Deliberately NOT a per-owner partial index. Ownership is enforced by the
-- predicate in the query, and one index per user does not scale. pgvector 0.8's
-- iterative scans are what make a filtered ANN return a full result set instead
-- of quietly under-returning once another user's vectors occupy the top k.
create index if not exists memories_embedding_hnsw_idx
  on public.memories
  using hnsw (embedding extensions.vector_cosine_ops);

-- The ownership predicate every semantic query carries. Present already for the
-- recency path; restated here because the vector query depends on it being
-- cheap enough that the planner will actually apply it alongside the ANN.
create index if not exists memories_owner_embedded_idx
  on public.memories (companion_id, user_id)
  where embedding is not null;
