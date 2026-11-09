/* Modal lifecycle checks share the isolated browser harness; no real user data. */
async function runModalChecks({ check, assert, equal, device, image }) {
  const w = await device(), d = w.document;
  const submit = form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await check('Dirty editors guard close, backdrop, Escape and Cancel; keep editing retains nodes', async () => {
    for (const dismiss of [
      () => d.querySelector('#modal-close').click(),
      () => d.querySelector('#modal-overlay').click(),
      () => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      () => d.querySelector('#book-cancel').click(),
    ]) {
      w.openBookModal();
      const form = d.querySelector('form');
      form.elements.title.value = 'Unfinished book';
      dismiss();
      equal(d.querySelector('#modal-title').textContent, 'Discard changes?', 'Discard prompt shown');
      equal(d.querySelector('#modal-overlay').dataset.presentation, 'dialog', 'Confirmation centered');
      d.querySelector('#confirm-no').click();
      assert(d.querySelector('form') === form, 'Original form and listeners restored');
      equal(form.elements.title.value, 'Unfinished book', 'Draft preserved');
      equal(d.querySelector('#modal-overlay').dataset.presentation, 'fullscreen', 'Editor presentation restored');
      w.Modal.requestClose(); d.querySelector('#confirm-yes').click();
      assert(!d.querySelector('#modal-overlay').classList.contains('is-open'), 'Discard closes editor');
      equal(w.Store.state.books.length, 0, 'Discard never saves');
    }
  });
  await check('Unchanged forms close directly and successful saves bypass dismissal guard', async () => {
    w.openBookModal(); d.querySelector('#book-cancel').click();
    assert(!d.querySelector('#modal-overlay').classList.contains('is-open'), 'Pristine form closes');
    w.openBookModal(); const form = d.querySelector('form'); form.elements.title.value = 'Saved book'; submit(form);
    await new Promise(resolve => setTimeout(resolve, 0));
    equal(w.Store.state.books.length, 1, 'Book saved');
    assert(!d.querySelector('#modal-overlay').classList.contains('is-open'), 'Save closes');
  });
  await check('Duplicate perfume cancellation preserves draft, pending photo and working submit', async () => {
    w.Store.state.items = [{ id: 'twin', categoryId: 'cat_perfumes', subcategoryId: '', brandId: '',
      subtext: 'Test scent', tags: [], status: 'active', cost: 10 }];
    w.Store.save();
    w.openItemModal(null, 'cat_perfumes');
    const form = d.querySelector('#item-form');
    form.elements.subcategoryId.value = 'sub_perfumes_designer';
    form.elements.subtext.value = 'Test scent'; form.elements.cost.value = '1234';
    const blob = await image(w, 'red');
    const input = form.querySelector('input[type="file"]');
    const files = new w.DataTransfer(); files.items.add(new w.File([blob], 'test.png', { type: 'image/png' }));
    input.files = files.files; input.dispatchEvent(new w.Event('change', { bubbles: true }));
    for (let i = 0; i < 100 && form.querySelector('[type="submit"]').disabled; i++) await new Promise(r => setTimeout(r, 10));
    submit(form);
    equal(d.querySelector('#modal-title').textContent, 'Already on your rack', 'Duplicate prompt shown');
    d.querySelector('#twin-cancel').click();
    assert(d.querySelector('#item-form') === form, 'Original perfume form retained');
    equal(form.elements.cost.value, '1234', 'Cost retained');
    equal(w.Store.state.items.length, 1, 'Cancel did not add bottle');
    submit(form); d.querySelector('#twin-add').click();
    for (let i = 0; i < 100 && d.querySelector('#modal-overlay').classList.contains('is-open'); i++) await new Promise(r => setTimeout(r, 10));
    equal(w.Store.state.items.length, 2, 'One duplicate saved');
    assert(await w.RackPhotos.get(w.Store.state.items[1].id), 'Pending photo saved after cancellation');
    assert(!d.querySelector('#modal-overlay').classList.contains('is-open'), 'Save closes both layers');
    equal(w.Modal._stack.length, 0, 'No stale layers');
  });
  await check('Quick actions invoke existing behavior once and return focus on dismissal', async () => {
    w.frameElement.hidden = false;
    const opener = d.createElement('button'); d.body.append(opener); opener.focus();
    const menu = d.createElement('div'); menu.innerHTML = '<button>Action</button>';
    let count = 0; menu.firstChild.addEventListener('click', () => count++);
    w.Modal.actions('Actions', menu);
    equal(d.querySelector('#modal-overlay').dataset.presentation, 'sheet', 'Quick actions use sheet');
    d.querySelector('.modal-quick-actions button').click(); equal(count, 1, 'Original action invoked once');
    assert(d.activeElement === opener, 'Focus restored');
    assert(!opener.inert, 'Background restored');
  });
}
