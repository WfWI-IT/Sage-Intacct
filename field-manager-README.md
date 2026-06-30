# WFWI Sage Intacct – Field Manager

A single embeddable script that declutters Intacct record pages by hiding selected fields, tables, sections, and tab panes for all users. It replaces the previous two-file approach (a loader that pulled in `sage-intacct-field-selector.js`, plus a separately generated "final field visibility script" pasted per page).

## TL;DR of the recommendation

Keep **one** hosted file (`field-manager.js`) that runs in two modes, and make each page carry only a tiny **config** instead of a full generated script:

- **Edit mode** – append `#fsedit` to the page URL and the Field Selector panel appears. Pick what to hide, click *Copy config*.
- **Runtime mode** – the page embed declares `window.WFWI_FS = { pageId, hide: [...] }`; the shared script reads it and hides those items for everyone.

Why this is better than generating a per-page logic script: all the *logic* lives in one version-controlled file, so a bug fix or improvement ships to every page by updating one file. Each page only stores *data* (the list of things to hide), which is short, readable, and easy to diff. The old model baked a full copy of the hiding logic into every page, so any logic change meant regenerating and re-pasting on every page — and the selector's discovery logic and the generated script's logic had already drifted apart (see below).

## Files

- `field-manager.js` — the unified script. Host it in the `WfWI-IT/Sage-Intacct` repo (you already do).
- `page-embed-template.html` — the per-page snippet to paste into each Intacct page (config + loader).
- `field-manager-README.md` — this document.

## How to deploy

1. Commit `field-manager.js` to the repo root and tag a release (e.g. `v0.4.0`).
2. On each page, paste **Block A** from `page-embed-template.html` with an empty `hide: []` and a `pageId`.
3. Open the page, add `#fsedit` to the URL, reload, tick fields, click *Copy config*.
4. Paste the copied `window.WFWI_FS` block over the placeholder, save, remove `#fsedit`, verify as a normal user.

To upgrade behaviour across **all** pages at once, bump the version in the loader's `SRC` (or just re-tag) — no page-by-page edits.

---

## Code review of the current scripts

### What's solid
The iframe-aware loader, the `.qxf-label` / `.form-group` / `.tab-pane` discovery, the checkbox/`one-option` empty handling, the noise-label filtering, and the dynamic "hide empty / show when filled" behaviour are all sound and clearly the product of real trial-and-error against Intacct's DOM. The unified script keeps all of that.

### Issues found and how the rewrite addresses them

**1. Logic duplicated between the selector and the generated script (the big one).**
The selector's `discoverFormFields` builds IDs like `fs_virtual_<label>_<index>`, while the generated script's `makeId` builds `fs_virtual_<label>` with no index — so the copy step had to inject alias keys (stripping the `_\d+` suffix) to make them match. That's a symptom of two code paths that must agree but can't easily be kept in sync. The rewrite has **one** `discover()` used by both modes, so the IDs are identical by construction.

**2. Fragile identity for tables and sections.**
The generated script keyed tables and sections by **DOM index** (`makeId('table_'+k)`, `makeId('section_'+m)`). If Intacct adds, removes, or reorders a panel — which it does between view/edit and across releases — the index shifts and the wrong element gets hidden. The rewrite keys everything by a stable, human-readable path: `field::<tab>::<label>`, `table::<label>`, `section::<label>`. No index dependence.

**3. Element-id dependence breaks across view vs. edit and across releases.**
Fields preferred `ctrl.id`, but Intacct ids are frequently auto-generated and differ between the view page and the edit page (and after upgrades). A field hidden on the view page wouldn't necessarily be hidden on the edit page. The rewrite identifies fields by **label within their tab**, which is stable across view/edit and is also what you actually see in the selector.

**4. The selector's MutationObserver wasn't debounced.**
`observer.observe(... runDiscoveryAndApply)` re-ran full discovery on *every* DOM mutation, and applying `display:none` itself mutates the DOM — a feedback loop on Intacct's busy pages. The rewrite debounces (200 ms) and **pauses the observer while it writes**, so it never reacts to its own changes.

**5. `hideEmpty` can hide fields users must fill in.**
On an edit form, hiding empty inputs hides the very fields someone is supposed to type into. The rewrite only applies `hideEmpty` when the page looks read-only (few editable controls), unless you explicitly set `hideEmptyInEditMode: true`.

**6. Grid tables weren't actually targeted at runtime.**
The generated script's table selector was `table.table, table.data-table, .table-responsive table`, but Intacct's line-item grids are `table.editor_grid` / `table.readonly_grid` (which the selector's snapshot helper *did* reference). So grids could appear in the picker but not be hidden at runtime. The rewrite includes the grid classes in both discovery and runtime.

**7. Page identity by `location.pathname` is unreliable.**
Many Intacct record pages share a pathname and differ only by query string, so `PAGE_KEY` could collide or be wrong. Since identity now comes from an explicit `pageId` you assign in the embed, there's no guessing. (`pageId` is mainly for clarity/labelling; the actual hiding is driven by the per-page `hide` list, which is already page-scoped because it lives in that page's embed.)

**8. Flash of unhidden content (FOUC).**
The old script applied on fixed `setTimeout`s (200 ms / 800 ms), so users saw fields appear then vanish. The rewrite dims the form container until the first apply completes, with a 1.2 s safety timeout so a page can never be left blank, and applies on first mutation rather than a fixed delay.

**9. Version drift.**
The loader requested `?v=0.3.6` while the file declared `v0.3.5`. The rewrite has a single `VERSION` constant shown in the panel and written into the copied config, and versioning is handled by the CDN tag in the loader.

### A note on delivery and security
Fetching `raw.githubusercontent.com` with `cache:"no-store"` on every page load, for every user, means a live runtime dependency on GitHub with no caching and rate limits — and any code in that file runs inside users' authenticated Intacct sessions. Two recommendations:

- Serve via **jsDelivr** (`https://cdn.jsdelivr.net/gh/WfWI-IT/Sage-Intacct@v0.4.0/field-manager.js`) instead of raw GitHub. It's a real CDN, versioned by tag/commit, cached, and lets the browser cache the file normally (the loader now uses `<script src>` rather than `fetch`).
- Treat the hosted file as production code: pin a tag for production (not `@main`), require PR review on the repo, and keep the repo access tight, since whoever can edit it can run JavaScript in everyone's Intacct session.

---

## Assumptions worth confirming in your environment

These match the class names already in your scripts, but verify on a couple of real pages (open the selector with `#fsedit` and check the picker looks right):

- Field rows are `.form-group` with labels in `.qxf-label` / `label`.
- Tabs are `.nav-tabs a` ↔ `.tab-pane` / `[role=tabpanel]`.
- Line-item grids are `table.editor_grid` / `table.readonly_grid`.
- The form renders in an iframe on at least some pages (the loader handles both cases).

If any page uses a different structure (e.g. a newer React-rendered page), open it in edit mode and tell me what the picker misses — discovery is centralized now, so adjustments are a one-file change.
