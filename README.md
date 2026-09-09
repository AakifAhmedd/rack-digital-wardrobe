# RACK — a digital wardrobe

RACK catalogs your clothes, shoes, and accessories, tracks how often you actually wear each one, and works out what each item has really cost you per wear — so you know what's worth buying more of, and what's worth donating.

**Live app:** https://aakifahmedd.github.io/rack-digital-wardrobe/

## What it does

- **Categories & subcategories** — Pants, Shirts, Shoes, Outerwear, and Accessories ship with sensible subcategories out of the box. Add your own at any time; user-created categories work identically to the built-in ones.
- **Brands & colors** as first-class masters — an item's identity is built from Brand + Color + Subcategory (e.g. "Nike Black Running Shoes"), with everything else (model name, etc.) treated as secondary description.
- **Tags scoped to categories** — a tag like *Cargo* only shows up when tagging Pants; *Collared* only shows up for Shirts. You manage the tag list yourself in Masters.
- **Activities with a real rule engine** — instead of manually assigning every item to every activity, an activity like "Office Smart Casual" is defined as a set of category/subcategory/tag rules (with always-exclude rules for things like Shorts). Items are matched automatically. Two worked examples from the spec — *Office Smart Casual* and *Badminton* — ship configured out of the box.
- **Usage tracking** — log a wear with one tap; see most-worn and least-worn items, categories, and subcategories.
- **Donation prompts** — items with zero wears are surfaced on the dashboard with a nudge toward donating rather than reselling.
- **Cost per wear** — record what an item cost you; RACK divides by wear count and colour-codes it against your wardrobe average, so you can see which purchases earned their keep.

## Architecture & why

This is a plain HTML/CSS/JS app — no build step, no framework — which keeps it easy to host on GitHub Pages and easy to modify.

**Storage.** The spec calls for access "from multiple devices, whenever and wherever." A static site can't run its own database, and standing up a hosted backend was out of scope for "very basic and practical." So RACK uses:
- **`localStorage`** as the fast, always-available local store (works offline, zero setup).
- **Optional sync via a private GitHub Gist**, using a personal access token *you* generate and paste into Settings. It's stored only in that browser's `localStorage` and calls the GitHub API directly from the client — RACK's own source code never contains or receives your token. Add the same token + Gist ID on a second device and it pulls the same data. This is genuinely cross-device, adds no server for anyone to run, and costs nothing.
- **Export/Import JSON** is always available as a manual backup path, independent of the Gist sync.

**Master data vs. item data.** Categories, subcategories, tags, brands, colors, and activity rules are stored separately from individual items, so editing a master (renaming a tag, adjusting an activity's rules) doesn't require touching every item that uses it.

**No pre-populated items.** Only the master lists ship with defaults. Your wardrobe starts empty, as it should.

## Using it

1. **Masters** → check the default categories/tags/activities, add your own brands and any categories you're missing.
2. **Wardrobe** → *Add item*, pick category → subcategory → brand → color → tags, optionally record cost.
3. Tap **+1 Worn** each time you wear something. That's the whole loop.
4. **Dashboard** shows what's earning its keep and what's been sitting unused.
5. **Settings** → optional cloud sync, JSON backup/restore, currency symbol.

## Setting up cloud sync (optional)

1. On GitHub, go to Settings → Developer settings → Personal access tokens → generate one with the **`gist`** scope only.
2. In RACK's Settings tab, paste it into "GitHub personal access token" and click **Push to cloud** — this creates a private Gist and remembers its ID.
3. On another device, open RACK, paste the *same* token and Gist ID into Settings, and click **Pull from cloud**.

Your token never leaves your browser except to call `api.github.com` directly, and it's never committed to this repository.

## Local development

No build step. Serve the folder with any static server and open `index.html`:

```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

## Structure

```
index.html        entry point
css/style.css      design system
js/data.js         default master data + localStorage persistence
js/sync.js         optional GitHub Gist cloud sync
js/app.js          rule engine, rendering, all app logic
```
