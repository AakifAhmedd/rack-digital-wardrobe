/* ============================================================
   RACK — data.js
   Default master data + localStorage persistence layer.
   Items are NEVER pre-populated. Only masters ship with defaults,
   and only on first run (never overwrites existing user data).
   ============================================================ */

const STORAGE_KEY = 'rack.wardrobe.v1';
const TOKEN_KEY = 'rack.sync.token';   // GitHub PAT — user's own, browser-only
const GIST_KEY = 'rack.sync.gistId';

/* ---------- id helpers ---------- */
function slugify(str) {
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------- default masters ---------- */

function defaultCategories() {
  const cats = [
    { name: 'Pants', icon: 'pants', subs: ['Cargo Pants', 'Chinos', 'Jeans', 'Shorts', 'Formal Trousers', 'Joggers'] },
    { name: 'Shirts', icon: 'shirt', subs: ['T-Shirts', 'Polo Shirts', 'Collared Shirts', 'Dress Shirts', 'Casual Shirts'] },
    { name: 'Shoes', icon: 'shoe', subs: ['Running Shoes', 'Casual Shoes', 'Formal Shoes', 'Sandals', 'Sports Shoes'] },
    { name: 'Outerwear', icon: 'jacket', subs: ['Jackets', 'Hoodies', 'Sweaters'] },
    { name: 'Accessories', icon: 'bag', subs: ['Watches', 'Belts', 'Cufflinks', 'Ties', 'Bags', 'Sunglasses', 'Hats'] },
  ];
  const categories = [];
  const subcategories = [];
  cats.forEach(c => {
    const catId = 'cat_' + slugify(c.name);
    categories.push({ id: catId, name: c.name, icon: c.icon, custom: false });
    c.subs.forEach(s => {
      subcategories.push({ id: 'sub_' + slugify(c.name) + '_' + slugify(s), name: s, categoryId: catId, custom: false });
    });
  });
  return { categories, subcategories };
}

function defaultColors() {
  const list = [
    ['Black', '#23201B'], ['White', '#F7F5F0'], ['Grey', '#8C8880'], ['Navy', '#22314F'],
    ['Blue', '#3B6EA5'], ['Red', '#A23B33'], ['Green', '#4C6B4F'], ['Brown', '#6B4A34'],
    ['Beige', '#D8CBAE'], ['Khaki', '#9C9268'], ['Multi', 'multi'],
  ];
  return list.map(([name, hex]) => ({ id: 'col_' + slugify(name), name, hex, custom: false }));
}

/* tags: name, categories they're restricted to (by category name), optional subcategory restriction */
function defaultTags(categories, subcategories) {
  const findCat = name => categories.find(c => c.name === name)?.id;
  const findSub = name => subcategories.find(s => s.name === name)?.id;

  const defs = [
    { name: 'Collared', cats: ['Shirts'] },
    { name: 'Cotton', cats: ['Shirts', 'Pants', 'Outerwear'] },
    { name: 'Polyester', cats: ['Shirts', 'Pants', 'Outerwear', 'Shoes'] },
    { name: 'Denim', cats: ['Pants', 'Shirts'] },
    { name: 'Linen', cats: ['Shirts', 'Pants'] },
    { name: 'Wool', cats: ['Outerwear', 'Accessories'] },
    { name: 'Cargo', cats: ['Pants'], subs: ['Cargo Pants'] },
    { name: 'Formal', cats: ['Shirts', 'Pants', 'Shoes', 'Accessories', 'Outerwear'] },
    { name: 'Casual', cats: ['Shirts', 'Pants', 'Shoes', 'Accessories', 'Outerwear'] },
    { name: 'Smart', cats: ['Shirts', 'Pants', 'Shoes', 'Accessories', 'Outerwear'] },
    { name: 'Sporty', cats: ['Shirts', 'Pants', 'Shoes'] },
    { name: 'Sports-appropriate', cats: ['Shirts', 'Shoes'] },
    { name: 'Not Formal', cats: ['Shirts', 'Pants', 'Shoes', 'Accessories', 'Outerwear'] },
    { name: 'Waterproof', cats: ['Shoes', 'Outerwear'] },
    { name: 'Breathable', cats: ['Shirts', 'Shoes'] },
    { name: 'Stretch', cats: ['Pants', 'Shoes'] },
    { name: 'Leather', cats: ['Shoes', 'Accessories'] },
    { name: 'Gifted', cats: ['Shirts', 'Pants', 'Shoes', 'Accessories', 'Outerwear'] },
  ];

  return defs.map(d => ({
    id: 'tag_' + slugify(d.name),
    name: d.name,
    categoryIds: d.cats.map(findCat).filter(Boolean),
    subcategoryIds: (d.subs || []).map(findSub).filter(Boolean),
    custom: false,
  }));
}

/* activities ship as two worked examples straight from the spec,
   demonstrating the rule engine out of the box. */
function defaultActivities(categories, subcategories, tags) {
  const cat = name => categories.find(c => c.name === name)?.id;
  const sub = name => subcategories.find(s => s.name === name)?.id;
  const tag = name => tags.find(t => t.name === name)?.id;

  return [
    {
      id: 'act_office_smart_casual',
      name: 'Office Smart Casual',
      custom: false,
      includeRules: [
        { category: cat('Shirts'), subcategory: sub('Collared Shirts') },
        { category: cat('Shirts'), subcategory: sub('Dress Shirts') },
        { category: cat('Shirts'), requiredTags: [tag('Collared')] },
        { category: cat('Pants') },
        { category: cat('Shoes'), subcategory: sub('Formal Shoes') },
        { category: cat('Shoes'), requiredTags: [tag('Formal')] },
      ],
      excludeCategories: [],
      excludeSubcategories: [sub('Shorts'), sub('Cargo Pants')],
      excludeTags: [tag('Sporty')],
    },
    {
      id: 'act_badminton',
      name: 'Badminton',
      custom: false,
      includeRules: [
        { category: cat('Shirts'), subcategory: sub('T-Shirts') },
        { category: cat('Shirts'), requiredTags: [tag('Sports-appropriate')] },
        { category: cat('Pants'), subcategory: sub('Shorts') },
        { category: cat('Pants'), requiredTags: [tag('Stretch')] },
        { category: cat('Shoes'), subcategory: sub('Sports Shoes') },
      ],
      excludeCategories: [],
      excludeSubcategories: [],
      excludeTags: [tag('Collared')],
    },
  ];
}

function buildDefaultState() {
  const { categories, subcategories } = defaultCategories();
  const colors = defaultColors();
  const tags = defaultTags(categories, subcategories);
  const activities = defaultActivities(categories, subcategories, tags);
  return {
    version: 1,
    categories,
    subcategories,
    colors,
    brands: [],       // user-owned, no defaults
    tags,
    activities,
    items: [],         // NEVER pre-populated
    appearance: {
      themeId: 'theme_canvas',
      fontId: 'font_fraunces_plex',
      customThemes: [],
      customFonts: [],
    },
    meta: { createdAt: Date.now(), updatedAt: Date.now() },
  };
}

/* ---------- appearance: built-in themes & fonts ----------
   Each theme defines a small core palette; everything else (muted
   text, hairlines, panel backgrounds, tinted badges) is derived
   from these via CSS color-mix(), so a theme only needs 8 colors. */
function defaultThemes() {
  return [
    {
      id: 'theme_canvas', name: "Tailor's Canvas", custom: false,
      canvas: '#E7E1D3', surfaceRaised: '#FFFFFF', text: '#23201B', ink: '#23201B',
      accentInk: '#FBF9F4', accent: '#8A6F3B', thread: '#A23B33', good: '#4C6B4F',
    },
    {
      id: 'theme_night', name: 'Night Rack', custom: false,
      canvas: '#1C1A17', surfaceRaised: '#27231D', text: '#EDE6D8', ink: '#100F0C',
      accentInk: '#F5F0E4', accent: '#C9A24B', thread: '#D8685C', good: '#7FAE83',
    },
    {
      id: 'theme_denim', name: 'Denim Studio', custom: false,
      canvas: '#E4E7EC', surfaceRaised: '#FFFFFF', text: '#1E2733', ink: '#1E2733',
      accentInk: '#F4F6F8', accent: '#3B6EA5', thread: '#B4483D', good: '#3F7A5D',
    },
  ];
}

function defaultFonts() {
  return [
    {
      id: 'font_fraunces_plex', name: 'Fraunces & Plex Sans', custom: false,
      display: 'Fraunces', body: 'IBM Plex Sans',
      googleQuery: 'Fraunces:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600',
    },
    {
      id: 'font_playfair_inter', name: 'Playfair & Inter', custom: false,
      display: 'Playfair Display', body: 'Inter',
      googleQuery: 'Playfair+Display:wght@600;700&family=Inter:wght@400;500;600',
    },
    {
      id: 'font_space_grotesk', name: 'Space Grotesk', custom: false,
      display: 'Space Grotesk', body: 'Space Grotesk',
      googleQuery: 'Space+Grotesk:wght@500;600;700',
    },
  ];
}

/* icon keys used by categories, rendered from app.js's ICONS registry */
const DEFAULT_CATEGORY_ICON = 'tag';

/* ---------- persistence ---------- */

const Store = {
  _state: null,

  load() {
    if (this._state) return this._state;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        this._state = JSON.parse(raw);
        this._migrate();
        return this._state;
      } catch (e) {
        console.error('Corrupt wardrobe data, starting fresh defaults', e);
      }
    }
    this._state = buildDefaultState();
    this.save();
    return this._state;
  },

  _migrate() {
    const s = this._state;
    if (!s.brands) s.brands = [];
    if (!s.items) s.items = [];
    if (!s.meta) s.meta = { createdAt: Date.now(), updatedAt: Date.now() };
    if (!s.appearance) s.appearance = { themeId: 'theme_canvas', fontId: 'font_fraunces_plex', customThemes: [], customFonts: [] };
    if (!s.appearance.customThemes) s.appearance.customThemes = [];
    if (!s.appearance.customFonts) s.appearance.customFonts = [];
    if (!s.appearance.themeId) s.appearance.themeId = 'theme_canvas';
    if (!s.appearance.fontId) s.appearance.fontId = 'font_fraunces_plex';
    s.categories.forEach(c => { if (!c.icon) c.icon = DEFAULT_CATEGORY_ICON; });
    s.items.forEach(i => {
      if (!i.status) i.status = 'active';
      if (i.retiredReason === undefined) i.retiredReason = null;
      if (i.retiredAt === undefined) i.retiredAt = null;
    });
    // Gifted tag may be missing on wardrobes created before this feature existed.
    if (!s.tags.find(t => t.id === 'tag_gifted')) {
      s.tags.push({
        id: 'tag_gifted', name: 'Gifted',
        categoryIds: s.categories.map(c => c.id),
        subcategoryIds: [], custom: false,
      });
    }
  },

  save() {
    this._state.meta.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
  },

  replaceAll(newState) {
    this._state = newState;
    this._migrate();
    this.save();
  },

  get state() { return this.load(); },

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  },
};
