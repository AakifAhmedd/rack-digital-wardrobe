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
};
