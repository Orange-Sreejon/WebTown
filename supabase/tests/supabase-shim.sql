-- TEST ONLY. The parts of a Supabase database that WebTown's migrations rely on, so they can be applied to a
-- plain PostgreSQL (PGlite) and their RLS exercised with real roles. Never applied to a real project.
--
-- Mirrors Supabase in the ways that matter for security:
-- - roles `anon`, `authenticated`, `service_role` (bypasses RLS);
-- - auth.uid() and auth.jwt() read the request's JWT claims (`request.jwt.claims`), as PostgREST sets them;
-- - default privileges give anon and authenticated everything on new objects in `public`, as Supabase does,
--   so a migration that forgets to revoke is caught by the tests;
-- - storage.objects has RLS enabled and no policies until a migration adds them.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text unique,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz not null default now(),
  metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare
  parts text[] := string_to_array(name, '/');
begin
  return parts[1:array_length(parts, 1) - 1];
end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Realtime (Phase 5): private channels are authorised by RLS on realtime.messages, read with the channel's topic
-- in `realtime.topic`, as Supabase Realtime does when a user joins a private channel.
create schema realtime;
create table realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default true,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;
grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to anon, authenticated, service_role;
grant usage on sequence realtime.messages_id_seq to anon, authenticated, service_role;
grant execute on function realtime.topic() to anon, authenticated, service_role;

-- realtime.send (CH-03): how the database itself broadcasts on a channel. Supabase's version writes a broadcast row to
-- realtime.messages, which Realtime delivers; this one writes the same row, so tests can see what was announced.
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language sql volatile as $$
  insert into realtime.messages (topic, extension, payload, event, private) values ($3, 'broadcast', $1, $2, $4)
$$;
