/* ============================================================
   RACK — app.js
   Main application: rule engine, view rendering, event wiring.
   No framework — plain DOM, re-rendered per tab on state change.
   ============================================================ */

'use strict';

/* ---------------- shortcuts & utils ---------------- */
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const cur = Store.state.meta.currency || 'LKR';
  return `${cur} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function fmtDate(ts) {
  if (!ts) return 'Never';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function toast(msg, kind = 'ok') {
  const host = qs('#toast-host');
  const t = el(`<div class="toast toast--${kind}">${esc(msg)}</div>`);
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-visible'));
  setTimeout(() => { t.classList.remove('is-visible'); setTimeout(() => t.remove(), 250); }, 2600);
}

/* ---------------- getters ---------------- */
const G = {
  category: id => Store.state.categories.find(c => c.id === id) || { id, name: 'Unknown', custom: true },
  subcategory: id => Store.state.subcategories.find(s => s.id === id) || null,
  subsFor: catId => Store.state.subcategories.filter(s => s.categoryId === catId),
  brand: id => Store.state.brands.find(b => b.id === id) || null,
  color: id => Store.state.colors.find(c => c.id === id) || null,
  tag: id => Store.state.tags.find(t => t.id === id) || { id, name: 'unknown' },
  activity: id => Store.state.activities.find(a => a.id === id) || null,
  item: id => Store.state.items.find(i => i.id === id) || null,
  tagsForScope(catId, subId) {
    return Store.state.tags.filter(t => {
      if (!t.categoryIds || t.categoryIds.length === 0) return true;
      if (!t.categoryIds.includes(catId)) return false;
      if (t.subcategoryIds && t.subcategoryIds.length > 0) {
        return subId ? t.subcategoryIds.includes(subId) : true;
      }
      return true;
    });
  },
};

/* ---------------- rule engine ---------------- */
function matchRule(rule, item) {
  if (rule.category && item.categoryId !== rule.category) return false;
  if (rule.subcategory && item.subcategoryId !== rule.subcategory) return false;
  if (rule.requiredTags && rule.requiredTags.length) {
    if (!rule.requiredTags.every(t => item.tags.includes(t))) return false;
  }
  if (rule.excludeTags && rule.excludeTags.length) {
    if (rule.excludeTags.some(t => item.tags.includes(t))) return false;
  }
  return true;
}
function matchActivity(activity, item) {
  if (activity.excludeCategories?.includes(item.categoryId)) return false;
  if (activity.excludeSubcategories?.includes(item.subcategoryId)) return false;
  if (activity.excludeTags?.some(t => item.tags.includes(t))) return false;
  if (!activity.includeRules || activity.includeRules.length === 0) return false;
  return activity.includeRules.some(r => matchRule(r, item));
}
function itemsForActivity(activityId) {
  const act = G.activity(activityId);
  if (!act) return [];
  return Store.state.items.filter(it => matchActivity(act, it));
}

/* ---------------- item helpers ---------------- */
function itemTitle(item) {
  const brand = G.brand(item.brandId);
  const color = G.color(item.colorId);
  const sub = G.subcategory(item.subcategoryId);
  const parts = [brand?.name, color?.name, sub?.name].filter(Boolean);
  return parts.join(' ') || 'Unnamed item';
}
function costPerWear(item) {
  if (item.cost === null || item.cost === undefined || item.cost === '') return null;
  if (!item.wearCount) return null;
  return item.cost / item.wearCount;
}
function avgCostPerWear() {
  const vals = Store.state.items.map(costPerWear).filter(v => v !== null && isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/* ---------------- modal system ---------------- */
const Modal = {
  open(title, bodyEl, opts = {}) {
    const overlay = qs('#modal-overlay');
    const box = qs('#modal-box');
    box.innerHTML = '';
    const header = el(`<div class="modal__header"><h3>${esc(title)}</h3><button class="icon-btn" id="modal-close" aria-label="Close">&times;</button></div>`);
    const body = el(`<div class="modal__body"></div>`);
    if (typeof bodyEl === 'string') body.innerHTML = bodyEl; else body.appendChild(bodyEl);
    box.appendChild(header);
    box.appendChild(body);
    overlay.classList.add('is-open');
    qs('#modal-close').addEventListener('click', () => Modal.close());
    if (opts.onMount) opts.onMount(body);
  },
  close() {
    qs('#modal-overlay').classList.remove('is-open');
    qs('#modal-box').innerHTML = '';
  },
  confirm(message, onYes, opts = {}) {
    const body = el(`
      <div class="confirm">
        <p>${esc(message)}</p>
        <div class="confirm__actions">
          <button class="btn btn--ghost" id="confirm-no">Cancel</button>
          <button class="btn ${opts.danger ? 'btn--danger' : 'btn--primary'}" id="confirm-yes">${esc(opts.yesLabel || 'Confirm')}</button>
        </div>
      </div>`);
    Modal.open(opts.title || 'Please confirm', body, {
      onMount: (root) => {
        qs('#confirm-no', root).addEventListener('click', () => Modal.close());
        qs('#confirm-yes', root).addEventListener('click', () => { onYes(); Modal.close(); });
      },
    });
  },
};
qs('#modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') Modal.close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') Modal.close(); });

/* ---------------- tab navigation ---------------- */
const TABS = ['dashboard', 'wardrobe', 'masters', 'settings'];
let activeTab = 'dashboard';
let activeMasterPanel = 'categories';
let wardrobeFilters = { category: '', subcategory: '', brand: '', color: '', tag: '', activity: '', sort: 'recent' };

function switchTab(name) {
  activeTab = name;
  qsa('.nav__link').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  render();
}

function render() {
  const main = qs('#view');
  main.innerHTML = '';
  if (activeTab === 'dashboard') main.appendChild(renderDashboard());
  else if (activeTab === 'wardrobe') { main.appendChild(renderWardrobe()); renderItemGrid(); }
  else if (activeTab === 'masters') main.appendChild(renderMasters());
  else if (activeTab === 'settings') main.appendChild(renderSettings());
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboard() {
  const items = Store.state.items;
  const wrap = el(`<section class="view-section"></section>`);

  if (items.length === 0) {
    wrap.appendChild(el(`
      <div class="empty-state">
        <h2>Your rack is empty</h2>
        <p>Add your first item and RACK will start tracking what actually gets worn.</p>
        <button class="btn btn--primary" id="empty-add">Add an item</button>
      </div>`));
    qs('#empty-add', wrap).addEventListener('click', openAddItemModal);
    return wrap;
  }

  const totalValue = items.reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const neverWorn = items.filter(i => !i.wearCount).length;
  const totalWears = items.reduce((s, i) => s + (i.wearCount || 0), 0);
  const avgCPW = avgCostPerWear();

  const byCategory = {};
  const bySubcategory = {};
  items.forEach(i => {
    byCategory[i.categoryId] = (byCategory[i.categoryId] || 0) + (i.wearCount || 0);
    bySubcategory[i.subcategoryId] = (bySubcategory[i.subcategoryId] || 0) + (i.wearCount || 0);
  });
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  const topSub = Object.entries(bySubcategory).sort((a, b) => b[1] - a[1])[0];

  const mostWorn = [...items].sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0)).slice(0, 5);
  const leastWorn = [...items].sort((a, b) => (a.wearCount || 0) - (b.wearCount || 0)).slice(0, 5);
  const bestValue = items.filter(i => costPerWear(i) !== null).sort((a, b) => costPerWear(a) - costPerWear(b)).slice(0, 3);
  const worstValue = items.filter(i => costPerWear(i) !== null).sort((a, b) => costPerWear(b) - costPerWear(a)).slice(0, 3);

  wrap.appendChild(el(`
    <div class="stat-grid">
      <div class="stat-card"><span class="stat-card__num">${items.length}</span><span class="stat-card__label">Items in rack</span></div>
      <div class="stat-card"><span class="stat-card__num">${totalWears}</span><span class="stat-card__label">Total wears logged</span></div>
      <div class="stat-card"><span class="stat-card__num">${neverWorn}</span><span class="stat-card__label">Never worn</span></div>
      <div class="stat-card"><span class="stat-card__num">${fmtMoney(totalValue)}</span><span class="stat-card__label">Wardrobe value</span></div>
      <div class="stat-card"><span class="stat-card__num">${avgCPW !== null ? fmtMoney(avgCPW) : '—'}</span><span class="stat-card__label">Avg. cost per wear</span></div>
      <div class="stat-card"><span class="stat-card__num">${topCat ? esc(G.category(topCat[0]).name) : '—'}</span><span class="stat-card__label">Most-worn category</span></div>
    </div>
  `));

  const cols = el(`<div class="dash-cols"></div>`);

  const mkList = (title, list, renderRow) => {
    const box = el(`<div class="panel"><h3>${esc(title)}</h3><div class="mini-list"></div></div>`);
    const mini = qs('.mini-list', box);
    if (!list.length) mini.appendChild(el(`<p class="muted">Nothing yet.</p>`));
    list.forEach(i => mini.appendChild(renderRow(i)));
    return box;
  };

  cols.appendChild(mkList('Most worn', mostWorn, i => el(`
    <div class="mini-row"><span>${esc(itemTitle(i))}</span><span class="tag-chip">${i.wearCount || 0}×</span></div>`)));

  cols.appendChild(mkList('Rarely worn — consider donating', leastWorn, i => el(`
    <div class="mini-row"><span>${esc(itemTitle(i))}</span><span class="tag-chip tag-chip--muted">${i.wearCount || 0}×</span></div>`)));

  cols.appendChild(mkList('Best value per wear', bestValue, i => el(`
    <div class="mini-row"><span>${esc(itemTitle(i))}</span><span class="tag-chip tag-chip--good">${fmtMoney(costPerWear(i))}</span></div>`)));

  cols.appendChild(mkList('Worst value per wear', worstValue, i => el(`
    <div class="mini-row"><span>${esc(itemTitle(i))}</span><span class="tag-chip tag-chip--warn">${fmtMoney(costPerWear(i))}</span></div>`)));

  wrap.appendChild(cols);

  if (neverWorn > 0) {
    const donate = el(`
      <div class="panel panel--accent">
        <h3>Ready to donate?</h3>
        <p class="muted">${neverWorn} item${neverWorn === 1 ? '' : 's'} ${neverWorn === 1 ? 'has' : 'have'} never been worn. Donating gets more value out of them than a shelf ever will.</p>
        <button class="btn btn--ghost" id="goto-unused">Review unused items</button>
      </div>`);
    qs('#goto-unused', donate).addEventListener('click', () => {
      wardrobeFilters = { category: '', subcategory: '', brand: '', color: '', tag: '', activity: '', sort: 'least' };
      switchTab('wardrobe');
    });
    wrap.appendChild(donate);
  }

  return wrap;
}

/* ================================================================
   WARDROBE
   ================================================================ */
function renderWardrobe() {
  const wrap = el(`<section class="view-section"></section>`);

  const toolbar = el(`
    <div class="wardrobe-block">
      <div class="toolbar">
        <div class="toolbar__filters">
          <select id="f-category"><option value="">All categories</option></select>
          <select id="f-subcategory"><option value="">All subcategories</option></select>
          <select id="f-brand"><option value="">All brands</option></select>
          <select id="f-color"><option value="">All colors</option></select>
          <select id="f-tag"><option value="">All tags</option></select>
          <select id="f-activity"><option value="">All activities</option></select>
          <select id="f-sort">
            <option value="recent">Recently added</option>
            <option value="most">Most worn</option>
            <option value="least">Least worn</option>
            <option value="cpw-asc">Best value / wear</option>
            <option value="cpw-desc">Worst value / wear</option>
          </select>
        </div>
        <button class="btn btn--primary" id="add-item-btn">+ Add item</button>
      </div>
      <div class="item-grid" id="item-grid"></div>
    </div>
  `);
  wrap.appendChild(toolbar);

  const s = Store.state;
  const catSel = qs('#f-category', toolbar);
  s.categories.forEach(c => catSel.appendChild(el(`<option value="${c.id}">${esc(c.name)}</option>`)));
  catSel.value = wardrobeFilters.category;

  const subSel = qs('#f-subcategory', toolbar);
  function refreshSubOptions() {
    subSel.innerHTML = '<option value="">All subcategories</option>';
    const subs = wardrobeFilters.category ? G.subsFor(wardrobeFilters.category) : s.subcategories;
    subs.forEach(sc => subSel.appendChild(el(`<option value="${sc.id}">${esc(sc.name)}</option>`)));
    subSel.value = wardrobeFilters.subcategory;
  }
  refreshSubOptions();

  const brandSel = qs('#f-brand', toolbar);
  s.brands.forEach(b => brandSel.appendChild(el(`<option value="${b.id}">${esc(b.name)}</option>`)));
  brandSel.value = wardrobeFilters.brand;

  const colorSel = qs('#f-color', toolbar);
  s.colors.forEach(c => colorSel.appendChild(el(`<option value="${c.id}">${esc(c.name)}</option>`)));
  colorSel.value = wardrobeFilters.color;

  const tagSel = qs('#f-tag', toolbar);
  s.tags.forEach(t => tagSel.appendChild(el(`<option value="${t.id}">${esc(t.name)}</option>`)));
  tagSel.value = wardrobeFilters.tag;

  const actSel = qs('#f-activity', toolbar);
  s.activities.forEach(a => actSel.appendChild(el(`<option value="${a.id}">${esc(a.name)}</option>`)));
  actSel.value = wardrobeFilters.activity;

  qs('#f-sort', toolbar).value = wardrobeFilters.sort;

  catSel.addEventListener('change', () => { wardrobeFilters.category = catSel.value; wardrobeFilters.subcategory = ''; refreshSubOptions(); renderItemGrid(); });
  subSel.addEventListener('change', () => { wardrobeFilters.subcategory = subSel.value; renderItemGrid(); });
  brandSel.addEventListener('change', () => { wardrobeFilters.brand = brandSel.value; renderItemGrid(); });
  colorSel.addEventListener('change', () => { wardrobeFilters.color = colorSel.value; renderItemGrid(); });
  tagSel.addEventListener('change', () => { wardrobeFilters.tag = tagSel.value; renderItemGrid(); });
  actSel.addEventListener('change', () => { wardrobeFilters.activity = actSel.value; renderItemGrid(); });
  qs('#f-sort', toolbar).addEventListener('change', (e) => { wardrobeFilters.sort = e.target.value; renderItemGrid(); });
  qs('#add-item-btn', toolbar).addEventListener('click', openAddItemModal);

  return wrap;
}

function renderItemGrid() {
  const grid = qs('#item-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const f = wardrobeFilters;
  let items = Store.state.items.filter(i => {
    if (f.category && i.categoryId !== f.category) return false;
    if (f.subcategory && i.subcategoryId !== f.subcategory) return false;
    if (f.brand && i.brandId !== f.brand) return false;
    if (f.color && i.colorId !== f.color) return false;
    if (f.tag && !i.tags.includes(f.tag)) return false;
    if (f.activity && !matchActivity(G.activity(f.activity), i)) return false;
    return true;
  });

  const cpwOrInf = (i, dir) => {
    const v = costPerWear(i);
    if (v === null) return dir === 'asc' ? Infinity : -Infinity;
    return v;
  };
  if (f.sort === 'most') items.sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0));
  else if (f.sort === 'least') items.sort((a, b) => (a.wearCount || 0) - (b.wearCount || 0));
  else if (f.sort === 'cpw-asc') items.sort((a, b) => cpwOrInf(a, 'asc') - cpwOrInf(b, 'asc'));
  else if (f.sort === 'cpw-desc') items.sort((a, b) => cpwOrInf(b, 'desc') - cpwOrInf(a, 'desc'));
  else items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!items.length) {
    grid.appendChild(el(`<p class="muted" style="padding: 2rem 0;">No items match these filters.</p>`));
    return;
  }
  items.forEach(item => grid.appendChild(itemCard(item)));
}

function itemCard(item) {
  const color = G.color(item.colorId);
  const cat = G.category(item.categoryId);
  const sub = G.subcategory(item.subcategoryId);
  const cpw = costPerWear(item);
  const avg = avgCostPerWear();
  let cpwClass = '';
  if (cpw !== null && avg !== null) cpwClass = cpw <= avg ? 'tag-chip--good' : 'tag-chip--warn';

  const swatchStyle = color?.hex && color.hex !== 'multi'
    ? `background:${color.hex}`
    : 'background:conic-gradient(#A23B33,#3B6EA5,#4C6B4F,#D8CBAE,#A23B33)';

  const card = el(`
    <article class="item-card">
      <div class="item-card__hole"></div>
      <div class="item-card__top">
        <span class="swatch" style="${swatchStyle}" title="${esc(color?.name || 'No color')}"></span>
        <div class="item-card__titles">
          <h4>${esc(itemTitle(item))}</h4>
          <p class="item-card__breadcrumb">${esc(cat.name)} &rsaquo; ${esc(sub?.name || '—')}</p>
        </div>
      </div>
      ${item.subtext ? `<p class="item-card__subtext">${esc(item.subtext)}</p>` : ''}
      <div class="item-card__tags">
        ${(item.tags || []).map(tid => `<span class="tag-chip">${esc(G.tag(tid).name)}</span>`).join('')}
      </div>
      <div class="item-card__stats">
        <div><span class="mono">${item.wearCount || 0}</span><small>wears</small></div>
        <div><span class="mono">${item.cost ? fmtMoney(item.cost) : '—'}</span><small>cost</small></div>
        <div><span class="mono ${cpwClass}">${cpw !== null ? fmtMoney(cpw) : '—'}</span><small>per wear</small></div>
      </div>
      <p class="item-card__last muted">Last worn: ${fmtDate(item.lastWornAt)}</p>
      <div class="item-card__actions">
        <button class="btn btn--small btn--primary" data-act="wear">+1 Worn</button>
        <button class="btn btn--small btn--ghost" data-act="undo" ${!item.wearCount ? 'disabled' : ''}>Undo</button>
        <button class="btn btn--small btn--ghost" data-act="edit">Edit</button>
        <button class="btn btn--small btn--danger-ghost" data-act="delete">Delete</button>
      </div>
    </article>`);

  qs('[data-act="wear"]', card).addEventListener('click', () => {
    item.wearCount = (item.wearCount || 0) + 1;
    item.lastWornAt = Date.now();
    Store.save();
    renderItemGrid();
  });
  qs('[data-act="undo"]', card).addEventListener('click', () => {
    if (!item.wearCount) return;
    item.wearCount -= 1;
    Store.save();
    renderItemGrid();
  });
  qs('[data-act="edit"]', card).addEventListener('click', () => openItemModal(item));
  qs('[data-act="delete"]', card).addEventListener('click', () => {
    Modal.confirm(`Remove "${itemTitle(item)}" from your rack? This can't be undone.`, () => {
      Store.state.items = Store.state.items.filter(i => i.id !== item.id);
      Store.save();
      render();
      toast('Item removed');
    }, { danger: true, yesLabel: 'Delete' });
  });

  return card;
}

function openAddItemModal() { openItemModal(null); }

function openItemModal(existing) {
  const s = Store.state;
  const isEdit = !!existing;
  const item = existing ? { ...existing } : {
    id: uid('item'), categoryId: '', subcategoryId: '', brandId: '', colorId: '',
    tags: [], subtext: '', cost: '', wearCount: 0, lastWornAt: null, createdAt: Date.now(),
  };

  const body = el(`
    <form class="form" id="item-form">
      <label>Category
        <select name="categoryId" required>
          <option value="">Select category…</option>
          ${s.categories.map(c => `<option value="${c.id}" ${c.id === item.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>Subcategory
        <select name="subcategoryId" required></select>
      </label>
      <label>Brand
        <div class="inline-add">
          <select name="brandId"></select>
          <button type="button" class="btn btn--small btn--ghost" id="quick-add-brand">+ New</button>
        </div>
      </label>
      <label>Color
        <select name="colorId" required>
          <option value="">Select color…</option>
          ${s.colors.map(c => `<option value="${c.id}" ${c.id === item.colorId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>Additional description <span class="muted">(model, product name — optional)</span>
        <input type="text" name="subtext" value="${esc(item.subtext || '')}" placeholder="e.g. Air Zoom Pegasus 40">
      </label>
      <fieldset>
        <legend>Tags <span class="muted">(only tags relevant to this category show up)</span></legend>
        <div class="tag-check-grid" id="tag-checks"></div>
      </fieldset>
      <div class="form-row">
        <label>Original cost <span class="muted">(optional)</span>
          <input type="number" name="cost" min="0" step="0.01" value="${item.cost ?? ''}" placeholder="0.00">
        </label>
        <label>Times worn
          <input type="number" name="wearCount" min="0" step="1" value="${item.wearCount || 0}">
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="item-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Add to rack'}</button>
      </div>
    </form>
  `);

  Modal.open(isEdit ? 'Edit item' : 'Add a new item', body, {
    onMount: (root) => {
      const form = qs('#item-form', root);
      const catSelect = form.categoryId;
      const subSelect = form.subcategoryId;
      const brandSelect = form.brandId;

      function refreshBrands() {
        brandSelect.innerHTML = '<option value="">No brand / unbranded</option>' +
          s.brands.map(b => `<option value="${b.id}" ${b.id === item.brandId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
      }
      refreshBrands();

      function refreshSubs() {
        const subs = G.subsFor(catSelect.value);
        subSelect.innerHTML = '<option value="">Select subcategory…</option>' +
          subs.map(sc => `<option value="${sc.id}" ${sc.id === item.subcategoryId ? 'selected' : ''}>${esc(sc.name)}</option>`).join('');
      }
      function refreshTags() {
        const box = qs('#tag-checks', root);
        const relevant = G.tagsForScope(catSelect.value, subSelect.value);
        if (!catSelect.value) {
          box.innerHTML = '<p class="muted">Choose a category first.</p>';
          return;
        }
        if (!relevant.length) { box.innerHTML = '<p class="muted">No tags for this category yet — add some in Masters.</p>'; return; }
        box.innerHTML = relevant.map(t => `
          <label class="tag-check">
            <input type="checkbox" value="${t.id}" ${item.tags?.includes(t.id) ? 'checked' : ''}> ${esc(t.name)}
          </label>`).join('');
      }

      refreshSubs();
      refreshTags();
      catSelect.addEventListener('change', () => { refreshSubs(); refreshTags(); });
      subSelect.addEventListener('change', refreshTags);

      qs('#quick-add-brand', root).addEventListener('click', () => {
        const name = prompt('New brand name:');
        if (!name || !name.trim()) return;
        const b = { id: uid('brand'), name: name.trim(), custom: true };
        s.brands.push(b);
        Store.save();
        refreshBrands();
        brandSelect.value = b.id;
      });

      qs('#item-cancel', root).addEventListener('click', () => Modal.close());

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        if (!fd.get('categoryId') || !fd.get('subcategoryId') || !fd.get('colorId')) {
          toast('Category, subcategory, and color are required', 'warn');
          return;
        }
        item.categoryId = fd.get('categoryId');
        item.subcategoryId = fd.get('subcategoryId');
        item.brandId = fd.get('brandId') || '';
        item.colorId = fd.get('colorId');
        item.subtext = fd.get('subtext').trim();
        item.cost = fd.get('cost') === '' ? null : Number(fd.get('cost'));
        item.wearCount = Math.max(0, parseInt(fd.get('wearCount'), 10) || 0);
        item.tags = qsa('#tag-checks input:checked', root).map(cb => cb.value);

        if (isEdit) {
          const idx = s.items.findIndex(i => i.id === item.id);
          s.items[idx] = item;
        } else {
          s.items.push(item);
        }
        Store.save();
        Modal.close();
        render();
        toast(isEdit ? 'Item updated' : 'Item added to rack');
      });
    },
  });
}

/* ================================================================
   MASTERS
   ================================================================ */
function renderMasters() {
  const wrap = el(`
    <section class="view-section">
      <div class="subnav" id="master-subnav">
        ${['categories', 'tags', 'brands', 'colors', 'activities'].map(p =>
          `<button class="subnav__link ${p === activeMasterPanel ? 'is-active' : ''}" data-panel="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`
        ).join('')}
      </div>
      <div id="master-panel"></div>
    </section>`);

  qsa('.subnav__link', wrap).forEach(btn => btn.addEventListener('click', () => {
    activeMasterPanel = btn.dataset.panel;
    render();
  }));

  const panel = qs('#master-panel', wrap);
  if (activeMasterPanel === 'categories') panel.appendChild(renderCategoriesPanel());
  else if (activeMasterPanel === 'tags') panel.appendChild(renderTagsPanel());
  else if (activeMasterPanel === 'brands') panel.appendChild(renderSimpleListPanel('brands', 'Brand'));
  else if (activeMasterPanel === 'colors') panel.appendChild(renderColorsPanel());
  else if (activeMasterPanel === 'activities') panel.appendChild(renderActivitiesPanel());

  return wrap;
}

/* ---- Categories & subcategories ---- */
function renderCategoriesPanel() {
  const s = Store.state;
  const box = el(`<div class="panel-list"></div>`);
  box.appendChild(el(`
    <div class="panel-list__header">
      <p class="muted">Categories organize your rack. Add subcategories under each — they carry the same weight as the built-in ones.</p>
      <button class="btn btn--primary btn--small" id="add-cat">+ Add category</button>
    </div>`));
  qs('#add-cat', box).addEventListener('click', () => promptCategory());

  s.categories.forEach(cat => {
    const subs = G.subsFor(cat.id);
    const itemCount = s.items.filter(i => i.categoryId === cat.id).length;
    const catBox = el(`
      <div class="master-card">
        <div class="master-card__row">
          <strong>${esc(cat.name)}</strong>
          <span class="muted">${itemCount} item${itemCount === 1 ? '' : 's'}</span>
          <div class="master-card__actions">
            <button class="btn btn--tiny btn--ghost" data-act="rename">Rename</button>
            <button class="btn btn--tiny btn--danger-ghost" data-act="delete">Delete</button>
          </div>
        </div>
        <div class="sub-list">
          ${subs.map(sc => `
            <span class="sub-pill" data-sub="${sc.id}">
              ${esc(sc.name)}
              <button data-act="rename-sub" title="Rename">✎</button>
              <button data-act="delete-sub" title="Delete">&times;</button>
            </span>`).join('')}
          <button class="btn btn--tiny btn--ghost" data-act="add-sub">+ Subcategory</button>
        </div>
      </div>`);

    qs('[data-act="rename"]', catBox).addEventListener('click', () => promptCategory(cat));
    qs('[data-act="delete"]', catBox).addEventListener('click', () => {
      Modal.confirm(`Delete category "${cat.name}" and its subcategories? Items already using it will keep a dangling reference.`, () => {
        s.categories = s.categories.filter(c => c.id !== cat.id);
        s.subcategories = s.subcategories.filter(sc => sc.categoryId !== cat.id);
        Store.save(); render();
      }, { danger: true, yesLabel: 'Delete' });
    });
    qs('[data-act="add-sub"]', catBox).addEventListener('click', () => promptSubcategory(cat));
    qsa('[data-act="rename-sub"]', catBox).forEach(btn => btn.addEventListener('click', (e) => {
      const sc = G.subcategory(e.target.closest('.sub-pill').dataset.sub);
      promptSubcategory(cat, sc);
    }));
    qsa('[data-act="delete-sub"]', catBox).forEach(btn => btn.addEventListener('click', (e) => {
      const scId = e.target.closest('.sub-pill').dataset.sub;
      Modal.confirm('Delete this subcategory?', () => {
        s.subcategories = s.subcategories.filter(sc => sc.id !== scId);
        Store.save(); render();
      }, { danger: true, yesLabel: 'Delete' });
    }));

    box.appendChild(catBox);
  });
  return box;
}
function promptCategory(existing) {
  const name = prompt(existing ? 'Rename category:' : 'New category name:', existing?.name || '');
  if (!name || !name.trim()) return;
  if (existing) { existing.name = name.trim(); }
  else { Store.state.categories.push({ id: uid('cat'), name: name.trim(), custom: true }); }
  Store.save(); render();
}
function promptSubcategory(cat, existing) {
  const name = prompt(existing ? 'Rename subcategory:' : `New subcategory under ${cat.name}:`, existing?.name || '');
  if (!name || !name.trim()) return;
  if (existing) { existing.name = name.trim(); }
  else { Store.state.subcategories.push({ id: uid('sub'), name: name.trim(), categoryId: cat.id, custom: true }); }
  Store.save(); render();
}

/* ---- Tags ---- */
function renderTagsPanel() {
  const s = Store.state;
  const box = el(`<div class="panel-list"></div>`);
  box.appendChild(el(`
    <div class="panel-list__header">
      <p class="muted">Tags are scoped to categories, so only relevant tags show up when tagging an item.</p>
      <button class="btn btn--primary btn--small" id="add-tag">+ Add tag</button>
    </div>`));
  qs('#add-tag', box).addEventListener('click', () => openTagModal(null));

  const list = el(`<div class="tag-table"></div>`);
  s.tags.forEach(t => {
    const cats = (t.categoryIds || []).map(id => G.category(id).name).join(', ') || 'All categories';
    const row = el(`
      <div class="tag-table__row">
        <span class="tag-chip">${esc(t.name)}</span>
        <span class="muted">${esc(cats)}</span>
        <div class="master-card__actions">
          <button class="btn btn--tiny btn--ghost" data-act="edit">Edit</button>
          <button class="btn btn--tiny btn--danger-ghost" data-act="delete">Delete</button>
        </div>
      </div>`);
    qs('[data-act="edit"]', row).addEventListener('click', () => openTagModal(t));
    qs('[data-act="delete"]', row).addEventListener('click', () => {
      Modal.confirm(`Delete tag "${t.name}"?`, () => {
        s.tags = s.tags.filter(x => x.id !== t.id);
        s.items.forEach(i => { i.tags = i.tags.filter(id => id !== t.id); });
        Store.save(); render();
      }, { danger: true, yesLabel: 'Delete' });
    });
    list.appendChild(row);
  });
  box.appendChild(list);
  return box;
}
function openTagModal(existing) {
  const s = Store.state;
  const isEdit = !!existing;
  const body = el(`
    <form class="form" id="tag-form">
      <label>Tag name
        <input type="text" name="name" value="${esc(existing?.name || '')}" required>
      </label>
      <fieldset>
        <legend>Restrict to categories <span class="muted">(none checked = applies everywhere)</span></legend>
        <div class="tag-check-grid">
          ${s.categories.map(c => `
            <label class="tag-check"><input type="checkbox" value="${c.id}" ${existing?.categoryIds?.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>
          `).join('')}
        </div>
      </fieldset>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="tag-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save' : 'Add tag'}</button>
      </div>
    </form>`);
  Modal.open(isEdit ? 'Edit tag' : 'New tag', body, {
    onMount: (root) => {
      qs('#tag-cancel', root).addEventListener('click', () => Modal.close());
      qs('#tag-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = qs('[name="name"]', root).value.trim();
        if (!name) return;
        const categoryIds = qsa('.tag-check-grid input:checked', root).map(c => c.value);
        if (isEdit) { existing.name = name; existing.categoryIds = categoryIds; }
        else { s.tags.push({ id: uid('tag'), name, categoryIds, subcategoryIds: [], custom: true }); }
        Store.save(); Modal.close(); render();
      });
    },
  });
}

/* ---- Brands (simple list, reused pattern) ---- */
function renderSimpleListPanel(stateKey, label) {
  const s = Store.state;
  const box = el(`<div class="panel-list"></div>`);
  box.appendChild(el(`
    <div class="panel-list__header">
      <p class="muted">Manage your ${label.toLowerCase()}s. They're used to build each item's identity.</p>
      <button class="btn btn--primary btn--small" id="add-simple">+ Add ${label.toLowerCase()}</button>
    </div>`));
  qs('#add-simple', box).addEventListener('click', () => {
    const name = prompt(`New ${label.toLowerCase()} name:`);
    if (!name || !name.trim()) return;
    s[stateKey].push({ id: uid(stateKey.slice(0, 3)), name: name.trim(), custom: true });
    Store.save(); render();
  });
  const grid = el(`<div class="chip-grid"></div>`);
  s[stateKey].forEach(x => {
    const count = s.items.filter(i => i[`${stateKey.slice(0, -1)}Id`] === x.id).length;
    const chip = el(`
      <div class="chip-card">
        <span>${esc(x.name)}</span>
        <span class="muted">${count}</span>
        <button data-act="rename" title="Rename">✎</button>
        <button data-act="delete" title="Delete">&times;</button>
      </div>`);
    qs('[data-act="rename"]', chip).addEventListener('click', () => {
      const name = prompt('Rename:', x.name);
      if (!name || !name.trim()) return;
      x.name = name.trim(); Store.save(); render();
    });
    qs('[data-act="delete"]', chip).addEventListener('click', () => {
      Modal.confirm(`Delete "${x.name}"?`, () => {
        s[stateKey] = s[stateKey].filter(y => y.id !== x.id);
        Store.save(); render();
      }, { danger: true, yesLabel: 'Delete' });
    });
    grid.appendChild(chip);
  });
  box.appendChild(grid);
  return box;
}

/* ---- Colors ---- */
function renderColorsPanel() {
  const s = Store.state;
  const box = el(`<div class="panel-list"></div>`);
  box.appendChild(el(`
    <div class="panel-list__header">
      <p class="muted">Colors are a distinct attribute — not part of an item's name.</p>
      <button class="btn btn--primary btn--small" id="add-color">+ Add color</button>
    </div>`));
  qs('#add-color', box).addEventListener('click', () => {
    const name = prompt('New color name:');
    if (!name || !name.trim()) return;
    const hex = prompt('Hex code (e.g. #445566), or leave blank for multi-color:', '#888888') || 'multi';
    s.colors.push({ id: uid('col'), name: name.trim(), hex, custom: true });
    Store.save(); render();
  });
  const grid = el(`<div class="chip-grid"></div>`);
  s.colors.forEach(c => {
    const count = s.items.filter(i => i.colorId === c.id).length;
    const swatchStyle = c.hex && c.hex !== 'multi' ? `background:${c.hex}` : 'background:conic-gradient(#A23B33,#3B6EA5,#4C6B4F,#D8CBAE)';
    const chip = el(`
      <div class="chip-card">
        <span class="swatch swatch--sm" style="${swatchStyle}"></span>
        <span>${esc(c.name)}</span>
        <span class="muted">${count}</span>
        <button data-act="delete" title="Delete">&times;</button>
      </div>`);
    qs('[data-act="delete"]', chip).addEventListener('click', () => {
      Modal.confirm(`Delete color "${c.name}"?`, () => {
        s.colors = s.colors.filter(x => x.id !== c.id);
        Store.save(); render();
      }, { danger: true, yesLabel: 'Delete' });
    });
    grid.appendChild(chip);
  });
  box.appendChild(grid);
  return box;
}

/* ---- Activities & rule builder ---- */
function renderActivitiesPanel() {
  const s = Store.state;
  const box = el(`<div class="panel-list"></div>`);
  box.appendChild(el(`
    <div class="panel-list__header">
      <p class="muted">Activities use category, subcategory, and tag rules to decide which items qualify — you don't assign items one by one.</p>
      <button class="btn btn--primary btn--small" id="add-activity">+ Add activity</button>
    </div>`));
  qs('#add-activity', box).addEventListener('click', () => openActivityModal(null));

  s.activities.forEach(act => {
    const count = itemsForActivity(act.id).length;
    const card = el(`
      <div class="master-card">
        <div class="master-card__row">
          <strong>${esc(act.name)}</strong>
          <span class="muted">${count} matching item${count === 1 ? '' : 's'}</span>
          <div class="master-card__actions">
            <button class="btn btn--tiny btn--ghost" data-act="edit">Edit rules</button>
            <button class="btn btn--tiny btn--danger-ghost" data-act="delete">Delete</button>
          </div>
        </div>
        <p class="muted rule-summary">${describeActivityRules(act)}</p>
      </div>`);
    qs('[data-act="edit"]', card).addEventListener('click', () => openActivityModal(act));
    qs('[data-act="delete"]', card).addEventListener('click', () => {
      Modal.confirm(`Delete activity "${act.name}"?`, () => {
        s.activities = s.activities.filter(a => a.id !== act.id);
        Store.save(); render();
      }, { danger: true, yesLabel: 'Delete' });
    });
    box.appendChild(card);
  });
  return box;
}
function describeActivityRules(act) {
  const parts = act.includeRules.map(r => {
    const bits = [];
    if (r.category) bits.push(G.category(r.category).name);
    if (r.subcategory) bits.push('› ' + (G.subcategory(r.subcategory)?.name || ''));
    if (r.requiredTags?.length) bits.push('+ ' + r.requiredTags.map(t => G.tag(t).name).join('+'));
    if (r.excludeTags?.length) bits.push('− ' + r.excludeTags.map(t => G.tag(t).name).join(','));
    return bits.join(' ');
  });
  let str = 'Shows: ' + (parts.join('  |  ') || 'nothing configured');
  const excl = [];
  if (act.excludeSubcategories?.length) excl.push(act.excludeSubcategories.map(id => G.subcategory(id)?.name).filter(Boolean).join(', '));
  if (act.excludeTags?.length) excl.push(act.excludeTags.map(id => G.tag(id).name).join(', '));
  if (excl.length) str += `.  Always excludes: ${excl.join(', ')}`;
  return str;
}

function openActivityModal(existing) {
  const s = Store.state;
  const isEdit = !!existing;
  const activity = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid('act'), name: '', includeRules: [{}], excludeCategories: [], excludeSubcategories: [], excludeTags: [],
  };

  const body = el(`
    <form class="form form--wide" id="activity-form">
      <label>Activity name
        <input type="text" name="name" value="${esc(activity.name)}" required placeholder="e.g. Weekend Hike">
      </label>
      <fieldset>
        <legend>Show items that match ANY of these rules</legend>
        <div id="rule-rows"></div>
        <button type="button" class="btn btn--small btn--ghost" id="add-rule">+ Add rule</button>
      </fieldset>
      <fieldset>
        <legend>Always exclude</legend>
        <label>Subcategories to always exclude</label>
        <div class="tag-check-grid" id="excl-subs"></div>
        <label>Tags to always exclude</label>
        <div class="tag-check-grid" id="excl-tags"></div>
      </fieldset>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="act-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save activity' : 'Create activity'}</button>
      </div>
    </form>`);

  Modal.open(isEdit ? 'Edit activity' : 'New activity', body, {
    onMount: (root) => {
      const ruleRows = qs('#rule-rows', root);

      function ruleRowEl(rule, idx) {
        const subs = rule.category ? G.subsFor(rule.category) : [];
        const row = el(`
          <div class="rule-row-block">
            <div class="rule-row" data-idx="${idx}">
              <select data-f="category">
                <option value="">Any category</option>
                ${s.categories.map(c => `<option value="${c.id}" ${rule.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
              <select data-f="subcategory">
                <option value="">Any subcategory</option>
                ${subs.map(sc => `<option value="${sc.id}" ${rule.subcategory === sc.id ? 'selected' : ''}>${esc(sc.name)}</option>`).join('')}
              </select>
              <select data-f="requiredTags" multiple size="3" title="Must have ALL of these tags">
                ${s.tags.map(t => `<option value="${t.id}" ${rule.requiredTags?.includes(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
              </select>
              <select data-f="excludeTags" multiple size="3" title="Must have NONE of these tags">
                ${s.tags.map(t => `<option value="${t.id}" ${rule.excludeTags?.includes(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
              </select>
              <button type="button" class="btn btn--tiny btn--danger-ghost" data-act="remove-rule">&times;</button>
            </div>
            <div class="rule-row__labels">
              <small>Category</small><small>Subcategory</small><small>Requires tags</small><small>Excludes tags</small><small></small>
            </div>
          </div>`);
        const catSel = qs('[data-f="category"]', row);
        catSel.addEventListener('change', () => {
          rule.category = catSel.value || undefined;
          rule.subcategory = undefined;
          rerenderRules();
        });
        qs('[data-f="subcategory"]', row).addEventListener('change', (e) => { rule.subcategory = e.target.value || undefined; });
        qs('[data-f="requiredTags"]', row).addEventListener('change', (e) => {
          rule.requiredTags = Array.from(e.target.selectedOptions).map(o => o.value);
        });
        qs('[data-f="excludeTags"]', row).addEventListener('change', (e) => {
          rule.excludeTags = Array.from(e.target.selectedOptions).map(o => o.value);
        });
        qs('[data-act="remove-rule"]', row).addEventListener('click', () => {
          activity.includeRules.splice(idx, 1);
          rerenderRules();
        });
        return row;
      }

      function rerenderRules() {
        ruleRows.innerHTML = '';
        activity.includeRules.forEach((r, i) => ruleRows.appendChild(ruleRowEl(r, i)));
      }
      rerenderRules();

      qs('#add-rule', root).addEventListener('click', () => {
        activity.includeRules.push({});
        rerenderRules();
      });

      qs('#excl-subs', root).innerHTML = s.subcategories.map(sc => `
        <label class="tag-check"><input type="checkbox" value="${sc.id}" ${activity.excludeSubcategories?.includes(sc.id) ? 'checked' : ''}> ${esc(G.category(sc.categoryId).name)} › ${esc(sc.name)}</label>
      `).join('');
      qs('#excl-tags', root).innerHTML = s.tags.map(t => `
        <label class="tag-check"><input type="checkbox" value="${t.id}" ${activity.excludeTags?.includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>
      `).join('');

      qs('#act-cancel', root).addEventListener('click', () => Modal.close());
      qs('#activity-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = qs('[name="name"]', root).value.trim();
        if (!name) return;
        activity.name = name;
        activity.excludeSubcategories = qsa('#excl-subs input:checked', root).map(c => c.value);
        activity.excludeTags = qsa('#excl-tags input:checked', root).map(c => c.value);
        activity.includeRules = activity.includeRules.filter(r => r.category || r.subcategory || r.requiredTags?.length || r.excludeTags?.length);

        if (isEdit) {
          const idx = s.activities.findIndex(a => a.id === activity.id);
          s.activities[idx] = activity;
        } else {
          s.activities.push(activity);
        }
        Store.save(); Modal.close(); render();
        toast(isEdit ? 'Activity updated' : 'Activity created');
      });
    },
  });
}

/* ================================================================
   SETTINGS
   ================================================================ */
function renderSettings() {
  const s = Store.state;
  const wrap = el(`<section class="view-section settings-grid"></section>`);

  const dataPanel = el(`
    <div class="panel">
      <h3>Currency</h3>
      <p class="muted">Used to display cost and value per wear.</p>
      <input type="text" id="currency-input" value="${esc(s.meta.currency || 'LKR')}" maxlength="6" style="max-width:120px">
    </div>`);
  qs('#currency-input', dataPanel).addEventListener('change', (e) => {
    s.meta.currency = e.target.value.trim() || 'LKR';
    Store.save(); toast('Currency updated');
  });

  const backupPanel = el(`
    <div class="panel">
      <h3>Backup</h3>
      <p class="muted">Download everything as a JSON file, or restore from one.</p>
      <div class="form-actions" style="justify-content:flex-start; gap:.6rem;">
        <button class="btn btn--ghost" id="export-btn">Download backup</button>
        <label class="btn btn--ghost" style="cursor:pointer;">Restore from file<input type="file" id="import-file" accept="application/json" hidden></label>
      </div>
    </div>`);
  qs('#export-btn', backupPanel).addEventListener('click', () => {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rack-wardrobe-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });
  qs('#import-file', backupPanel).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        Modal.confirm('Replace all current data with this backup?', () => {
          Store.replaceAll(data);
          render();
          toast('Backup restored');
        }, { danger: true, yesLabel: 'Restore' });
      } catch (err) {
        toast('That file could not be read as a backup', 'warn');
      }
    };
    reader.readAsText(file);
  });

  const syncPanel = el(`
    <div class="panel">
      <h3>Cloud sync (optional)</h3>
      <p class="muted">Access your rack on other devices using a private GitHub Gist as storage. Your token stays in this browser only — it's never written into the app's code or repository.</p>
      <label>GitHub personal access token (needs "gist" scope)
        <input type="password" id="sync-token" value="${esc(Sync.getToken())}" placeholder="ghp_…">
      </label>
      <label>Gist ID <span class="muted">(leave blank to create one)</span>
        <input type="text" id="sync-gist" value="${esc(Sync.getGistId())}" placeholder="auto-filled after first sync">
      </label>
      <div class="form-actions" style="justify-content:flex-start; gap:.6rem;">
        <button class="btn btn--primary btn--small" id="push-btn">Push to cloud</button>
        <button class="btn btn--ghost btn--small" id="pull-btn">Pull from cloud</button>
        <button class="btn btn--danger-ghost btn--small" id="disconnect-btn">Disconnect</button>
      </div>
      <p class="muted" id="sync-status"></p>
    </div>`);
  qs('#sync-token', syncPanel).addEventListener('change', (e) => Sync.setToken(e.target.value.trim()));
  qs('#sync-gist', syncPanel).addEventListener('change', (e) => Sync.setGistId(e.target.value.trim()));
  qs('#push-btn', syncPanel).addEventListener('click', async () => {
    const status = qs('#sync-status', syncPanel);
    status.textContent = 'Pushing…';
    try {
      Sync.setToken(qs('#sync-token', syncPanel).value.trim());
      await Sync.pushToCloud(Store.state);
      qs('#sync-gist', syncPanel).value = Sync.getGistId();
      status.textContent = `Synced to cloud just now. Gist ID: ${Sync.getGistId()}`;
      toast('Pushed to cloud');
    } catch (err) { status.textContent = err.message; toast(err.message, 'warn'); }
  });
  qs('#pull-btn', syncPanel).addEventListener('click', async () => {
    const status = qs('#sync-status', syncPanel);
    try {
      Sync.setToken(qs('#sync-token', syncPanel).value.trim());
      Sync.setGistId(qs('#sync-gist', syncPanel).value.trim());
      const data = await Sync.pullFromCloud();
      Modal.confirm('Replace local data with the version from the cloud?', () => {
        Store.replaceAll(data);
        render();
        toast('Pulled from cloud');
      }, { danger: true, yesLabel: 'Replace' });
    } catch (err) { status.textContent = err.message; toast(err.message, 'warn'); }
  });
  qs('#disconnect-btn', syncPanel).addEventListener('click', () => {
    Sync.setToken(''); Sync.setGistId('');
    qs('#sync-token', syncPanel).value = ''; qs('#sync-gist', syncPanel).value = '';
    toast('Disconnected');
  });

  const dangerPanel = el(`
    <div class="panel panel--danger">
      <h3>Reset</h3>
      <p class="muted">Erase everything on this device and start over with default masters.</p>
      <button class="btn btn--danger" id="reset-btn">Reset app</button>
    </div>`);
  qs('#reset-btn', dangerPanel).addEventListener('click', () => {
    Modal.confirm('This deletes every item, category edit, and setting on this device. Continue?', () => {
      localStorage.removeItem(STORAGE_KEY);
      Store._state = null;
      Store.load();
      render();
      toast('App reset');
    }, { danger: true, yesLabel: 'Erase everything' });
  });

  [dataPanel, backupPanel, syncPanel, dangerPanel].forEach(p => wrap.appendChild(p));
  return wrap;
}

/* ================================================================
   INIT
   ================================================================ */
function init() {
  if (!Store.state.meta.currency) { Store.state.meta.currency = 'LKR'; Store.save(); }
  qsa('.nav__link').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  switchTab('dashboard');
}
document.addEventListener('DOMContentLoaded', init);
