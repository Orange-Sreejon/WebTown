-- WebTown Phase 4: profiles, worlds, membership, houses and everything a house owns.
-- See .kiro/specs/phase4-accounts/design.md. Every table with user or world data has RLS.
-- Guests (anonymous sign-ins) use the `authenticated` role, so every rule here applies to them exactly as to
-- permanent users. Nothing is granted to `anon`.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 40 and display_name !~ '[[:cntrl:]]'),
  avatar text not null default 'villager' check (avatar ~ '^[a-z0-9-]{1,32}$'),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60 and name !~ '[[:cntrl:]]'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'personal' check (kind in ('personal', 'shared')),
  town text not null default 'webtown-village' check (town ~ '^[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now()
);
create unique index worlds_one_personal_per_owner on public.worlds (owner_id) where kind = 'personal';

create table public.world_members (
  world_id uuid not null references public.worlds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'resident', 'visitor')),
  joined_at timestamptz not null default now(),
  primary key (world_id, user_id)
);
create index world_members_by_user on public.world_members (user_id);

create table public.houses (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.worlds (id) on delete cascade,
  -- The map slot this house stands on (an entrance of the town map), stable for the life of the world.
  slot text not null check (slot ~ '^[a-z0-9-]{1,40}$'),
  owner_id uuid,
  interior_template text not null default 'cozy-room' check (interior_template ~ '^[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now(),
  unique (world_id, slot),
  -- The owner must be a member of the house's world; leaving the world frees the house.
  foreign key (world_id, owner_id) references public.world_members (world_id, user_id) on delete set null (owner_id)
);
create unique index houses_one_per_owner_per_world on public.houses (world_id, owner_id) where owner_id is not null;
create index houses_by_owner on public.houses (owner_id) where owner_id is not null;

create table public.house_layouts (
  house_id uuid primary key references public.houses (id) on delete cascade,
  template_id text not null check (template_id ~ '^[a-z0-9-]{1,40}$'),
  schema_version int not null check (schema_version between 1 and 1000),
  -- The game validates a layout as a whole and items refer to each other; never queried item by item.
  items jsonb not null
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200 and octet_length(items::text) <= 65536),
  revision int not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.websites (
  house_id uuid primary key references public.houses (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  home_page text not null,
  css text not null default '' check (octet_length(css) <= 1000000),
  origin jsonb not null default '{"kind":"blank"}'::jsonb
    check (jsonb_typeof(origin) = 'object' and octet_length(origin::text) <= 1024),
  schema_version int not null default 1 check (schema_version = 1),
  revision int not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.website_pages (
  house_id uuid not null references public.websites (house_id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.html$'),
  html text not null check (octet_length(html) <= 1000000),
  position int not null check (position between 0 and 99),
  primary key (house_id, name)
);
create unique index website_pages_name_ci on public.website_pages (house_id, lower(name));

create table public.website_assets (
  id uuid primary key,
  house_id uuid not null references public.websites (house_id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(png|jpe?g|gif|webp|svg)$'),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml')),
  byte_size int not null check (byte_size between 1 and 5000000),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create unique index website_assets_name_ci on public.website_assets (house_id, lower(name));

create table public.artworks (
  id uuid primary key,
  house_id uuid not null references public.houses (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60 and title !~ '[[:cntrl:]]'),
  width int not null check (width between 1 and 1280),
  height int not null check (height between 1 and 1024),
  transparent boolean not null,
  byte_size int not null check (byte_size between 1 and 5000000),
  storage_path text not null unique,
  revision int not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index artworks_by_house on public.artworks (house_id, updated_at desc);

-- One row per item copied from a device into an account, so a repeated import never duplicates.
create table public.local_imports (
  user_id uuid not null references auth.users (id) on delete cascade,
  source_key text not null check (char_length(source_key) between 1 and 200),
  target_id uuid,
  imported_at timestamptz not null default now(),
  primary key (user_id, source_key)
);

-- ── Helpers (not exposed by the API) ────────────────────────────────────────

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();

-- Times as the app writes them: ISO 8601 in UTC with milliseconds, e.g. 2026-11-21T10:00:00.000Z.
create function private.iso(p_at timestamptz) returns text language sql immutable set search_path = '' as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create function private.is_world_member(
p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.world_members m where m.world_id = p_world and m.user_id = (select auth.uid()))
$$;

create function private.shares_world(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.world_members a join public.world_members b on b.world_id = a.world_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  )
$$;

create function private.owns_house(p_house uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.houses h where h.id = p_house and h.owner_id = (select auth.uid()))
$$;

create function private.can_view_house(p_house uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.houses h join public.world_members m on m.world_id = h.world_id
    where h.id = p_house and m.user_id = (select auth.uid())
  )
$$;

-- `{world}/{house}/{file}`: true when the path names a real house of that world that the caller may read
-- (`p_write` false) or owns (`p_write` true).
create function private.house_path_allows(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if array_length(parts, 1) is distinct from 3 or parts[1] !~ uuid_re or parts[2] !~ uuid_re
     or parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.png)?$' then
    return false;
  end if;
  return exists (
    select 1 from public.houses h
    where h.id = parts[2]::uuid and h.world_id = parts[1]::uuid
      and case when p_write then h.owner_id = (select auth.uid())
               else exists (select 1 from public.world_members m where m.world_id = h.world_id and m.user_id = (select auth.uid()))
          end
  );
end $$;

-- The folder a house's files live in.
create function private.house_folder(p_house uuid) returns text
language sql stable security definer set search_path = '' as $$
  select h.world_id::text || '/' || h.id::text || '/' from public.houses h where h.id = p_house
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.worlds enable row level security;
alter table public.world_members enable row level security;
alter table public.houses enable row level security;
alter table public.house_layouts enable row level security;
alter table public.websites enable row level security;
alter table public.website_pages enable row level security;
alter table public.website_assets enable row level security;
alter table public.artworks enable row level security;
alter table public.local_imports enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_world(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy worlds_read on public.worlds for select to authenticated using (private.is_world_member(id));
create policy worlds_rename_own on public.worlds for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy world_members_read on public.world_members for select to authenticated
  using (private.is_world_member(world_id));

create policy houses_read on public.houses for select to authenticated using (private.is_world_member(world_id));

create policy house_layouts_read on public.house_layouts for select to authenticated using (private.can_view_house(house_id));
create policy house_layouts_insert on public.house_layouts for insert to authenticated with check (private.owns_house(house_id));
create policy house_layouts_update on public.house_layouts for update to authenticated
  using (private.owns_house(house_id)) with check (private.owns_house(house_id));

create policy websites_read on public.websites for select to authenticated using (private.can_view_house(house_id));
create policy websites_insert on public.websites for insert to authenticated with check (private.owns_house(house_id));
create policy websites_update on public.websites for update to authenticated
  using (private.owns_house(house_id)) with check (private.owns_house(house_id));
create policy websites_delete on public.websites for delete to authenticated using (private.owns_house(house_id));

create policy website_pages_read on public.website_pages for select to authenticated using (private.can_view_house(house_id));
create policy website_pages_insert on public.website_pages for insert to authenticated with check (private.owns_house(house_id));
create policy website_pages_update on public.website_pages for update to authenticated
  using (private.owns_house(house_id)) with check (private.owns_house(house_id));
create policy website_pages_delete on public.website_pages for delete to authenticated using (private.owns_house(house_id));

create policy website_assets_read on public.website_assets for select to authenticated using (private.can_view_house(house_id));
create policy website_assets_insert on public.website_assets for insert to authenticated with check (private.owns_house(house_id));
create policy website_assets_update on public.website_assets for update to authenticated
  using (private.owns_house(house_id)) with check (private.owns_house(house_id));
create policy website_assets_delete on public.website_assets for delete to authenticated using (private.owns_house(house_id));

create policy artworks_read on public.artworks for select to authenticated using (private.can_view_house(house_id));
create policy artworks_insert on public.artworks for insert to authenticated with check (private.owns_house(house_id));
create policy artworks_update on public.artworks for update to authenticated
  using (private.owns_house(house_id)) with check (private.owns_house(house_id));
create policy artworks_delete on public.artworks for delete to authenticated using (private.owns_house(house_id));

create policy local_imports_own on public.local_imports for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Table privileges. Supabase grants everything on new tables to anon and authenticated by default; narrow it.
revoke all on public.profiles, public.worlds, public.world_members, public.houses, public.house_layouts,
  public.websites, public.website_pages, public.website_assets, public.artworks, public.local_imports from anon, public;
revoke all on public.profiles, public.worlds, public.world_members, public.houses, public.house_layouts,
  public.websites, public.website_pages, public.website_assets, public.artworks, public.local_imports from authenticated;
grant select on public.profiles, public.worlds, public.world_members, public.houses to authenticated;
grant update (display_name, avatar, settings) on public.profiles to authenticated;
grant update (name) on public.worlds to authenticated;
grant select, insert, update on public.house_layouts to authenticated;
grant select, insert, update, delete on public.websites, public.website_pages, public.website_assets, public.artworks to authenticated;
grant select, insert on public.local_imports to authenticated;

-- ── Functions the app calls ─────────────────────────────────────────────────

-- The map slots of the WebTown village. A new slot on the map is a new migration that changes this list;
-- `bootstrap_player` adds missing slots to existing worlds on the next start.
create function private.town_slots() returns text[] language sql immutable set search_path = '' as $$
  select array['house-a', 'house-b', 'house-c', 'house-d', 'house-e', 'house-f', 'house-g']
$$;
grant execute on function private.town_slots() to authenticated;

-- Creates (or finds) the caller's profile, personal world, membership, houses and their own house, all for
-- auth.uid() only. Safe to call on every start and from two tabs at once.
create function public.bootstrap_player(p_display_name text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  wid uuid;
  wanted text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if wanted is not null and (char_length(wanted) > 40 or wanted ~ '[[:cntrl:]]') then
    wanted := null;
  end if;

  insert into public.profiles (id, display_name)
  values (uid, coalesce(wanted, 'Resident ' || upper(substr(replace(uid::text, '-', ''), 1, 4))))
  on conflict (id) do nothing;

  select w.id into wid from public.worlds w where w.owner_id = uid and w.kind = 'personal';
  if wid is null then
    insert into public.worlds (name, owner_id, kind) values ('My WebTown', uid, 'personal')
    on conflict (owner_id) where kind = 'personal' do nothing
    returning id into wid;
    if wid is null then
      select w.id into wid from public.worlds w where w.owner_id = uid and w.kind = 'personal';
    end if;
  end if;

  insert into public.world_members (world_id, user_id, role) values (wid, uid, 'owner')
  on conflict (world_id, user_id) do nothing;

  insert into public.houses (world_id, slot)
  select wid, s from unnest(private.town_slots()) as s
  on conflict (world_id, slot) do nothing;

  -- Their house: house-a in their personal world, unless they already own one there.
  update public.houses h set owner_id = uid
  where h.world_id = wid and h.slot = 'house-a' and h.owner_id is null
    and not exists (select 1 from public.houses o where o.world_id = wid and o.owner_id = uid);

  return (
    select jsonb_build_object(
      'profile', (select jsonb_build_object('id', p.id, 'displayName', p.display_name, 'avatar', p.avatar,
                   'settings', p.settings, 'createdAt', private.iso(p.created_at)) from public.profiles p where p.id = uid),
      'world', (select jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind, 'town', w.town,
                 'role', m.role, 'createdAt', private.iso(w.created_at))
                from public.worlds w join public.world_members m on m.world_id = w.id and m.user_id = uid
                where w.id = wid),
      'houses', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'slot', h.slot, 'ownerId', h.owner_id,
                  'interiorTemplate', h.interior_template) order by h.slot), '[]'::jsonb)
                 from public.houses h where h.world_id = wid)
    )
  );
end $$;

create function public.update_profile(p_display_name text, p_avatar text, p_settings jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  update public.profiles p set
    display_name = coalesce(btrim(p_display_name), p.display_name),
    avatar = coalesce(p_avatar, p.avatar),
    settings = coalesce(p_settings, p.settings)
  where p.id = (select auth.uid())
  returning jsonb_build_object('id', p.id, 'displayName', p.display_name, 'avatar', p.avatar,
    'settings', p.settings, 'createdAt', private.iso(p.created_at)) into result;
  if result is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  return result;
end $$;

-- Furniture.
create function public.get_house_layout(p_house uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.can_view_house(p_house) then
    raise exception 'You cannot see this house.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('templateId', l.template_id, 'schemaVersion', l.schema_version,
            'items', l.items, 'revision', l.revision, 'updatedAt', private.iso(l.updated_at))
          from public.house_layouts l where l.house_id = p_house);
end $$;

create function public.save_house_layout(p_house uuid, p_base_revision int, p_template_id text,
  p_schema_version int, p_items jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  r int;
begin
  if not private.owns_house(p_house) then
    raise exception 'Only the owner of this house can change its furniture.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') is distinct from 'string'
       or jsonb_typeof(e -> 'type') is distinct from 'string' or jsonb_typeof(e -> 'at') is distinct from 'object'
  ) then
    raise exception 'The furniture layout is damaged.' using errcode = '22023';
  end if;

  if coalesce(p_base_revision, 0) = 0 then
    insert into public.house_layouts (house_id, template_id, schema_version, items, revision, updated_by)
    values (p_house, p_template_id, p_schema_version, p_items, 1, (select auth.uid()))
    on conflict (house_id) do nothing
    returning revision into r;
  else
    update public.house_layouts l set template_id = p_template_id, schema_version = p_schema_version,
      items = p_items, revision = l.revision + 1, updated_at = now(), updated_by = (select auth.uid())
    where l.house_id = p_house and l.revision = p_base_revision
    returning l.revision into r;
  end if;
  if r is null then
    raise exception 'This house''s furniture was changed somewhere else since you opened it.' using errcode = 'WTCON';
  end if;
  return jsonb_build_object('revision', r);
end $$;

-- Websites.
create function public.get_website(p_house uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.can_view_house(p_house) then
    raise exception 'You cannot see this house.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'title', w.title, 'homePage', w.home_page, 'css', w.css, 'origin', w.origin,
      'schemaVersion', w.schema_version, 'revision', w.revision, 'createdAt', private.iso(w.created_at), 'updatedAt', private.iso(w.updated_at),
      'pages', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'html', p.html) order by p.position), '[]'::jsonb)
                from public.website_pages p where p.house_id = w.house_id),
      'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'mimeType', a.mime_type,
                  'size', a.byte_size, 'path', a.storage_path) order by a.created_at, a.name), '[]'::jsonb)
                 from public.website_assets a where a.house_id = w.house_id)
    )
    from public.websites w where w.house_id = p_house
  );
end $$;

-- Replaces the house's website with `p_site` in one transaction, if it is still at `p_base_revision`
-- (0: there is none yet). New assets must already be uploaded to `{world}/{house}/{asset id}`. Returns the new
-- revision and the Storage paths of assets that are no longer used, for the caller to remove.
create function public.save_website(p_house uuid, p_base_revision int, p_site jsonb, p_import_key text default null)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  folder text;
  r int;
  pages jsonb := p_site -> 'pages';
  assets jsonb := p_site -> 'assets';
  page_count int;
  total bigint;
  removed text[];
  missing text;
begin
  if not private.owns_house(p_house) then
    raise exception 'Only the owner of this house can change its website.' using errcode = '42501';
  end if;
  folder := private.house_folder(p_house);

  if jsonb_typeof(pages) is distinct from 'array' or jsonb_typeof(assets) is distinct from 'array' then
    raise exception 'The website is damaged.' using errcode = '22023';
  end if;
  page_count := jsonb_array_length(pages);
  if page_count < 1 or page_count > 100 then
    raise exception 'A website has 1 to 100 pages.' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(pages) e where e ->> 'name' = p_site ->> 'homePage') then
    raise exception 'The homepage must be one of the pages.' using errcode = '22023';
  end if;
  if jsonb_array_length(assets) + page_count + 1 > 500 then
    raise exception 'A website can have at most 500 files.' using errcode = '22023';
  end if;
  select coalesce(sum(octet_length(e ->> 'html')), 0) + octet_length(coalesce(p_site ->> 'css', ''))
       + coalesce((select sum((a ->> 'size')::bigint) from jsonb_array_elements(assets) a), 0)
  into total from jsonb_array_elements(pages) e;
  if total > 50000000 then
    raise exception 'The website is larger than 50 MB.' using errcode = '22023';
  end if;
  -- Every asset is in this house's folder, under its own id, and its bytes are there.
  select a ->> 'name' into missing from jsonb_array_elements(assets) a
  where a ->> 'path' is distinct from folder || (a ->> 'id')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'website-assets' and o.name = a ->> 'path')
  limit 1;
  if missing is not null then
    raise exception '% was not uploaded. Try saving again.', missing using errcode = '22023';
  end if;

  if coalesce(p_base_revision, 0) = 0 then
    insert into public.websites (house_id, title, home_page, css, origin, revision)
    values (p_house, btrim(p_site ->> 'title'), p_site ->> 'homePage', coalesce(p_site ->> 'css', ''),
            coalesce(p_site -> 'origin', '{"kind":"blank"}'::jsonb), 1)
    on conflict (house_id) do nothing
    returning revision into r;
  else
    update public.websites w set title = btrim(p_site ->> 'title'), home_page = p_site ->> 'homePage',
      css = coalesce(p_site ->> 'css', ''), origin = coalesce(p_site -> 'origin', w.origin),
      revision = w.revision + 1, updated_at = now()
    where w.house_id = p_house and w.revision = p_base_revision
    returning w.revision into r;
  end if;
  if r is null then
    raise exception 'This website was saved somewhere else since you opened it.' using errcode = 'WTCON';
  end if;

  delete from public.website_pages p where p.house_id = p_house;
  insert into public.website_pages (house_id, name, html, position)
  select p_house, e.value ->> 'name', e.value ->> 'html', (e.ordinality - 1)::int
  from jsonb_array_elements(pages) with ordinality e;

  with gone as (
    delete from public.website_assets a
    where a.house_id = p_house
      and not exists (select 1 from jsonb_array_elements(assets) n where (n ->> 'id')::uuid = a.id)
    returning a.storage_path
  )
  select coalesce(array_agg(storage_path), '{}') into removed from gone;

  -- Renames first through a temporary name, so swapping two names cannot collide.
  update public.website_assets a set name = a.id::text || '.tmp.png'
  from jsonb_array_elements(assets) n
  where a.house_id = p_house and a.id = (n ->> 'id')::uuid and a.name <> n ->> 'name';
  update public.website_assets a set name = n ->> 'name'
  from jsonb_array_elements(assets) n
  where a.house_id = p_house and a.id = (n ->> 'id')::uuid and a.name <> n ->> 'name';
  insert into public.website_assets (id, house_id, name, mime_type, byte_size, storage_path)
  select (n ->> 'id')::uuid, p_house, n ->> 'name', n ->> 'mimeType', (n ->> 'size')::int, n ->> 'path'
  from jsonb_array_elements(assets) n
  where not exists (select 1 from public.website_assets a where a.id = (n ->> 'id')::uuid);

  if p_import_key is not null then
    insert into public.local_imports (user_id, source_key, target_id) values ((select auth.uid()), p_import_key, p_house)
    on conflict (user_id, source_key) do nothing;
  end if;

  return jsonb_build_object('revision', r, 'removedPaths', to_jsonb(removed),
    'updatedAt', (select private.iso(w.updated_at) from public.websites w where w.house_id = p_house),
    'createdAt', (select private.iso(w.created_at) from public.websites w where w.house_id = p_house));
end $$;

-- Sketchbook drawings.
create function public.list_artworks(p_house uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.can_view_house(p_house) then
    raise exception 'You cannot see this house.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'width', a.width,
            'height', a.height, 'transparent', a.transparent, 'byteSize', a.byte_size, 'path', a.storage_path,
            'revision', a.revision, 'createdAt', private.iso(a.created_at), 'updatedAt', private.iso(a.updated_at))
            order by a.updated_at desc, a.id), '[]'::jsonb)
          from public.artworks a where a.house_id = p_house);
end $$;

-- Creates (p_base_revision 0) or updates a drawing whose new PNG is already uploaded at p_path. Returns the
-- drawing's id and revision, and the path of the image it replaced (for the caller to remove).
create function public.save_artwork(p_house uuid, p_id uuid, p_base_revision int, p_title text, p_width int,
  p_height int, p_transparent boolean, p_byte_size int, p_path text, p_import_key text default null) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  folder text;
  aid uuid := p_id;
  old_path text;
  r int;
  existing uuid;
begin
  if not private.owns_house(p_house) then
    raise exception 'Only the owner of this house can change its Sketchbook.' using errcode = '42501';
  end if;
  folder := private.house_folder(p_house);
  if p_path is null or left(p_path, char_length(folder)) <> folder
     or not exists (select 1 from storage.objects o where o.bucket_id = 'artworks' and o.name = p_path) then
    raise exception 'The drawing was not uploaded. Try saving again.' using errcode = '22023';
  end if;

  if p_import_key is not null then
    select i.target_id into existing from public.local_imports i
    where i.user_id = (select auth.uid()) and i.source_key = p_import_key;
    if found then
      return jsonb_build_object('id', existing, 'duplicate', true);
    end if;
  end if;

  if coalesce(p_base_revision, 0) = 0 then
    perform pg_advisory_xact_lock(hashtextextended(p_house::text, 0));
    if (select count(*) from public.artworks a where a.house_id = p_house) >= 50 then
      raise exception 'A Sketchbook can hold 50 drawings. Delete one to start another.' using errcode = '22023';
    end if;
    aid := coalesce(p_id, gen_random_uuid());
    insert into public.artworks (id, house_id, title, width, height, transparent, byte_size, storage_path)
    values (aid, p_house, btrim(p_title), p_width, p_height, p_transparent, p_byte_size, p_path)
    on conflict (id) do nothing
    returning revision into r;
  else
    select a.storage_path into old_path from public.artworks a where a.id = p_id and a.house_id = p_house for update;
    update public.artworks a set title = btrim(p_title), width = p_width, height = p_height,
      transparent = p_transparent, byte_size = p_byte_size, storage_path = p_path,
      revision = a.revision + 1, updated_at = now()
    where a.id = p_id and a.house_id = p_house and a.revision = p_base_revision
    returning a.revision into r;
  end if;
  if r is null then
    raise exception 'This drawing was changed or deleted somewhere else since you opened it.' using errcode = 'WTCON';
  end if;

  if p_import_key is not null then
    insert into public.local_imports (user_id, source_key, target_id) values ((select auth.uid()), p_import_key, aid)
    on conflict (user_id, source_key) do nothing;
  end if;

  return (select jsonb_build_object('id', a.id, 'revision', a.revision, 'createdAt', private.iso(a.created_at),
            'updatedAt', private.iso(a.updated_at), 'oldPath', old_path, 'duplicate', false)
          from public.artworks a where a.id = aid);
end $$;

create function public.delete_artwork(p_house uuid, p_id uuid) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  gone text;
begin
  if not private.owns_house(p_house) then
    raise exception 'Only the owner of this house can change its Sketchbook.' using errcode = '42501';
  end if;
  delete from public.artworks a where a.id = p_id and a.house_id = p_house returning a.storage_path into gone;
  return jsonb_build_object('removedPath', gone);
end $$;

-- Which of these import keys the caller already has (so a repeated import skips them before uploading).
create function public.imported_keys(p_keys text[]) returns text[]
language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(i.source_key), '{}') from public.local_imports i
  where i.user_id = (select auth.uid()) and i.source_key = any (p_keys)
$$;

-- Records an import that needed no new row (for example a website that already existed in the account).
create function public.record_import(p_key text, p_target uuid) returns void
language sql volatile security invoker set search_path = '' as $$
  insert into public.local_imports (user_id, source_key, target_id) values ((select auth.uid()), p_key, p_target)
  on conflict (user_id, source_key) do nothing
$$;

-- Only signed-in users (guests included) may call the app's functions; never anon, never PUBLIC.
revoke all on function public.bootstrap_player(text), public.update_profile(text, text, jsonb),
  public.get_house_layout(uuid), public.save_house_layout(uuid, int, text, int, jsonb), public.get_website(uuid),
  public.save_website(uuid, int, jsonb, text), public.list_artworks(uuid),
  public.save_artwork(uuid, uuid, int, text, int, int, boolean, int, text, text), public.delete_artwork(uuid, uuid),
  public.imported_keys(text[]), public.record_import(text, uuid)
  from public, anon;
grant execute on function public.bootstrap_player(text), public.update_profile(text, text, jsonb),
  public.get_house_layout(uuid), public.save_house_layout(uuid, int, text, int, jsonb), public.get_website(uuid),
  public.save_website(uuid, int, jsonb, text), public.list_artworks(uuid),
  public.save_artwork(uuid, uuid, int, text, int, int, boolean, int, text, text), public.delete_artwork(uuid, uuid),
  public.imported_keys(text[]), public.record_import(text, uuid)
  to authenticated;
