-- WebTown Phase 4: private buckets for website images and Sketchbook drawings, and who may touch which file.
-- Paths are `{world id}/{house id}/{file id}` (`.png` for drawings). Files are never overwritten: a new version
-- is a new file, swapped in by save_website / save_artwork, and the old one removed afterwards.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('website-assets', 'website-assets', false, 5000000,
   array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']),
  ('artworks', 'artworks', false, 5000000, array['image/png'])
on conflict (id) do nothing;

create policy "webtown: members read house files" on storage.objects for select to authenticated
  using (bucket_id in ('website-assets', 'artworks') and private.house_path_allows(name, false));

create policy "webtown: owners add house files" on storage.objects for insert to authenticated
  with check (bucket_id in ('website-assets', 'artworks') and private.house_path_allows(name, true));

create policy "webtown: owners remove house files" on storage.objects for delete to authenticated
  using (bucket_id in ('website-assets', 'artworks') and private.house_path_allows(name, true));
