/* Run tests/sync.html through a static server. Uses real browser photo
   decoding, FileReader and IndexedDB; never reads the application's stores. */
(async () => {
  const results = document.querySelector('#results');
  const lines = [];
  const devices = [];
  const sources = await Promise.all(['data', 'sync', 'photos'].map(async name =>
    [name, await (await fetch(`../js/${name}.js`)).text()]));
  const cloud = { files: {}, updated_at: 'revision-0', id: 'test-gist' };
  const requests = [];
  let revision = 0;
  let failNetwork = false;
  function assert(ok, message) { if (!ok) throw new Error(message); }
  function equal(a, b, message) { assert(JSON.stringify(a) === JSON.stringify(b), message); }
  async function check(name, fn) {
    await fn();
    lines.push(`PASS ${name}`);
    results.textContent = lines.join('\n');
  }
  function cloudFile(name, data) { cloud.files[name] = { content: JSON.stringify(data) }; }
  function advance() { cloud.updated_at = `revision-${++revision}`; }
  async function device() {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    document.body.append(frame);
    const w = frame.contentWindow;
    const storage = new Map();
    Object.defineProperty(w, 'localStorage', { value: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    } });
    const nativeIDB = w.indexedDB;
    const nativeFetch = w.fetch.bind(w);
    const dbName = `rack-sync-test-${crypto.randomUUID()}`;
    Object.defineProperty(w, 'indexedDB', { value: { open: (_, version) => nativeIDB.open(dbName, version) } });
    w.fetch = async (input, opts = {}) => {
      const url = String(input);
      if (url.startsWith('data:')) return nativeFetch(input, opts);
      assert(url.startsWith('https://api.github.com/gists') || url.startsWith('https://gist.githubusercontent.com/'), 'Unexpected network request');
      if (failNetwork) throw new Error('Simulated offline');
      requests.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
      if (url.startsWith('https://gist.githubusercontent.com/')) {
        assert(!opts.headers, 'Raw file request must not forward authentication');
        return new w.Response(cloud.rawContent);
      }
      if (opts.method === 'POST' || opts.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        Object.assign(cloud.files, body.files);
        advance();
      }
      return new w.Response(JSON.stringify(cloud), { headers: { 'Content-Type': 'application/json' } });
    };
    for (const [name, source] of sources) {
      const script = w.document.createElement('script');
      const exports = name === 'data' ? 'Store, buildDefaultState' : name === 'sync' ? 'Sync, SyncEngine, saveSyncMeta' : 'RackPhotos';
      script.textContent = `${source}\nObject.assign(window, { ${exports} });`;
      w.document.body.append(script);
    }
    // Stub headers so the tests never need or store even a fake token.
    w.Sync._headers = async () => ({ Accept: 'application/vnd.github+json' });
    w.Sync.isConnected = () => !!w.Sync.getGistId();
    const d = { w, frame, storage, nativeIDB, dbName };
    devices.push(d);
    return w;
  }
  function markClean(w) {
    w.saveSyncMeta({ lastRemoteUpdatedAt: cloud.updated_at, lastSyncedLocalUpdatedAt: w.Store.state.meta.updatedAt });
  }
  async function image(w, color) {
    const canvas = w.document.createElement('canvas');
    canvas.width = 4; canvas.height = 3;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 3);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  async function photos(w) { return (await w.RackPhotos.exportAll()).photos; }
  try {
    const a = await device();
    const b = await device();
    a.Store.state.items = ['bottle', 'empty'].map(id => ({ id, categoryId: 'cat_perfumes', tags: [] }));
    a.Store.save();
    const red = await image(a, 'red');
    const blue = await image(a, 'blue');
    await a.RackPhotos.put('bottle', red);
    await check('Push creates both Gist files in one request without image data in wardrobe JSON', async () => {
      await a.SyncEngine.push();
      assert(a.Sync.getGistId() === cloud.id, 'Created Gist ID remembered');
      const write = requests.find(r => r.method === 'POST');
      const body = JSON.parse(write.body);
      assert(body.public === false, 'Gist must be private');
      equal(Object.keys(body.files).sort(), ['rack-photos.json', 'rack-wardrobe.json'], 'Both files created');
      assert(!body.files['rack-wardrobe.json'].content.includes('data:image/'), 'Wardrobe excludes photos');
      assert(!a.Store.exportJSON().includes('data:image/'), 'Ordinary backup excludes photos');
      assert([...devices[0].storage.values()].every(v => !v.includes('data:image/')), 'localStorage excludes photos');
    });
    b.Sync.setGistId(cloud.id);
    await check('Pull restores another device, deletes stale/orphan photos and preserves empty items', async () => {
      await b.RackPhotos.put('stale', blue);
      await b.RackPhotos.put('empty', blue);
      await b.SyncEngine.pull();
      equal(await photos(b), await photos(a), 'Photo snapshot matches');
      equal(b.Store.state.items.map(i => i.id), ['bottle', 'empty'], 'Empty item survives');
      assert(!await b.RackPhotos.get('empty'), 'Empty photo slot preserved');
    });
    await check('Latest successful snapshot updates a different image for the same item', async () => {
      await a.RackPhotos.put('bottle', blue);
      await a.SyncEngine.push();
      await b.SyncEngine.pull();
      equal(await photos(b), await photos(a), 'New image replaces old image');
      const writes = requests.filter(r => r.method === 'PATCH');
      equal(Object.keys(JSON.parse(writes.at(-1).body).files).sort(), ['rack-photos.json', 'rack-wardrobe.json'], 'Both files patched');
    });
    await check('Deleting a photo, Push and Pull removes it on another device', async () => {
      await a.RackPhotos.delete('bottle');
      await a.SyncEngine.push();
      equal(JSON.parse(cloud.files['rack-photos.json'].content).photos, {}, 'Deleted photo omitted');
      await b.SyncEngine.pull();
      equal(await photos(b), {}, 'Empty authoritative snapshot clears all photos');
      assert(b.Store.state.items.length === 2, 'Items remain without photos');
    });
    await check('Old Gist without photos still pulls wardrobe data and reports a warning', async () => {
      delete cloud.files['rack-photos.json'];
      await b.RackPhotos.put('bottle', red);
      advance();
      const result = await b.SyncEngine.pull();
      assert(result.photoWarning.includes('no remote photos'), 'Missing file reported');
      assert(b.SyncEngine.status === 'synced', 'Old Gist still counts as a successful wardrobe pull');
      assert(await b.RackPhotos.get('bottle'), 'Missing file keeps local photos');
      assert(b.Store.state.items.length === 2, 'Wardrobe pulled');
    });
    await check('Background auto-sync never fetches raw photos or applies/deletes them', async () => {
      const original = await photos(b);
      const data = JSON.parse(cloud.files['rack-wardrobe.json'].content);
      data.items.push({ id: 'remote-only', categoryId: 'cat_perfumes', tags: [] });
      cloudFile('rack-wardrobe.json', data);
      cloud.files['rack-photos.json'] = { truncated: true, raw_url: 'https://gist.githubusercontent.com/test/raw/revision/photos' };
      advance();
      const rawCount = requests.filter(r => r.url.includes('gist.githubusercontent.com')).length;
      const exportFn = b.RackPhotos.exportAll;
      const prepareFn = b.RackPhotos.prepareSnapshot;
      b.RackPhotos.exportAll = b.RackPhotos.prepareSnapshot = () => { throw new Error('Background photo access'); };
      const result = await b.SyncEngine.checkAndAutoSync();
      b.RackPhotos.exportAll = exportFn; b.RackPhotos.prepareSnapshot = prepareFn;
      assert(result.pulled, 'Background wardrobe pull succeeds');
      assert(b.Store.state.items.some(i => i.id === 'remote-only'), 'Remote wardrobe applied');
      equal(await photos(b), original, 'Background leaves photos intact');
      equal(requests.filter(r => r.url.includes('gist.githubusercontent.com')).length, rawCount, 'No raw photo fetch');
    });
    await check('Invalid/unsupported payloads fail softly and preserve local photos', async () => {
      const original = await photos(b);
      for (const payload of [null, { format: 'other', version: 1, photos: {} },
        { format: 'rack-photos', version: 2, photos: {} }, { format: 'rack-photos', version: 1, photos: [] }]) {
        cloudFile('rack-photos.json', payload);
        const result = await b.SyncEngine.pull();
        assert(result.photoWarning, 'Invalid payload reported');
        assert(b.SyncEngine.status === 'failed', 'Invalid photo payload reflected in status');
        equal(await photos(b), original, 'Local photos preserved');
      }
      cloud.files['rack-photos.json'] = { content: '{broken JSON' };
      assert((await b.SyncEngine.pull()).photoWarning, 'Invalid JSON reported');
      equal(await photos(b), original, 'Invalid JSON preserves photos');
    });
    await check('Malformed images and unknown item IDs are skipped safely', async () => {
      const url = await a.RackPhotos._blobToDataUrl(red);
      cloudFile('rack-photos.json', { format: 'rack-photos', version: 1, photos: {
        bottle: url, orphan: url, empty: 'data:image/png;base64,????',
        'remote-only': 'data:image/png;base64,YmFk',
      } });
      const result = await b.SyncEngine.pull();
      assert(result.photoWarning.includes('3 remote photo entries skipped'), 'Skipped entries reported');
      equal(Object.keys(await photos(b)), ['bottle'], 'Only valid matching image restored');
    });
    await check('Large truncated photo files use raw content without authentication headers', async () => {
      cloud.rawContent = JSON.stringify({ format: 'rack-photos', version: 1, photos: {} });
      cloud.files['rack-photos.json'] = { truncated: true, content: '{partial', raw_url: 'https://gist.githubusercontent.com/test/raw/revision/photos' };
      const result = await b.SyncEngine.pull();
      assert(!result.photoWarning, 'Raw photo pull succeeds');
      equal(await photos(b), {}, 'Raw snapshot applied');
    });
    await check('IndexedDB failure rolls back clear/puts and keeps wardrobe usable', async () => {
      await b.RackPhotos.put('bottle', red);
      const original = await photos(b);
      let rejected = false;
      try { await b.RackPhotos.replaceSnapshot({ entries: [['bottle', blue], ['bad', () => {}]], restored: 2, skipped: 0 }); }
      catch (err) { rejected = true; }
      assert(rejected, 'Write failure rejected');
      equal(await photos(b), original, 'Transaction rolled back');
      cloudFile('rack-photos.json', { format: 'rack-photos', version: 1, photos: {} });
      const replace = b.RackPhotos.replaceSnapshot;
      b.RackPhotos.replaceSnapshot = async () => { throw new Error('Quota exceeded'); };
      const result = await b.SyncEngine.pull();
      b.RackPhotos.replaceSnapshot = replace;
      assert(result.photoWarning.includes('could not restore'), 'Storage failure reported');
      equal(await photos(b), original, 'Local photos preserved');
      assert(b.Store.state.items.length === 3, 'Wardrobe still usable');
      assert(b.SyncEngine._retryTimer === null, 'Manual photo failure has no background retry');
    });
    await check('Photo export failure prevents any upload and manual network failures do not retry', async () => {
      const exportFn = a.RackPhotos.exportAll;
      const before = requests.length;
      a.RackPhotos.exportAll = async () => { throw new Error('IndexedDB unavailable'); };
      let rejected = false;
      try { await a.SyncEngine.push(); } catch (err) { rejected = true; }
      a.RackPhotos.exportAll = exportFn;
      assert(rejected && requests.length === before, 'Failed export cannot upload wardrobe alone');
      failNetwork = true;
      for (const action of ['push', 'pull']) {
        try { await a.SyncEngine[action](); } catch (err) { /* expected */ }
        assert(a.SyncEngine.status === 'failed' && a.SyncEngine._retryTimer === null, 'No automatic manual-action retry');
      }
      failNetwork = false;
    });
    await check('Wardrobe conflict blocks replacement/upload until explicitly resolved', async () => {
      markClean(b);
      b.Store.state.meta.updatedAt += 100;
      const local = b.Store.exportJSON();
      const original = await photos(b);
      advance();
      assert((await b.SyncEngine.checkAndAutoSync()).conflict, 'Auto-sync reports conflict');
      assert((await b.SyncEngine.pull()).conflict, 'Manual Pull preserves conflict');
      assert(b.Store.exportJSON() === local, 'Conflicted wardrobe unchanged');
      equal(await photos(b), original, 'Conflicted photos unchanged');
      const before = requests.filter(r => r.method === 'PATCH').length;
      assert((await b.SyncEngine.push()).conflict, 'Manual Push preserves conflict');
      equal(requests.filter(r => r.method === 'PATCH').length, before, 'No conflicted upload');
      assert(!(await b.SyncEngine.pull({ resolveConflict: true })).conflict, 'Explicit conflict choice applies snapshot');
    });
    await check('Manual Download/Restore snapshot remains additive and compatible', async () => {
      await b.RackPhotos.put('empty', blue);
      const backup = { format: 'rack-photos', version: 1, photos: { bottle: await a.RackPhotos._blobToDataUrl(red) } };
      const result = await b.RackPhotos.importAll(backup, new Set(['bottle', 'empty']));
      assert(result.restored === 1 && result.skipped === 0, 'Manual restore compatible');
      equal(Object.keys(await photos(b)).sort(), ['bottle', 'empty'], 'Restore does not delete other photos');
    });
    window.testResult = { passed: lines.length, failed: 0 };
    lines.push(`\nAll ${lines.length} checks passed.`);
  } catch (err) {
    lines.push(`FAIL ${err.message}`);
    window.testResult = { passed: lines.filter(s => s.startsWith('PASS')).length, failed: 1, error: err.stack };
  } finally {
    for (const d of devices) {
      d.w.SyncEngine._clearRetry();
      if (d.w.RackPhotos._db) d.w.RackPhotos._db.close();
      d.nativeIDB.deleteDatabase(d.dbName);
      d.frame.remove();
    }
    results.textContent = lines.join('\n');
  }
})();
