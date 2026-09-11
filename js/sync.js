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

  async createGist(data) {
    const headers = await this._headers();
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'RACK wardrobe data (do not delete)',
        public: false,
        files: { 'rack-wardrobe.json': { content: JSON.stringify(data, null, 2) } },
      }),
    });
    if (!res.ok) throw new Error(`Could not create gist (${res.status}). Check your token's permissions.`);
    const json = await res.json();
    this.setGistId(json.id);
    return json.id;
  },

  async pushToCloud(data) {
    const gistId = this.getGistId();
    if (!gistId) return this.createGist(data);
    const headers = await this._headers();
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        files: { 'rack-wardrobe.json': { content: JSON.stringify(data, null, 2) } },
      }),
    });
    if (!res.ok) throw new Error(`Sync failed (${res.status}). Check your token and gist ID.`);
    return true;
  },

  async pullFromCloud() {
    const gistId = this.getGistId();
    if (!gistId) throw new Error('No gist connected yet.');
    const headers = await this._headers();
    const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers });
    if (!res.ok) throw new Error(`Could not fetch cloud data (${res.status}).`);
    const json = await res.json();
    const file = json.files['rack-wardrobe.json'];
    if (!file) throw new Error('Gist does not contain rack-wardrobe.json.');
    return JSON.parse(file.content);
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
   and retry-on-failure, layered on top of Sync's raw API calls.

   This only tracks LOCAL bookkeeping (in localStorage) about what
   remote/local state we last knew to be in sync — it never changes
   the shape of the data that actually gets pushed to the gist
   (still just the full Store.state, exactly as before).
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

  /* Called on app open and on tab/app resume. Detects whether the
     remote has moved since we last looked. If it has and we have no
     unsynced local edits, it's safe to auto-pull. If it has AND we
     have unsynced local edits, that's a genuine conflict — caller
     (app.js) is responsible for prompting the user via a modal. */
  async checkAndAutoSync() {
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
        await this.pull({ silent: true, knownRemoteUpdatedAt: remoteUpdatedAt });
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

  async push() {
    this._setStatus('syncing');
    try {
      await Sync.pushToCloud(Store.state);
      const remoteUpdatedAt = await Sync.fetchRemoteUpdatedAt().catch(() => null);
      saveSyncMeta({ lastRemoteUpdatedAt: remoteUpdatedAt, lastSyncedLocalUpdatedAt: Store.state.meta.updatedAt });
      this._setStatus('synced');
      this._clearRetry();
      return true;
    } catch (err) {
      this._setStatus('failed', err);
      this._scheduleRetry(() => this.push());
      throw err;
    }
  },

  async pull(opts = {}) {
    this._setStatus('syncing');
    try {
      const data = await Sync.pullFromCloud();
      Store.replaceAll(data);
      if (typeof applyStoredAppearance === 'function') applyStoredAppearance();
      const remoteUpdatedAt = opts.knownRemoteUpdatedAt || await Sync.fetchRemoteUpdatedAt().catch(() => null);
      saveSyncMeta({ lastRemoteUpdatedAt: remoteUpdatedAt, lastSyncedLocalUpdatedAt: Store.state.meta.updatedAt });
      this._setStatus('synced');
      this._clearRetry();
      // Always reflect the new data on screen — "silent" only means
      // "don't make a fuss about it", never "leave the UI stale".
      if (typeof render === 'function') render();
      return true;
    } catch (err) {
      this._setStatus('failed', err);
      this._scheduleRetry(() => this.pull(opts));
      throw err;
    }
  },

  disconnect() {
    this._clearRetry();
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
