-- WebTown Community Hall, CH-05: the Community Website's durable data. One shared draft every member edits in the
-- Site Studio, immutable numbered revisions, and the version visitors see, which only moderators publish.
-- See .kiro/specs/community-hall/design.md (sections 3, 4.3, 4.4).
--
-- - Revisions: every draft save is a new revision (1, 2, 3... per Hall). The draft is the newest one; saving is
--   compare-and-swap on its number (WTCON when someone else saved first). Publishing points at a revision a
--   moderator reviewed; publishing an older one is a rollback. Both are logged.
-- - Bounds: the newest 30 revisions and the 10 most recently published are kept; foreign keys make it impossible to
--   drop the draft or the published version. One revision is at most 3 MB as stored (pages, stylesheet, names).
-- - Images: bucket `community-assets`, `{world}/{image id}`. Members of the town upload new files (never overwrite)
--   and read them; a file may be removed only once no kept revision uses it (marked by the database on save).
-- - Every write goes through these security-definer functions; the tables have no client grants at all.
-- - Saves and publishes are announced as `{ kind, number }` on `hall:<uuid>`: a hint only, as on the canvas.

-- ── Tables ─────────────────────────────────────────────────────────────────────────────────────────────────

create table public.community_websites (
  world_id uuid primary key references public.community_halls (world_id) on delete cascade,
  -- The newest revision (the draft); null before the first save.
  draft_number int check (draft_number >= 1),
  published_number int check (published_number >= 1),
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  check ((published_number is null) = (published_at is null))
);

create table public.community_website_revisions (
  world_id uuid not null references public.community_websites (world_id) on delete cascade,
  number int not null check (number >= 1),
  -- Kept when the author leaves the town (shown as "a former member").
  author_id uuid references auth.users (id) on delete set null,
  -- { title, homePage, css, origin, pages: [{ name, html }], assets: [{ id, name, mimeType, size }] }, as checked by
  -- private.community_site.
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 3000000),
  created_at timestamptz not null default now(),
  last_published_at timestamptz,
  primary key (world_id, number)
);
create index community_website_revisions_published on public.community_website_revisions (world_id, last_published_at)
  where last_published_at is not null;

alter table public.community_websites
  add foreign key (world_id, draft_number) references public.community_website_revisions (world_id, number),
  add foreign key (world_id, published_number) references public.community_website_revisions (world_id, number);

-- Uploaded images, recorded when a save first uses them. Names live in each revision (renaming is per revision).
create table public.community_website_assets (
  id uuid primary key,
  world_id uuid not null references public.community_websites (world_id) on delete cascade,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml')),
  byte_size int not null check (byte_size between 1 and 5000000),
  storage_path text not null unique,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set when no kept revision uses it any more: from then on, members may remove the file from Storage.
  removed_at timestamptz
);
create index community_website_assets_by_world on public.community_website_assets (world_id) where removed_at is null;

alter table public.community_websites enable row level security;
alter table public.community_website_revisions enable row level security;
alter table public.community_website_assets enable row level security;
revoke all on public.community_websites, public.community_website_revisions, public.community_website_assets
  from anon, authenticated, public;

-- Every Hall has its website row (no revision yet); existing Halls are backfilled.
create function private.create_community_website() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.community_websites (world_id) values (new.world_id) on conflict (world_id) do nothing;
  return new;
end $$;

create trigger community_halls_create_website after insert on public.community_halls
for each row execute function private.create_community_website();

insert into public.community_websites (world_id) select h.world_id from public.community_halls h
on conflict (world_id) do nothing;

-- ── Storage ────────────────────────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-assets', 'community-assets', false, 5000000,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

-- Whether the caller may read, add or remove the file `p_name` in `community-assets`: it must be exactly
-- `{world}/{uuid}` of a town they are in; new files only where none was recorded; removal only once unused.
create function private.community_path_allows(p_name text, p_action text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  world uuid;
begin
  if p_name is null or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  world := split_part(p_name, '/', 1)::uuid;
  if not private.is_world_member(world) then
    return false;
  end if;
  if p_action = 'read' then
    return true;
  elsif p_action = 'add' then
    -- A file is never replaced: once an image id is recorded, its path takes no new upload.
    return not exists (select 1 from public.community_website_assets a where a.id = split_part(p_name, '/', 2)::uuid);
  elsif p_action = 'remove' then
    return exists (select 1 from public.community_website_assets a where a.storage_path = p_name and a.removed_at is not null);
  end if;
  return false;
end $$;

create policy "webtown: members read community files" on storage.objects for select to authenticated
  using (bucket_id = 'community-assets' and private.community_path_allows(name, 'read'));
create policy "webtown: members add community files" on storage.objects for insert to authenticated
  with check (bucket_id = 'community-assets' and private.community_path_allows(name, 'add'));
create policy "webtown: members remove unused community files" on storage.objects for delete to authenticated
  using (bucket_id = 'community-assets' and private.community_path_allows(name, 'remove'));

-- ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────

create function private.community_site_limit(p_what text) returns int language sql immutable set search_path = '' as $$
  select case p_what
    when 'keep' then 30            -- newest revisions kept
    when 'keep_published' then 10  -- most recently published revisions kept as well
    when 'stored' then 3000000     -- bytes of one revision as stored (the table's own bound)
  end
$$;

-- Checks a website from the Studio and returns it in the stored shape, with only the known fields. Raises 22023 with
-- a message for the player. The same rules as a house's website (save_website), plus the stored-size bound above.
create function private.community_site(p_site jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  pages jsonb := p_site -> 'pages';
  assets jsonb := p_site -> 'assets';
  title text := btrim(coalesce(p_site ->> 'title', ''));
  home text := p_site ->> 'homePage';
  css text := coalesce(p_site ->> 'css', '');
  origin jsonb := p_site -> 'origin';
  bad text;
  page_count int;
  text_bytes bigint;
  total bigint;
  result jsonb;
begin
  if jsonb_typeof(p_site) is distinct from 'object' or jsonb_typeof(pages) is distinct from 'array'
     or jsonb_typeof(assets) is distinct from 'array' or jsonb_typeof(p_site -> 'css') not in ('string', 'null') then
    raise exception 'The website is damaged.' using errcode = '22023';
  end if;
  if char_length(title) not between 1 and 60 or title ~ '[[:cntrl:]]' then
    raise exception 'The website needs a name of 1 to 60 characters.' using errcode = '22023';
  end if;
  page_count := jsonb_array_length(pages);
  if page_count < 1 or page_count > 100 then
    raise exception 'A website has 1 to 100 pages.' using errcode = '22023';
  end if;
  select coalesce(e ->> 'name', '?') into bad from jsonb_array_elements(pages) e
  where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'html') is distinct from 'string'
     or coalesce(e ->> 'name', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.html$' or octet_length(e ->> 'html') > 1000000
  limit 1;
  if bad is not null then
    raise exception 'The page % is damaged, badly named or too large.', bad using errcode = '22023';
  end if;
  if (select count(distinct lower(e ->> 'name')) from jsonb_array_elements(pages) e) <> page_count then
    raise exception 'Two pages have the same name.' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(pages) e where e ->> 'name' = home) then
    raise exception 'The homepage must be one of the pages.' using errcode = '22023';
  end if;
  if octet_length(css) > 1000000 then
    raise exception 'style.css is larger than 1 MB.' using errcode = '22023';
  end if;
  if jsonb_array_length(assets) + page_count + 1 > 500 then
    raise exception 'A website can have at most 500 files.' using errcode = '22023';
  end if;
  select coalesce(a ->> 'name', '?') into bad from jsonb_array_elements(assets) a
  where jsonb_typeof(a) <> 'object'
     or coalesce(a ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(a ->> 'name', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(png|jpe?g|gif|webp|svg)$'
     or coalesce(a ->> 'mimeType', '') not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml')
     -- (no cast before the format is known: SQL does not promise to read OR from the left)
     or jsonb_typeof(a -> 'size') is distinct from 'number'
     or case when (a ->> 'size') ~ '^[0-9]{1,7}$' then (a ->> 'size')::int not between 1 and 5000000 else true end
  limit 1;
  if bad is not null then
    raise exception 'The image % is damaged or not one WebTown can use.', bad using errcode = '22023';
  end if;
  if (select count(distinct lower(a ->> 'name')) from jsonb_array_elements(assets) a) <> jsonb_array_length(assets)
     or (select count(distinct a ->> 'id') from jsonb_array_elements(assets) a) <> jsonb_array_length(assets) then
    raise exception 'Two images have the same name.' using errcode = '22023';
  end if;
  select coalesce(sum(octet_length(e ->> 'html')), 0) + octet_length(css) into text_bytes from jsonb_array_elements(pages) e;
  select text_bytes + coalesce(sum((a ->> 'size')::bigint), 0) into total from jsonb_array_elements(assets) a;
  if total > 50000000 then
    raise exception 'The website is larger than 50 MB.' using errcode = '22023';
  end if;
  if jsonb_typeof(origin) is distinct from 'object' or octet_length(origin::text) > 1024 then
    origin := '{"kind":"blank"}'::jsonb;
  end if;
  result := jsonb_build_object(
    'title', title, 'homePage', home, 'css', css, 'origin', origin,
    'pages', (select jsonb_agg(jsonb_build_object('name', e.value ->> 'name', 'html', e.value ->> 'html') order by e.ordinality)
              from jsonb_array_elements(pages) with ordinality e),
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', a.value ->> 'id', 'name', a.value ->> 'name',
                 'mimeType', a.value ->> 'mimeType', 'size', (a.value ->> 'size')::int) order by a.ordinality), '[]'::jsonb)
               from jsonb_array_elements(assets) with ordinality a));
  if octet_length(result::text) > private.community_site_limit('stored') then
    raise exception 'The Community Website''s pages and style.css are too large together (at most about 3 MB).' using errcode = '22023';
  end if;
  return result;
end $$;

-- A revision as the app reads it: the stored website (with each image's Storage path) and who saved it when.
create function private.community_revision_json(r public.community_website_revisions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select r.content
    || jsonb_build_object(
      'assets', (select coalesce(jsonb_agg(a.value || jsonb_build_object('path', r.world_id::text || '/' || (a.value ->> 'id'))
                   order by a.ordinality), '[]'::jsonb)
                 from jsonb_array_elements(r.content -> 'assets') with ordinality a),
      'number', r.number, 'authorId', r.author_id, 'authorName', private.member_name(r.world_id, r.author_id),
      'savedAt', private.iso(r.created_at))
$$;

-- Best effort, as on the canvas: a hint on the Hall channel that something changed.
create function private.community_announce(p_world uuid, p_kind text, p_number int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('kind', p_kind, 'number', p_number), 'website', 'hall:' || p_world::text, true);
exception when others then
  null;
end $$;

-- ── Functions the app calls ────────────────────────────────────────────────────────────────────────────────

-- The draft, the published version, or one kept revision (`p_which` 'draft' | 'published' | 'revision'), with the
-- current draft and published numbers. Null when there is none (yet, or no longer kept).
create function public.get_community_website(p_world uuid, p_which text default 'draft', p_number int default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  w public.community_websites;
  wanted int;
  r public.community_website_revisions;
begin
  perform private.need_hall_member(p_world);
  select * into w from public.community_websites x where x.world_id = p_world;
  if p_which is null or p_which not in ('draft', 'published', 'revision') then
    raise exception 'That is not a version of the Community Website.' using errcode = '22023';
  end if;
  wanted := case p_which when 'draft' then w.draft_number when 'published' then w.published_number else p_number end;
  select * into r from public.community_website_revisions x where x.world_id = p_world and x.number = wanted;
  if r.number is null then
    return null;
  end if;
  return private.community_revision_json(r) || jsonb_build_object(
    'draftNumber', w.draft_number, 'publishedNumber', w.published_number, 'publishedAt', private.iso(w.published_at));
end $$;

-- Saves the shared draft as a new revision, if the draft is still the one this save started from (`p_base_number`;
-- 0 for none yet): otherwise WTCON. New images must already be uploaded to `{world}/{image id}`. Refused while
-- the draft is locked, except for moderators. Returns the new number and the Storage paths now unused (for the
-- caller to remove).
create function public.save_community_draft(p_world uuid, p_base_number int, p_site jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
  w public.community_websites;
  content jsonb;
  missing text;
  next_number int;
  removed text[];
  saved timestamptz;
begin
  if (select h.draft_locked from public.community_halls h where h.world_id = p_world) and not private.is_hall_moderator(p_world) then
    raise exception 'A moderator has locked the Community Website''s draft for now.' using errcode = '22023';
  end if;
  content := private.community_site(p_site);
  -- One save or publish at a time per Hall.
  select * into w from public.community_websites x where x.world_id = p_world for update;
  if coalesce(w.draft_number, 0) <> coalesce(p_base_number, -1) then
    raise exception 'Someone else saved the Community Website after you opened it.' using errcode = 'WTCON';
  end if;

  -- Images: ones already recorded must be this town's and still in use; new ones must have been uploaded here.
  select a ->> 'name' into missing from jsonb_array_elements(content -> 'assets') a
  left join public.community_website_assets x on x.id = (a ->> 'id')::uuid
  where (x.id is not null and (x.world_id <> p_world or x.removed_at is not null
                               or x.mime_type <> a ->> 'mimeType' or x.byte_size <> (a ->> 'size')::int))
     or (x.id is null and not exists (select 1 from storage.objects o where o.bucket_id = 'community-assets'
                                        and o.name = p_world::text || '/' || (a ->> 'id')))
  limit 1;
  if missing is not null then
    raise exception '% was not uploaded. Try saving again.', missing using errcode = '22023';
  end if;
  insert into public.community_website_assets (id, world_id, mime_type, byte_size, storage_path, uploaded_by)
  select (a ->> 'id')::uuid, p_world, a ->> 'mimeType', (a ->> 'size')::int, p_world::text || '/' || (a ->> 'id'), uid
  from jsonb_array_elements(content -> 'assets') a
  on conflict (id) do nothing;

  next_number := coalesce(w.draft_number, 0) + 1;
  insert into public.community_website_revisions (world_id, number, author_id, content)
  values (p_world, next_number, uid, content)
  returning created_at into saved;
  update public.community_websites x set draft_number = next_number where x.world_id = p_world;

  -- Keep the newest revisions, the recently published ones, the draft and the published version.
  delete from public.community_website_revisions r
  where r.world_id = p_world
    and r.number is distinct from next_number and r.number is distinct from w.published_number
    and r.number not in (select k.number from public.community_website_revisions k where k.world_id = p_world
                         order by k.number desc limit private.community_site_limit('keep'))
    and r.number not in (select k.number from public.community_website_revisions k where k.world_id = p_world
                           and k.last_published_at is not null
                         order by k.last_published_at desc limit private.community_site_limit('keep_published'));
  with unused as (
    update public.community_website_assets a set removed_at = now()
    where a.world_id = p_world and a.removed_at is null
      and not exists (select 1 from public.community_website_revisions r, jsonb_array_elements(r.content -> 'assets') x
                      where r.world_id = p_world and x ->> 'id' = a.id::text)
    returning a.storage_path
  )
  select coalesce(array_agg(storage_path), '{}') into removed from unused;

  perform private.community_announce(p_world, 'draft', next_number);
  return jsonb_build_object('number', next_number, 'savedAt', private.iso(saved), 'removedPaths', to_jsonb(removed));
end $$;

-- Moderators: visitors now see revision `p_number` (one a moderator reviewed). An older number than the one
-- published is a rollback. Logged; publishing the version already published changes nothing.
create function public.publish_community_website(p_world uuid, p_number int, p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.need_hall_member(p_world);
  w public.community_websites;
  stamp timestamptz := now();
begin
  if not private.is_hall_moderator(p_world) then
    raise exception 'Only moderators can publish the Community Website.' using errcode = '42501';
  end if;
  select * into w from public.community_websites x where x.world_id = p_world for update;
  if not exists (select 1 from public.community_website_revisions r where r.world_id = p_world and r.number = p_number) then
    raise exception 'That version of the Community Website is no longer kept.' using errcode = '22023';
  end if;
  if w.published_number = p_number then
    return jsonb_build_object('number', p_number, 'publishedAt', private.iso(w.published_at), 'changed', false);
  end if;
  update public.community_websites x set published_number = p_number, published_at = stamp, published_by = uid
  where x.world_id = p_world;
  update public.community_website_revisions r set last_published_at = stamp where r.world_id = p_world and r.number = p_number;
  perform private.log_moderation(p_world,
    case when w.published_number is not null and p_number < w.published_number then 'rollback' else 'publish' end,
    jsonb_build_object('number', p_number, 'previous', w.published_number), p_note);
  perform private.community_announce(p_world, 'published', p_number);
  return jsonb_build_object('number', p_number, 'publishedAt', private.iso(stamp), 'changed', true);
end $$;

-- The kept revisions, newest first, without their content.
create function public.list_community_revisions(p_world uuid, p_before int default null, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  w public.community_websites;
begin
  perform private.need_hall_member(p_world);
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Ask for 1 to 50 versions.' using errcode = '22023';
  end if;
  select * into w from public.community_websites x where x.world_id = p_world;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('number', r.number, 'authorId', r.author_id,
        'authorName', private.member_name(r.world_id, r.author_id), 'savedAt', private.iso(r.created_at),
        'lastPublishedAt', private.iso(r.last_published_at),
        'isDraft', r.number = w.draft_number, 'isPublished', r.number is not distinct from w.published_number)
      order by r.number desc), '[]'::jsonb)
    from (select * from public.community_website_revisions x
          where x.world_id = p_world and (p_before is null or x.number < p_before)
          order by x.number desc limit p_limit) r
  );
end $$;

-- ── Grants (S4: private helpers only where a policy needs them) ──────────────────────────────────────────────

revoke all on function private.create_community_website(), private.community_path_allows(text, text),
  private.community_site_limit(text), private.community_site(jsonb),
  private.community_revision_json(public.community_website_revisions), private.community_announce(uuid, text, int)
from public, anon, authenticated;
grant execute on function private.community_path_allows(text, text) to authenticated;

revoke all on function public.get_community_website(uuid, text, int), public.save_community_draft(uuid, int, jsonb),
  public.publish_community_website(uuid, int, text), public.list_community_revisions(uuid, int, int)
from public, anon;
grant execute on function public.get_community_website(uuid, text, int), public.save_community_draft(uuid, int, jsonb),
  public.publish_community_website(uuid, int, text), public.list_community_revisions(uuid, int, int)
to authenticated;
