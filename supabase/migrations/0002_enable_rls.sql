-- Nexa — lock the memory tables to the backend.
--
-- Without this, every row is reachable by the `anon` and `authenticated` roles
-- through PostgREST: anyone holding the project's publishable key could read or
-- rewrite another person's memories. That is the same cross-user exposure Step 1
-- closed inside the process, arriving by a different door.
--
-- Enabled with **no policies**, deliberately. A policy grants access, and there
-- is nobody to grant it to yet: authentication does not exist, so there is no
-- `auth.uid()` to match a row against. RLS with no policy denies every role it
-- applies to, which is exactly the intent — the only client is the backend, and
-- the backend connects as the tables' owner, which bypasses RLS.
--
-- When authentication lands, this is where per-user policies go, and at that
-- point the backend should stop being the owner and start being a role these
-- policies actually constrain.

alter table public.memories            enable row level security;
alter table public.insights            enable row level security;
alter table public.relationships       enable row level security;
alter table public.conversation_turns  enable row level security;
