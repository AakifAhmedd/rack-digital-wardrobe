/* Run tests/sync.html through a static server. Uses real browser photo
   decoding, FileReader and IndexedDB; never reads the application's stores. */
(async () => {
  const results = document.querySelector('#results');
  const lines = [];
  const devices = [];
  const sources = await Promise.all(['data', 'sync', 'photos', 'brand-logos', 'app'].map(async name =>
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
    w.document.body.innerHTML = '<div id="modal-overlay"><div id="modal-box"></div></div>';
    for (const [name, source] of sources) {
      const script = w.document.createElement('script');
      const exports = name === 'data' ? 'Store, buildDefaultState, WearHistory' : name === 'sync' ? 'Sync, SyncEngine, saveSyncMeta' : name === 'photos' ? 'RackPhotos' : name === 'brand-logos' ? 'BrandLogo' : 'renderOutfitBuilder, renderOutfitHistory, renderOutfitSummary, wireItemActions, openBackfillModal, openWearHistoryModal, openItemModal, openRetireModal, costPerWear, renderDashboard, itemCard, itemListRow, Modal, openActivityModal, renderActivitiesPanel, renderWardrobe, matchActivity';
      script.textContent = `${source.replace("document.addEventListener('DOMContentLoaded', init);", '')}\nObject.assign(window, { ${exports} });`;
      w.document.body.append(script);
    }
    w.eval('render = () => {}; renderItemGrid = () => {}; toast = () => {};');
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
    await check('Outfit migration and JSON restore are idempotent and compatible', async () => {
      const old = a.buildDefaultState();
      delete old.outfitHistory;
      a.Store.replaceAll(old);
      equal(a.Store.state.outfitHistory, [], 'Old backup defaults history');
      a.Store.state.outfitHistory.push({ id: 'log-test', wornAt: 123456789, itemIds: ['missing'] });
      const backup = a.Store.exportJSON();
      b.Store.replaceAll(JSON.parse(backup));
      b.Store._migrate(); b.Store._migrate();
      equal(b.Store.state.outfitHistory, a.Store.state.outfitHistory, 'History survives repeated migration and restore');
      b.Store._state = null;
      equal(b.Store.state.outfitHistory, a.Store.state.outfitHistory, 'History survives local reload');
    });
    await check('Wear action logs exact selection once, preserves wear counts and warns on repeats', async () => {
      a.Store.replaceAll(a.buildDefaultState());
      const items = ['one', 'two', 'unselected'].map(id => ({ id, categoryId: 'cat_shirts', subcategoryId: 'sub_shirts_t-shirts', tags: [], status: 'active', wearCount: 2 }));
      a.Store.state.items = items;
      a.eval("outfitSelectedIds = new Set(['one', 'two']); toast = () => {};");
      const box = a.renderOutfitSummary(items, () => {});
      const button = box.querySelector('#outfit-wear');
      const before = Date.now();
      button.click(); button.click();
      equal(a.Store.state.outfitHistory.length, 1, 'Double click creates one log');
      const log = a.Store.state.outfitHistory[0];
      equal(log.itemIds, ['one', 'two'], 'Exact selected IDs');
      equal(Object.keys(log).sort(), ['id', 'itemIds', 'wornAt'], 'No item/photo snapshots');
      assert(log.id.startsWith('outfit_') && log.wornAt >= before, 'Generated ID and timestamp');
      equal(items.map(i => i.wearCount), [3, 3, 2], 'Selected items only increment once');
      equal(items[0].lastWornAt, log.wornAt, 'Wear time matches');
      a.eval("outfitSelectedIds = new Set(['two', 'one']);");
      assert(a.renderOutfitSummary(items, () => {}).querySelector('.outfit-repeat'), 'Order-independent repeat warning');
      a.eval("outfitSelectedIds = new Set(['one']);");
      assert(!a.renderOutfitSummary(items, () => {}).querySelector('.outfit-repeat'), 'Subset is not an exact repeat');
    });
    await check('History renders retired/deleted items safely, without activities, and confirms removal', async () => {
      a.Store.state.items[0].status = 'retired';
      a.Store.state.items[0].categoryId = 'cat_perfumes';
      a.Store.state.items[0].subtext = '<img src=x onerror=alert(1)>';
      a.Store.state.items = a.Store.state.items.filter(i => i.id !== 'two');
      a.Store.state.activities = [];
      const history = a.renderOutfitBuilder();
      assert(history.textContent.includes('Retired') && history.textContent.includes('Deleted item'), 'Historical items retained');
      assert(history.querySelector('time').getAttribute('datetime'), 'Date/time present');
      assert(!history.querySelector('.outfit-history img') && history.textContent.includes('<img src=x onerror=alert(1)>'), 'Names escaped');
      let confirm;
      a.Modal.confirm = (_, yes) => { confirm = yes; };
      a.eval('render = () => {};');
      history.querySelector('.outfit-history button').click();
      assert(a.Store.state.outfitHistory.length === 1, 'Removal waits for confirmation');
      confirm();
      assert(a.Store.state.outfitHistory.length === 0, 'Confirmed removal');
      assert(a.Store.state.items[0].wearCount === 3, 'Removal keeps wear count');
      assert(a.renderOutfitHistory().textContent.includes('No outfits logged yet'), 'Empty state after removal');
    });
    await check('History syncs via Push/Pull and participates in whole-wardrobe conflicts', async () => {
      a.Store.state.outfitHistory = [{ id: 'remote-log', wornAt: 123, itemIds: ['one'] }];
      await a.SyncEngine.push({ resolveConflict: true });
      await b.SyncEngine.pull({ resolveConflict: true });
      equal(b.Store.state.outfitHistory, a.Store.state.outfitHistory, 'History pushed/pulled');
      markClean(b);
      b.Store.state.outfitHistory.push({ id: 'local-log', wornAt: 456, itemIds: ['two'] });
      b.Store.save();
      b.Store.state.meta.updatedAt += 100;
      advance();
      assert((await b.SyncEngine.checkAndAutoSync()).conflict, 'History edit triggers auto-sync conflict');
      assert((await b.SyncEngine.push()).conflict, 'Push blocked');
      assert((await b.SyncEngine.pull()).conflict, 'Pull blocked');
      assert(b.Store.state.outfitHistory.length === 2, 'Conflict preserves local history');
      await b.SyncEngine.push({ resolveConflict: true });
      equal(JSON.parse(cloud.files['rack-wardrobe.json'].content).outfitHistory, b.Store.state.outfitHistory, 'Push choice replaces cloud history');
      cloudFile('rack-wardrobe.json', JSON.parse(a.Store.exportJSON())); advance();
      await b.SyncEngine.pull({ resolveConflict: true });
      equal(b.Store.state.outfitHistory, a.Store.state.outfitHistory, 'Pull choice replaces local history');
      const old = JSON.parse(a.Store.exportJSON()); delete old.outfitHistory;
      cloudFile('rack-wardrobe.json', old); advance();
      await b.SyncEngine.pull({ resolveConflict: true });
      equal(b.Store.state.outfitHistory, [], 'Legacy Gist defaults empty');
    });
    function clothingItem(id, count = 0, last = null) {
      return { id, categoryId: 'cat_shirts', subcategoryId: 'sub_shirts_collared-shirts',
        colorId: 'col_white', brandId: '', tags: [], subtext: '', cost: 1200,
        status: 'active', wearCount: count, lastWornAt: last };
    }
    function submit(w, form) { form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); }
    await check('Wear migration preserves legacy items and dates without inventing events', async () => {
      const old = a.buildDefaultState();
      old.items = [clothingItem('legacy', 7, 1600000000000), clothingItem('unknown', 3), clothingItem('unused'),
        { id: 'perfume', categoryId: 'cat_perfumes', tags: [], wearCount: 9, lastWornAt: 1600000000000 }];
      old.outfitHistory = [{ id: 'old-outfit', wornAt: 1600000000000, itemIds: ['legacy'] }];
      const legacyOutfits = JSON.stringify(old.outfitHistory);
      a.Store.replaceAll(old);
      const [legacy, unknown, unused, perfume] = a.Store.state.items;
      equal(legacy.wearHistory, { events: [], undatedCount: 7, legacyLastWornAt: 1600000000000 }, 'Legacy count/date preserved');
      equal([legacy.wearCount, legacy.lastWornAt], [7, 1600000000000], 'Legacy summaries preserved');
      equal(unknown.wearHistory, { events: [], undatedCount: 3, legacyLastWornAt: null }, 'Unknown dates stay unknown');
      equal(unused.wearHistory, { events: [], undatedCount: 0, legacyLastWornAt: null }, 'Zero count stays zero');
      assert(!perfume.wearHistory && perfume.wearCount === 9 && perfume.lastWornAt === 1600000000000, 'Perfume stored values untouched');
      equal(JSON.stringify(a.Store.state.outfitHistory), legacyOutfits, 'No reconstruction from outfits');
      const migrated = a.Store.exportJSON();
      a.Store._migrate(); a.Store._migrate();
      equal(a.Store.exportJSON(), migrated, 'Migration idempotent');
      a.Store._state = null;
      equal(a.Store.exportJSON(), migrated, 'Local reload preserves history');
    });
    await check('Quick wear and Undo work on cards/list rows and reject repeat submission', async () => {
      const item = clothingItem('quick', 2, 1600000000000);
      a.Store.state.items = [item]; a.Store.save();
      for (const renderRow of [a.itemCard, a.itemListRow]) {
        const row = renderRow(item);
        const wear = row.querySelector('[data-act="wear"]');
        wear.click(); wear.click();
        const event = item.wearHistory.events.at(-1);
        equal([item.wearCount, item.wearHistory.events.length], [3, 1], 'Exactly one quick event');
        assert(event.id.startsWith('wear_') && item.lastWornAt === event.wornAt, 'Timestamp and summary agree');
        const refreshed = renderRow(item);
        const undo = refreshed.querySelector('[data-act="undo"]');
        undo.click(); undo.click();
        equal([item.wearCount, item.lastWornAt, item.wearHistory.events.length], [2, 1600000000000, 0], 'Undo restores prior state once');
      }
      a.WearHistory.undo(item); a.WearHistory.undo(item);
      equal([item.wearCount, item.lastWornAt], [0, null], 'Undo exhausts unknown count safely');
      assert(!a.WearHistory.undo(item), 'Zero undo is a no-op');
      const row = a.itemCard(item);
      row.querySelector('[data-act="wear"]').dispatchEvent(new a.MouseEvent('click', { detail: 2 }));
      equal(item.wearCount, 0, 'Second click of double click ignored on newly rendered button');
      a.WearHistory.record(item, 1600000000000);
      a.WearHistory.record(item, 1700000000000);
      a.WearHistory.record(item, 1650000000000);
      assert(new Set(item.wearHistory.events.map(event => event.id)).size === 3, 'Event IDs unique');
      a.WearHistory.undo(item);
      equal(item.lastWornAt, 1700000000000, 'Undo older backfill keeps newest date');
      a.WearHistory.undo(item);
      equal(item.lastWornAt, 1600000000000, 'Undo newest wear restores previous dated wear');
    });
    await check('Existing past-wear form records chosen local date once and keeps last worn forward', async () => {
      const item = clothingItem('past', 4, 1700000000000);
      a.Store.state.items = [item]; a.Store.save();
      a.openBackfillModal(item);
      const form = a.document.querySelector('#backfill-form');
      form.elements.namedItem('date').value = '2020-02-29';
      submit(a, form); submit(a, form);
      equal(item.wearCount, 5, 'Past submission adds once');
      equal(item.wearHistory.events[0].wornAt, new a.Date('2020-02-29T12:00:00').getTime(), 'Local calendar date retained');
      equal(item.lastWornAt, 1700000000000, 'Old wear cannot move last worn back');
      a.WearHistory.record(item, 1750000000000);
      a.openBackfillModal(item);
      const form2 = a.document.querySelector('#backfill-form');
      form2.elements.namedItem('date').value = '2021-01-01';
      submit(a, form2);
      equal(item.lastWornAt, 1750000000000, 'Backfill cannot move latest event back');
      a.WearHistory.undo(item);
      equal(item.lastWornAt, 1750000000000, 'Undo removes last logged backfill, not latest date');
      a.WearHistory.undo(item);
      equal(item.lastWornAt, 1700000000000, 'Undo latest date restores legacy baseline');
      a.openBackfillModal(item);
      const invalid = a.document.querySelector('#backfill-form');
      invalid.elements.namedItem('date').value = '2099-01-01';
      const count = item.wearCount;
      submit(a, invalid);
      equal(item.wearCount, count, 'Future date rejected');
      invalid.elements.namedItem('date').value = '';
      submit(a, invalid);
      equal(item.wearCount, count, 'Empty date rejected');
      a.Modal.close();
    });
    await check('Outfit wear creates dated item events and preserves independent outfit logs', async () => {
      const shirt = clothingItem('outfit-shirt', 1, 1600000000000);
      const pants = { ...clothingItem('outfit-pants'), categoryId: 'cat_pants' };
      const perfume = { id: 'scent', categoryId: 'cat_perfumes', tags: [], wearCount: 8, lastWornAt: 1600000000000 };
      a.Store.state.items = [shirt, pants, perfume]; a.Store.state.outfitHistory = []; a.Store.save();
      a.eval("outfitSelectedIds = new Set(['outfit-shirt', 'outfit-pants', 'scent']);");
      const summary = a.renderOutfitSummary(a.Store.state.items, () => {});
      const wear = summary.querySelector('#outfit-wear'); wear.click(); wear.click();
      const log = a.Store.state.outfitHistory[0];
      equal(log.itemIds, ['outfit-shirt', 'outfit-pants', 'scent'], 'Outfit keeps exact selection including perfume');
      equal([shirt.wearCount, pants.wearCount, perfume.wearCount], [2, 1, 8], 'Clothing only wears');
      assert(shirt.wearHistory.events[0].wornAt === log.wornAt && pants.wearHistory.events[0].wornAt === log.wornAt, 'Shared outfit date');
      assert(!perfume.wearHistory, 'No perfume events');
      a.WearHistory.undo(shirt); a.Store.save();
      assert(a.Store.state.outfitHistory.length === 1 && pants.wearCount === 1, 'Individual undo leaves outfit and other items intact');
      let remove;
      a.Modal.confirm = (_, yes) => { remove = yes; };
      const history = a.renderOutfitHistory(); history.querySelector('button').click(); remove();
      equal([pants.wearCount, pants.wearHistory.events.length, a.Store.state.outfitHistory.length], [1, 1, 0], 'Outfit removal leaves item history intact');
    });
    await check('Count edits preserve dated history, handle undated counts, and do not mutate on cancel', async () => {
      const item = clothingItem('edit', 5, 1600000000000);
      a.Store.state.items = [item]; a.Store.save();
      a.WearHistory.record(item, 1700000000000);
      const event = JSON.stringify(item.wearHistory.events);
      assert(a.WearHistory.setCount(item, 8), 'Count increase accepted');
      equal(item.wearHistory.undatedCount, 7, 'Increase adds unknown wears');
      assert(a.WearHistory.setCount(item, 1), 'Undated wears can be removed');
      equal([item.wearCount, item.lastWornAt, item.wearHistory.legacyLastWornAt], [1, 1700000000000, null], 'Legacy baseline removed when no undated wears');
      const before = JSON.stringify(item);
      assert(!a.WearHistory.setCount(item, 0), 'Cannot delete dated history by count edit');
      equal(JSON.stringify(item), before, 'Rejected edit does not mutate');
      a.openItemModal(item);
      const form = a.document.querySelector('#item-form');
      form.elements.namedItem('wearCount').value = '4';
      form.querySelector('#item-cancel').click();
      equal(JSON.stringify(item), before, 'Cancelled form changes nothing');
      a.openItemModal(item);
      const save = a.document.querySelector('#item-form');
      save.elements.namedItem('wearCount').value = '4';
      save.elements.namedItem('subtext').value = 'Edited description';
      submit(a, save); submit(a, save);
      await new Promise(resolve => a.setTimeout(resolve, 0));
      const updated = a.Store.state.items[0];
      equal([updated.wearCount, updated.wearHistory.undatedCount, updated.lastWornAt], [4, 3, 1700000000000], 'Saved edit updates unknown count only');
      equal(JSON.stringify(updated.wearHistory.events), event, 'Edited item retains same dated events');
      assert(updated.subtext === 'Edited description' && updated !== item, 'Clone replaces item');
      equal(JSON.stringify(item), before, 'Original history not mutated by shallow clone');
    });
    await check('Retirement preserves readable per-item history; perfumes have no wear UI or CPW', async () => {
      const item = a.Store.state.items[0];
      const before = JSON.stringify(item.wearHistory);
      a.openRetireModal(item);
      submit(a, a.document.querySelector('#retire-form'));
      equal(JSON.stringify(item.wearHistory), before, 'Retirement preserves history');
      assert(item.status === 'retired' && !a.WearHistory.record(item), 'Retired items cannot record wears');
      const card = a.itemCard(item);
      assert(card.querySelector('[data-act="history"]') && !card.querySelector('[data-act="wear"]'), 'Retired history accessible');
      card.querySelector('[data-act="history"]').click();
      assert(a.document.querySelector('.wear-history time'), 'History date shown');
      a.Modal.close();
      card.querySelector('[data-act="reactivate"]').click();
      assert(item.status === 'active', 'Reactivation works');
      equal(JSON.stringify(item.wearHistory), before, 'Reactivation preserves history');
      const perfume = { ...clothingItem('perfume-ui', 100, 1600000000000), categoryId: 'cat_perfumes' };
      assert(!a.WearHistory.record(perfume) && !a.WearHistory.undo(perfume), 'Perfume wear helpers are no-ops');
      equal(a.costPerWear(perfume), null, 'Perfume has no CPW');
      for (const renderRow of [a.itemCard, a.itemListRow]) {
        const row = renderRow(perfume);
        assert(!row.querySelector('[data-act="wear"], [data-act="undo"], [data-act="history"], [data-act="backfill"]'), 'No perfume wear controls');
        assert(row.querySelector('[data-act="retire"]'), 'Perfume retirement preserved');
      }
      a.openItemModal(perfume);
      const form = a.document.querySelector('#item-form');
      assert(form.querySelector('#wear-count-field').hidden && form.elements.namedItem('wearCount').disabled, 'Perfume count editor excluded');
      a.Modal.close();
    });
    await check('New and old JSON backups/Gists round trip item history with whole-wardrobe conflicts', async () => {
      const item = a.Store.state.items[0];
      a.WearHistory.record(item, 1760000000000); a.Store.save();
      const history = JSON.stringify(item.wearHistory);
      const backup = a.Store.exportJSON();
      b.Store.replaceAll(JSON.parse(backup));
      equal(JSON.stringify(b.Store.state.items[0].wearHistory), history, 'New JSON restore retains events and unknown count');
      const summary = [item.wearCount, item.lastWornAt];
      equal([b.Store.state.items[0].wearCount, b.Store.state.items[0].lastWornAt], summary, 'Restored summaries consistent');
      await a.SyncEngine.push({ resolveConflict: true });
      await b.SyncEngine.pull({ resolveConflict: true });
      equal(JSON.stringify(b.Store.state.items[0].wearHistory), history, 'Gist round trip retains history');
      assert(!cloud.files['rack-wardrobe.json'].content.includes('data:image/'), 'History never stores photos');
      markClean(b);
      const lastSaved = b.Store.state.meta.updatedAt;
      b.WearHistory.record(b.Store.state.items[0], 1760100000000); b.Store.save();
      assert(b.Store.state.meta.updatedAt > lastSaved, 'Every edit is visible to sync');
      const nativeNow = b.Date.now;
      const sameTime = b.Store.state.meta.updatedAt;
      b.Date.now = () => sameTime;
      try { b.Store.save(); b.Store.save(); }
      finally { b.Date.now = nativeNow; }
      assert(b.Store.state.meta.updatedAt === sameTime + 2, 'Same-millisecond saves remain visible to sync');
      advance();
      assert((await b.SyncEngine.pull()).conflict && (await b.SyncEngine.push()).conflict, 'Dated history edits participate in conflict');
      await b.SyncEngine.pull({ resolveConflict: true });
      equal(JSON.stringify(b.Store.state.items[0].wearHistory), history, 'Conflict Pull replaces entire history');
      markClean(b); b.WearHistory.undo(b.Store.state.items[0]); b.Store.save(); advance();
      await b.SyncEngine.push({ resolveConflict: true });
      equal(JSON.parse(cloud.files['rack-wardrobe.json'].content).items[0].wearHistory, b.Store.state.items[0].wearHistory, 'Conflict Push replaces remote history');
      const old = JSON.parse(backup); delete old.items[0].wearHistory;
      b.Store.replaceAll(JSON.parse(JSON.stringify(old)));
      equal(b.Store.state.items[0].wearHistory.events, [], 'Old JSON has no invented events');
      equal([b.Store.state.items[0].wearCount, b.Store.state.items[0].lastWornAt], summary, 'Old JSON keeps legacy summaries');
      cloudFile('rack-wardrobe.json', old); advance();
      await b.SyncEngine.pull({ resolveConflict: true });
      equal([b.Store.state.items[0].wearCount, b.Store.state.items[0].lastWornAt], summary, 'Old Gist keeps legacy summaries');
      equal(b.Store.state.items[0].wearHistory.events, [], 'Old Gist migrates without duplicates');
    });
    await runReviewChecks({ check, assert, equal, device, image });
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
