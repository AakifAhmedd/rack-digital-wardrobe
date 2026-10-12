/* Logo processing uses synthetic images and isolated storage; no real logos. */
async function runLogoChecks({ check, assert, equal, device }) {
  const w = await device();
  async function fixture(type = 'image/png', opaque = false) {
    const canvas = w.document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (opaque) { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 80, 60); }
    ctx.fillStyle = 'black'; ctx.fillRect(20, 10, 30, 20);
    if (!opaque) {
      ctx.clearRect(28, 18, 4, 4);
      const pixel = ctx.createImageData(1, 1); pixel.data.set([255, 0, 0, 1]); ctx.putImageData(pixel, 50, 30);
    }
    return new Promise(resolve => canvas.toBlob(resolve, type, 1));
  }
  const dataUrl = blob => w.RackPhotos._blobToDataUrl(blob);
  const decode = async url => w.RackPhotos._loadImage(await (await w.fetch(url)).blob());
  const png = await fixture(), source = await dataUrl(png);
  await check('PNG and WebP logo uploads trim shared alpha boundaries and preserve faint edges and internal transparency', async () => {
    for (const type of ['image/png', 'image/webp']) {
      const blob = await fixture(type), original = await w.RackPhotos._loadImage(blob);
      const box = w.RackPhotos._contentBox(original, { alphaThreshold: 0, scanEdge: 4096 });
      const encoded = await w.BrandLogo.fromFile(blob), cropped = await decode(encoded);
      equal([cropped.naturalWidth, cropped.naturalHeight], [box.w, box.h], 'Tight content bounds retained before any resizing');
      assert(encoded.startsWith('data:image/png;'), 'Output remains a compatible transparent PNG');
      if (type === 'image/png') {
        equal([box.x, box.y, box.w, box.h], [20, 10, 31, 21], 'Even alpha-1 edge belongs to the logo');
        const canvas = w.document.createElement('canvas'); canvas.width = 31; canvas.height = 21;
        const ctx = canvas.getContext('2d'); ctx.drawImage(cropped, 0, 0);
        equal(ctx.getImageData(9, 9, 1, 1).data[3], 0, 'Internal transparent hole preserved');
        equal(ctx.getImageData(30, 20, 1, 1).data[3], 1, 'Faint visible edge preserved');
      }
    }
    const original = await w.RackPhotos._loadImage(png);
    equal(w.RackPhotos._contentBox(original), { x: 20, y: 10, w: 30, h: 20, hasAlpha: true }, 'Perfume scanner default threshold unchanged');
    const opaque = await w.BrandLogo.fromFile(await fixture('image/png', true));
    const image = await decode(opaque); equal([image.naturalWidth, image.naturalHeight], [80, 60], 'Opaque image is not cut or upscaled');
  });
  await check('Existing raster logos recrop idempotently; built-ins and unsupported external logos are preserved', async () => {
    const cropped = await w.BrandLogo.trimStored(source), image = await decode(cropped);
    equal([image.naturalWidth, image.naturalHeight], [31, 21], 'Existing embedded logo cropped');
    equal(await w.BrandLogo.trimStored(cropped), cropped, 'Repeated cropping is a no-op');
    const opaque = await dataUrl(await fixture('image/png', true));
    equal(await w.BrandLogo.trimStored(opaque), opaque, 'Opaque stored logo remains byte-for-byte unchanged');
    w.Store.state.brands = [
      { id: 'trim-png', name: 'Custom', logo: source },
      { id: 'opaque', name: 'Opaque', logo: opaque },
      { id: 'built-in', name: 'Nike' },
      { id: 'external', name: 'External', logo: 'https://example.invalid/logo.png' },
      { id: 'bad', name: 'Broken', logo: 'data:image/png;base64,YmFk' },
    ]; w.Store.save();
    const result = await w.BrandLogo.trimExisting();
    equal(result, { trimmed: 1, skipped: 2 }, 'Only trimmable uploaded logo changes');
    equal(w.Store.state.brands[2].logo, undefined, 'Built-in vector untouched');
    equal(w.Store.state.brands[3].logo, 'https://example.invalid/logo.png', 'External logo not requested or changed');
    const timestamp = w.Store.state.meta.updatedAt;
    equal((await w.BrandLogo.trimExisting()).trimmed, 0, 'Second bulk pass changes no logos');
    equal(w.Store.state.meta.updatedAt, timestamp, 'No-op processing cannot create sync edits');
  });
  await check('Bulk logo trimming rolls back storage failures and preserves edits made during decoding', async () => {
    w.Store.state.brands = [{ id: 'rollback-logo', name: 'Before', logo: source }]; w.Store.save();
    const before = w.Store.exportJSON(), setItem = w.localStorage.setItem;
    w.localStorage.setItem = () => { throw new Error('Storage full'); };
    try {
      let failed = false; try { await w.BrandLogo.trimExisting(); } catch (_) { failed = true; }
      assert(failed, 'Quota failure reported'); equal(w.Store.exportJSON(), before, 'Memory and sync timestamp rolled back');
    } finally { w.localStorage.setItem = setItem; }
    equal(JSON.parse(w.localStorage.getItem('rack.wardrobe.v1')), JSON.parse(before), 'Persisted wardrobe retained');
    const trim = w.BrandLogo.trimStored.bind(w.BrandLogo);
    w.BrandLogo.trimStored = async logo => {
      const cropped = await trim(logo); w.Store.state.brands[0].logo = 'newer-logo'; w.Store.save(); return cropped;
    };
    try {
      equal(await w.BrandLogo.trimExisting(), { trimmed: 0, skipped: 1 }, 'Concurrent logo edit skipped');
      equal(w.Store.state.brands[0].logo, 'newer-logo', 'Newer edit survives');
    } finally { w.BrandLogo.trimStored = trim; }
  });
  await check('Logo upload retains the previous logo on quota failure and does not save after the editor is closed', async () => {
    w.Store.state.brands = [{ id: 'upload-logo', name: 'Upload', logo: source }]; w.Store.save();
    const before = w.Store.exportJSON(), fromFile = w.BrandLogo.fromFile.bind(w.BrandLogo), setItem = w.localStorage.setItem;
    const cropped = await w.BrandLogo.trimStored(source);
    function pick() {
      const input = w.document.querySelector('#brand-logo-file');
      Object.defineProperty(input, 'files', { value: [png] }); input.dispatchEvent(new w.Event('change'));
    }
    try {
      w.BrandLogo.fromFile = async () => cropped;
      w.localStorage.setItem = () => { throw new Error('Storage full'); };
      w.openBrandLogoModal(w.Store.state.brands[0]); pick();
      await new Promise(resolve => w.setTimeout(resolve, 0));
      equal(w.Store.exportJSON(), before, 'Failed upload restores logo and sync timestamp');
      assert(!w.document.querySelector('#brand-logo-pick').disabled, 'Upload controls usable after failure');
      w.Modal.close(); w.localStorage.setItem = setItem;
      let complete; w.BrandLogo.fromFile = () => new Promise(resolve => { complete = resolve; });
      w.openBrandLogoModal(w.Store.state.brands[0]); pick(); w.Modal.close(); complete(cropped);
      await new Promise(resolve => w.setTimeout(resolve, 0));
      equal(w.Store.exportJSON(), before, 'Closing the editor cancels the pending upload');
    } finally { w.BrandLogo.fromFile = fromFile; w.localStorage.setItem = setItem; w.Modal.close(); }
  });
}
