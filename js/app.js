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
/* Compact relative date for tight spaces (e.g. the item card stat grid). */
function fmtDateShort(ts) {
  if (!ts) return 'Never';
  const d = new Date(ts);
  const startOf = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const days = Math.round((startOf(Date.now()) - startOf(ts)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days}d ago`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' });
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

/* ---------------- constants ---------------- */
const GIFTED_TAG_ID = 'tag_gifted';
const RETIRE_REASONS = [
  { id: 'donated', label: 'Donated' },
  { id: 'sold', label: 'Sold' },
  { id: 'disposed', label: 'Disposed' },
  { id: 'other', label: 'Other' },
];
function activeItems() { return Store.state.items.filter(i => i.status !== 'retired'); }
function retiredItems() { return Store.state.items.filter(i => i.status === 'retired'); }

/* ---------------- icon registry ----------------
   Small hand-drawn line icons (24x24, stroke=currentColor) — no
   external icon font/library. Used for category badges and, in
   the dashboard charts, in place of text labels to save width. */
const ICONS = {
  tag: '<path d="M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3"/>',
  hanger: '<path d="M14 6a2 2 0 1 0 -4 0c0 1.667 .67 3 2 4h-.008l7.971 4.428a2 2 0 0 1 1.029 1.749v.823a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-.823a2 2 0 0 1 1.029 -1.749l7.971 -4.428"/>',
  shirt: '<path d="M15 4l6 2v5h-3v8a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-8h-3v-5l6 -2a3 3 0 0 0 6 0"/>',
  pants: '<path d="M12 19H16.4363C16.7532 19 17.0154 18.7536 17.0352 18.4374L17.9602 3.63743C17.9817 3.29201 17.7074 3 17.3613 3H6.63426C6.28981 3 6.01608 3.28936 6.03518 3.63328L6.96852 20.4333C6.98618 20.7512 7.24915 21 7.56759 21H11.4C11.7314 21 12 20.7314 12 20.4V8"/>',
  shorts: '<path d="M12 16.8H18.9662C19.2706 16.8 19.5267 16.5721 19.5621 16.2698L20.9215 4.66983C20.9633 4.31323 20.6846 4 20.3256 4H3.65888C3.30539 4 3.02851 4.30406 3.0615 4.65601L4.449 19.456C4.47791 19.7643 4.73671 20 5.04638 20H11.4C11.7314 20 12 19.7314 12 19.4V12"/>',
  dress: '<path d="M9 9L7 5H17L15 9V12L20.25 22H3.5L9 12V9Z"/><path d="M10 2V5"/><path d="M14 2V5"/><path d="M9 10.5L15 10.5"/><path d="M9 9.5V11.5"/><path d="M15 9.5V11.5"/>',
  shoe: '<path d="M4 6h5.426a1 1 0 0 1 .863 .496l1.064 1.823a3 3 0 0 0 1.896 1.407l4.677 1.114a4 4 0 0 1 3.074 3.89v2.27a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10a1 1 0 0 1 1 -1"/><path d="M14 13l1 -2"/><path d="M8 18v-1a4 4 0 0 0 -4 -4h-1"/><path d="M10 12l1.5 -3"/>',
  jacket: '<path d="M16 3l-4 5l-4 -5"/><path d="M12 19a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-8.172a2 2 0 0 1 .586 -1.414l.828 -.828a2 2 0 0 0 .586 -1.414v-2.172a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v2.172a2 2 0 0 0 .586 1.414l.828 .828a2 2 0 0 1 .586 1.414v8.172a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2"/><path d="M20 13h-3a1 1 0 0 0 -1 1v2a1 1 0 0 0 1 1h3"/><path d="M4 17h3a1 1 0 0 0 1 -1v-2a1 1 0 0 0 -1 -1h-3"/><path d="M12 19v-11"/>',
  watch: '<path d="M16 16.4722V20C16 21.1045 15.1046 22 14 22H10C8.89543 22 8 21.1045 8 20V16.4722"/><path d="M8 7.52779V4C8 2.89543 8.89543 2 10 2H14C15.1046 2 16 2.89543 16 4V7.52779"/><path d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12Z"/><path d="M14 12H12V10"/>',
  bag: '<path d="M9 8H4C2.89543 8 2 8.89543 2 10V19C2 20.1046 2.89543 21 4 21H20C21.1046 21 22 20.1046 22 19V10C22 8.89543 21.1046 8 20 8H15M9 8V3.6C9 3.26863 9.26863 3 9.6 3H14.4C14.7314 3 15 3.26863 15 3.6V8M9 8H15M9 8V14M15 8V14"/>',
  hat: '<path d="M7 17V15C7 11.134 10.134 8 14 8C17.866 8 21 11.134 21 15V17H7ZM7 17H2"/><path d="M14 6.01L14.01 5.99889"/>',
  tie: '<path d="M12 22l4 -4l-2.5 -11l.993 -2.649a1 1 0 0 0 -.936 -1.351h-3.114a1 1 0 0 0 -.936 1.351l.993 2.649l-2.5 11l4 4"/><path d="M10.5 7h3l5 5.5"/>',
  glasses: '<path d="M2 14C2 16.2091 3.79086 18 6 18C8.20914 18 10 16.2091 10 14C10 11.7909 8.20914 10 6 10C3.79086 10 2 11.7909 2 14ZM2 14V6"/><path d="M22 14C22 16.2091 20.2091 18 18 18C15.7909 18 14 16.2091 14 14C14 11.7909 15.7909 10 18 10C20.2091 10 22 11.7909 22 14ZM22 14V6"/><path d="M14 14H10"/>',
  socks: '<path d="M13 3v6l4.798 5.142a4 4 0 0 1 -5.441 5.86l-6.736 -6.41a2 2 0 0 1 -.621 -1.451v-9.141h8"/><path d="M7.895 15.768c.708 -.721 1.105 -1.677 1.105 -2.768a4 4 0 0 0 -4 -4"/>',
  scarf: '<path d="M15 11H5C3.89543 11 3 10.1046 3 9V5C3 3.89543 3.89543 3 5 3H19C20.1046 3 21 3.89543 21 5V21"/><path d="M18 21V19"/><path d="M15 3V7V11V21"/><path d="M15 7H3"/>',
  belt: '<rect x="2" y="10" width="20" height="4" rx="1"/><rect x="9" y="8" width="6" height="8" rx="1"/>',
  gloves: '<path d="M17.5 13.5V8.5M17.5 8.5V6C17.5 4.1144 17.5 3.1716 16.9142 2.5858C16.3285 2 15.3856 2 13.5 2H7.5C5.6144 2 4.6716 2 4.0858 2.5858C3.5 3.1716 3.5 4.1144 3.5 6V22H17.5V18.5C17.5 18.5 21 18.5 21 15.5C21 14.5 21 13 21 11.5C21 8.5 17.5 8.5 17.5 8.5Z"/><path d="M7 11V2"/><path d="M10.5 11V2"/><path d="M14 11V2"/><path d="M6 2H15"/>',
  umbrella: '<path d="M4 12a8 8 0 0 1 16 0l-16 0"/><path d="M12 12v6a2 2 0 0 0 4 0"/>',
  ring: '<circle cx="12.5" cy="14.5" r="7.5"/><path d="M9 4L10.5 2H12.567H14.5268L16 4L12.5 7L9 4Z"/>',
};
const ICON_KEYS = Object.keys(ICONS);
function iconMarkup(key) {
  return `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || ICONS.tag}</g>`;
}
function iconSvg(key, size = 18, extraAttrs = '') {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${extraAttrs}>${iconMarkup(key)}</svg>`;
}

/* Stat-card icons (Lucide, MIT) — kept separate from ICONS/ICON_KEYS so they never show up in the category icon picker. */
const STAT_ICONS = {
  wears: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
  calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'trending-down': '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>',
};
function statIconSvg(key, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${STAT_ICONS[key] || ''}</g></svg>`;
}

/* ---------------- appearance: themes & fonts ---------------- */
function getThemeById(id) {
  return defaultThemes().find(t => t.id === id) || Store.state.appearance.customThemes.find(t => t.id === id);
}
function getFontById(id) {
  return defaultFonts().find(f => f.id === id) || Store.state.appearance.customFonts.find(f => f.id === id);
}
function ensureGoogleFont(query) {
  if (!query) return;
  const id = 'gf-' + slugify(query);
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  document.head.appendChild(link);
}
function applyTheme(themeId) {
  const theme = getThemeById(themeId);
  if (!theme) return;
  const root = document.documentElement.style;
  root.setProperty('--canvas', theme.canvas);
  root.setProperty('--surface-raised', theme.surfaceRaised);
  root.setProperty('--text', theme.text);
  root.setProperty('--ink', theme.ink);
  root.setProperty('--accent-ink', theme.accentInk);
  root.setProperty('--accent', theme.accent);
  root.setProperty('--thread', theme.thread);
  root.setProperty('--good', theme.good);
  // Only persist (and bump meta.updatedAt) when the choice actually changed —
  // re-applying the already-saved theme on every app load shouldn't count
  // as a local edit for sync purposes.
  if (Store.state.appearance.themeId !== themeId) {
    Store.state.appearance.themeId = themeId;
    Store.save();
  }
}
function applyFont(fontId) {
  const font = getFontById(fontId);
  if (!font) return;
  ensureGoogleFont(font.googleQuery);
  document.documentElement.style.setProperty('--font-display', `'${font.display}', Georgia, 'Times New Roman', serif`);
  document.documentElement.style.setProperty('--font-body', `'${font.body}', -apple-system, Segoe UI, sans-serif`);
  if (Store.state.appearance.fontId !== fontId) {
    Store.state.appearance.fontId = fontId;
    Store.save();
  }
}
function applyStoredAppearance() {
  const a = Store.state.appearance;
  applyTheme(a.themeId);
  applyFont(a.fontId);
}

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
  return activeItems().filter(it => matchActivity(act, it));
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
  const vals = activeItems().map(costPerWear).filter(v => v !== null && isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/* ---------------- tiny SVG chart helpers ----------------
   Hand-rolled, dependency-free, styled with our own tokens
   rather than a generic charting library's default look. */
function svgHBarChart(rows, opts = {}) {
  // rows: [{ label, value, color, iconKey }]  — value assumed >= 0
  const width = opts.width || 560;
  const rowH = 30;
  const gap = 10;
  const tickH = 20; // reserved space at top for gridline tick labels
  const useIcons = !!opts.useIcons;
  const labelW = opts.labelW || (useIcons ? 34 : 132);
  const fmt = opts.format || (v => Math.round(v).toLocaleString());
  const longestValue = Math.max(...rows.map(r => fmt(r.value).length), 3);
  const valueW = Math.max(56, longestValue * 7.2 + 14);
  const barAreaW = width - labelW - valueW;
  const bodyH = rows.length * (rowH + gap) - gap;
  const height = tickH + bodyH + 8;
  const max = Math.max(1, ...rows.map(r => r.value));

  // gridlines + tick labels at 25/50/75/100% of the shared scale
  const gridlines = [0.25, 0.5, 0.75, 1].map(frac => {
    const x = labelW + frac * barAreaW;
    return `
      <line x1="${x}" y1="${tickH}" x2="${x}" y2="${tickH + bodyH}" class="chart-grid"></line>
      <text x="${x}" y="${tickH - 6}" class="chart-tick" text-anchor="middle">${esc(fmt(max * frac))}</text>`;
  }).join('');

  const tracks = rows.map((r, i) => {
    const y = tickH + i * (rowH + gap);
    return `<rect x="${labelW}" y="${y + 4}" width="${barAreaW}" height="${rowH - 8}" rx="4" class="chart-track"></rect>`;
  }).join('');

  const bars = rows.map((r, i) => {
    const y = tickH + i * (rowH + gap);
    const w = Math.max(2, (r.value / max) * barAreaW);
    const color = r.color || 'var(--accent)';
    const labelMarkup = useIcons
      ? `<svg x="4" y="${y + rowH / 2 - 10}" width="20" height="20" viewBox="0 0 24 24" class="chart-icon"><title>${esc(r.label)}</title>${iconMarkup(r.iconKey)}</svg>`
      : `<text x="0" y="${y + rowH / 2 + 4}" class="chart-label">${esc(r.label)}</text>`;
    return `
      ${labelMarkup}
      <rect x="${labelW}" y="${y + 4}" width="${w}" height="${rowH - 8}" rx="4" fill="${color}"></rect>
      <text x="${labelW + barAreaW + 8}" y="${y + rowH / 2 + 4}" class="chart-value">${esc(fmt(r.value))}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${Math.max(height, rowH)}" class="chart-svg" role="img" aria-label="${esc(opts.aria || 'chart')}">${tracks}${gridlines}${bars}</svg>`;
}
function chartEmpty(msg) {
  return `<p class="muted" style="padding:.5rem 0;">${esc(msg)}</p>`;
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
let activeSettingsPanel = 'general';
const WARDROBE_FILTERS_KEY = 'rack.wardrobe.filters';
const DEFAULT_WARDROBE_FILTERS = { category: '', subcategory: '', brand: '', color: '', tag: '', activity: '', status: 'active', sort: 'recent', search: '' };
function loadWardrobeFilters() {
  try {
    const raw = localStorage.getItem(WARDROBE_FILTERS_KEY);
    if (!raw) return { ...DEFAULT_WARDROBE_FILTERS };
    return { ...DEFAULT_WARDROBE_FILTERS, ...JSON.parse(raw) };
  } catch (e) { return { ...DEFAULT_WARDROBE_FILTERS }; }
}
function saveWardrobeFilters() {
  try { localStorage.setItem(WARDROBE_FILTERS_KEY, JSON.stringify(wardrobeFilters)); } catch (e) { /* ignore */ }
}
function countActiveWardrobeFilters() {
  const f = wardrobeFilters;
  let n = 0;
  if ((f.status || 'active') !== 'active') n++;
  if (f.category) n++;
  if (f.subcategory) n++;
  if (f.brand) n++;
  if (f.color) n++;
  if (f.tag) n++;
  if (f.activity) n++;
  if (f.search) n++;
  return n;
}
let wardrobeFilters = loadWardrobeFilters();
let filtersSheetOpen = false;

const WARDROBE_VIEW_MODE_KEY = 'rack.wardrobe.viewMode';
function loadViewMode() {
  try { return localStorage.getItem(WARDROBE_VIEW_MODE_KEY) === 'list' ? 'list' : 'card'; }
  catch (e) { return 'card'; }
}
function saveViewMode(mode) {
  try { localStorage.setItem(WARDROBE_VIEW_MODE_KEY, mode); } catch (e) { /* ignore */ }
}
let wardrobeViewMode = loadViewMode();

function switchTab(name) {
  activeTab = name;
  qsa('.nav__link').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
  qsa('.bottom-nav__link').forEach(b => b.classList.toggle('is-active', b.dataset.tab === name));
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
   SYNC INDICATOR (header) — status dot + popover with Push/Pull,
   plus the conflict modal shown when SyncEngine flags a genuine
   conflict (local unsynced changes + remote also moved).
   ================================================================ */
function syncStatusLabel(status) {
  switch (status) {
    case 'synced': return 'Synced';
    case 'pending': return 'Unsynced';
    case 'syncing': return 'Syncing…';
    case 'failed': return 'Sync failed';
    case 'conflict': return 'Conflict';
    case 'not-connected': return 'Not synced';
    default: return '—';
  }
}
function fmtDateTime(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function syncStatusDetail(status) {
  const meta = loadSyncMeta();
  switch (status) {
    case 'synced': {
      const when = fmtDateTime(meta.lastSyncedLocalUpdatedAt);
      return when ? `Last synced ${when}` : 'Up to date.';
    }
    case 'pending': return "You have changes on this device that haven't been pushed yet.";
    case 'syncing': return 'Talking to the cloud…';
    case 'failed': return (SyncEngine.lastError && SyncEngine.lastError.message) || 'Something went wrong. Retrying automatically.';
    case 'conflict': return 'This device and the cloud both have changes. Choose which one wins.';
    case 'not-connected': return "Cloud sync isn't set up yet.";
    default: return '';
  }
}

let conflictModalShown = false;
function openConflictModal() {
  const body = el(`
    <div>
      <p>This device has changes that haven't been pushed, and the cloud copy has changed too — probably from another device. Pick one:</p>
      <div class="form-actions" style="flex-direction:column; align-items:stretch; gap:.6rem;">
        <button class="btn btn--primary" id="conflict-pull">Pull remote — discard my local changes</button>
        <button class="btn btn--danger" id="conflict-push">Push mine — overwrite remote</button>
        <button class="btn btn--ghost" id="conflict-cancel">Decide later</button>
      </div>
    </div>`);
  Modal.open('Sync conflict', body, {
    onMount: (root) => {
      qs('#conflict-pull', root).addEventListener('click', async () => {
        Modal.close();
        try { await SyncEngine.pull(); toast('Pulled remote — local changes replaced'); }
        catch (err) { toast(err.message, 'warn'); }
      });
      qs('#conflict-push', root).addEventListener('click', async () => {
        Modal.close();
        try { await SyncEngine.push(); toast('Pushed — remote overwritten'); }
        catch (err) { toast(err.message, 'warn'); }
      });
      qs('#conflict-cancel', root).addEventListener('click', () => Modal.close());
    },
  });
}

function initSyncIndicator() {
  const wrap = qs('#sync-indicator');
  const btn = qs('#sync-indicator-btn');
  const dot = qs('#sync-dot');
  const label = qs('#sync-indicator-label');
  const popover = qs('#sync-popover');
  const statusEl = qs('#sync-popover-status');
  const pushBtn = qs('#sync-push-btn');
  const pullBtn = qs('#sync-pull-btn');
  const settingsBtn = qs('#sync-popover-settings');

  const closePopover = () => popover.classList.remove('is-open');
  btn.addEventListener('click', (e) => { e.stopPropagation(); popover.classList.toggle('is-open'); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) closePopover(); });

  settingsBtn.addEventListener('click', () => {
    closePopover();
    activeSettingsPanel = 'general';
    switchTab('settings');
  });
  pushBtn.addEventListener('click', async () => {
    try { await SyncEngine.push(); toast('Pushed to cloud'); }
    catch (err) { toast(err.message, 'warn'); }
  });
  pullBtn.addEventListener('click', async () => {
    try { await SyncEngine.pull(); toast('Pulled from cloud'); }
    catch (err) { toast(err.message, 'warn'); }
  });

  function updateUI(status) {
    dot.className = 'sync-dot sync-dot--' + status;
    label.textContent = syncStatusLabel(status);
    statusEl.textContent = syncStatusDetail(status);
    const busy = status === 'syncing' || status === 'not-connected';
    pushBtn.disabled = busy;
    pullBtn.disabled = busy;

    if (status === 'conflict' && !conflictModalShown) {
      conflictModalShown = true;
      openConflictModal();
    } else if (status !== 'conflict') {
      conflictModalShown = false;
    }
  }
  SyncEngine.onChange(updateUI);
  updateUI(SyncEngine.status);
}

/* ================================================================
   DASHBOARD
   ================================================================ */
function renderDashboard() {
  const allItems = Store.state.items;
  const items = activeItems();
  const retired = retiredItems();
  const wrap = el(`<section class="view-section"></section>`);

  if (allItems.length === 0) {
    wrap.appendChild(el(`
      <div class="empty-state">
        <h2>Your rack is empty</h2>
        <p>Add your first item and RACK will start tracking what actually gets worn.</p>
        <button class="btn btn--primary" id="empty-add">Add an item</button>
      </div>`));
    qs('#empty-add', wrap).addEventListener('click', openAddItemModal);
    return wrap;
  }

  if (items.length === 0) {
    wrap.appendChild(el(`
      <div class="empty-state">
        <h2>Every item is retired</h2>
        <p>All ${allItems.length} item${allItems.length === 1 ? '' : 's'} in your rack ${allItems.length === 1 ? 'has' : 'have'} been marked donated, sold, or disposed. Add something new, or review what's retired.</p>
        <button class="btn btn--primary" id="empty-add">Add an item</button>
        <button class="btn btn--ghost" id="empty-retired">View retired items</button>
      </div>`));
    qs('#empty-add', wrap).addEventListener('click', openAddItemModal);
    qs('#empty-retired', wrap).addEventListener('click', () => {
      wardrobeFilters = { ...wardrobeFilters, status: 'retired' };
      saveWardrobeFilters();
      switchTab('wardrobe');
    });
    return wrap;
  }

  const totalValue = items.reduce((s, i) => s + (Number(i.cost) || 0), 0);
  const neverWorn = items.filter(i => !i.wearCount).length;
  const totalWears = items.reduce((s, i) => s + (i.wearCount || 0), 0);
  const avgCPW = avgCostPerWear();

  const byCategoryWears = {};
  const bySubcategoryWears = {};
  const byCategoryCount = {};
  const byCategoryCPW = {};
  items.forEach(i => {
    byCategoryWears[i.categoryId] = (byCategoryWears[i.categoryId] || 0) + (i.wearCount || 0);
    bySubcategoryWears[i.subcategoryId] = (bySubcategoryWears[i.subcategoryId] || 0) + (i.wearCount || 0);
    byCategoryCount[i.categoryId] = (byCategoryCount[i.categoryId] || 0) + 1;
    const cpw = costPerWear(i);
    if (cpw !== null) {
      (byCategoryCPW[i.categoryId] ||= []).push(cpw);
    }
  });
  const topSub = Object.entries(bySubcategoryWears).sort((a, b) => b[1] - a[1])[0];

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
      <div class="stat-card"><span class="stat-card__num">${topSub ? esc(G.subcategory(topSub[0])?.name || '—') : '—'}</span><span class="stat-card__label">Most-worn subcategory</span></div>
    </div>
  `));

  /* ---- charts ---- */
  const chartCols = el(`<div class="dash-cols"></div>`);

  const wearRows = Object.entries(byCategoryWears)
    .map(([id, wears]) => ({ label: G.category(id).name, iconKey: G.category(id).icon, value: wears }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  chartCols.appendChild(el(`
    <div class="panel">
      <h3>Wears by category</h3>
      ${wearRows.some(r => r.value > 0) ? svgHBarChart(wearRows, { color: 'var(--accent)', useIcons: true, aria: 'Wears by category' }) : chartEmpty('Log a few wears to see this fill in.')}
    </div>`));

  const cpwRows = Object.entries(byCategoryCPW)
    .map(([id, vals]) => ({ label: G.category(id).name, iconKey: G.category(id).icon, value: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  chartCols.appendChild(el(`
    <div class="panel">
      <h3>Avg. cost per wear by category</h3>
      ${cpwRows.length ? svgHBarChart(cpwRows, { color: 'var(--thread)', useIcons: true, format: v => fmtMoney(v), aria: 'Average cost per wear by category' }) : chartEmpty('Add cost and log wears to see this.')}
    </div>`));

  const countRows = Object.entries(byCategoryCount)
    .map(([id, n]) => ({ label: G.category(id).name, iconKey: G.category(id).icon, value: n }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  chartCols.appendChild(el(`
    <div class="panel">
      <h3>Wardrobe composition</h3>
      ${svgHBarChart(countRows, { color: 'var(--good)', useIcons: true, aria: 'Item count by category' })}
    </div>`));

  if (retired.length) {
    const reasonCounts = {};
    retired.forEach(i => { reasonCounts[i.retiredReason || 'other'] = (reasonCounts[i.retiredReason || 'other'] || 0) + 1; });
    const reasonRows = RETIRE_REASONS.map(r => ({ label: r.label, value: reasonCounts[r.id] || 0 })).filter(r => r.value > 0);
    const retiredPanel = el(`
      <div class="panel">
        <h3>Retired items</h3>
        ${svgHBarChart(reasonRows, { color: 'var(--ink-soft)', aria: 'Retired items by reason' })}
        <button class="btn btn--ghost btn--small" id="view-retired" style="margin-top:.6rem;">View ${retired.length} retired item${retired.length === 1 ? '' : 's'}</button>
      </div>`);
    qs('#view-retired', retiredPanel).addEventListener('click', () => {
      wardrobeFilters = { ...wardrobeFilters, status: 'retired' };
      saveWardrobeFilters();
      switchTab('wardrobe');
    });
    chartCols.appendChild(retiredPanel);
  }

  wrap.appendChild(chartCols);

  /* ---- lists ---- */
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
      wardrobeFilters = { ...DEFAULT_WARDROBE_FILTERS, sort: 'least' };
      saveWardrobeFilters();
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
        <input type="search" class="search-input" id="wardrobe-search" placeholder="Search wardrobe…" autocomplete="off" value="${esc(wardrobeFilters.search || '')}">
        <button type="button" class="btn btn--ghost filters-toggle-btn" id="filters-toggle-btn">
          Filters<span class="filter-count-badge" id="filter-count-badge" hidden></span>
        </button>
        <div class="toolbar__filters" id="toolbar-filters">
          <select id="f-status">
            <option value="active">Active</option>
            <option value="retired">Retired</option>
            <option value="all">All</option>
          </select>
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
          <button type="button" class="btn btn--ghost btn--small" id="filters-reset-btn">Reset filters</button>
          <button type="button" class="btn btn--ghost filters-done-btn" id="filters-done-btn">Done</button>
        </div>
        <div class="view-toggle" id="view-toggle">
          <button type="button" class="view-toggle__btn ${wardrobeViewMode === 'card' ? 'is-active' : ''}" data-mode="card">Cards</button>
          <button type="button" class="view-toggle__btn ${wardrobeViewMode === 'list' ? 'is-active' : ''}" data-mode="list">List</button>
        </div>
        <button class="btn btn--primary" id="add-item-btn">+ Add item</button>
      </div>
      <div class="filters-backdrop" id="filters-backdrop"></div>
      <div class="item-grid" id="item-grid"></div>
    </div>
  `);
  wrap.appendChild(toolbar);

  qsa('.view-toggle__btn', toolbar).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === wardrobeViewMode) return;
      wardrobeViewMode = btn.dataset.mode;
      saveViewMode(wardrobeViewMode);
      qsa('.view-toggle__btn', toolbar).forEach(b => b.classList.toggle('is-active', b === btn));
      renderItemGrid();
    });
  });

  const s = Store.state;
  qs('#f-status', toolbar).value = wardrobeFilters.status || 'active';

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

  const badge = qs('#filter-count-badge', toolbar);
  const resetBtn = qs('#filters-reset-btn', toolbar);
  function syncFilterIndicators() {
    const count = countActiveWardrobeFilters();
    badge.textContent = String(count);
    badge.hidden = count === 0;
    resetBtn.textContent = count > 0 ? `Reset filters (${count})` : 'Reset filters';
    resetBtn.disabled = count === 0;
  }
  function onFilterChanged() {
    saveWardrobeFilters();
    syncFilterIndicators();
    renderItemGrid();
  }
  syncFilterIndicators();

  qs('#f-status', toolbar).addEventListener('change', (e) => { wardrobeFilters.status = e.target.value; onFilterChanged(); });
  catSel.addEventListener('change', () => { wardrobeFilters.category = catSel.value; wardrobeFilters.subcategory = ''; refreshSubOptions(); onFilterChanged(); });
  subSel.addEventListener('change', () => { wardrobeFilters.subcategory = subSel.value; onFilterChanged(); });
  brandSel.addEventListener('change', () => { wardrobeFilters.brand = brandSel.value; onFilterChanged(); });
  colorSel.addEventListener('change', () => { wardrobeFilters.color = colorSel.value; onFilterChanged(); });
  tagSel.addEventListener('change', () => { wardrobeFilters.tag = tagSel.value; onFilterChanged(); });
  actSel.addEventListener('change', () => { wardrobeFilters.activity = actSel.value; onFilterChanged(); });
  qs('#f-sort', toolbar).addEventListener('change', (e) => { wardrobeFilters.sort = e.target.value; onFilterChanged(); });
  qs('#add-item-btn', toolbar).addEventListener('click', openAddItemModal);

  const searchInput = qs('#wardrobe-search', toolbar);
  let searchDebounce = null;
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      wardrobeFilters.search = val;
      onFilterChanged();
    }, 150);
  });

  resetBtn.addEventListener('click', () => {
    wardrobeFilters = { ...DEFAULT_WARDROBE_FILTERS };
    saveWardrobeFilters();
    render();
    toast('Filters reset');
  });

  /* mobile-only filter sheet: same live selects, just repositioned via CSS */
  const filtersPanel = qs('#toolbar-filters', toolbar);
  const backdrop = qs('#filters-backdrop', toolbar);
  const toggleBtn = qs('#filters-toggle-btn', toolbar);
  const doneBtn = qs('#filters-done-btn', toolbar);
  function openFiltersSheet() {
    filtersSheetOpen = true;
    filtersPanel.classList.add('is-open');
    backdrop.classList.add('is-open');
  }
  function closeFiltersSheet() {
    filtersSheetOpen = false;
    filtersPanel.classList.remove('is-open');
    backdrop.classList.remove('is-open');
  }
  toggleBtn.addEventListener('click', () => (filtersSheetOpen ? closeFiltersSheet() : openFiltersSheet()));
  backdrop.addEventListener('click', closeFiltersSheet);
  doneBtn.addEventListener('click', closeFiltersSheet);
  if (filtersSheetOpen) { filtersPanel.classList.add('is-open'); backdrop.classList.add('is-open'); }

  return wrap;
}

function renderItemGrid() {
  const grid = qs('#item-grid');
  if (!grid) return;
  grid.innerHTML = '';
  grid.classList.toggle('item-grid--list', wardrobeViewMode === 'list');
  const f = wardrobeFilters;
  let items = Store.state.items.filter(i => {
    const status = f.status || 'active';
    if (status === 'active' && i.status === 'retired') return false;
    if (status === 'retired' && i.status !== 'retired') return false;
    if (f.category && i.categoryId !== f.category) return false;
    if (f.subcategory && i.subcategoryId !== f.subcategory) return false;
    if (f.brand && i.brandId !== f.brand) return false;
    if (f.color && i.colorId !== f.color) return false;
    if (f.tag && !i.tags.includes(f.tag)) return false;
    if (f.activity && !matchActivity(G.activity(f.activity), i)) return false;
    if (f.search) {
      const tagNames = (i.tags || []).map(tid => G.tag(tid)?.name || '').join(' ');
      const haystack = `${itemTitle(i)} ${tagNames}`.toLowerCase();
      if (!haystack.includes(f.search.trim().toLowerCase())) return false;
    }
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
    const msg = (f.status === 'retired') ? "No retired items yet." : "No items match these filters.";
    grid.appendChild(el(`<p class="muted" style="padding: 2rem 0;">${esc(msg)}</p>`));
    return;
  }
  items.forEach(item => grid.appendChild(wardrobeViewMode === 'list' ? itemListRow(item) : itemCard(item)));
}

/* Shared action wiring — both the card and the compact list row use the
   exact same data-act handlers, just attached to different markup. */
function wireItemActions(root, item, isRetired) {
  if (!isRetired) {
    const wearBtn = qs('[data-act="wear"]', root);
    if (wearBtn) wearBtn.addEventListener('click', () => {
      item.wearCount = (item.wearCount || 0) + 1;
      item.lastWornAt = Date.now();
      Store.save();
      renderItemGrid();
    });
    const undoBtn = qs('[data-act="undo"]', root);
    if (undoBtn) undoBtn.addEventListener('click', () => {
      if (!item.wearCount) return;
      item.wearCount -= 1;
      Store.save();
      renderItemGrid();
    });
    const backfillBtn = qs('[data-act="backfill"]', root);
    if (backfillBtn) backfillBtn.addEventListener('click', () => openBackfillModal(item));
    const retireBtn = qs('[data-act="retire"]', root);
    if (retireBtn) retireBtn.addEventListener('click', () => openRetireModal(item));
  } else {
    const reactivateBtn = qs('[data-act="reactivate"]', root);
    if (reactivateBtn) reactivateBtn.addEventListener('click', () => {
      item.status = 'active';
      item.retiredReason = null;
      item.retiredAt = null;
      Store.save();
      render();
      toast('Item reactivated');
    });
  }
  qs('[data-act="edit"]', root).addEventListener('click', () => openItemModal(item));
  qs('[data-act="delete"]', root).addEventListener('click', () => {
    Modal.confirm(`Permanently delete "${itemTitle(item)}"? This removes it completely, including its wear history. This can't be undone.`, () => {
      Store.state.items = Store.state.items.filter(i => i.id !== item.id);
      Store.save();
      render();
      toast('Item deleted');
    }, { danger: true, yesLabel: 'Delete permanently' });
  });
}

function itemCard(item) {
  const color = G.color(item.colorId);
  const cat = G.category(item.categoryId);
  const sub = G.subcategory(item.subcategoryId);
  const cpw = costPerWear(item);
  const avg = avgCostPerWear();
  const isRetired = item.status === 'retired';
  let cpwClass = '';
  if (cpw !== null && avg !== null) cpwClass = cpw <= avg ? 'tag-chip--good' : 'tag-chip--warn';

  const swatchStyle = color?.hex && color.hex !== 'multi'
    ? `background:${color.hex}`
    : 'background:conic-gradient(#A23B33,#3B6EA5,#4C6B4F,#D8CBAE,#A23B33)';

  const reasonLabel = RETIRE_REASONS.find(r => r.id === item.retiredReason)?.label || 'Retired';

  const cpwCellClass = cpwClass === 'tag-chip--good' ? 'stat-cell--good' : (cpwClass === 'tag-chip--warn' ? 'stat-cell--warn' : '');

  ensureOverflowOutsideClickHandler();
  const card = el(`
    <article class="item-card ${isRetired ? 'item-card--retired' : ''}">
      <div class="item-card__top">
        <span class="swatch" style="${swatchStyle}" title="${esc(color?.name || 'No color')}"></span>
        <div class="item-card__titles">
          <h4>${esc(itemTitle(item))}</h4>
          <p class="item-card__breadcrumb">${iconSvg(cat.icon, 13, 'style="vertical-align:-2px;margin-right:3px;"')}${esc(cat.name)} &rsaquo; ${esc(sub?.name || '—')}</p>
        </div>
        <div class="item-card__overflow item-row__overflow">
          <button type="button" class="item-card__hole-btn" data-act="overflow-toggle" aria-label="More actions">&#8942;</button>
          <div class="item-row__menu">
            ${isRetired ? '' : `
              <button type="button" data-act="undo" ${!item.wearCount ? 'disabled' : ''}>Undo</button>
              <button type="button" data-act="retire">Retire</button>`}
            <button type="button" data-act="edit">Edit</button>
            <button type="button" data-act="delete" class="danger">Delete</button>
          </div>
        </div>
      </div>
      ${item.subtext ? `<p class="item-card__subtext">${esc(item.subtext)}</p>` : ''}
      ${isRetired ? `<p class="retired-badge">${esc(reasonLabel)} &middot; ${esc(fmtDate(item.retiredAt))}</p>` : ''}
      <div class="item-card__tags">
        ${(item.tags || []).map(tid => `<span class="tag-chip">${esc(G.tag(tid).name)}</span>`).join('')}
      </div>
      <div class="item-card__stats">
        <div class="stat-cell">
          <span class="stat-cell__icon">${statIconSvg('wears')}</span>
          <span class="stat-cell__text"><span class="mono">${item.wearCount || 0}</span><small>wears</small></span>
        </div>
        <div class="stat-cell">
          <span class="stat-cell__icon">${statIconSvg('calendar')}</span>
          <span class="stat-cell__text"><span class="mono" title="${item.lastWornAt ? esc(fmtDate(item.lastWornAt)) : ''}">${fmtDateShort(item.lastWornAt)}</span><small>last worn</small></span>
        </div>
        <div class="stat-cell">
          <span class="stat-cell__icon">${statIconSvg('wallet')}</span>
          <span class="stat-cell__text"><span class="mono">${item.cost ? fmtMoney(item.cost) : '—'}</span><small>cost</small></span>
        </div>
        <div class="stat-cell ${cpwCellClass}">
          <span class="stat-cell__icon">${statIconSvg('trending-down')}</span>
          <span class="stat-cell__text"><span class="mono">${cpw !== null ? fmtMoney(cpw) : '—'}</span><small>per wear</small></span>
        </div>
      </div>
      <div class="item-card__actions">
        ${isRetired
          ? `<button class="btn btn--small btn--ghost" data-act="reactivate">Reactivate</button>`
          : `<div class="item-card__actions-row item-card__actions-row--primary">
               <button class="btn btn--primary btn--wear" data-act="wear">+1 Worn</button>
               <button class="btn btn--ghost btn--wear" data-act="backfill">Log past</button>
             </div>`}
      </div>
    </article>`);

  const overflowWrap = qs('.item-card__overflow', card);
  qs('[data-act="overflow-toggle"]', card).addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = overflowWrap.classList.contains('is-open');
    qsa('.item-row__overflow.is-open').forEach(w => w.classList.remove('is-open'));
    if (!wasOpen) overflowWrap.classList.add('is-open');
  });

  wireItemActions(card, item, isRetired);
  return card;
}

/* ---- compact list row: name + primary action visible, rest behind an overflow menu ---- */
let __overflowOutsideClickBound = false;
function ensureOverflowOutsideClickHandler() {
  if (__overflowOutsideClickBound) return;
  __overflowOutsideClickBound = true;
  document.addEventListener('click', (e) => {
    qsa('.item-row__overflow.is-open').forEach(wrap => {
      if (!wrap.contains(e.target)) wrap.classList.remove('is-open');
    });
  });
}

function itemListRow(item) {
  ensureOverflowOutsideClickHandler();
  const color = G.color(item.colorId);
  const cat = G.category(item.categoryId);
  const sub = G.subcategory(item.subcategoryId);
  const cpw = costPerWear(item);
  const isRetired = item.status === 'retired';
  const reasonLabel = RETIRE_REASONS.find(r => r.id === item.retiredReason)?.label || 'Retired';

  const swatchStyle = color?.hex && color.hex !== 'multi'
    ? `background:${color.hex}`
    : 'background:conic-gradient(#A23B33,#3B6EA5,#4C6B4F,#D8CBAE,#A23B33)';

  const metaBits = [
    `${esc(cat.name)} \u203a ${esc(sub?.name || '—')}`,
    `${item.wearCount || 0}\u00d7`,
  ];
  if (cpw !== null) metaBits.push(`${fmtMoney(cpw)}/wear`);
  if (isRetired) metaBits.push(`${esc(reasonLabel)}`);

  const row = el(`
    <div class="item-row ${isRetired ? 'item-row--retired' : ''}">
      <span class="swatch swatch--sm" style="${swatchStyle}" title="${esc(color?.name || 'No color')}"></span>
      <div class="item-row__main">
        <span class="item-row__title">${esc(itemTitle(item))}</span>
        <span class="item-row__meta">${metaBits.join(' &middot; ')}</span>
      </div>
      ${isRetired
        ? `<button class="btn btn--small btn--ghost" data-act="reactivate">Reactivate</button>`
        : `<button class="btn btn--small btn--primary" data-act="wear">+1 Worn</button>`}
      <div class="item-row__overflow">
        <button type="button" class="btn btn--tiny btn--ghost item-row__overflow-btn" data-act="overflow-toggle" aria-label="More actions">&#8942;</button>
        <div class="item-row__menu">
          ${isRetired ? '' : `
            <button type="button" data-act="undo" ${!item.wearCount ? 'disabled' : ''}>Undo</button>
            <button type="button" data-act="backfill">Log past wear</button>
            <button type="button" data-act="retire">Retire</button>`}
          <button type="button" data-act="edit">Edit</button>
          <button type="button" data-act="delete" class="danger">Delete</button>
        </div>
      </div>
    </div>`);

  const overflowWrap = qs('.item-row__overflow', row);
  qs('[data-act="overflow-toggle"]', row).addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = overflowWrap.classList.contains('is-open');
    qsa('.item-row__overflow.is-open').forEach(w => w.classList.remove('is-open'));
    if (!wasOpen) overflowWrap.classList.add('is-open');
  });

  wireItemActions(row, item, isRetired);
  return row;
}


function todayDateStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function openBackfillModal(item) {
  const maxDate = todayDateStr();
  const body = el(`
    <form class="form" id="backfill-form">
      <p class="muted">Log a wear for "${esc(itemTitle(item))}" on a past date. This adds to the wear count; "Last worn" only moves forward if this date is more recent than what's already stored.</p>
      <label>Date worn
        <input type="date" name="date" max="${maxDate}" value="${maxDate}" required>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="backfill-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">Log wear</button>
      </div>
    </form>`);
  Modal.open('Log a past wear', body, {
    onMount: (root) => {
      qs('#backfill-cancel', root).addEventListener('click', () => Modal.close());
      qs('#backfill-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const dateStr = new FormData(e.target).get('date');
        if (!dateStr) return;
        if (dateStr > maxDate) { toast('Pick a date up to today', 'warn'); return; }
        const ts = new Date(dateStr + 'T12:00:00').getTime();
        item.wearCount = (item.wearCount || 0) + 1;
        if (ts > (item.lastWornAt || 0)) item.lastWornAt = ts;
        Store.save();
        Modal.close();
        renderItemGrid();
        toast(`Logged a wear for ${fmtDate(ts)}`);
      });
    },
  });
}

function openRetireModal(item) {
  const body = el(`
    <form class="form" id="retire-form">
      <p class="muted">Retiring keeps "${esc(itemTitle(item))}" and its wear history on record, just out of your active rack.</p>
      <label>Reason
        <select name="reason">
          ${RETIRE_REASONS.map(r => `<option value="${r.id}" ${r.id === 'donated' ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="retire-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">Retire item</button>
      </div>
    </form>`);
  Modal.open('Retire item', body, {
    onMount: (root) => {
      qs('#retire-cancel', root).addEventListener('click', () => Modal.close());
      qs('#retire-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const reason = new FormData(e.target).get('reason');
        item.status = 'retired';
        item.retiredReason = reason;
        item.retiredAt = Date.now();
        Store.save();
        Modal.close();
        render();
        toast(`Marked as ${RETIRE_REASONS.find(r => r.id === reason).label.toLowerCase()}`);
      });
    },
  });
}

function openAddItemModal() { openItemModal(null); }

function openItemModal(existing) {
  const s = Store.state;
  const isEdit = !!existing;
  const item = existing ? { ...existing } : {
    id: uid('item'), categoryId: '', subcategoryId: '', brandId: '', colorId: '',
    tags: [], subtext: '', cost: '', wearCount: 0, lastWornAt: null, createdAt: Date.now(),
    status: 'active', retiredReason: null, retiredAt: null,
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
        <label><span id="cost-label-text">Original cost</span> <span class="muted">(optional)</span>
          <input type="number" name="cost" min="0" step="0.01" value="${item.cost ?? ''}" placeholder="0.00">
        </label>
        <label>Times worn
          <input type="number" name="wearCount" min="0" step="1" value="${item.wearCount || 0}">
        </label>
      </div>
      <p class="muted" id="gifted-hint" style="display:none; margin-top:-.6rem;">Tagged as Gifted — enter what it would have cost, so it still shows up in value analytics.</p>
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
      catSelect.addEventListener('change', () => { refreshSubs(); refreshTags(); updateGiftedHint(); });
      subSelect.addEventListener('change', () => { refreshTags(); updateGiftedHint(); });

      function updateGiftedHint() {
        const isGifted = qsa('#tag-checks input:checked', root).some(cb => cb.value === GIFTED_TAG_ID);
        qs('#gifted-hint', root).style.display = isGifted ? 'block' : 'none';
        qs('#cost-label-text', root).textContent = isGifted ? 'Estimated value' : 'Original cost';
      }
      qs('#tag-checks', root).addEventListener('change', updateGiftedHint);
      updateGiftedHint();

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
  qs('#add-cat', box).addEventListener('click', () => openCategoryModal());

  s.categories.forEach(cat => {
    const subs = G.subsFor(cat.id);
    const itemCount = s.items.filter(i => i.categoryId === cat.id).length;
    const catBox = el(`
      <div class="master-card">
        <div class="master-card__row">
          <span class="cat-icon-badge">${iconSvg(cat.icon, 18)}</span>
          <strong>${esc(cat.name)}</strong>
          <span class="muted">${itemCount} item${itemCount === 1 ? '' : 's'}</span>
          <div class="master-card__actions">
            <button class="btn btn--tiny btn--ghost" data-act="edit">Edit</button>
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

    qs('[data-act="edit"]', catBox).addEventListener('click', () => openCategoryModal(cat));
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
function openCategoryModal(existing) {
  const isEdit = !!existing;
  let selectedIcon = existing?.icon || 'tag';
  const body = el(`
    <form class="form" id="cat-form">
      <label>Category name
        <input type="text" name="name" value="${esc(existing?.name || '')}" required autofocus>
      </label>
      <fieldset>
        <legend>Icon</legend>
        <div class="icon-picker" id="icon-picker">
          ${ICON_KEYS.map(k => `<button type="button" class="icon-picker__btn ${k === selectedIcon ? 'is-selected' : ''}" data-icon="${k}" title="${k}">${iconSvg(k, 20)}</button>`).join('')}
        </div>
      </fieldset>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="cat-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">${isEdit ? 'Save' : 'Add category'}</button>
      </div>
    </form>`);
  Modal.open(isEdit ? 'Edit category' : 'New category', body, {
    onMount: (root) => {
      qsa('.icon-picker__btn', root).forEach(btn => {
        btn.addEventListener('click', () => {
          selectedIcon = btn.dataset.icon;
          qsa('.icon-picker__btn', root).forEach(b => b.classList.toggle('is-selected', b === btn));
        });
      });
      qs('#cat-cancel', root).addEventListener('click', () => Modal.close());
      qs('#cat-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = qs('[name="name"]', root).value.trim();
        if (!name) return;
        if (isEdit) { existing.name = name; existing.icon = selectedIcon; }
        else { Store.state.categories.push({ id: uid('cat'), name, icon: selectedIcon, custom: true }); }
        Store.save(); Modal.close(); render();
        toast(isEdit ? 'Category updated' : 'Category added');
      });
    },
  });
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
  const wrap = el(`
    <section class="view-section">
      <div class="subnav" id="settings-subnav">
        ${['general', 'appearance'].map(p =>
          `<button class="subnav__link ${p === activeSettingsPanel ? 'is-active' : ''}" data-panel="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`
        ).join('')}
      </div>
      <div id="settings-panel"></div>
    </section>`);

  qsa('.subnav__link', wrap).forEach(btn => btn.addEventListener('click', () => {
    activeSettingsPanel = btn.dataset.panel;
    render();
  }));

  const panel = qs('#settings-panel', wrap);
  if (activeSettingsPanel === 'appearance') panel.appendChild(renderAppearanceSettings());
  else panel.appendChild(renderGeneralSettings());

  return wrap;
}

function renderGeneralSettings() {
  const s = Store.state;
  const wrap = el(`<div class="settings-grid"></div>`);

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
          applyStoredAppearance();
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
      <p class="muted">Access your rack on other devices using a private GitHub Gist as storage. Your token stays in this browser only — it's never written into the app's code or repository. This app auto-checks for newer changes when you open or return to it; use Push/Pull here (or the status indicator in the header) to sync manually anytime.</p>
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
      <p class="muted" id="sync-status">${esc(syncStatusLabel(SyncEngine.status))} — ${esc(syncStatusDetail(SyncEngine.status))}</p>
    </div>`);
  const statusLine = qs('#sync-status', syncPanel);
  const refreshStatusLine = () => { statusLine.textContent = `${syncStatusLabel(SyncEngine.status)} — ${syncStatusDetail(SyncEngine.status)}`; };
  qs('#sync-token', syncPanel).addEventListener('change', (e) => Sync.setToken(e.target.value.trim()));
  qs('#sync-gist', syncPanel).addEventListener('change', (e) => Sync.setGistId(e.target.value.trim()));
  qs('#push-btn', syncPanel).addEventListener('click', async () => {
    Sync.setToken(qs('#sync-token', syncPanel).value.trim());
    Sync.setGistId(qs('#sync-gist', syncPanel).value.trim());
    try {
      await SyncEngine.push();
      qs('#sync-gist', syncPanel).value = Sync.getGistId();
      toast('Pushed to cloud');
    } catch (err) { toast(err.message, 'warn'); }
    refreshStatusLine();
  });
  qs('#pull-btn', syncPanel).addEventListener('click', async () => {
    Sync.setToken(qs('#sync-token', syncPanel).value.trim());
    Sync.setGistId(qs('#sync-gist', syncPanel).value.trim());
    try {
      await SyncEngine.pull();
      toast('Pulled from cloud');
    } catch (err) { toast(err.message, 'warn'); }
    refreshStatusLine();
  });
  qs('#disconnect-btn', syncPanel).addEventListener('click', () => {
    Sync.setToken(''); Sync.setGistId('');
    SyncEngine.disconnect();
    qs('#sync-token', syncPanel).value = ''; qs('#sync-gist', syncPanel).value = '';
    toast('Disconnected');
    refreshStatusLine();
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
      applyStoredAppearance();
      render();
      toast('App reset');
    }, { danger: true, yesLabel: 'Erase everything' });
  });

  [dataPanel, backupPanel, syncPanel, dangerPanel].forEach(p => wrap.appendChild(p));
  return wrap;
}

/* ---- Appearance: themes & fonts ---- */
function renderAppearanceSettings() {
  const s = Store.state;
  const wrap = el(`<div class="settings-grid settings-grid--appearance"></div>`);

  /* -- themes -- */
  const themePanel = el(`
    <div class="panel panel--wide">
      <h3>Theme</h3>
      <p class="muted">Pick a palette, or build your own.</p>
      <div class="theme-grid" id="theme-grid"></div>
      <button class="btn btn--ghost btn--small" id="add-theme" style="margin-top:.8rem;">+ New theme</button>
    </div>`);
  const themeGrid = qs('#theme-grid', themePanel);
  const allThemes = [...defaultThemes(), ...s.appearance.customThemes];
  allThemes.forEach(theme => {
    const isActive = s.appearance.themeId === theme.id;
    const card = el(`
      <div class="theme-card ${isActive ? 'is-active' : ''}" style="background:${theme.canvas}; border-color:${isActive ? theme.accent : theme.canvas};">
        <div class="theme-card__dots">
          <span style="background:${theme.ink}"></span>
          <span style="background:${theme.accent}"></span>
          <span style="background:${theme.thread}"></span>
          <span style="background:${theme.good}"></span>
        </div>
        <p style="color:${theme.text};">${esc(theme.name)}</p>
        <div class="theme-card__actions">
          <button class="btn btn--tiny" data-act="apply" style="${isActive ? `background:${theme.ink};color:${theme.accentInk};border-color:${theme.ink};` : `background:transparent;color:${theme.text};border:1px solid ${theme.accent};`}">${isActive ? 'Active' : 'Apply'}</button>
          ${theme.custom ? `<button class="btn btn--tiny" data-act="delete" style="background:transparent;color:${theme.thread};border:1px solid ${theme.thread};">Delete</button>` : ''}
        </div>
      </div>`);
    qs('[data-act="apply"]', card).addEventListener('click', () => {
      applyTheme(theme.id);
      render();
      toast(`Theme set to ${theme.name}`);
    });
    if (theme.custom) {
      qs('[data-act="delete"]', card).addEventListener('click', () => {
        Modal.confirm(`Delete theme "${theme.name}"?`, () => {
          s.appearance.customThemes = s.appearance.customThemes.filter(t => t.id !== theme.id);
          if (s.appearance.themeId === theme.id) applyTheme('theme_canvas');
          Store.save(); render();
        }, { danger: true, yesLabel: 'Delete' });
      });
    }
    themeGrid.appendChild(card);
  });
  qs('#add-theme', themePanel).addEventListener('click', () => openThemeModal());

  /* -- fonts -- */
  const fontPanel = el(`
    <div class="panel panel--wide">
      <h3>Font</h3>
      <p class="muted">Applies to headings and body text throughout the app.</p>
      <div class="font-grid" id="font-grid"></div>
      <button class="btn btn--ghost btn--small" id="add-font" style="margin-top:.8rem;">+ New font</button>
    </div>`);
  const fontGrid = qs('#font-grid', fontPanel);
  const allFonts = [...defaultFonts(), ...s.appearance.customFonts];
  allFonts.forEach(font => {
    ensureGoogleFont(font.googleQuery);
    const isActive = s.appearance.fontId === font.id;
    const card = el(`
      <div class="font-card ${isActive ? 'is-active' : ''}">
        <p class="font-card__sample" style="font-family:'${esc(font.display)}', serif;">Aa</p>
        <p class="font-card__name">${esc(font.name)}</p>
        <div class="theme-card__actions">
          <button class="btn btn--tiny ${isActive ? 'btn--primary' : 'btn--ghost'}" data-act="apply">${isActive ? 'Active' : 'Apply'}</button>
          ${font.custom ? '<button class="btn btn--tiny btn--danger-ghost" data-act="delete">Delete</button>' : ''}
        </div>
      </div>`);
    qs('[data-act="apply"]', card).addEventListener('click', () => {
      applyFont(font.id);
      render();
      toast(`Font set to ${font.name}`);
    });
    if (font.custom) {
      qs('[data-act="delete"]', card).addEventListener('click', () => {
        Modal.confirm(`Delete font "${font.name}"?`, () => {
          s.appearance.customFonts = s.appearance.customFonts.filter(f => f.id !== font.id);
          if (s.appearance.fontId === font.id) applyFont('font_fraunces_plex');
          Store.save(); render();
        }, { danger: true, yesLabel: 'Delete' });
      });
    }
    fontGrid.appendChild(card);
  });
  qs('#add-font', fontPanel).addEventListener('click', () => openFontModal());

  wrap.appendChild(themePanel);
  wrap.appendChild(fontPanel);
  return wrap;
}

function openThemeModal() {
  const fields = [
    ['name', 'Theme name', 'text', 'My theme'],
    ['canvas', 'Background', 'color', '#E7E1D3'],
    ['surfaceRaised', 'Card surface', 'color', '#FFFFFF'],
    ['text', 'Body text', 'color', '#23201B'],
    ['ink', 'Header / buttons', 'color', '#23201B'],
    ['accentInk', 'Text on header/buttons', 'color', '#FBF9F4'],
    ['accent', 'Accent', 'color', '#8A6F3B'],
    ['thread', 'Secondary accent', 'color', '#A23B33'],
    ['good', 'Success color', 'color', '#4C6B4F'],
  ];
  const body = el(`
    <form class="form" id="theme-form">
      ${fields.map(([key, label, type, def]) => `
        <label${type === 'color' ? ' class="color-field"' : ''}>${label}
          <input type="${type}" name="${key}" value="${def}" ${type === 'text' ? 'required' : ''}>
        </label>`).join('')}
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="theme-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">Create theme</button>
      </div>
    </form>`);
  Modal.open('New theme', body, {
    onMount: (root) => {
      qs('#theme-cancel', root).addEventListener('click', () => Modal.close());
      qs('#theme-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = fd.get('name').trim();
        if (!name) return;
        const theme = { id: uid('theme'), name, custom: true };
        fields.forEach(([key]) => { if (key !== 'name') theme[key] = fd.get(key); });
        Store.state.appearance.customThemes.push(theme);
        applyTheme(theme.id);
        Modal.close(); render();
        toast('Theme created');
      });
    },
  });
}

function openFontModal() {
  const body = el(`
    <form class="form" id="font-form">
      <label>Font name
        <input type="text" name="name" required placeholder="e.g. My Font Pairing">
      </label>
      <label>Display font (headings) <span class="muted">— exact Google Fonts name</span>
        <input type="text" name="display" required placeholder="e.g. Lora">
      </label>
      <label>Body font (everything else) <span class="muted">— exact Google Fonts name</span>
        <input type="text" name="body" required placeholder="e.g. Source Sans 3">
      </label>
      <p class="muted">RACK loads these from Google Fonts, so use the family name exactly as it appears there.</p>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="font-cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">Create font</button>
      </div>
    </form>`);
  Modal.open('New font', body, {
    onMount: (root) => {
      qs('#font-cancel', root).addEventListener('click', () => Modal.close());
      qs('#font-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = fd.get('name').trim();
        const display = fd.get('display').trim();
        const bodyFont = fd.get('body').trim();
        if (!name || !display || !bodyFont) return;
        const families = [...new Set([display, bodyFont])].map(f => f.replace(/\s+/g, '+') + ':wght@400;500;600;700');
        const font = { id: uid('font'), name, display, body: bodyFont, googleQuery: families.join('&family='), custom: true };
        Store.state.appearance.customFonts.push(font);
        applyFont(font.id);
        Modal.close(); render();
        toast('Font created');
      });
    },
  });
}

/* ================================================================
   INIT
   ================================================================ */
function init() {
  if (!Store.state.meta.currency) { Store.state.meta.currency = 'LKR'; Store.save(); }
  applyStoredAppearance();
  qsa('.nav__link').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  qsa('.bottom-nav__link').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  initSyncIndicator();
  switchTab('dashboard');

  SyncEngine.checkAndAutoSync().catch(() => { /* status already reflects the failure */ });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      SyncEngine.checkAndAutoSync().catch(() => {});
    }
  });
}
document.addEventListener('DOMContentLoaded', init);
