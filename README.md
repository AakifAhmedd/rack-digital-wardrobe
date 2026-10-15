# RACK — a digital wardrobe

RACK is a personal wardrobe and collections tracker. It helps you keep track of what you own, what you wear, and how your collection changes over time.

**Live app:** https://aakifahmedd.github.io/rack-digital-wardrobe/

## What it does

- Catalog clothes, shoes, accessories, and perfumes with custom categories, brands, colors, tags, and notes.
- Log clothing wears and outfits, review dated wear history, and see cost per wear and monthly wardrobe insights.
- Build activities from item rules and use them to find outfit options.
- Keep a separate Bookshelf for books, reading history, and summaries. Perfumes and Bookshelf can be hidden on a device without deleting their records.
- Add photos and brand logos. Photos stay in that browser unless included in an explicit sync or photo backup.
- Install RACK as a progressive web app and use it offline after the app has loaded.

## Getting started

Open the live app, add any brands or categories you need under **Settings → Masters**, then add items from **Wardrobe**. Clothing wears can be logged from an item or while recording an outfit. Use **Settings → Backup** to download or restore your data.

RACK starts with an empty collection. Your data is stored in the browser, so it stays under your control and is available on that device.

### Optional device sync

RACK can sync between your devices through a private GitHub Gist. Set it up in **Settings** with a GitHub token that has only the `gist` permission. Push and Pull transfer wardrobe data and the photo snapshot; automatic background sync transfers wardrobe data only. Your token is kept in that browser and is not part of the app or repository. JSON data backups and photo backups are also available.

## Development

RACK is a static HTML, CSS, and JavaScript app with no build step or package dependencies. To serve it locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. The browser regression checks are at `http://localhost:8000/tests/sync.html` and use mock data and storage.

The app version is stored in [`VERSION`](VERSION). See [`VERSIONING.md`](VERSIONING.md) for version and asset cache-busting rules. The main files are `index.html`, `css/style.css`, and `js/`; `sw.js` and `manifest.webmanifest` provide offline and install support.
