/* Roadmap regressions, using isolated data and the mocked Gist device harness. */
async function runMilestoneChecks({ check, assert, equal, device }) {
  const w = await device();
  const stamp = (month, day, hour = 12) => new Date(2026, month, day, hour).getTime();
  const clothing = (id, status = 'active') => ({ id, categoryId: 'cat_shirts',
    subcategoryId: 'sub_shirts_t-shirts', colorId: 'col_white', brandId: '', tags: [],
    status, subtext: id, wearHistory: { events: [], undatedCount: 4, legacyLastWornAt: stamp(7, 10) } });
  await check('Monthly insights respect local month boundaries, retired items and undated/perfume exclusions', async () => {
    const a = clothing('first'), b = clothing('retired', 'retired'), perfume = clothing('perfume');
    perfume.categoryId = 'cat_perfumes';
    a.wearHistory.events = [stamp(8, 1, 0), stamp(8, 1), stamp(8, 30), stamp(9, 1, 0)].map((wornAt, i) => ({ id: `a-${i}`, wornAt }));
    b.wearHistory.events = [{ id: 'b', wornAt: stamp(8, 30) }];
    perfume.wearHistory.events = [{ id: 'p', wornAt: stamp(8, 2) }];
    w.Store.state.items = [a, b, perfume]; w.Store.save();
    const before = w.Store.exportJSON();
    const summary = w.WearInsights.forMonth(w.Store.state.items, 2026, 8);
    equal([summary.events.length, summary.days, summary.uniqueItems, summary.undatedCount], [4, 2, 2, 8], 'Monthly counts are dated clothing only');
    equal(summary.topItems.map(row => [row.item.id, row.count]), [['first', 3], ['retired', 1]], 'Most-worn ranking includes retired history');
    equal(w.WearInsights.forMonth(w.Store.state.items, 2026, 9).events.length, 1, 'Midnight wear belongs to the following month');
    equal(w.Store.exportJSON(), before, 'Browsing never changes wardrobe data or sync timestamp');
    w.openWardrobeHistoryModal(new Date(2026, 8, 1));
    const body = w.document.querySelector('#modal-box');
    assert(body.textContent.includes('8 undated wears') && body.textContent.includes('Retired'), 'UI explains legacy and retired history');
    body.querySelector('#wear-prev').click();
    assert(body.textContent.includes('No dated clothing wears'), 'Older empty month is clear');
    body.querySelector('#wear-next').click();
    assert(body.querySelectorAll('#wear-month-events li').length === 4, 'Month navigation restores all recorded events');
    w.Modal.close();
    w.WearHistory.undo(a);
    equal(w.WearInsights.forMonth(w.Store.state.items, 2026, 9).events.length, 0, 'Undo updates insights without duplicating outfit logs');
  });
  await check('Damaged backups cannot replace saved data, while optional legacy fields still migrate', async () => {
    w.Store.save();
    const before = w.Store.exportJSON();
    const invalid = [
      state => { state.items.push({ ...state.items[0] }); },
      state => { state.items[0].wearHistory.events[0].wornAt = 'not-a-date'; },
      state => { state.items[0].wearHistory.undatedCount = -1; },
      state => { state.tags[0].categoryIds = {}; },
      state => { state.activities[0].includeRules = {}; },
      state => { state.outfitHistory = {}; },
      state => { state.appearance.customThemes = {}; },
    ];
    for (const damage of invalid) {
      const snapshot = JSON.parse(before); damage(snapshot);
      let failed = false; try { w.Store.replaceAll(snapshot); } catch (_) { failed = true; }
      assert(failed, 'Malformed snapshot rejected');
      equal(w.Store.exportJSON(), before, 'In-memory data retained');
      equal(JSON.parse(w.localStorage.getItem('rack.wardrobe.v1')), JSON.parse(before), 'Saved data retained');
    }
    const legacy = w.buildDefaultState(); delete legacy.items; delete legacy.brands; delete legacy.outfitHistory;
    w.Store.replaceAll(legacy);
    equal(w.Store.state.items, [], 'Optional old fields migrate');
  });
  await check('Filters use the accessible modal and return their controls and focus on close', async () => {
    w.frameElement.hidden = false;
    const wardrobe = w.renderWardrobe(); w.document.body.appendChild(wardrobe);
    const opener = wardrobe.querySelector('#filters-toggle-btn'); opener.focus(); opener.click();
    const modal = w.document.querySelector('#modal-box');
    assert(modal.querySelector('#toolbar-filters'), 'Filter controls moved into modal');
    assert([...modal.querySelectorAll('select')].every(select => select.closest('label')), 'Each filter has a visible label');
    assert(opener.getAttribute('aria-expanded') === 'true' && wardrobe.inert, 'Expanded state and background isolation');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(wardrobe.querySelector('#toolbar-filters') && !wardrobe.inert, 'Controls returned and background available');
    assert(w.document.activeElement === opener && opener.getAttribute('aria-expanded') === 'false', 'Focus and expanded state restored');
    wardrobe.remove(); w.frameElement.hidden = true;
  });
  await check('Malformed filter preferences recover and retired dashboard links clear stale searches', async () => {
    w.localStorage.setItem('rack.wardrobe.filters', JSON.stringify({ search: {}, category: null, status: 'wrong', sort: 'wrong' }));
    equal(w.eval('loadWardrobeFilters()'), w.eval('DEFAULT_WARDROBE_FILTERS'), 'Invalid preferences fall back safely');
    w.Store.state.items = [clothing('retired', 'retired')]; w.Store.save();
    w.eval("wardrobeFilters = { ...DEFAULT_WARDROBE_FILTERS, search: 'hidden', activity: 'gone' }; switchTab = () => {};");
    const dashboard = w.renderDashboard(); dashboard.querySelector('#empty-retired').click();
    equal(w.eval('[wardrobeFilters.search, wardrobeFilters.activity, wardrobeFilters.status]'), ['', '', 'retired'], 'Retired items visible without stale filters');
  });
  await check('Bookshelf migration is additive and idempotent without changing wardrobe metrics', async () => {
    const old = w.buildDefaultState(); delete old.books;
    old.items = [clothing('existing-clothing')];
    w.Store.replaceAll(old);
    equal(w.Store.state.books, [], 'Old wardrobe receives an empty bookshelf');
    const before = JSON.stringify(w.Store.state.items);
    const book = w.BookCollection.save({ title: '  Sample book  ', author: 'An author', genre: 'History', type: 'non-fiction', format: 'ebook', readingStatus: 'reading' });
    equal(book.title, 'Sample book', 'Title normalized');
    w.Store._migrate(); w.Store._migrate();
    equal(w.Store.state.books.length, 1, 'Repeated migrations preserve one book');
    equal(JSON.stringify(w.Store.state.items), before, 'Wardrobe history and counts unaffected');
    assert(!w.Store.state.categories.some(category => category.name === 'Books'), 'No wardrobe category added');
    const saved = w.Store.exportJSON();
    w.setBookshelfEnabled(false);
    assert(!w.bookshelfEnabled(), 'Bookshelf can be hidden');
    equal(w.Store.exportJSON(), saved, 'Hiding the collection cannot delete or edit books');
    w.setBookshelfEnabled(true);
    assert(w.bookshelfEnabled(), 'Bookshelf can be enabled');
  });
  await check('Book forms support editing, cancel, search, safe rendering, archive and restore', async () => {
    w.Store.state.books = []; w.Store.save();
    const submit = form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    w.openBookModal();
    let form = w.document.querySelector('#book-form');
    form.elements.title.value = '<img src=x onerror=alert(1)> A book';
    form.elements.author.value = 'A writer'; form.elements.genre.value = 'History';
    form.elements.type.value = 'non-fiction'; form.elements.format.value = 'audiobook'; form.elements.readingStatus.value = 'paused';
    submit(form); submit(form);
    equal(w.Store.state.books.length, 1, 'Repeated submit adds one book');
    const book = w.Store.state.books[0];
    w.openBookModal(book); form = w.document.querySelector('#book-form');
    form.elements.title.value = 'Cancelled edit'; w.Modal.close();
    assert(book.title.includes('<img'), 'Cancel preserves original title');
    w.openBookModal(book); form = w.document.querySelector('#book-form');
    form.elements.readingStatus.value = 'finished'; submit(form);
    equal(w.Store.state.books[0].readingStatus, 'finished', 'Reading status edited');
    const shelf = w.renderBookshelf();
    assert(!shelf.querySelector('img') && shelf.textContent.includes('<img src=x'), 'Book title rendered as text');
    const search = shelf.querySelector('#bookshelf-search');
    search.value = 'a writer'; search.dispatchEvent(new w.Event('input'));
    assert(shelf.querySelectorAll('.book-card').length === 1, 'Search matches author');
    search.value = 'history'; search.dispatchEvent(new w.Event('input'));
    assert(shelf.querySelectorAll('.book-card').length === 1, 'Search matches genre');
    search.value = 'missing'; search.dispatchEvent(new w.Event('input'));
    assert(shelf.querySelector('#bookshelf-clear-search'), 'Empty search has recovery action');
    shelf.querySelector('#bookshelf-clear-search').click();
    shelf.querySelector('[data-book-act="archive"]').click();
    assert(!w.Store.state.books[0].archived, 'Archive waits for confirmation');
    w.document.querySelector('#confirm-no').click();
    assert(!w.Store.state.books[0].archived, 'Cancelled archive keeps book');
    shelf.querySelector('[data-book-act="archive"]').click(); w.document.querySelector('#confirm-yes').click();
    assert(w.Store.state.books[0].archived, 'Archive preserves the book');
    w.eval("bookshelfArchiveFilter = 'archived'");
    const archived = w.renderBookshelf(); archived.querySelector('[data-book-act="archive"]').click();
    assert(!w.Store.state.books[0].archived, 'Restore returns the archived book');
    w.eval("bookshelfArchiveFilter = 'active'");
  });
  await check('Book save/archive failures preserve memory, persisted data and sync timestamps', async () => {
    const before = w.Store.exportJSON(), timestamp = w.Store.state.meta.updatedAt;
    const setItem = w.localStorage.setItem;
    w.localStorage.setItem = () => { throw new Error('Simulated storage full'); };
    try {
      for (const action of [
        () => w.BookCollection.save({ title: 'Failed add', author: '', genre: '', type: 'fiction', format: 'paperback', readingStatus: 'to-read' }),
        () => w.BookCollection.archive(w.Store.state.books[0].id, true),
        () => w.BookCollection.save({ ...w.Store.state.books[0], title: 'Failed edit' }, w.Store.state.books[0].id),
      ]) {
        let failed = false; try { action(); } catch (_) { failed = true; }
        assert(failed, 'Failed save reports an error');
        equal(w.Store.exportJSON(), before, 'Book change rolled back');
        equal(w.Store.state.meta.updatedAt, timestamp, 'Failed save does not create a sync edit');
      }
    } finally { w.localStorage.setItem = setItem; }
    equal(JSON.parse(w.localStorage.getItem('rack.wardrobe.v1')), JSON.parse(before), 'Persisted snapshot unchanged');
  });
  await check('Books round trip through backups, reload and mocked Gist snapshots; malformed books are rejected', async () => {
    const books = JSON.stringify(w.Store.state.books), backup = w.Store.exportJSON();
    const other = await device();
    other.Store.replaceAll(JSON.parse(backup)); other.Store._state = null;
    equal(JSON.stringify(other.Store.state.books), books, 'Backup and local reload preserve book fields');
    assert(other.bookshelfEnabled(), 'New device with books shows the optional collection');
    await w.SyncEngine.push(); other.Sync.setGistId(w.Sync.getGistId());
    await other.SyncEngine.pull({ resolveConflict: true });
    equal(JSON.stringify(other.Store.state.books), books, 'Gist includes books with ordinary data');
    const saved = other.Store.exportJSON();
    for (const damage of [
      state => { state.books = {}; },
      state => { state.books.push({ ...state.books[0] }); },
      state => { state.books[0].title = ''; },
      state => { state.books[0].readingStatus = 'invalid'; },
    ]) {
      const state = JSON.parse(saved); damage(state);
      let failed = false; try { other.Store.replaceAll(state); } catch (_) { failed = true; }
      assert(failed, 'Malformed book data rejected');
      equal(other.Store.exportJSON(), saved, 'Current books and wardrobe retained');
    }
    const legacy = JSON.parse(backup); delete legacy.books;
    other.Store.replaceAll(legacy);
    equal(other.Store.state.books, [], 'Old backup restores an empty bookshelf explicitly');
  });
}
