/* ============================================================
   RACK — photos.js
   Per-device item photos for the perfume prototype.
   Stored in IndexedDB ('rack-images'), keyed by item id, one
   compressed Blob per item. Photos are per-device by design:
   they NEVER touch Store.state, localStorage, or the Gist sync —
   delete this file and the app runs exactly as before. Sync code
   is intentionally unaware of this module.
   ============================================================ */

'use strict';

const DB_NAME = 'rack-images';
const DB_VERSION = 1;
const STORE_NAME = 'photos';
const MAX_EDGE = 800;              // long edge of the uploaded image, px
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.85;
const TRIM_ALPHA = 10;           // pixels with alpha above this count as content
const TRIM_PAD_PCT = 0.04;       // padding kept around the trimmed content
const TRIM_PAD_MIN = 8;          // ...but never less than this many px
const TRIM_SCAN_EDGE = 1024;     // bounding box is found on a copy this size

const RackPhotos = {
  _db: null,
  _dbPromise: null,
  _webp: undefined,

  /* Fire-and-forget at boot: warm the connection and ask the browser
     to make our storage persistent so eviction is less likely. */
  async init() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => { /* best-effort */ });
      }
      await this._open();
    } catch (e) { /* photos are optional — the app keeps working */ }
  },

  _open() {
    if (this._db) return Promise.resolve(this._db);
    if (!this._dbPromise) {
      this._dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME); // out-of-line key = item id
          }
        };
        req.onsuccess = () => resolve((this._db = req.result));
        req.onerror = () => { this._dbPromise = null; reject(req.error); };
      });
    }
    return this._dbPromise;
  },

  _store(mode) {
    return this._open().then(db =>
      db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
  },

  get(itemId) {
    return this._store('readonly')
      .then(store => new Promise((resolve, reject) => {
        const r = store.get(itemId);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      }))
      .catch(() => null); // no photo (or no IndexedDB) — degrade silently
  },

  put(itemId, blob) {
    return this._store('readwrite').then(store => new Promise((resolve, reject) => {
      const r = store.put(blob, itemId);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    }));
  },

  delete(itemId) {
    return this._store('readwrite').then(store => new Promise((resolve, reject) => {
      const r = store.delete(itemId);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    }));
  },

  /* ---------- manual backup (photos are not part of the JSON backup or sync) ---------- */

  _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  },

  /* Every stored photo as { format, version, photos: { itemId: dataUrl } }. */
  async exportAll() {
    const store = await this._store('readonly');
    const [keys, blobs] = await Promise.all(['getAllKeys', 'getAll'].map(m =>
      new Promise((resolve, reject) => {
        const r = store[m]();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })));
    const photos = {};
    for (let i = 0; i < keys.length; i++) photos[keys[i]] = await this._blobToDataUrl(blobs[i]);
    return { format: 'rack-photos', version: 1, photos };
  },

  /* Restore photos from an exportAll() object. Only ids in `validIds` (items
     that exist on this device) are written; returns { restored, skipped }. */
  async importAll(data, validIds) {
    if (!data || data.format !== 'rack-photos' || !data.photos || typeof data.photos !== 'object') {
      throw new Error('Not a RACK photo backup');
    }
    let restored = 0, skipped = 0;
    for (const [id, url] of Object.entries(data.photos)) {
      if (!validIds.has(id) || typeof url !== 'string' || !url.startsWith('data:image/')) { skipped++; continue; }
      await this.put(id, await (await fetch(url)).blob());
      restored++;
    }
    return { restored, skipped };
  },

  /* ---------- file -> compressed Blob ---------- */

  /* Read the file through an <img> element: every modern browser applies
     EXIF orientation there, so iPhone camera photos come out the right way
     up without any extra handling. */
  _loadImage(file) {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image'));
      };
      img.src = url;
    }).then(img => {
      URL.revokeObjectURL(url);
      return img;
    });
  },

  _supportsWebP() {
    if (this._webp === undefined) {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        this._webp = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      } catch (e) { this._webp = false; }
    }
    return this._webp;
  },

  /* Bounding box of the visible (alpha > TRIM_ALPHA) pixels, in source px.
     Scanned on a downscaled copy so huge photos stay cheap. Opaque images
     and fully transparent ones come back as the whole image. */
  _contentBox(img) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const full = { x: 0, y: 0, w: iw, h: ih, hasAlpha: false };
    try {
      const k = Math.min(1, TRIM_SCAN_EDGE / Math.max(iw, ih));
      const sw = Math.max(1, Math.round(iw * k));
      const sh = Math.max(1, Math.round(ih * k));
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, sw, sh);
      const data = ctx.getImageData(0, 0, sw, sh).data;
      let minX = sw, minY = sh, maxX = -1, maxY = -1, hasAlpha = false;
      for (let y = 0; y < sh; y++) {
        const row = y * sw * 4 + 3;
        for (let x = 0; x < sw; x++) {
          const a = data[row + x * 4];
          if (a < 255) hasAlpha = true;
          if (a > TRIM_ALPHA) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (!hasAlpha || maxX < 0) return { ...full, hasAlpha };
      const x0 = Math.max(0, Math.floor(minX / k));
      const y0 = Math.max(0, Math.floor(minY / k));
      const x1 = Math.min(iw, Math.ceil((maxX + 1) / k));
      const y1 = Math.min(ih, Math.ceil((maxY + 1) / k));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, hasAlpha };
    } catch (e) { return full; } // tainted/unreadable canvas — keep the whole image
  },

  _encode(canvas, needsAlpha) {
    let type, quality;
    if (this._supportsWebP()) { type = 'image/webp'; quality = WEBP_QUALITY; }
    else if (needsAlpha) { type = 'image/png'; }  // JPEG would turn transparency black
    else { type = 'image/jpeg'; quality = JPEG_QUALITY; }
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality);
    });
  },

  /* Trim transparent borders, pad the result to the card's 4:3 frame with a
     transparent background (so object-fit: cover shows the whole bottle),
     resize to ~800px on the long edge and re-encode (WebP where possible).
     Rejects with an Error when the file cannot be decoded. */
  async processImageFile(file) {
    const img = await this._loadImage(file);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const box = this._contentBox(img);

    // Content rect = trimmed box + padding. With transparency the padding may
    // extend past the source (it is transparent anyway); opaque photos stay inside it.
    const padX = Math.max(TRIM_PAD_MIN, Math.round(box.w * TRIM_PAD_PCT));
    const padY = Math.max(TRIM_PAD_MIN, Math.round(box.h * TRIM_PAD_PCT));
    let cx = box.x - padX, cy = box.y - padY, cw = box.w + 2 * padX, ch = box.h + 2 * padY;
    if (!box.hasAlpha) { cx = 0; cy = 0; cw = iw; ch = ih; }

    // 4:3 frame around the content, content centred.
    const fw = cw * 3 >= ch * 4 ? cw : ch * 4 / 3;
    const fh = cw * 3 >= ch * 4 ? cw * 3 / 4 : ch;
    const scale = Math.min(1, MAX_EDGE / Math.max(fw, fh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(fw * scale));
    canvas.height = Math.max(1, Math.round(fh * scale));

    // Draw only the part of the content rect that lies inside the source image.
    const sx0 = Math.max(0, cx), sy0 = Math.max(0, cy);
    const sx1 = Math.min(iw, cx + cw), sy1 = Math.min(ih, cy + ch);
    const ox = (fw - cw) / 2, oy = (fh - ch) / 2;
    canvas.getContext('2d').drawImage(
      img, sx0, sy0, sx1 - sx0, sy1 - sy0,
      (ox + sx0 - cx) * scale, (oy + sy0 - cy) * scale, (sx1 - sx0) * scale, (sy1 - sy0) * scale);

    const needsAlpha = box.hasAlpha || fw - cw > 1 || fh - ch > 1;
    return this._encode(canvas, needsAlpha);
  },

  /* Re-render a stored blob scaled by `zoom` about its centre, same frame size.
     Always applied to the un-zoomed base, never to a previous zoom result. */
  async zoomBlob(blob, zoom) {
    const img = await this._loadImage(blob);
    const w = img.naturalWidth, h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, w * (1 - zoom) / 2, h * (1 - zoom) / 2, w * zoom, h * zoom);
    return this._encode(canvas, true);
  },
};
