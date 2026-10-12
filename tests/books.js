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
    const mode = root.querySelector('#book-summary-mode'); mode.value = 'range'; mode.dispatchEvent(new w.Event('change'));
    const from = root.querySelector('#book-summary-from'), to = root.querySelector('#book-summary-to');
    from.value = '2026-01-01'; to.value = '2026-01-01'; to.dispatchEvent(new w.Event('change'));
    equal(root.querySelectorAll('.reading-summary-list li').length, 2, 'Custom range filters completions');
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
