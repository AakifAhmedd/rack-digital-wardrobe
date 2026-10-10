/* Focused regression cases found during the repository review. Uses the same
   isolated browser/device harness as sync.js; no real wardrobe or credentials. */
async function runReviewChecks({ check, assert, equal, device, image }) {
  const w = await device();
  const submit = form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const item = { id: 'review-item', categoryId: 'cat_shirts', subcategoryId: 'sub_shirts_collared-shirts',
    colorId: 'col_white', brandId: '', tags: ['tag_cotton'], status: 'active', wearCount: 2, cost: 100 };
  w.Store.state.items = [item]; w.Store.save();
  await check('Advanced activity rules survive opening, renaming and saving', async () => {
    for (const rules of [
      [{ category: 'cat_shirts', subcategory: 'sub_shirts_collared-shirts', requiredTags: ['tag_cotton'], excludeTags: ['tag_sporty'] }],
      [{ requiredTags: ['tag_cotton'] }],
      [{ category: 'cat_shirts', requiredTags: ['tag_cotton'] }, { category: 'cat_shirts', requiredTags: ['tag_linen'] }],
      [{}],
    ]) {
      const activity = { id: 'review-activity', name: 'Review', includeRules: rules, excludeCategories: [], excludeSubcategories: [], excludeTags: [] };
      w.Store.state.activities = [activity];
      w.openActivityModal(activity);
      const form = w.document.querySelector('#activity-form');
      form.elements.namedItem('name').value = 'Renamed'; submit(form);
      equal(w.Store.state.activities[0].includeRules, rules, 'Raw rule semantics preserved');
    }
  });
  await check('Failed wardrobe replacement preserves the current in-memory and persisted wardrobe', async () => {
    const original = w.Store.state, saved = w.Store.exportJSON();
    for (const invalid of [null, {}, { categories: [], items: [{ wearHistory: {} }] }]) {
      let failed = false;
      try { w.Store.replaceAll(invalid); } catch (_) { failed = true; }
      assert(failed, 'Malformed replacement fails');
      assert(w.Store.state === original, 'Current state identity retained');
      equal(w.Store.exportJSON(), saved, 'Current wardrobe untouched');
    }
    const setItem = w.localStorage.setItem;
    w.localStorage.setItem = () => { throw new Error('Simulated quota failure'); };
    try {
      let failed = false;
      try { w.Store.replaceAll(w.buildDefaultState()); } catch (_) { failed = true; }
      assert(failed && w.Store.state === original, 'Quota failure retains current wardrobe');
    } finally { w.localStorage.setItem = setItem; }
    equal(JSON.parse(w.localStorage.getItem('rack.wardrobe.v1')), JSON.parse(saved), 'Persisted wardrobe unchanged');
  });
  await check('Unreadable saved wardrobe is preserved for recovery instead of overwritten', async () => {
    const saved = w.localStorage.getItem('rack.wardrobe.v1');
    for (const raw of ['{broken', JSON.stringify({ categories: [] })]) {
      w.localStorage.setItem('rack.wardrobe.v1', raw); w.Store._state = null;
      let failed = false;
      try { w.Store.load(); } catch (_) { failed = true; }
      assert(failed && w.Store._state === null, 'Load reports failure without retaining partial state');
      equal(w.localStorage.getItem('rack.wardrobe.v1'), raw, 'Original bytes preserved');
    }
    w.localStorage.setItem('rack.wardrobe.v1', saved); w.Store._state = null; w.Store.load();
  });
  await check('Photo writes reject a transaction aborted after request success', async () => {
    const red = await image(w, 'red');
    const open = w.RackPhotos._open;
    const db = await open.call(w.RackPhotos);
    for (const action of ['put', 'delete']) {
      w.RackPhotos._open = async () => ({ transaction: (...args) => {
        const tx = db.transaction(...args), store = tx.objectStore('photos');
        const method = store[action].bind(store);
        store[action] = (...values) => {
          const request = method(...values);
          request.addEventListener('success', () => tx.abort());
          return request;
        };
        return tx;
      } });
      let failed = false;
      try { await w.RackPhotos[action]('review-item', red); } catch (_) { failed = true; }
      assert(failed, `${action} must report aborted transaction`);
    }
    w.RackPhotos._open = open;
  });
  await check('Manual photo restore validates images and versions while remaining additive', async () => {
    const red = await image(w, 'red');
    await w.RackPhotos.put('keep', red);
    const valid = await w.RackPhotos._blobToDataUrl(red);
    const restored = await w.RackPhotos.importAll({ format: 'rack-photos', version: 1,
      photos: { 'review-item': valid, bad: 'data:image/png;base64,YmFk', remote: 'https://example.invalid/image.png' } }, new Set(['review-item', 'bad', 'remote']));
    equal(restored, { restored: 1, skipped: 2 }, 'Only valid raster images imported');
    assert(await w.RackPhotos.get('keep'), 'Unmentioned photos retained');
    let failed = false;
    try { await w.RackPhotos.importAll({ format: 'rack-photos', version: 2, photos: {} }, new Set()); } catch (_) { failed = true; }
    assert(failed, 'Unsupported version rejected');
  });
  await check('Stored activity names, colors, currency and logos render as data', async () => {
    const payload = '"><img data-injected src=x>';
    w.Store.state.categories[0].name = payload;
    w.Store.state.activities = [{ id: 'act', name: 'Test', includeRules: [{ category: w.Store.state.categories[0].id }] }];
    assert(!w.renderActivitiesPanel().querySelector('[data-injected]'), 'Rule summary escaped');
    w.Store.state.colors[0].hex = payload;
    const colored = { ...item, colorId: w.Store.state.colors[0].id };
    assert(!w.itemCard(colored).querySelector('[data-injected]'), 'Color cannot break out of style attribute');
    w.Store.state.meta.currency = payload;
    assert(!w.itemCard(item).querySelector('[data-injected]'), 'Currency escaped');
    const host = w.document.createElement('div');
    host.innerHTML = w.BrandLogo.html({ name: 'Custom', logo: payload }, 16, payload);
    assert(!host.querySelector('[data-injected]'), 'Logo and title escaped');
    w.Store.state.meta.currency = 'LKR';
    assert(w.itemCard({ ...item, cost: 0 }).textContent.includes('LKR 0'), 'Zero cost is displayed');
  });
  await check('Deleted filter masters do not leave invisible filters or crash wardrobe', async () => {
    w.eval("wardrobeFilters = { ...DEFAULT_WARDROBE_FILTERS, category: 'gone', subcategory: 'gone', color: 'gone', activity: 'gone' };");
    w.renderWardrobe();
    equal(w.eval('[wardrobeFilters.category, wardrobeFilters.subcategory, wardrobeFilters.color, wardrobeFilters.activity]'), ['', '', '', ''], 'Dangling filters cleared');
    assert(w.matchActivity(null, item) === false, 'Missing activity cannot crash matching');
  });
  await check('Changing subcategory and brand scope keeps current form selections', async () => {
    w.Store.state.brands.push({ id: 'review-brand', name: 'Review', scope: 'clothing' });
    w.openItemModal(item);
    const form = w.document.querySelector('#item-form');
    form.elements.namedItem('brandId').value = 'review-brand';
    const cotton = form.querySelector('#tag-checks input[value="tag_cotton"]'); cotton.checked = false;
    form.querySelector('#tag-checks input[value="tag_formal"]').checked = true;
    form.elements.namedItem('subcategoryId').value = 'sub_shirts_dress-shirts';
    form.elements.namedItem('subcategoryId').dispatchEvent(new w.Event('change'));
    assert(form.querySelector('#tag-checks input[value="tag_formal"]').checked && !form.querySelector('#tag-checks input[value="tag_cotton"]').checked, 'Unsaved tag edits retained');
    form.querySelector('#show-all-brands').click();
    equal(form.elements.namedItem('brandId').value, 'review-brand', 'Selected brand retained');
    w.Modal.close();
  });
  await check('Modal has dialog semantics, contains keyboard focus and restores its opener', async () => {
    w.frameElement.hidden = false;
    const opener = w.document.createElement('button'); w.document.body.append(opener); opener.focus();
    w.Modal.open('Review dialog', '<button id="first">First</button><button id="last">Last</button>');
    const box = w.document.querySelector('#modal-box');
    equal(box.getAttribute('role'), 'dialog', 'Dialog role');
    assert(box.contains(w.document.activeElement), 'Focus moved inside dialog');
    w.document.querySelector('#last').focus();
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    equal(w.document.activeElement.id, 'modal-close', 'Tab wraps inside dialog');
    w.Modal.close(); assert(w.document.activeElement === opener, 'Focus restored'); opener.remove();
  });
  await check('A local edit during Pull requires another conflict choice, even after resolving a prior conflict', async () => {
    const read = w.Sync.pullFromCloud;
    for (const resolveConflict of [false, true]) {
      const before = w.Store.state;
      let finish;
      w.Sync.pullFromCloud = () => new Promise(resolve => { finish = resolve; });
      const pulling = w.SyncEngine.pull({ resolveConflict });
      before.items[0].subtext = 'Edited during pull'; w.Store.save();
      finish({ data: w.buildDefaultState(), updatedAt: 'unchanged', photoWarning: 'No photos' });
      assert((await pulling).conflict, 'Concurrent local edit prompts');
      assert(w.Store.state === before, 'Concurrent edit retained');
    }
    w.Sync.pullFromCloud = read;
  });
  await check('Background retry increases its delay and resets after success', async () => {
    const setTimer = w.setTimeout, checkRemote = w.Sync.fetchRemoteUpdatedAt;
    const delays = [];
    w.setTimeout = (_, delay) => { delays.push(delay); return 1; };
    w.Sync.isConnected = () => true;
    w.Sync.fetchRemoteUpdatedAt = async () => { throw new Error('Offline'); };
    try {
      for (let n = 0; n < 3; n++) {
        try { await w.SyncEngine.checkAndAutoSync(); } catch (_) { /* expected */ }
      }
      equal(delays, [15000, 30000, 60000], 'Exponential backoff');
      w.Sync.fetchRemoteUpdatedAt = async () => null;
      await w.SyncEngine.checkAndAutoSync();
      equal(w.SyncEngine._retryDelay, 15000, 'Successful check resets backoff');
    } finally { w.setTimeout = setTimer; w.Sync.fetchRemoteUpdatedAt = checkRemote; w.SyncEngine._clearRetry(); }
  });
  await check('Saving waits for photo processing and closing releases the preview URL', async () => {
    const perfume = { ...item, categoryId: 'cat_perfumes', subcategoryId: 'sub_perfumes_designer', subtext: 'Test bottle' };
    w.Store.state.items = [perfume]; w.Store.save();
    const process = w.RackPhotos.processImageFile, revoke = w.URL.revokeObjectURL;
    let finish, released = 0;
    w.RackPhotos.processImageFile = () => new Promise(resolve => { finish = resolve; });
    w.URL.revokeObjectURL = url => { released++; revoke.call(w.URL, url); };
    try {
      w.openItemModal(perfume);
      const form = w.document.querySelector('#item-form');
      const input = form.querySelector('#photo-input'), files = new w.DataTransfer();
      files.items.add(new w.File(['image'], 'bottle.png', { type: 'image/png' }));
      input.files = files.files; input.dispatchEvent(new w.Event('change'));
      assert(form.querySelector('[type="submit"]').disabled, 'Save disabled during decode');
      submit(form); assert(w.Store.state.items[0] === perfume, 'Early submit does not commit');
      finish(await image(w, 'blue'));
      await new Promise(resolve => setTimeout(resolve, 30));
      assert(!form.querySelector('[type="submit"]').disabled, 'Save restored after decoding');
      w.Modal.close(); assert(released > 0, 'Preview URL revoked on close');
    } finally { w.RackPhotos.processImageFile = process; w.URL.revokeObjectURL = revoke; }
  });
  await check('Service worker preserves unrelated caches, uses exact asset versions and tolerates cache failure', async () => {
    const source = await (await fetch('../sw.js')).text();
    const handlers = {}, cached = new Map();
    const base = 'https://rack.example/rack/';
    const key = req => new URL(typeof req === 'string' ? req : req.url, base).href;
    let offline = false, cacheFailure = false, writeFailure = false, deleted = 0;
    const cache = {
      addAll: async () => {},
      put: async (req, response) => { if (writeFailure) throw new Error('Quota'); cached.set(key(req), response); },
      match: async req => cached.get(key(req)),
    };
    const fakeCaches = {
      open: async () => { if (cacheFailure) throw new Error('Cache unavailable'); return cache; },
      keys: async () => ['other-app', 'rack-shell-v1'], delete: async () => { deleted++; },
    };
    const fakeSelf = { registration: { scope: base }, location: { origin: 'https://rack.example' },
      clients: { claim: async () => {} }, skipWaiting: async () => {},
      addEventListener: (name, fn) => { handlers[name] = fn; } };
    const fakeFetch = async () => { if (offline) throw new Error('Offline'); return new Response('network'); };
    new Function('self', 'caches', 'fetch', source)(fakeSelf, fakeCaches, fakeFetch);
    let activation; handlers.activate({ waitUntil: p => { activation = p; } }); await activation;
    equal(deleted, 0, 'Other caches untouched');
    const request = (url, mode = 'cors') => {
      let response;
      handlers.fetch({ request: { url, mode, method: 'GET' }, respondWith: p => { response = p; } });
      return response;
    };
    equal(request('https://rack.example/other-app/'), undefined, 'Other app requests untouched');
    equal(request('https://api.github.com/gists'), undefined, 'Gist requests untouched');
    cached.set(base + 'js/app.js?v=old', new Response('old'));
    cached.set(base + 'js/app.js?v=new', new Response('new'));
    cached.set(base + 'index.html', new Response('shell'));
    offline = true;
    equal(await (await request(base + 'js/app.js?v=new')).text(), 'new', 'Exact asset token matched');
    equal(await (await request(base + '?tab=outfit', 'navigate')).text(), 'shell', 'Offline shortcut uses shell');
    offline = false; cacheFailure = true;
    equal(await (await request(base + 'js/app.js?v=new')).text(), 'network', 'Network works without cache');
    cacheFailure = false; writeFailure = true;
    equal(await (await request(base + 'js/app.js?v=new')).text(), 'network', 'Cache quota failure does not discard network response');
  });

}
