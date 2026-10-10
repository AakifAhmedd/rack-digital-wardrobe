# RACK — a digital wardrobe

RACK catalogs your clothes, shoes, accessories, and perfumes, tracks how often you actually wear each one, and works out what each item has really cost you per wear — so you know what's worth buying more of, and what's worth donating.

**Live app:** https://aakifahmedd.github.io/rack-digital-wardrobe/

## What it does

- **Categories & subcategories** — Pants, Shirts, Shoes, Outerwear, Accessories, and Perfumes ship with sensible subcategories out of the box. Add your own at any time; user-created categories work identically to the built-in ones.
- **Brands & colors** as first-class masters — an item's identity is built from Brand + Color + Subcategory (e.g. "Nike Black Running Shoes"), with everything else (model name, etc.) treated as secondary description.
- **Perfumes as a first-class category** — fragrance houses are brands, market tier (Designer / Niche / Middle Eastern / Local) is the subcategory, and scent family + concentration (EDT/EDP/Parfum/EDC/Oil) are tags scoped to Perfumes — so they match in activities exactly like clothing tags do. A perfume's card reads as *Brand + Perfume name* (e.g. "Tom Ford Black Orchid"), colour is optional, and the dashboard reports a separate **fragrance collection value** alongside your wardrobe value.
- **Duplicate bottle detection** — adding a perfume whose brand + name is already on your rack asks "Add another bottle" and carries over brand, name, scent family and concentration, instead of quietly creating a near-identical item. Retired bottles count too, so finishing a scent you love and buying it again months later is recognised as a re-buy and the new bottle inherits the old one's details.
- **Tags scoped to categories** — a tag like *Cargo* only shows up when tagging Pants; *Collared* only shows up for Shirts. You manage the tag list yourself in Settings › Masters.
- **Activities with a real rule engine** — instead of manually assigning every item to every activity, an activity like "Office Smart Casual" is defined as a set of category/subcategory/tag rules (with always-exclude rules for things like Shorts). Items are matched automatically. Two worked examples from the spec — *Office Smart Casual* and *Badminton* — ship configured out of the box.
- **Usage tracking** — log a wear with one tap; see most-worn and least-worn items, categories, and subcategories.
- **Donation prompts** — items with zero wears are surfaced on the dashboard with a nudge toward donating rather than reselling.
- **Cost per wear** — record what an item cost you; RACK divides by wear count and colour-codes it against your wardrobe average, so you can see which purchases earned their keep.
- **Perfume photos** — attach a photo to a perfume. On upload, transparent borders are trimmed and the image is centred on a 4:3 transparent frame so the whole bottle shows on the card; a zoom slider in the item form fine-tunes it. Photos live in the browser's IndexedDB (`js/photos.js`), never in `Store.state`, localStorage, `rack-wardrobe.json`, or the ordinary JSON backup. Explicit cloud Push/Pull transfers them in a separate `rack-photos.json` file. Settings → Backup → *Download photos* / *Restore photos* still provides an independent, additive photo backup.
- **Installable (PWA)** — a web manifest and a network-first service worker (`sw.js`) let you add RACK to your home screen; the cache is only an offline fallback, so updates always win when online. Home-screen shortcuts open Outfit and Wardrobe directly.
- **Finished vs. donated** — perfumes retire as *Finished* rather than *Donated*, since a used-up bottle isn't a donation. Bottles are collected, so "used up" and "empty" are the same event and only one option is offered.

## Architecture & why

This is a plain HTML/CSS/JS app — no build step, no framework — which keeps it easy to host on GitHub Pages and easy to modify.

**Storage.** The spec calls for access "from multiple devices, whenever and wherever." A static site can't run its own database, and standing up a hosted backend was out of scope for "very basic and practical." So RACK uses:
- **`localStorage`** as the fast, always-available local store (works offline, zero setup).
- **Optional sync via a private GitHub Gist**, using a personal access token *you* generate and paste into Settings. It's stored only in that browser's `localStorage` and calls the GitHub API directly from the client — RACK's own source code never contains or receives your token. Add the same token + Gist ID on a second device and it pulls the same data. This is genuinely cross-device, adds no server for anyone to run, and costs nothing.
- **Export/Import JSON** is always available as a manual backup path, independent of the Gist sync.

**Master data vs. item data.** Categories, subcategories, tags, brands, colors, and activity rules are stored separately from individual items, so editing a master (renaming a tag, adjusting an activity's rules) doesn't require touching every item that uses it.

**No pre-populated items.** Only the master lists ship with defaults. Your wardrobe starts empty, as it should.

## Using it

1. **Settings › Masters** → check the default categories/tags/activities, add your own brands and any categories you're missing.
2. **Wardrobe** → *Add item*, pick category → subcategory → brand → color → tags, optionally record cost.
3. Tap **+1 Worn** each time you wear something. That's the whole loop.
4. **Dashboard** shows what's earning its keep and what's been sitting unused.
5. **Settings › General** → appearance, optional cloud sync, JSON backup/restore (plus a separate photo backup), currency symbol.

## Setting up cloud sync (optional)

1. On GitHub, go to Settings → Developer settings → Personal access tokens → generate one with the **`gist`** scope only.
2. In RACK's Settings tab, paste it into "GitHub personal access token" and click **Push to cloud** — this creates a private Gist containing both `rack-wardrobe.json` and `rack-photos.json` and remembers its ID.
3. On another device, open RACK, paste the *same* token and Gist ID into Settings, and click **Pull from cloud**.

Explicit **Push** uploads the current wardrobe and the complete photo snapshot together in one Gist create/update request. Explicit **Pull** reads both files from the same Gist revision, uses the existing wardrobe replacement path, then replaces IndexedDB photos in one transaction. Only photos for items in the pulled wardrobe are restored. Photos absent from the snapshot are deleted locally, including when the snapshot is empty; items without photos remain valid. The latest successful Push/Pull snapshot wins, with the existing wardrobe conflict choice when both devices have wardrobe changes. There is no per-photo merge or conflict dialog.

Background checks on app open/resume continue to auto-pull **wardrobe data only**. They never export, restore, or delete photos. Failed manual actions require another explicit Push/Pull; they do not retry photo transfers on a timer.

Older Gists containing only `rack-wardrobe.json` still pull successfully, keep local photos, and show a warning that no remote photos were available. Unreadable or unsupported photo snapshots also keep local photos and report a warning while allowing the wardrobe pull. Photo payloads must use `format: "rack-photos"`, `version: 1`, and an object of item IDs to base64 WebP/PNG/JPEG data URLs. Entries for unknown items or invalid images are skipped and reported; skipped entries are absent from the applied snapshot. Storage failures roll back the entire photo transaction, leaving previous photos intact; the pulled wardrobe remains usable. Wardrobe and photo storage use different browser storage systems, so they cannot share one atomic transaction.

Large Gist files are retrieved from their revision-specific raw URL when [GitHub truncates API content](https://docs.github.com/en/rest/gists/gists#truncation). Raw file requests never include the token. Your token never leaves your browser except to call `api.github.com` directly, and it's never committed to this repository.

## Versioning

The live version shows in the header next to the RACK wordmark. It's read at load time from the plain-text `VERSION` file at the repo root (one line, no build step) and rendered as `v<number>`.

Every commit bumps `VERSION`. The full rules (what to bump, the step-by-step procedure, and the separate `?v=` cache-busting token) are in [`VERSIONING.md`](VERSIONING.md), written so that any developer or AI tool can follow them.

`.nojekyll` is present so GitHub Pages serves the site as-is (no Jekyll processing).

## Local development

No build step. Serve the folder with any static server and open `index.html`:

```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

Open `http://localhost:8000/tests/sync.html` for the zero-dependency browser
regression checks. These use a mocked Gist API, isolated localStorage and
temporary IndexedDB databases, exercising photo transfer/deletion, old Gists,
malformed payloads, rollback, wardrobe conflicts and additive manual Restore.
They never read your real wardrobe, use credentials or contact GitHub.

## Structure

```
index.html        entry point
VERSION            displayed app version (plain text, one line)
VERSIONING.md      rules for bumping the version
css/style.css      design system
js/data.js         default master data + localStorage persistence
js/sync.js         optional GitHub Gist cloud sync
js/photos.js       local item photos (IndexedDB), trim/pad/zoom, backup and snapshot sync
js/brand-logos.js  brand logo registry
sw.js              service worker (offline fallback)
manifest.webmanifest  PWA manifest
icons/             app icons
js/app.js          rule engine, rendering, all app logic
```
