# WebTown Website HTML/CSS Studio - Tasks

Each step leaves `npx tsc -b`, `npm test` and `npm run build` green. No commits without the owner's approval.
Status: all done, uncommitted, awaiting the owner's review.

- [x] **W-01** Spec (this folder) and dependency: CodeMirror 6 packages, exact versions, owner chunk only;
      `coding-standards.md` exception recorded.
- [x] **W-02** Domain, pure: `site-project/types`, `rules` (names, limits, asset signatures, `validateProject`),
      `html-check` (markup and brace checks, linear on hostile input), `page-history`; tests.
- [x] **W-03** Templates and migration, pure: Blank, Classic, `siteContentToProject` with escaping; tests with hostile
      strings and every legacy field.
- [x] **W-04** Builder, pure: `toRenderable`, `buildSitePage`; tests for every removal, rewrite and the shared
      stylesheet rule.
- [x] **W-05** Storage: `webtown` v2, `IdbDatabase.atomic` and `getAllByIndex`, memory and IndexedDB project
      repositories (one contract suite), `guardProjectWriter`, `resolveWebsite` and `websiteAccessFor` in
      `composition.ts`; v1 data preserved (tested against a v1 database).
- [x] **W-06** Sandbox runtime: `public/site-host.html`, `public/site-nav.html`, `host-protocol` guards, `SiteFrame`
      with the external-link bar and Stop; tests.
- [x] **W-07** Viewer: `SiteViewer`, `HouseWebsite`, new `WebsiteApp` (visitor and owner paths, none / migrated /
      damaged states); old renderer, form editor and `siteAccessFor` removed; boundary tests rewritten.
- [x] **W-08** Studio: reducer (`studio-state`), CodeMirror editor, pages, images, save and conflict, templates,
      dialogs, layouts and viewports, Ctrl+S, `beforeunload`; component tests (textarea editor injected) and CodeMirror
      tests in jsdom.
- [x] **W-09** Real-browser tests (`npm run test:e2e`, Playwright, three engines): the definition-of-done journey with
      a grid-based zine, isolation between houses, hostile-page checks against a beacon, and the visitor download
      boundary. Found and fixed: in-page `#name` links (written as `about:srcdoc#name`; WebKit limitation recorded).
- [x] **W-10** Docs: steering, `docs/TESTING.md`, `docs/site-sandbox-findings.md`, personal-spaces-mvp task status.
      Final tsc, tests, build, audit.
