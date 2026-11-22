# Phase 4: Accounts, Guest Identity and Persistence - Tasks

Each step leaves `npx tsc -b`, `npm test` and `npm run build` green and the app runnable. No commits without the
owner's approval. Status: all done, uncommitted. The live suite (
pm run test:live)
waits for a Supabase test project. Order changed from the brief: the schema comes before the auth code that calls it.

- [x] **T-01** Audit and spec (this folder); dependencies `@supabase/supabase-js` (runtime) and `@electric-sql/pglite` (dev).
- [x] **T-02** Schema, RLS, functions, Storage policies (`supabase/migrations/`); PGlite shim and RLS tests with
      several users.
- [x] **T-03** Auth foundation: config, ports, session controller, bootstrap, player context; session gate, start
      screen, account button and panel (sign up, log in, log out, upgrade, password, display name).
- [x] **T-04** World and house assignment in the game: ownership from the context; local mode unchanged.
- [x] **T-05** Furniture persistence: cloud layout store with CAS.
- [x] **T-06** Website persistence: cloud project repository (pages, CSS, assets in Storage).
- [x] **T-07** Sketchbook persistence: cloud artwork repository.
- [x] **T-08** Local import (idempotent, receipts, device marker).
- [x] **T-09** Integration: labels, failure paths, live suite, docs and steering; tsc, tests, build, audit.
