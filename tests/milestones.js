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
}
