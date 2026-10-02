/* Built-in brand logos: single-colour marks from simple-icons (CC0), keyed by lowercase brand name.
   Brands without an entry here show no logo unless one is uploaded in Masters > Brands. */
const BUILTIN_BRAND_LOGOS = {"nike": "M24 7.8L6.442 15.276c-1.456.616-2.679.925-3.668.925-1.12 0-1.933-.392-2.437-1.177-.317-.504-.41-1.143-.28-1.918.13-.775.476-1.6 1.036-2.478.467-.71 1.232-1.643 2.297-2.8a6.122 6.122 0 00-.784 1.848c-.28 1.195-.028 2.072.756 2.632.373.261.886.392 1.54.392.522 0 1.11-.084 1.764-.252L24 7.8z", "puma": "M23.845 3.008c-.417-.533-1.146-.106-1.467.08-2.284 1.346-2.621 3.716-3.417 5.077-.626 1.09-1.652 1.89-2.58 1.952-.686.049-1.43-.084-2.168-.405-1.807-.781-2.78-1.792-3.017-1.97-.487-.37-4.23-4.015-7.28-4.164 0 0-.372-.75-.465-.763-.222-.025-.45.451-.616.501-.15.053-.413-.512-.565-.487-.153.02-.302.586-.6.877-.22.213-.486.2-.637.463-.052.096-.034.265-.093.42-.127.32-.551.354-.555.697 0 .381.357.454.669.72.248.212.265.362.554.461.258.088.632-.187.964-.088.277.081.543.14.602.423.054.256 0 .658-.34.613-.112-.015-.598-.174-1.198-.11-.725.077-1.553.309-1.634 1.11-.041.447.514.97 1.055.866.371-.071.196-.506.399-.716.267-.27 1.772.944 3.172.944.593 0 1.031-.15 1.467-.605.04-.029.093-.102.155-.11a.632.632 0 01.195.088c1.131.897 1.984 2.7 6.13 2.721.582.007 1.25.279 1.796.777.48.433.764 1.125 1.037 1.825.418 1.053 1.161 2.069 2.292 3.203.06.068.99.78 1.06.833.012.01.084.167.053.255-.02.69-.123 2.67 1.365 2.753.366.02.275-.231.275-.41-.005-.341-.065-.685.113-1.04.253-.478-.526-.709-.509-1.756.019-.784-.645-.651-.984-1.25-.19-.343-.368-.532-.35-.946.073-2.38-.517-3.948-.805-4.327-.227-.294-.423-.403-.207-.54 1.24-.815 1.525-1.574 1.525-1.574.66-1.541 1.256-2.945 2.075-3.57.166-.12.589-.44.852-.56.763-.362 1.173-.578 1.388-.788.356-.337.635-1.053.294-1.48z", "uniqlo": "M0 0v24h24V0H0zm3.006 3.236h1.52v5.051a1.007 1.007 0 1 0 2.014 0v-5.05h1.517v5.056a2.525 2.525 0 1 1-5.051 0V3.236zm7.07 0h1.514l2.023 4.328V3.236h1.516v7.575h-1.516L11.59 6.482v4.329h-1.514V3.236zm7.569.01h1.488v7.576h-1.488V3.246zM5.533 13.078a2.526 2.526 0 0 1 2.524 2.53v2.523a2.51 2.51 0 0 1-.75 1.793l.75 2.248H6.539l-.518-1.563a2.472 2.472 0 0 1-.488.043 2.524 2.524 0 0 1-2.527-2.521v-2.524a2.527 2.527 0 0 1 2.527-2.529zm4.547 0h1.514v6.057h3.535v1.517H10.08v-7.574zm8.336 0a2.526 2.526 0 0 1 2.523 2.53v2.523a2.525 2.525 0 0 1-2.523 2.521 2.53 2.53 0 0 1-2.531-2.521v-2.524a2.533 2.533 0 0 1 2.531-2.529zm-12.88 1.52a1.007 1.007 0 0 0-1.01 1.01v2.523c0 .552.45 1.006 1.01 1.006.558 0 1.003-.454 1.003-1.006v-2.524c0-.559-.445-1.01-1.004-1.01zm12.88 0a1.01 1.01 0 0 0-1.012 1.01v2.523c0 .552.453 1.006 1.012 1.006a1.012 1.012 0 0 0 1.01-1.006v-2.524c0-.559-.455-1.01-1.01-1.01z"};

const BrandLogo = {
  /* HTML for a small logo (uploaded image wins over built-in), or '' when the brand has none. */
  html(brand, size = 16, title = '') {
    const t = title ? ` title="${title}"` : '';
    if (!brand) return '';
    if (brand.logo) return `<img class="brand-logo"${t} src="${brand.logo}" width="${size}" height="${size}" alt="" loading="lazy">`;
    const d = BUILTIN_BRAND_LOGOS[String(brand.name || '').trim().toLowerCase()];
    return d ? `<svg class="brand-logo"${t} viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>` : '';
  },
  has(brand) { return !!brand && (!!brand.logo || this.hasBuiltin(brand)); },
  hasBuiltin(brand) { return !!BUILTIN_BRAND_LOGOS[String(brand?.name || '').trim().toLowerCase()]; },
  /* Downscale an uploaded image file to a small PNG data URL so synced data stays tiny. */
  async fromFile(file, max = 96) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * r)); c.height = Math.max(1, Math.round(img.height * r));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  },
};
