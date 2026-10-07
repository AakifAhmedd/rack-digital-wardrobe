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

  /* Resize to ~800px on the long edge and re-encode (WebP where possible,
     otherwise JPEG). Rejects with an Error when the file cannot be decoded. */
  async processImageFile(file) {
    const img = await this._loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const type = this._supportsWebP() ? 'image/webp' : 'image/jpeg';
    const quality = type === 'image/webp' ? WEBP_QUALITY : JPEG_QUALITY;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality);
    });
    return blob;
  },
};