/* ============================================================
   RACK — sync.js
   Optional cross-device sync using a GitHub Gist as the cloud
   store. The user supplies THEIR OWN personal access token —
   it is kept only in this browser's localStorage and is used
   directly, client-side, to call the GitHub API. It is never
   sent anywhere else and never bundled into the app's source.
   ============================================================ */

const Sync = {
  getToken() { return localStorage.getItem(TOKEN_KEY) || ''; },
  getGistId() { return localStorage.getItem(GIST_KEY) || ''; },
  setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); },
  setGistId(id) { id ? localStorage.setItem(GIST_KEY, id) : localStorage.removeItem(GIST_KEY); },
  isConnected() { return !!(this.getToken() && this.getGistId()); },

  async _headers() {
    const token = this.getToken();
    if (!token) throw new Error('No GitHub token saved. Add one in Settings first.');
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
  },

  _files(data, photos) {
    const files = { 'rack-wardrobe.json': { content: JSON.stringify(data, null, 2) } };
    if (photos !== undefined) files['rack-photos.json'] = { content: JSON.stringify(photos) };
    return files;
  },

  async createGist(data, photos) {
    const headers = await this._headers();
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'RACK wardrobe data (do not delete)',
        public: false,
        files: this._files(data, photos),
      }),
    });
    if (!res.ok) throw new Error(`Could not create gist (${res.status}). Check your token's permissions.`);
    const json = await res.json();
    this.setGistId(json.id);
    return json.updated_at || null;
  },

  async pushToCloud(data, photos) {
    const gistId = this.getGistId();
    if (!gistId) return this.createGist(data, photos);
    const headers = await this._headers();
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        files: this._files(data, photos),
      }),
    });
    if (!res.ok) throw new Error(`Sync failed (${res.status}). Check your token and gist ID.`);
    const json = await res.json();
    return json.updated_at || null;
  },

  /* GitHub truncates large files in the API response. Read that revision's
     raw URL without forwarding the token outside api.github.com. */
  async _readFile(file) {
    if (!file.truncated && typeof file.content === 'string') return JSON.parse(file.content);
    const url = new URL(file.raw_url);
    if (url.protocol !== 'https:' || url.hostname !== 'gist.githubusercontent.com' || url.username || url.password) {
      throw new Error('Invalid Gist file URL');
    }
    const res = await fetch(url.href, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not read Gist file (${res.status}).`);
    return JSON.parse(await res.text());
  },

  async pullFromCloud({ includePhotos = false } = {}) {
    const gistId = this.getGistId();
    if (!gistId) throw new Error('No gist connected yet.');
    const headers = await this._headers();
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
    if (!res.ok) throw new Error(`Could not fetch cloud data (${res.status}).`);
    const json = await res.json();
    const file = json.files && json.files['rack-wardrobe.json'];
    if (!file) throw new Error('Gist does not contain rack-wardrobe.json.');
    const data = await this._readFile(file);
    const snapshot = { data, updatedAt: json.updated_at || null, photos: null, photoWarning: null, photoFailed: false };
    // Background sync does not parse, fetch raw content, or apply photo files.
    if (includePhotos) {
      const photoFile = json.files['rack-photos.json'];
      if (!photoFile) {
        snapshot.photoWarning = 'Wardrobe pulled; no remote photos were available. Local photos kept.';
      } else {
        try { snapshot.photos = await this._readFile(photoFile); }
        catch (err) {
          snapshot.photoWarning = 'Wardrobe pulled; could not read remote photos. Local photos kept. Try Pull again.';
          snapshot.photoFailed = true;
        }
      }
    }
    return snapshot;
  },

  /* Lightweight check: just the gist's last-modified time, no content parsing.
     Used to detect "remote moved since we last looked" without a full pull. */
  async fetchRemoteUpdatedAt() {
    const gistId = this.getGistId();
    if (!gistId) return null;
    const headers = await this._headers();
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
    if (!res.ok) throw new Error(`Could not check cloud status (${res.status}).`);
    const json = await res.json();
    return json.updated_at || null;
  },
};

/* ============================================================
   SyncEngine — status tracking, conflict detection, auto-pull,
   and background retry-on-failure, layered on top of Sync's raw API calls.

   This only tracks LOCAL bookkeeping (in localStorage) about what
   remote/local state we last knew to be in sync — it never changes
   the shape of the data that actually gets pushed to the gist
   (rack-wardrobe.json is still just the full Store.state, including outfitHistory).
   Conflict choices replace that entire snapshot; outfit entries are not merged. Only explicit
   Push/Pull transfers the separate rack-photos.json snapshot. Manual actions
   are never retried by a timer, so photos cannot sync in the background.
   ============================================================ */

const SYNC_META_KEY = 'rack.sync.meta';

function loadSyncMeta() {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    return raw ? JSON.parse(raw) : { lastRemoteUpdatedAt: null, lastSyncedLocalUpdatedAt: 0 };
  } catch (e) { return { lastRemoteUpdatedAt: null, lastSyncedLocalUpdatedAt: 0 }; }
}
function saveSyncMeta(meta) {
  try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
}

const SyncEngine = {
  // 'idle' | 'not-connected' | 'syncing' | 'synced' | 'pending' | 'failed' | 'conflict'
  status: 'idle',
  lastError: null,
  lastNotice: null,
  _listeners: [],
  _retryTimer: null,
  _retryDelay: 15000,

  onChange(fn) { this._listeners.push(fn); },
  _setStatus(s, err) {
    this.status = s;
    this.lastError = err || null;
    this._listeners.forEach(fn => { try { fn(s); } catch (e) { /* ignore listener errors */ } });
  },

  hasLocalChangesSinceSync() {
    const meta = loadSyncMeta();
    return Store.state.meta.updatedAt > (meta.lastSyncedLocalUpdatedAt || 0);
  },

  lastSyncedAt() { return loadSyncMeta().lastSyncedLocalUpdatedAt || null; },

  _hasConflict(remoteUpdatedAt) {
    const meta = loadSyncMeta();
    return !!meta.lastRemoteUpdatedAt && !!remoteUpdatedAt &&
      remoteUpdatedAt !== meta.lastRemoteUpdatedAt && this.hasLocalChangesSinceSync();
  },

  /* Called on app open and on tab/app resume. Detects whether the
     remote has moved since we last looked. If it has and we have no
     unsynced local edits, it's safe to auto-pull. If it has AND we
     have unsynced local edits, that's a genuine conflict — caller
     (app.js) is responsible for prompting the user via a modal. */
  async checkAndAutoSync() {
    if (this.status === 'syncing') return { busy: true };
    if (!Sync.isConnected()) { this._setStatus('not-connected'); return { notConnected: true }; }
    this._setStatus('syncing');
    try {
      const remoteUpdatedAt = await Sync.fetchRemoteUpdatedAt();
      const meta = loadSyncMeta();
      const neverSynced = !meta.lastRemoteUpdatedAt;
      const remoteMoved = !!remoteUpdatedAt && remoteUpdatedAt !== meta.lastRemoteUpdatedAt;
      const localDirty = this.hasLocalChangesSinceSync();

      if (neverSynced) {
        // First-ever connection for this device: there's no common sync
        // point to compare against, so this can't be a real conflict —
        // leave it to the user to choose Push or Pull explicitly.
        this._setStatus(localDirty ? 'pending' : 'synced');
        this._clearRetry();
        return {};
      }

      if (remoteMoved && localDirty) {
        this._setStatus('conflict');
        return { conflict: true };
      }
      if (remoteMoved && !localDirty) {
        const result = await this.pull({ silent: true });
        if (result.conflict) return result;
        if (typeof toast === 'function') toast('Synced latest changes from the cloud');
        return { pulled: true };
      }
      this._setStatus(localDirty ? 'pending' : 'synced');
      this._clearRetry();
      return {};
    } catch (err) {
      this._setStatus('failed', err);
      this._scheduleRetry(() => this.checkAndAutoSync());
      throw err;
    }
  },

  async push(opts = {}) {
    if (this.status === 'syncing') return { busy: true };
    this._clearRetry();
    this._setStatus('syncing');
    try {
      // Capture wardrobe before awaiting the photo export. Later local edits
      // must remain pending rather than being marked as uploaded.
      const data = JSON.parse(JSON.stringify(Store.state));
      let photos;
      try { photos = await RackPhotos.exportAll(); }
      catch (err) { throw new Error('Could not read local photos. Nothing was pushed. Try Push again.'); }
      const before = Sync.getGistId() ? await Sync.fetchRemoteUpdatedAt() : null;
      if (!opts.resolveConflict && this._hasConflict(before)) {
        this._setStatus('conflict');
        return { conflict: true };
      }
      const remoteUpdatedAt = await Sync.pushToCloud(data, photos);
      saveSyncMeta({ lastRemoteUpdatedAt: remoteUpdatedAt, lastSyncedLocalUpdatedAt: data.meta.updatedAt });
      this.lastNotice = null;
      this._setStatus(this.hasLocalChangesSinceSync() ? 'pending' : 'synced');
      this._clearRetry();
      return {};
    } catch (err) {
      this._setStatus('failed', err);
      throw err;
    }
  },

  async pull(opts = {}) {
    // A silent pull is entered from checkAndAutoSync while status is syncing.
    if (!opts.silent && this.status === 'syncing') return { busy: true };
    this._clearRetry();
    this._setStatus('syncing');
    try {
      const snapshot = await Sync.pullFromCloud({ includePhotos: !opts.silent });
      let prepared = null;
      let photoWarning = snapshot.photoWarning;
      let photoFailed = snapshot.photoFailed;
      if (!opts.silent && !photoWarning) {
        try {
          prepared = await RackPhotos.prepareSnapshot(snapshot.photos, new Set((snapshot.data.items || []).map(i => i.id)));
        } catch (err) {
          photoWarning = 'Wardrobe pulled; remote photo snapshot is invalid or unsupported. Local photos kept. Try Pull again.';
          photoFailed = true;
        }
      }
      // Recheck after all reads/decoding; a local edit during the request must
      // still produce the existing wardrobe conflict before any replacement.
      if (!opts.resolveConflict && this._hasConflict(snapshot.updatedAt)) {
        this._setStatus('conflict');
        return { conflict: true };
      }
      Store.replaceAll(snapshot.data);
      const localUpdatedAt = Store.state.meta.updatedAt;
      if (prepared) {
        try {
          await RackPhotos.replaceSnapshot(prepared);
          if (prepared.skipped) photoWarning = `Wardrobe pulled; ${prepared.skipped} remote photo entries skipped (invalid image or no matching item).`;
        } catch (err) {
          photoWarning = 'Wardrobe pulled; could not restore photos. Local photos kept. Try Pull again.';
          photoFailed = true;
        }
      }
      if (typeof applyStoredAppearance === 'function') applyStoredAppearance();
      saveSyncMeta({ lastRemoteUpdatedAt: snapshot.updatedAt, lastSyncedLocalUpdatedAt: localUpdatedAt });
      if (!opts.silent) this.lastNotice = photoWarning;
      this._setStatus(photoFailed ? 'failed' : (this.hasLocalChangesSinceSync() ? 'pending' : 'synced'), photoFailed ? new Error(photoWarning) : null);
      this._clearRetry();
      // Always reflect the new data on screen — "silent" only means
      // "don't make a fuss about it", never "leave the UI stale".
      if (typeof render === 'function') render();
      return { photoWarning };
    } catch (err) {
      this._setStatus('failed', err);
      throw err;
    }
  },

  disconnect() {
    this._clearRetry();
    this.lastNotice = null;
    saveSyncMeta({ lastRemoteUpdatedAt: null, lastSyncedLocalUpdatedAt: 0 });
    this._setStatus('not-connected');
  },

  _scheduleRetry(fn) {
    this._clearRetry();
    this._retryTimer = setTimeout(() => { fn().catch(() => { /* status already reflects failure */ }); }, this._retryDelay);
    this._retryDelay = Math.min(this._retryDelay * 2, 5 * 60 * 1000);
  },
  _clearRetry() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._retryDelay = 15000;
  },
};
