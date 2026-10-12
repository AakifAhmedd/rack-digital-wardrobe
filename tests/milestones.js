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
}
