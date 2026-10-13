/* Bookshelf history, management and summary regressions. Uses isolated devices. */
async function runBooksChecks({ check, assert, equal, device }) {
  const w = await device();
  const values = { title: 'History sample', author: 'Writer', genre: 'History', type: 'non-fiction', format: 'paperback', readingStatus: 'to-read' };
  const book = () => w.Store.state.books[0];
  const submit = form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await check('Reading history migrates old books without inventing dates or changing status', async () => {
    w.BookCollection.save(values);
    const legacy = JSON.parse(w.Store.exportJSON()); delete legacy.books[0].readingHistory;
    legacy.books[0].readingStatus = 'finished';
    w.Store.replaceAll(legacy); w.Store._migrate(); w.Store._migrate();
    equal(book().readingHistory, [], 'Old finished book has no invented reading');
    equal(book().readingStatus, 'finished', 'Existing status kept');
  });
  await check('Reading history supports started, finished, reread and finish-only records without wardrobe edits', async () => {
    const wardrobe = JSON.stringify(w.Store.state.items);
    const started = w.BookReading.save(book().id, { startedOn: '2025-04-01', finishedOn: '' });
    equal(book().readingStatus, 'reading', 'Start changes status');
    w.BookReading.save(book().id, { startedOn: '2025-04-01', finishedOn: '2025-04-12' }, started.id);
    equal(book().readingStatus, 'finished', 'Finish changes status');
    w.BookReading.save(book().id, { startedOn: '2026-01-01', finishedOn: '2026-01-04' });
    w.BookReading.save(book().id, { startedOn: '', finishedOn: '2024-02-29' });
    equal(book().readingHistory.length, 3, 'Reread and finish-only history retained');
    assert(book().readingHistory.some(entry => entry.startedOn === null), 'Unknown start stays unknown');
    equal(JSON.stringify(w.Store.state.items), wardrobe, 'Clothing and perfumes unaffected');
    w.BookCollection.save({ ...book(), title: 'Renamed', readingStatus: 'paused' }, book().id);
    equal(book().readingHistory.length, 3, 'General edit preserves history');
    w.BookCollection.archive(book().id, true); w.BookCollection.archive(book().id, false);
    equal(book().readingHistory.length, 3, 'Archive and restore preserve history');
  });
  await check('Invalid reading dates, multiple open readings and missing edited entries fail without data loss', async () => {
    const open = w.BookReading.save(book().id, { startedOn: '2026-02-01', finishedOn: null });
    for (const [dates, id] of [
      [{ startedOn: '', finishedOn: '' }, null],
      [{ startedOn: '2025-02-29', finishedOn: '' }, null],
      [{ startedOn: '9999-01-01', finishedOn: '' }, null],
      [{ startedOn: '2026-03-03', finishedOn: '2026-03-01' }, null],
      [{ startedOn: '2026-03-03', finishedOn: '' }, null],
      [{ startedOn: '2026-03-03', finishedOn: '2026-03-04' }, 'missing'],
    ]) {
      const before = w.Store.exportJSON(); let failed = false;
      try { w.BookReading.save(book().id, dates, id); } catch (_) { failed = true; }
      assert(failed, 'Invalid reading rejected'); equal(w.Store.exportJSON(), before, 'Saved books retained');
    }
    w.BookReading.save(book().id, { startedOn: '2026-02-01', finishedOn: '2026-02-10' }, open.id);
    const before = w.Store.exportJSON(), invalid = JSON.parse(before);
    invalid.books[0].readingHistory[0].finishedOn = 'not-a-date';
    let failed = false; try { w.Store.replaceAll(invalid); } catch (_) { failed = true; }
    assert(failed, 'Malformed synced/backup history rejected'); equal(w.Store.exportJSON(), before, 'Invalid replacement retains books');
  });
  await check('Reading forms cancel cleanly, save once and require confirmation to remove a record', async () => {
    const before = w.Store.exportJSON();
    w.openBookReadingModal(book().id);
    let form = w.document.querySelector('#book-reading-form');
    form.elements.startedOn.value = '2026-03-01'; form.querySelector('#reading-cancel').click();
    equal(w.Store.exportJSON(), before, 'Cancel changes nothing');
    w.document.querySelector('#book-log-reading').click();
    form = w.document.querySelector('#book-reading-form');
    form.elements.startedOn.value = '2026-03-01'; form.elements.finishedOn.value = '2026-03-03';
    const count = book().readingHistory.length; submit(form); submit(form);
    equal(book().readingHistory.length, count + 1, 'Repeated submit records once');
    w.document.querySelector('[data-reading-act="remove"]').click();
    equal(book().readingHistory.length, count + 1, 'Removal waits for confirmation');
    w.document.querySelector('#confirm-no').click();
    equal(book().readingHistory.length, count + 1, 'Cancelled removal preserves history');
    w.openBookReadingHistory(book().id); w.document.querySelector('[data-reading-act="remove"]').click();
    w.document.querySelector('#confirm-yes').click(); equal(book().readingHistory.length, count, 'Confirmed entry removed');
  });
  await check('Reading changes roll back on storage failure and survive backup, reload and Gist round trips', async () => {
    const before = w.Store.exportJSON(), setItem = w.localStorage.setItem;
    w.localStorage.setItem = () => { throw new Error('Storage full'); };
    try {
      for (const action of [
        () => w.BookReading.save(book().id, { startedOn: '2026-04-01', finishedOn: '2026-04-02' }),
        () => w.BookReading.remove(book().id, book().readingHistory[0].id),
      ]) {
        let failed = false; try { action(); } catch (_) { failed = true; }
        assert(failed, 'Storage failure reported'); equal(w.Store.exportJSON(), before, 'History, status and sync timestamp rolled back');
      }
    } finally { w.localStorage.setItem = setItem; }
    const other = await device(); other.Store.replaceAll(JSON.parse(before)); other.Store._state = null;
    equal(other.Store.state.books[0].readingHistory, book().readingHistory, 'Restore and reload keep history');
    await w.SyncEngine.push(); other.Sync.setGistId(w.Sync.getGistId()); await other.SyncEngine.pull({ resolveConflict: true });
    equal(other.Store.state.books[0].readingHistory, book().readingHistory, 'Gist keeps reading dates');
  });
  await check('Ownership migrates old books, survives edits and rejects invalid snapshot values', async () => {
    const old = JSON.parse(w.Store.exportJSON()); delete old.books[0].ownership;
    const history = JSON.stringify(old.books[0].readingHistory);
    w.Store.replaceAll(old); w.Store._migrate();
    equal(book().ownership, 'owned', 'Old books default to Owned');
    w.BookCollection.save({ ...book(), ownership: 'borrowed' }, book().id);
    equal(book().ownership, 'borrowed', 'Borrowed state saved');
    equal(JSON.stringify(book().readingHistory), history, 'Ownership change keeps reading history');
    const before = w.Store.exportJSON(), invalid = JSON.parse(before); invalid.books[0].ownership = 'invalid';
    let failed = false; try { w.Store.replaceAll(invalid); } catch (_) { failed = true; }
    assert(failed, 'Invalid ownership rejected'); equal(w.Store.exportJSON(), before, 'Failed restore keeps books');
    const other = await device(); await w.SyncEngine.push(); other.Sync.setGistId(w.Sync.getGistId()); await other.SyncEngine.pull();
    equal(other.Store.state.books[0].ownership, 'borrowed', 'Ownership survives Gist round trip');
  });
  await check('Combined book filters, all sort choices and empty reset work without syncing view preferences', async () => {
    w.Store.replaceAll(w.buildDefaultState());
    w.eval("bookshelfFilters = { ...DEFAULT_BOOKSHELF_FILTERS }; bookshelfArchiveFilter = 'active'; bookshelfSearch = '';");
    const alpha = w.BookCollection.save({ ...values, title: 'Alpha', author: 'Z writer', ownership: 'owned' });
    const beta = w.BookCollection.save({ ...values, title: 'Beta', author: 'A writer', ownership: 'borrowed', format: 'ebook', readingStatus: 'reading' });
    const gamma = w.BookCollection.save({ ...values, title: 'Gamma', ownership: 'wishlist', type: 'fiction', genre: 'Mystery' });
    w.BookReading.save(alpha.id, { startedOn: '2025-01-01', finishedOn: '2025-01-02' });
    w.BookReading.save(gamma.id, { startedOn: '2026-01-01', finishedOn: '2026-01-02' });
    w.Store.state.books.forEach((row, i) => { row.createdAt = i + 1; row.updatedAt = i + 1; }); w.Store.save();
    const before = w.Store.exportJSON(), shelf = w.renderBookshelf();
    const select = (selector, value) => { const node = shelf.querySelector(selector); node.value = value; node.dispatchEvent(new w.Event('change')); };
    const titles = () => [...shelf.querySelectorAll('.book-card h3')].map(node => node.textContent);
    for (const [sort, first] of [['recent', 'Gamma'], ['title', 'Alpha'], ['author', 'Beta'], ['updated', 'Gamma'], ['finished', 'Gamma']]) {
      select('#bookshelf-sort', sort); equal(titles()[0], first, 'Sort has the expected first book');
    }
    select('[data-book-filter="ownership"]', 'borrowed');
    select('[data-book-filter="readingStatus"]', 'reading');
    select('[data-book-filter="format"]', 'ebook');
    equal(titles(), ['Beta'], 'Combined filters match a borrowed reading ebook');
    select('[data-book-filter="genre"]', 'mystery');
    assert(shelf.querySelector('#bookshelf-empty-reset'), 'Empty filter combination has reset action');
    shelf.querySelector('#bookshelf-empty-reset').click(); equal(titles().length, 3, 'Reset restores books');
    select('[data-book-filter="type"]', 'fiction'); equal(titles(), ['Gamma'], 'Type filter matches');
    equal(w.eval('loadBookshelfFilters().type'), 'fiction', 'View preferences reload');
    equal(w.Store.exportJSON(), before, 'Filtering/sorting cannot change books or sync timestamps');
    w.eval("bookshelfFilters.genre = 'deleted-genre'"); w.renderBookshelf();
    equal(w.eval('bookshelfFilters.genre'), '', 'Missing genre does not become a hidden filter');
    w.localStorage.setItem('rack.bookshelf.filters', JSON.stringify({ ownership: 'wrong', sort: {}, type: null }));
    equal(w.eval('loadBookshelfFilters()'), w.eval('DEFAULT_BOOKSHELF_FILTERS'), 'Malformed view preferences recover safely');
  });
  await check('Bookshelf filters reuse the modal pattern, keep selections on Done and fully reset without changing books', async () => {
    w.Modal.close(); w.Store.replaceAll(w.buildDefaultState());
    w.BookCollection.save({ ...values, title: 'Owned filter sample', ownership: 'owned' });
    w.BookCollection.save({ ...values, title: 'Borrowed filter sample', ownership: 'borrowed' });
    w.eval("bookshelfFilters = { ...DEFAULT_BOOKSHELF_FILTERS }; bookshelfArchiveFilter = 'active'; bookshelfSearch = '';");
    const before = w.Store.exportJSON(), shelf = w.renderBookshelf(), wasHidden = w.frameElement.hidden;
    w.frameElement.hidden = false; w.document.body.append(shelf);
    try {
      const toggle = shelf.querySelector('#bookshelf-filters-toggle'), panel = shelf.querySelector('#bookshelf-filters');
      const badge = shelf.querySelector('#bookshelf-filter-count');
      const change = (selector, value) => { const select = panel.querySelector(selector); select.value = value; select.dispatchEvent(new w.Event('change')); };
      toggle.focus(); toggle.click();
      equal(w.document.querySelector('#modal-title').textContent, 'Bookshelf filters', 'Filters open the shared dialog');
      assert(w.document.querySelector('.modal__body').contains(panel) && shelf.inert, 'Panel moves into the dialog and isolates background controls');
      equal(toggle.getAttribute('aria-expanded'), 'true', 'Toggle announces the open dialog');
      change('[data-book-filter="ownership"]', 'borrowed'); change('#bookshelf-sort', 'title');
      equal(shelf.querySelectorAll('.book-card').length, 1, 'Selection applies while controls are outside the shelf');
      equal(badge.textContent, '1', 'Badge counts active filters, excluding sort');
      assert(!badge.hidden, 'Active badge is visible');
      panel.querySelector('#bookshelf-filters-done').click();
      assert(shelf.contains(panel) && !panel.classList.contains('is-open') && !shelf.inert, 'Done restores the hidden panel and background');
      assert(w.document.activeElement === toggle, 'Done returns focus to Filters');
      equal(w.eval('loadBookshelfFilters().ownership'), 'borrowed', 'Done keeps saved filter preferences');
      toggle.click();
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(shelf.contains(panel) && w.document.activeElement === toggle, 'Escape restores the panel and opener');
      toggle.click(); w.document.querySelector('#modal-overlay').click();
      assert(shelf.contains(panel) && toggle.getAttribute('aria-expanded') === 'false', 'Backdrop close restores the panel');
      const search = shelf.querySelector('#bookshelf-search'); search.value = 'Borrowed'; search.dispatchEvent(new w.Event('input'));
      equal(badge.textContent, '2', 'Search is counted like Wardrobe search');
      toggle.click(); change('#bookshelf-archive-filter', 'all');
      equal(badge.textContent, '3', 'Collection restriction is included');
      panel.querySelector('#bookshelf-reset-filters').click();
      assert(shelf.contains(panel) && !w.document.querySelector('#modal-overlay').classList.contains('is-open'), 'Reset closes the dialog');
      equal(shelf.querySelectorAll('.book-card').length, 2, 'Reset restores all active books');
      equal(search.value, '', 'Reset clears search');
      equal(panel.querySelector('#bookshelf-sort').value, 'recent', 'Reset restores default sorting');
      assert(badge.hidden && panel.querySelector('#bookshelf-reset-filters').disabled, 'Default filters have no badge and cannot be reset again');
      assert(w.document.activeElement === toggle, 'Reset returns focus to Filters');
      equal(w.Store.exportJSON(), before, 'Filter interaction never changes book data or sync timestamps');
    } finally { w.Modal.close(); shelf.remove(); w.frameElement.hidden = wasHidden; }
  });
  await check('Book action menus dismiss cleanly and keep keyboard focus separate from reading history', async () => {
    w.Modal.close(); w.Store.replaceAll(w.buildDefaultState());
    w.BookCollection.save({ ...values, title: 'Alpha menu sample' });
    w.BookCollection.save({ ...values, title: 'Beta menu sample' });
    w.eval("bookshelfFilters = { ...DEFAULT_BOOKSHELF_FILTERS, sort: 'title' }; bookshelfArchiveFilter = 'active'; bookshelfSearch = '';");
    const before = w.Store.exportJSON(), shelf = w.renderBookshelf(), wasHidden = w.frameElement.hidden;
    w.frameElement.hidden = false; w.document.body.append(shelf);
    try {
      const cards = [...shelf.querySelectorAll('.book-card')];
      const [first, second] = cards.map(card => card.querySelector('[data-book-act="overflow"]'));
      const menus = cards.map(card => card.querySelector('.item-row__menu'));
      assert(menus.every(menu => menu.hidden), 'Administrative actions start hidden');
      first.focus(); first.click();
      assert(!menus[0].hidden && first.getAttribute('aria-expanded') === 'true', 'Toggle exposes its actions');
      equal(first.getAttribute('aria-controls'), menus[0].id, 'Toggle identifies its controlled actions');
      assert(!w.document.querySelector('#modal-overlay').classList.contains('is-open'), 'Overflow does not open reading history');
      second.click();
      assert(menus[0].hidden && !menus[1].hidden && first.getAttribute('aria-expanded') === 'false', 'Only one book menu stays open');
      shelf.querySelector('#bookshelf-search').click();
      assert(menus[1].hidden && second.getAttribute('aria-expanded') === 'false', 'Outside click dismisses the menu');
      first.focus(); first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      const edit = cards[0].querySelector('[data-book-act="edit"]');
      assert(!menus[0].hidden && w.document.activeElement === edit, 'ArrowDown opens actions and focuses the first action');
      edit.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(menus[0].hidden && w.document.activeElement === first, 'Escape dismisses and returns focus to the trigger');
      first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      shelf.querySelector('#bookshelf-search').focus();
      await new Promise(resolve => w.setTimeout(resolve, 0));
      assert(menus[0].hidden, 'Leaving the actions by keyboard dismisses them');
      first.focus(); first.click(); edit.click();
      assert(w.document.querySelector('#book-form') && !w.document.querySelector('.book-reading-history'), 'Edit opens only the book editor');
      assert(menus[0].hidden, 'Launching an administrative action closes the menu');
      w.document.querySelector('#book-cancel').click();
      assert(w.document.activeElement === first, 'Cancelling the editor returns focus to the visible action trigger');
      cards[0].querySelector('[data-book-act="history"]').click();
      equal(w.document.querySelector('.book-reading-history h4').textContent, 'Alpha menu sample', 'Primary card control opens the selected reading history');
      w.Modal.close(); equal(w.Store.exportJSON(), before, 'Browsing menus and cancelling the editor do not change data');
    } finally { w.Modal.close(); shelf.remove(); w.frameElement.hidden = wasHidden; }
  });
  await check('Book menu archive needs confirmation and restore retains reading history', async () => {
    w.Store.replaceAll(w.buildDefaultState());
    const saved = w.BookCollection.save({ ...values, title: 'Archive menu sample' });
    w.BookReading.save(saved.id, { startedOn: '2026-01-01', finishedOn: '2026-01-03' });
    w.eval("bookshelfFilters = { ...DEFAULT_BOOKSHELF_FILTERS }; bookshelfArchiveFilter = 'active'; bookshelfSearch = '';");
    const before = w.Store.exportJSON(), history = JSON.stringify(book().readingHistory), wasHidden = w.frameElement.hidden;
    let shelf = w.renderBookshelf(); w.frameElement.hidden = false; w.document.body.append(shelf);
    try {
      const trigger = shelf.querySelector('[data-book-act="overflow"]');
      trigger.focus(); trigger.click(); shelf.querySelector('[data-book-act="archive"]').click();
      assert(w.document.querySelector('#confirm-yes') && !w.document.querySelector('.book-reading-history'), 'Archive opens confirmation without opening history');
      equal(w.Store.exportJSON(), before, 'Archive has not changed data before confirmation');
      w.document.querySelector('#confirm-no').click();
      equal(w.Store.exportJSON(), before, 'Cancelled archive keeps the book and dates');
      assert(w.document.activeElement === trigger, 'Cancelled archive returns focus to its trigger');
      trigger.click(); shelf.querySelector('[data-book-act="archive"]').click(); w.document.querySelector('#confirm-yes').click();
      assert(book().archived, 'Confirmed archive marks the selected book archived');
      equal(JSON.stringify(book().readingHistory), history, 'Archive keeps reading dates');
      shelf.remove(); w.eval("bookshelfArchiveFilter = 'archived'");
      shelf = w.renderBookshelf(); w.document.body.append(shelf);
      shelf.querySelector('[data-book-act="overflow"]').click(); shelf.querySelector('[data-book-act="archive"]').click();
      assert(!book().archived && !w.document.querySelector('#modal-overlay').classList.contains('is-open'), 'Restore returns the book directly without opening history');
      equal(JSON.stringify(book().readingHistory), history, 'Restore retains all readings');
    } finally { w.Modal.close(); shelf.remove(); w.frameElement.hidden = wasHidden; }
  });
  await check('Reading summaries count dated finishes, lifetime recorded rereads and archived books across year boundaries', async () => {
    w.Store.replaceAll(w.buildDefaultState());
    const a = w.BookCollection.save({ ...values, title: 'A sample' });
    const b = w.BookCollection.save({ ...values, title: 'B sample' });
    const legacy = w.BookCollection.save({ ...values, title: 'Undated finished book', readingStatus: 'finished' });
    w.BookReading.save(a.id, { startedOn: '2024-12-31', finishedOn: '2025-01-01' });
    w.BookReading.save(a.id, { startedOn: '2025-12-31', finishedOn: '2026-01-01' });
    w.BookReading.save(a.id, { startedOn: '2026-01-04', finishedOn: '2026-01-04' });
    w.BookReading.save(b.id, { startedOn: '', finishedOn: '2026-01-01' });
    w.BookReading.save(b.id, { startedOn: '2026-02-01', finishedOn: '' });
    w.BookCollection.archive(a.id, true);
    const before = w.Store.exportJSON();
    const summary = w.BookInsights.forRange(w.Store.state.books, '2026-01-01', '2026-12-31');
    equal([summary.completions.length, summary.uniqueBooks, summary.rereads, summary.started, summary.averageDays, summary.spanCount], [3, 2, 2, 2, 1.5, 2], 'Year counts and inclusive calendar spans are correct');
    equal(summary.monthly, [['2026-01', 3]], 'Monthly totals use finish dates');
    equal(w.BookInsights.forRange(w.Store.state.books, '2026-01-01', '2026-01-01').completions.length, 2, 'Date range includes both endpoints');
    assert(!summary.completions.some(row => row.book.id === legacy.id), 'Undated finish statuses do not invent completions');
    const empty = w.BookInsights.forRange(w.Store.state.books, '2023-01-01', '2023-12-31');
    equal([empty.completions.length, empty.averageDays], [0, null], 'Empty years have no invented average');
    equal(w.Store.exportJSON(), before, 'Summaries cannot mutate history or sync state');
  });
  await check('Reading summary controls support year, range, invalid dates and history links without changing data', async () => {
    const before = w.Store.exportJSON();
    w.eval("bookshelfFilters = { ...DEFAULT_BOOKSHELF_FILTERS, ownership: 'wishlist' }; readingSummaryView = { mode: 'year', year: 2026, from: '', to: '' };");
    w.openReadingSummary();
    const root = w.document.querySelector('#modal-box');
    assert(root.querySelectorAll('.reading-summary-list li').length === 3, 'Browsing filters do not hide summary history');
    equal(root.querySelector('.reading-summary-hero strong').textContent, '3', 'Primary metric counts finished readings, including rereads');
    const stats = [...root.querySelectorAll('.reading-summary-stats > div')];
    const distinct = stats.find(node => node.querySelector('dt')?.textContent === 'Different books');
    equal(distinct?.querySelector('dd')?.textContent, '2', 'Distinct books stay separate from the finished-reading total');
    assert(root.querySelector('.reading-summary-help') instanceof w.HTMLDetailsElement && !root.querySelector('.reading-summary-help').open, 'Calculation explanations start collapsed and remain available');
    const mode = root.querySelector('#book-summary-mode'); mode.value = 'range'; mode.dispatchEvent(new w.Event('change'));
    const from = root.querySelector('#book-summary-from'), to = root.querySelector('#book-summary-to');
    from.value = '2026-01-01'; to.value = '2026-01-01'; to.dispatchEvent(new w.Event('change'));
    equal(root.querySelectorAll('.reading-summary-list li').length, 2, 'Custom range filters completions');
    equal(root.querySelector('.reading-summary-hero strong').textContent, '2', 'Primary metric refreshes for the selected range');
    from.value = '2026-02-01'; from.dispatchEvent(new w.Event('change'));
    assert(!root.querySelector('#book-summary-error').hidden && !root.querySelector('.reading-summary-list'), 'Reversed range shows an error instead of stale totals');
    from.value = '2026-01-01'; from.dispatchEvent(new w.Event('change'));
    root.querySelector('.reading-summary-list button').click();
    assert(w.document.querySelector('.book-reading-history'), 'Completion opens the related book history');
    w.Modal.close(); equal(w.Store.exportJSON(), before, 'Summary UI does not edit data');
    let failed = false; try { w.BookInsights.forRange(w.Store.state.books, '2026-02-30', '2026-03-01'); } catch (_) { failed = true; }
    assert(failed, 'Invalid calendar ranges rejected');
  });
  await check('Baseline genres follow book type, support subgenres and preserve existing custom genres', async () => {
    w.openBookModal();
    let form = w.document.querySelector('#book-form'), preset = form.elements.genrePreset;
    assert([...preset.options].some(option => option.value === 'Fantasy — Romantasy (Fantasy Romance)'), 'Fantasy subgenres available');
    assert(![...preset.options].some(option => option.value === 'True Crime'), 'Fiction options exclude non-fiction baseline');
    form.elements.title.value = 'Genre sample'; preset.value = 'Fantasy — Epic'; preset.dispatchEvent(new w.Event('change'));
    equal(form.elements.genre.value, 'Fantasy — Epic', 'Subtype keeps its parent context');
    submit(form);
    const saved = w.Store.state.books.find(row => row.title === 'Genre sample');
    equal(saved.genre, 'Fantasy — Epic', 'Genre saved in compatible string field');
    w.openBookModal(saved); form = w.document.querySelector('#book-form');
    form.elements.type.value = 'non-fiction'; form.elements.type.dispatchEvent(new w.Event('change'));
    equal(form.elements.genre.value, saved.genre, 'Type change does not silently discard the genre');
    preset = form.elements.genrePreset;
    assert([...preset.options].some(option => option.value === 'True Crime'), 'Non-fiction baseline available');
    assert(![...preset.options].some(option => option.value === 'Fantasy — Epic'), 'Fiction presets removed after type change');
    preset.value = 'Science & Nature'; preset.dispatchEvent(new w.Event('change')); submit(form);
    equal(w.Store.state.books.find(row => row.id === saved.id).genre, 'Science & Nature', 'Non-fiction selection saved');
    const custom = w.BookCollection.save({ ...values, title: 'Custom sample', genre: 'Unlisted & unusual <genre>' });
    w.openBookModal(custom); form = w.document.querySelector('#book-form');
    equal(form.elements.genrePreset.value, '__custom__', 'Existing custom genre retained as custom');
    assert(!form.querySelector('#book-custom-genre-field').hidden, 'Custom input visible');
    submit(form); equal(w.Store.state.books.find(row => row.id === custom.id).genre, custom.genre, 'Editing preserves custom genre exactly');
  });
  await check('Parent genre filtering includes subgenres while custom filters keep their exact matches', async () => {
    w.Store.replaceAll(w.buildDefaultState());
    w.BookCollection.save({ ...values, title: 'Epic sample', type: 'fiction', genre: 'Fantasy — Epic' });
    w.BookCollection.save({ ...values, title: 'Urban sample', type: 'fiction', genre: 'Fantasy — Urban' });
    w.BookCollection.save({ ...values, title: 'Custom sample', genre: 'Personal genre' });
    w.eval("bookshelfFilters = { ...DEFAULT_BOOKSHELF_FILTERS }; bookshelfArchiveFilter = 'active'; bookshelfSearch = '';");
    const shelf = w.renderBookshelf(), select = shelf.querySelector('[data-book-filter="genre"]');
    select.value = 'fantasy'; select.dispatchEvent(new w.Event('change'));
    equal(shelf.querySelectorAll('.book-card').length, 2, 'Parent filter matches both fantasy subgenres');
    select.value = 'fantasy — epic'; select.dispatchEvent(new w.Event('change'));
    equal(shelf.querySelectorAll('.book-card').length, 1, 'Subgenre filter narrows matches');
    select.value = 'personal genre'; select.dispatchEvent(new w.Event('change'));
    equal(shelf.querySelectorAll('.book-card').length, 1, 'Custom genre remains filterable');
  });
}
