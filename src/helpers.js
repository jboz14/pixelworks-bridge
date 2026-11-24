'use strict';
// Helpers copied from the Pixelworks desktop app (icons, Creator Store search, thumbnails, frame-list cleanup).
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const hexOr = (v, def) => { const m = String(v || '').trim().match(HEX); return m ? '#' + m[1].toLowerCase() : def; };
const numOr = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const oneOf = (v, list, def) => (list.includes(String(v)) ? String(v) : def);

const NODE_ID = /^\d+:\d+$/;
function sanitizeContext(c) {
  const frames = (Array.isArray(c.frames) ? c.frames : []).filter((f) => f && NODE_ID.test(String(f.id))).slice(0, 100)
    .map((f) => ({ id: String(f.id), name: String(f.name || '').slice(0, 80) }));
  return {
    fileKey: /^[A-Za-z0-9]{15,40}$/.test(String(c.fileKey || '')) ? String(c.fileKey) : '',
    fileName: String(c.fileName || '').slice(0, 80),
    page: String(c.page || '').slice(0, 60),
    frames,
    selected: (Array.isArray(c.selected) ? c.selected : []).map(String).filter((id) => NODE_ID.test(id)).slice(0, 100)
  };
}

/* ---- Icons: Iconify's free search/SVG API, fetched here so the Figma plugin needs no internet access of its own.
   Only collections with permissive licenses: Lucide (ISC), Tabler (MIT), Material Symbols (Apache-2.0), Game Icons (CC BY 3.0, credit "game-icons.net"). */
const ICON_SETS = 'lucide,tabler,material-symbols,game-icons';
const svgCache = new Map();
// Brand logos (Robux, Roblox...) are trademarks and are not in these sets, so game words map to generic look-alikes.
const ICON_ALIASES = {
  robux: ['coin', 'coins', 'gem', 'hexagon'], rbx: ['coin', 'coins', 'gem'], roblox: ['gamepad', 'cube'],
  currency: ['coin', 'coins', 'money'], money: ['coin', 'cash', 'wallet'], cash: ['cash', 'banknote'], gold: ['coin', 'coins'],
  diamond: ['gem', 'diamond'], premium: ['crown', 'gem', 'star'], vip: ['crown', 'star']
};
async function searchOne(query) {
  const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=48&prefixes=${ICON_SETS}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Icon search failed (${r.status}).`);
  const j = await r.json();
  return (Array.isArray(j.icons) ? j.icons : []).filter((id) => /^[a-z0-9-]+:[a-z0-9-]+$/.test(id));
}
async function searchIcons(q) {
  const query = String(q || '').trim().slice(0, 40);
  if (!query) return { icons: [], note: '' };
  const alias = ICON_ALIASES[query.toLowerCase()];
  let icons = alias ? [] : await searchOne(query);
  let note = '';
  if (alias || !icons.length) {
    const words = alias || [];
    const lists = await Promise.all(words.map((w) => searchOne(w).catch(() => [])));
    const merged = [];
    for (let i = 0; merged.length < 48 && lists.some((l) => i < l.length); i += 1) for (const l of lists) if (l[i] && !merged.includes(l[i])) merged.push(l[i]);
    icons = merged;
    if (alias) note = `“${query}” is a brand/trademark and is not in the free sets, so these are generic ${words.slice(0, 2).join('/')} icons. For the real logo, import your own image.`;
  }
  return { icons: icons.slice(0, 48), note };
}
async function fetchIconSvg(id, color, size) {
  if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(String(id || ''))) throw new Error('Bad icon id.');
  const [prefix, name] = id.split(':');
  if (!ICON_SETS.split(',').includes(prefix)) throw new Error('That icon set is not enabled.');
  const col = hexOr(color, '#ffffff');
  const px = Math.round(numOr(size, 32, 8, 256));
  const key = `${id}|${col}|${px}`;
  if (svgCache.has(key)) return svgCache.get(key);
  const r = await fetch(`https://api.iconify.design/${prefix}/${name}.svg?color=${encodeURIComponent(col)}&height=${px}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Icon download failed (${r.status}).`);
  const svg = await r.text();
  if (!svg.startsWith('<svg')) throw new Error('Unexpected icon data.');
  if (svgCache.size > 300) svgCache.clear();
  svgCache.set(key, svg);
  return svg;
}

/* ---- Roblox Creator Store: texture search (needs your Open Cloud key with "Creator Store Products: Read", scope creator-store-product:read).
   Docs: create.roblox.com/docs/cloud/reference/features/creator-store  (POST /toolbox-service/v2/assets:search).
   Textures are Decal assets. Roblox loads them in the game with rbxthumb://type=Asset&id=<id>, which also works for decal ids in an ImageLabel. */
const STORE_URL = 'https://apis.roblox.com/toolbox-service/v2/assets:search';
async function searchStore(apiKey, query, fetchImpl = fetch) {
  const q = String(query || '').trim().slice(0, 50);
  if (!q) return { items: [] };
  if (!apiKey) throw new Error('No Roblox Open Cloud key saved. Add one in Settings (the Assets key works if you also add Creator Store Products: Read).');
  const res = await fetchImpl(STORE_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchCategoryType: 'Decal', query: q, maxPageSize: 30 }),
    signal: AbortSignal.timeout(12000)
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = {}; }
  if (res.status === 401 || res.status === 403) throw new Error('Roblox rejected the key for the Creator Store (' + res.status + '). In create.roblox.com ▸ Open Cloud ▸ API Keys, add the “Creator Store Products” API with Read permission to your key (and remove any IP limit that blocks this computer).');
  if (res.status === 429) throw new Error('Roblox rate-limited the search. Wait a few seconds and try again.');
  if (!res.ok) throw new Error('Creator Store search failed (HTTP ' + res.status + '). ' + String(body.message || body.error || text).slice(0, 160));
  const items = [];
  for (const x of Array.isArray(body.creatorStoreAssets) ? body.creatorStoreAssets : []) {
    const a = x.asset || {};
    const id = String(a.id != null ? a.id : (x.creatorStoreProduct && x.creatorStoreProduct.id) || '');
    if (!/^\d{1,19}$/.test(id) || items.some((i) => i.id === id)) continue;
    items.push({ id, name: String(a.name || 'Texture ' + id).slice(0, 60), creator: String((x.creator && x.creator.name) || '').slice(0, 40) });
  }
  return { items };
}

const thumbCache = new Map();
const THUMB_SIZES = [150, 420];
async function fetchThumb(id, size, fetchImpl = fetch) {
  if (!/^\d{1,19}$/.test(String(id || ''))) throw new Error('Bad texture id.');
  const px = THUMB_SIZES.includes(Number(size)) ? Number(size) : 150;
  const key = id + '|' + px;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let info;
  for (let i = 0; i < 4; i += 1) {   // Roblox may still be rendering a thumbnail: wait a moment
    const meta = await fetchImpl('https://thumbnails.roblox.com/v1/assets?assetIds=' + id + '&returnPolicy=PlaceHolder&size=' + px + 'x' + px + '&format=Png&isCircular=false', { signal: AbortSignal.timeout(10000) });
    if (!meta.ok) throw new Error('Thumbnail lookup failed (' + meta.status + ').');
    const j = await meta.json();
    info = Array.isArray(j.data) ? j.data[0] : null;
    if (info && info.state === 'Completed') break;
    if (info && info.state !== 'Pending') break;
    await new Promise((r) => setTimeout(r, 700));
  }
  if (!info || info.state !== 'Completed' || !/^https:\/\/[a-z0-9-]+\.rbxcdn\.com\//i.test(String(info.imageUrl || ''))) throw new Error('No preview is available for that texture (it may be moderated or still processing).');
  const img = await fetchImpl(info.imageUrl, { signal: AbortSignal.timeout(15000) });
  if (!img.ok) throw new Error('Preview download failed (' + img.status + ').');
  const buf = Buffer.from(await img.arrayBuffer());
  if (!buf.length || buf.length > 5 * 1024 * 1024) throw new Error('Unexpected preview size.');
  if (thumbCache.size > 200) thumbCache.clear();
  thumbCache.set(key, buf);
  return buf;
}


module.exports = { searchIcons, fetchIconSvg, searchStore, fetchThumb, sanitizeContext, NODE_ID };
