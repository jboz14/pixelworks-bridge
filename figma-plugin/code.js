// Pixelworks Bridge: builds the design JSON sent by the desktop app as real Figma layers.
figma.showUI(__html__, { width: 360, height: 760, themeColors: true });

const WEIGHT = { regular: 'Regular', medium: 'Medium', bold: 'Bold' };
const MAIN = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
const CROSS = { start: 'MIN', center: 'CENTER', end: 'MAX' };

function rgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
const solid = (h) => [{ type: 'SOLID', color: rgb(h) }];
const toHex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
// amt > 0 lightens toward white, amt < 0 darkens toward black
function shade(h, amt) {
  const c = rgb(h), t = amt >= 0 ? 1 : 0, k = Math.min(1, Math.abs(amt));
  return toHex({ r: c.r + (t - c.r) * k, g: c.g + (t - c.g) * k, b: c.b + (t - c.b) * k });
}
const gradient = (top, bottom, opacity) => [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: [{ position: 0, color: Object.assign(rgb(top), { a: 1 }) }, { position: 1, color: Object.assign(rgb(bottom), { a: 1 }) }], opacity: opacity == null ? 1 : opacity }];
const dropShadow = (color, a, y, radius) => [{ type: 'DROP_SHADOW', color: Object.assign({}, color, { a }), offset: { x: 0, y }, radius, spread: 0, visible: true, blendMode: 'NORMAL' }];

// one place for "what just happened": a Figma toast and a line in the panel
function say(text, error) {
  try { figma.notify(text, error ? { error: true } : { timeout: 3000 }); } catch (e) { /* ignore */ }
  figma.ui.postMessage({ type: 'log', text, error: Boolean(error) });
}

async function loadFonts() {
  for (const s of Object.values(WEIGHT)) await figma.loadFontAsync({ family: 'Inter', style: s });
}

function style(node, n) {
  if (n.opacity != null) node.opacity = n.opacity;
  if (n.t !== 'text') {
    node.fills = n.fill ? solid(n.fill) : [];
    if (n.fill && n.fill2) node.fills = gradient(n.fill, n.fill2);
    if (n.stroke) {
      node.strokes = solid(n.stroke); node.strokeWeight = n.sw || 1;
      if ('strokeAlign' in node) node.strokeAlign = 'INSIDE';   // a border that stays inside the card, so it never grows the layout
    }
    if (n.r != null && 'cornerRadius' in node) node.cornerRadius = n.r;
    if (n.shadow) node.effects = dropShadow({ r: 0, g: 0, b: 0 }, 0.35, 8, 20);
  }
}


// ---------- effect tags (stored in the layer name, like "Play button @glow @bg(style=studs)") ----------
const BG_DEFAULTS = { style: 'studs', color: '#6b7a8f', color2: '#8d9db3', size: 24, opacity: 1 }; // keep in sync with src/figma-effects.js
let CONFLICT_MAP = { pulse: ['hover', 'popin'], hover: ['pulse'], float: ['bounce'], bounce: ['float'], popin: ['pulse'], spin: ['swing'], swing: ['spin'], flicker: ['blink'], blink: ['flicker'] };
let KNOWN = new Set(['hoverpop', 'hoverlift', 'hovergrow', 'hovertilt', 'hovershine', 'hoverglow', 'hoverbright', 'hoverwiggle', 'press', 'ripple', 'clickburst', 'embers', 'snow', 'fireflies', 'coins', 'hearts', 'print', 'ref', 'uigui', 'uiframe', 'uilabel', 'uiinput', 'uicorner', 'uistroke', 'uigradient', 'uipadding', 'uishadow', 'uilist', 'uigrid', 'uipage', 'uitable', 'uiflex', 'uiaspect', 'uiscale', 'uisize', 'uitextsize', 'uiparticle', 'jello', 'rubberband', 'tada', 'wobble', 'heartbeat', 'headshake', 'jelly', 'jump', 'wiggle', 'drop', 'stamp', 'flip', 'confetti', 'bubbles', 'wisp', 'glow', 'shimmer', 'sparkle', 'pulse', 'float', 'rainbow', 'hover', 'fadein', 'slidein', 'bg', 'aura', 'rays', 'stars', 'halo', 'orbit', 'border', 'outline', 'bounce', 'spin', 'swing', 'popin', 'flicker', 'blink', 'font', 'textwave', 'textshake', 'textpop', 'textrainbow', 'textglitch', 'textgradient', 'textglow', 'shadow', 'gloss', 'glass', 'bevel', 'typewriter', 'button', 'scroll', 'ignore', 'image', 'export', 'close', 'open', 'toggle', 'panel', 'tabgroup', 'tab', 'active']);
const TAG_RE = /@([a-zA-Z]+)(?::([\w-]+))?(?:\(([^)]*)\))?/g;
const tagName = (t) => (String(t).match(/^@([a-zA-Z]+)/) || [])[1].toLowerCase();

function splitName(name) {
  const tags = [];
  const clean = String(name).replace(TAG_RE, (all, n) => { if (KNOWN.has(n.toLowerCase())) { tags.push(all); return ''; } return all; }).replace(/\s{2,}/g, ' ').trim();
  return { clean, tags };
}
function tagParams(tag) {
  const m = String(tag).match(/\(([^)]*)\)/);
  const out = {};
  if (m) for (const part of m[1].split(',')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
const isContainer = (n) => n.type === 'FRAME' || n.type === 'COMPONENT';
const isAutoLayout = (n) => Boolean(n && n.layoutMode && n.layoutMode !== 'NONE');
const isPreview = (n) => Boolean(n.getPluginData && n.getPluginData('pwBg') === '1');

function removeBg(node) {
  if (!('children' in node)) return;
  for (const c of node.children.slice()) if (isPreview(c)) c.remove();
}

// Roblox Creator Store textures are previewed with the thumbnail image. Its hash is remembered in the file so a resize can redraw it.
const TEX_KEY = (id) => 'pwTex' + id;
const TEX_PX = 420;   // thumbnail size requested from Roblox; Roblox tiles at size*4 px, so the Figma tile uses the same scale

// How far the border reaches into the frame: INSIDE = full width, CENTER = half, OUTSIDE = none. Handles per-side widths.
function borderInset(node) {
  const z = { t: 0, r: 0, b: 0, l: 0 };
  if (!('strokes' in node) || !Array.isArray(node.strokes) || !node.strokes.some((x) => x.visible !== false)) return z;
  const k = node.strokeAlign === 'INSIDE' ? 1 : node.strokeAlign === 'CENTER' ? 0.5 : 0;
  if (!k) return z;
  const num = (v, d) => (typeof v === 'number' ? v : d);
  const sw = num(node.strokeWeight, 0);
  return { t: num(node.strokeTopWeight, sw) * k, r: num(node.strokeRightWeight, sw) * k, b: num(node.strokeBottomWeight, sw) * k, l: num(node.strokeLeftWeight, sw) * k };
}
// Four corner radii [tl, tr, br, bl]; works when the corners differ (figma.mixed) too.
function cornerRadii(node) {
  const num = (v) => (typeof v === 'number' ? v : 0);
  if (typeof node.cornerRadius === 'number') return [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius];
  return [num(node.topLeftRadius), num(node.topRightRadius), num(node.bottomRightRadius), num(node.bottomLeftRadius)];
}
// Redraw the background when the border or corners changed, so it keeps fitting inside them.
function refreshBg(node) {
  try {
    if (!isContainer(node) || !node.children.some(isPreview)) return;
    const bg = splitName(node.name).tags.find((t) => tagName(t) === 'bg');
    if (bg) drawBg(node, bg);
  } catch (e) { /* preview only */ }
}

// Draws the background as real shapes inside the frame so you can see it in Figma. It is named "@ignore" so the importer skips it
// (Roblox draws its own version from the @bg tag).
function drawBg(node, tag) {
  removeBg(node);
  const p = Object.assign({}, BG_DEFAULTS, tagParams(tag));
  const style = String(p.style || 'studs');
  const c1 = String(p.color), c2 = String(p.color2);
  const size = Math.max(6, Number(p.size) || 24);
  const opacity = Math.min(1, Math.max(0.05, Number(p.opacity) || 1));
  let imgHash = '';
  if (style === 'image') {
    const id = String(p.store || '').replace(/\D/g, '');
    imgHash = id ? figma.root.getPluginData(TEX_KEY(id)) : '';
    if (!imgHash) {
      figma.notify(id ? 'Texture preview not saved in this file. Click the texture again in the Store tab to redraw it.' : 'Your own image shows up in Roblox. In Figma, drop it into the frame fill if you want to see it.');
      return;
    }
  }
  // The border is an INSIDE stroke, and Figma paints children above their parent's stroke. So the background box must sit
  // inside the stroke (inset by its width) with a matching smaller radius, or the pattern covers the border and the corners.
  const inset = borderInset(node);
  const w = Math.max(1, node.width - inset.l - inset.r), h = Math.max(1, node.height - inset.t - inset.b);
  const box = figma.createFrame();
  box.name = 'Background preview @ignore';
  box.setPluginData('pwBg', '1');
  box.resize(w, h);
  box.clipsContent = true;
  box.fills = [];
  const rad = cornerRadii(node), hi = Math.min(node.width, node.height) / 2;
  const inner = (r, a, b) => Math.max(0, Math.min(r, hi) - Math.max(a, b));
  box.topLeftRadius = inner(rad[0], inset.t, inset.l);
  box.topRightRadius = inner(rad[1], inset.t, inset.r);
  box.bottomRightRadius = inner(rad[2], inset.b, inset.r);
  box.bottomLeftRadius = inner(rad[3], inset.b, inset.l);
  node.insertChild(0, box);
  if (isAutoLayout(node)) box.layoutPositioning = 'ABSOLUTE';
  box.x = inset.l; box.y = inset.t;
  box.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
  box.locked = true;
  if (style === 'image') {
    box.fills = [{ type: 'IMAGE', imageHash: imgHash, scaleMode: 'TILE', scalingFactor: Math.max(0.05, (size * 4) / TEX_PX), opacity }];
    return;
  }
  const base = style === 'gradient'
    ? gradient(c1, c2, opacity)
    : [{ type: 'SOLID', color: rgb(c1), opacity }];
  box.fills = base;
  let cols = Math.ceil(w / size), rows = Math.ceil(h / size), step = size;
  if (cols * rows > 700) { step = Math.ceil(Math.sqrt(w * h / 700)); cols = Math.ceil(w / step); rows = Math.ceil(h / step); }
  const add = (shape, x, y, ww, hh, color, o) => { shape.x = x; shape.y = y; shape.resize(ww, hh); shape.fills = solid(color); shape.opacity = o == null ? opacity : o; box.appendChild(shape); return shape; };
  if (style === 'studs') {
    const d = step * 0.64;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = add(figma.createEllipse(), c * step + (step - d) / 2, r * step + (step - d) / 2, d, d, c2);
      s.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.3 }]; s.strokeWeight = 1;
    }
  } else if (style === 'dots') {
    const d = step * 0.28;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) add(figma.createEllipse(), c * step + (step - d) / 2, r * step + (step - d) / 2, d, d, c2);
  } else if (style === 'checker') {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ((r + c) % 2 === 0) add(figma.createRectangle(), c * step, r * step, step, step, c2);
  } else if (style === 'stripes') {
    for (let r = 0; r < rows; r += 2) add(figma.createRectangle(), 0, r * step, w, step, c2);
  } else if (style === 'baseplate' || style === 'grid') {
    const t = style === 'baseplate' ? 2 : 1;
    for (let c = 0; c <= cols; c++) add(figma.createRectangle(), c * step - t / 2, 0, t, h, c2);
    for (let r = 0; r <= rows; r++) add(figma.createRectangle(), 0, r * step - t / 2, w, t, c2);
  }
}

// Aura preview: a soft radial light drawn just BEHIND the layer (as its neighbour), named "@ignore" so the importer skips it.
// Roblox builds its own animated light from the @aura tag. The preview is a still picture: press Aura again after resizing or moving the layer.
const AURA_DEFAULTS = { color: '#b57cff', color2: '#5b8cff', size: 1.5, strength: 0.55, shape: 'round' }; // keep in sync with src/figma-effects.js
function removeAura(node) {
  const parent = node.parent;
  if (!parent || !('children' in parent)) return;
  for (const c of parent.children.slice()) if (c.getPluginData && c.getPluginData('pwAuraFor') === node.id) c.remove();
}
function drawAura(node, tag) {
  removeAura(node);
  const parent = node.parent;
  if (!parent || !('children' in parent) || isAutoLayout(parent)) return;
  const p = Object.assign({}, AURA_DEFAULTS, tagParams(tag));
  const size = Math.min(3, Math.max(1.05, Number(p.size) || 1.5));
  const strength = Math.min(1, Math.max(0.1, Number(p.strength) || 0.55));
  const round = String(p.shape) !== 'oval';
  const w = node.width, h = node.height;
  const dw = (round ? Math.max(w, h) : w) * size, dh = (round ? Math.max(w, h) : h) * size;
  const glow = figma.createEllipse();
  glow.name = 'Aura preview @ignore';
  glow.setPluginData('pwAuraFor', node.id);
  glow.resize(dw, dh);
  glow.fills = [{
    type: 'GRADIENT_RADIAL',
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [
      { position: 0, color: Object.assign(rgb(String(p.color)), { a: strength }) },
      { position: 0.55, color: Object.assign(rgb(String(p.color2)), { a: strength * 0.45 }) },
      { position: 1, color: Object.assign(rgb(String(p.color2)), { a: 0 }) }
    ]
  }];
  parent.insertChild(Math.max(0, parent.children.indexOf(node)), glow); // lower index = further back
  glow.x = node.x + w / 2 - dw / 2;
  glow.y = node.y + h / 2 - dh / 2;
  glow.locked = true;
}

// Shadow preview: a real Figma drop shadow so you can see it. Roblox draws its own animated one from the @shadow tag (the Figma one is skipped on import).
function applyShadowPreview(node, tag) {
  if (!('effects' in node)) return;
  const p = Object.assign({ color: '#000000', strength: 0.45, offsetY: 6, offsetX: 0, blur: 8 }, tagParams(tag));
  const keep = node.getPluginData('pwShadow') === '1' ? node.effects.filter((e) => e.type !== 'DROP_SHADOW') : node.effects.slice();
  const c = rgb(String(p.color));
  keep.push({ type: 'DROP_SHADOW', color: Object.assign({}, c, { a: Math.min(1, Math.max(0.05, Number(p.strength) || 0.45)) }), offset: { x: Number(p.offsetX) || 0, y: Number(p.offsetY) || 0 }, radius: Math.max(0, Number(p.blur) || 0) * 2, spread: 0, visible: true, blendMode: 'NORMAL' });
  node.effects = keep;
  node.setPluginData('pwShadow', '1');
}
function removeShadowPreview(node) {
  if (!('effects' in node) || node.getPluginData('pwShadow') !== '1') return;
  node.effects = node.effects.filter((e) => e.type !== 'DROP_SHADOW');
  node.setPluginData('pwShadow', '');
}

// Font preview: Figma cannot use Roblox fonts, so the closest Google font is shown (when your Figma has it). Roblox uses the real Roblox font from the tag.
const FIGMA_FONT = {"Gotham": "Inter", "Montserrat": "Montserrat", "Nunito": "Nunito", "Roboto": "Roboto", "RobotoCondensed": "Roboto Condensed", "Oswald": "Oswald", "Ubuntu": "Ubuntu", "TitilliumWeb": "Titillium Web", "JosefinSans": "Josefin Sans", "FredokaOne": "Fredoka One", "LuckiestGuy": "Luckiest Guy", "Bangers": "Bangers", "PermanentMarker": "Permanent Marker", "DenkOne": "Denk One", "PatrickHand": "Patrick Hand", "Kalam": "Kalam", "IndieFlower": "Indie Flower", "AmaticSC": "Amatic SC", "Creepster": "Creepster", "SpecialElite": "Special Elite", "Fondamento": "Fondamento", "GrenzeGotisch": "Grenze Gotisch", "Merriweather": "Merriweather", "Michroma": "Michroma", "Jura": "Jura", "Sarpanch": "Sarpanch", "RobotoMono": "Roboto Mono", "Arcade": "Press Start 2P", "SciFi": "Orbitron", "Fantasy": "Cinzel"};
const FIGMA_WEIGHT = { regular: 'Regular', medium: 'Medium', bold: 'Bold', heavy: 'Black' };
function fontTargets(node) {
  if (node.type === 'TEXT') return [node];
  return 'findAll' in node ? node.findAll((n) => n.type === 'TEXT' && !/@ignore/.test(n.name)) : [];
}
// more Roblox font families (v0.10.22) and the closest Google font Figma can show for each
Object.assign(FIGMA_FONT, { Arimo: 'Arimo', Balthazar: 'Balthazar', Bodoni: 'Libre Bodoni', Garamond: 'EB Garamond', Cartoon: 'Comic Neue', ComicNeueAngular: 'Comic Neue', Code: 'Source Code Pro', Highway: 'Oswald', Antique: 'Cardo', BuilderSans: 'Inter', BuilderExtended: 'Inter', BuilderMono: 'Roboto Mono', AccanthisADFStd: 'Gelasio', Zekton: 'Orbitron', SourceSans: 'Source Sans 3', Legacy: 'Arimo' });
// fonts you added yourself (kept in Figma's client storage, so they stay after you close the plugin)
let customFonts = {};
let customAssets = {};   // v0.13.3: your own particle pictures (small data URLs), kept in Figma's client storage
const assetsReady = figma.clientStorage.getAsync('pwAssets').then((v) => { if (v && typeof v === 'object') customAssets = v; }).catch(() => {});
async function pushAssets() { await assetsReady; figma.ui.postMessage({ type: 'assets', assets: customAssets }); }
const fontsReady = figma.clientStorage.getAsync('pwFonts').then((v) => { if (v && typeof v === 'object') customFonts = v; }).catch(() => {});
function customFigmaFor(val) {
  if (customFonts[val]) return customFonts[val].figma;
  const k = Object.keys(customFonts).find((n) => customFonts[n].id && customFonts[n].id === val);
  return k ? customFonts[k].figma : null;
}
async function pushFonts() { await fontsReady; figma.ui.postMessage({ type: 'fonts', fonts: customFonts }); }
async function applyFontPreview(node, tag) {
  const p = Object.assign({ font: 'FredokaOne', weight: 'auto', italic: 'off' }, tagParams(tag));
  const family = FIGMA_FONT[p.font] || customFigmaFor(p.font) || 'Inter';
  let missing = false;
  for (const t of fontTargets(node)) {
    if (t.fontName === figma.mixed) continue;
    if (!t.getPluginData('pwFontOrig')) t.setPluginData('pwFontOrig', JSON.stringify(t.fontName));
    const orig = JSON.parse(t.getPluginData('pwFontOrig'));
    const w = p.weight === 'auto' ? (/bold|black|heavy/i.test(orig.style) ? 'Bold' : 'Regular') : (FIGMA_WEIGHT[p.weight] || 'Regular');
    const tries = [w + (p.italic === 'on' ? ' Italic' : ''), w, 'Regular'];
    let done = false;
    for (const style of tries) {
      try { await figma.loadFontAsync({ family, style }); t.fontName = { family, style }; done = true; break; } catch (e) { /* try next style */ }
    }
    if (!done) missing = true;
  }
  if (missing) figma.notify('Figma does not have the font "' + family + '" here, so it looks unchanged. Roblox will still use ' + p.font + '.');
}
const previewedFont = new Set();   // layers that show a font you only clicked (not applied yet)
async function revertPreviewedFonts() {
  const ids = [...previewedFont]; previewedFont.clear();
  for (const id of ids) {
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.removed) continue;
      const ft = splitName(node.name).tags.find((t) => tagName(t) === 'font');
      if (ft) await applyFontPreview(node, ft); else await removeFontPreview(node);
    } catch (e) { /* preview only */ }
  }
}
async function removeFontPreview(node) {
  for (const t of fontTargets(node)) {
    const o = t.getPluginData('pwFontOrig');
    if (!o) continue;
    try { const f = JSON.parse(o); await figma.loadFontAsync(f); t.fontName = f; t.setPluginData('pwFontOrig', ''); } catch (e) { /* ignore */ }
  }
}

// ---------- text animation helpers ----------
const TEXT_FX = ['textwave', 'textshake', 'textpop', 'textrainbow', 'textglitch', 'textgradient', 'textglow'];
const LETTER_FX = ['textwave', 'textshake', 'textpop', 'textrainbow', 'textglitch'];
const RAINBOW_STOPS = ['#ff4d4d', '#ffb84d', '#ffe94d', '#4dff88', '#4dc8ff', '#7d6bff', '#ff6ad5'];
// Figma cannot animate, so a flowing gradient / rainbow is shown as a still gradient fill. The original fill is remembered and restored.
function syncTextFill(node) {
  if (node.type !== 'TEXT') return;
  const tags = splitName(node.name).tags;
  const grad = tags.find((t) => tagName(t) === 'textgradient');
  const rain = tags.find((t) => tagName(t) === 'textrainbow');
  const orig = node.getPluginData('pwFillOrig');
  if (!grad && !rain) {
    if (orig) { try { node.fills = JSON.parse(orig); } catch (e) { /* ignore */ } node.setPluginData('pwFillOrig', ''); }
    return;
  }
  if (!orig) node.setPluginData('pwFillOrig', JSON.stringify(node.fills));
  let stops, angle = 0;
  if (grad) {
    const p = Object.assign({ color: '#ff6ad5', color2: '#5bc8ff' }, tagParams(grad));
    stops = parseStops(p.stops) || [{ hex: String(p.color), pos: 0 }, { hex: String(p.color2), pos: 1 }];
    angle = Number(p.angle) || 0;
  } else stops = RAINBOW_STOPS.map((h, i) => ({ hex: h, pos: i / (RAINBOW_STOPS.length - 1) }));
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);   // 0 = left to right, turning clockwise
  node.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[c, s, 0.5 - 0.5 * c - 0.5 * s], [-s, c, 0.5 + 0.5 * s - 0.5 * c]], gradientStops: stops.map((g) => ({ position: g.pos, color: Object.assign(rgb(g.hex), { a: 1 }) })) }];
}
// gradient stops are written as stops=ff6ad5:0|5bc8ff:100 (hex without #, position in percent) so the tag stays one word
function parseStops(str) {
  if (!str) return null;
  const out = String(str).split('|').map((part) => {
    const m = part.trim().match(/^#?([0-9a-f]{6}):(-?[\d.]+)$/i);
    return m ? { hex: '#' + m[1].toLowerCase(), pos: Math.min(1, Math.max(0, Number(m[2]) / 100)) } : null;
  }).filter(Boolean).sort((x, y) => x.pos - y.pos).slice(0, 6);   // Roblox advises at most 6 color stops
  return out.length >= 2 ? out : null;
}

// Glow borders: Figma shows a real colored stroke plus a soft glow. The original stroke / effects are remembered and restored when the tag changes or goes away.
const GLOW_BORDERS = ['glow', 'rarity', 'pulse', 'glowchase'];
function removeBorderPreview(node) {
  const o = node.getPluginData('pwBorderOrig');
  if (!o) return;
  try { const s = JSON.parse(o); node.strokes = s.strokes; node.strokeWeight = s.weight; node.effects = s.effects; } catch (e) { /* ignore */ }
  node.setPluginData('pwBorderOrig', '');
}
function applyBorderPreview(node, tag) {
  if (!('effects' in node) || !('strokes' in node)) return;
  const p = Object.assign({ style: 'solid', color: '#ffd54a', color2: '#ff8a3d', thickness: 3, glow: 14, strength: 0.8 }, tagParams(tag));
  if (!GLOW_BORDERS.includes(p.style)) { removeBorderPreview(node); return; }
  if (!node.getPluginData('pwBorderOrig')) node.setPluginData('pwBorderOrig', JSON.stringify({ strokes: node.strokes, weight: typeof node.strokeWeight === 'number' ? node.strokeWeight : 0, effects: node.effects }));
  const o = JSON.parse(node.getPluginData('pwBorderOrig'));
  const t = Math.min(14, Math.max(1, Number(p.thickness) || 3)), g = Math.min(60, Math.max(0, Number(p.glow) || 0)), a = Math.min(1, Math.max(0.1, Number(p.strength) || 0.8));
  node.strokes = p.style === 'rarity'
    ? [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: [{ position: 0, color: Object.assign(rgb(String(p.color)), { a: 1 }) }, { position: 1, color: Object.assign(rgb(String(p.color2)), { a: 1 }) }] }]
    : solid(String(p.color));
  node.strokeWeight = t;
  try { node.strokeAlign = 'INSIDE'; } catch (e) { /* not for this layer */ }
  const col = Object.assign(rgb(String(p.color)), { a: a });
  const fx = o.effects.slice();
  if (g > 0) {
    fx.push({ type: 'DROP_SHADOW', color: col, offset: { x: 0, y: 0 }, radius: g, spread: 0, visible: true, blendMode: 'NORMAL' });
    fx.push({ type: 'INNER_SHADOW', color: Object.assign({}, col, { a: a * 0.45 }), offset: { x: 0, y: 0 }, radius: g * 0.8, spread: 0, visible: true, blendMode: 'NORMAL' });
  }
  node.effects = fx;
}

/* ---------- Roblox UI objects (v0.11): classes + modifiers from Studio's GUI / Frame / Label / Input / Appearance / Layout / Constraint menus ----------
   Classes are tags like @uiframe(type=ScrollingFrame). Modifiers (UICorner, UIStroke, ...) are tags too, and Figma shows what it can:
   corners, stroke, gradient, shadow, padding, list / grid auto layout, aspect lock, size limits. Roblox reads the tags on import. */
const UI_CLASS = { uigui: ['ScreenGui', 'SurfaceGui', 'AdGui', 'BillboardGui'], uiframe: ['Frame', 'CanvasGroup', 'ScrollingFrame', 'VideoFrame', 'ViewportFrame'], uilabel: ['ImageLabel', 'TextLabel'], uiinput: ['ImageButton', 'TextButton', 'TextBox'] };
const UI_MOD = ['uicorner', 'uistroke', 'uigradient', 'uipadding', 'uishadow', 'uilist', 'uigrid', 'uipage', 'uitable', 'uiflex', 'uiaspect', 'uiscale', 'uisize', 'uitextsize', 'uiparticle'];
const isUiTag = (tn) => Boolean(UI_CLASS[tn]) || UI_MOD.includes(tn);
const uiNum = (v, d, lo, hi) => { const n = Number(v); return Math.min(hi, Math.max(lo, v === undefined || v === '' || !isFinite(n) ? d : n)); };
const UI_KEEP = (node, key, val) => { if (!node.getPluginData(key)) node.setPluginData(key, JSON.stringify(val)); };
const UI_BACK = (node, key) => { const o = node.getPluginData(key); if (!o) return null; node.setPluginData(key, ''); try { return JSON.parse(o); } catch (e) { return null; } };
function linearGradient(c1, c2, deg) {
  const a = (Number(deg) || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);   // 0 = left to right, turning clockwise (same as Roblox UIGradient.Rotation)
  return [{ type: 'GRADIENT_LINEAR', gradientTransform: [[c, s, 0.5 - 0.5 * c - 0.5 * s], [-s, c, 0.5 + 0.5 * s - 0.5 * c]], gradientStops: [{ position: 0, color: Object.assign(rgb(c1), { a: 1 }) }, { position: 1, color: Object.assign(rgb(c2), { a: 1 }) }] }];
}
function applyUiTag(node, tag) {
  const tn = tagName(tag), p = tagParams(tag);
  try {
    if (UI_CLASS[tn]) {
      const type = UI_CLASS[tn].includes(p.type) ? p.type : UI_CLASS[tn][0];
      if (('clipsContent' in node) && (type === 'ScrollingFrame' || type === 'CanvasGroup' || type === 'ViewportFrame' || type === 'VideoFrame')) node.clipsContent = true;
    } else if (tn === 'uicorner' && 'cornerRadius' in node) {
      node.cornerRadius = uiNum(p.r, 8, 0, 999); refreshBg(node);
    } else if (tn === 'uistroke' && 'strokes' in node) {
      UI_KEEP(node, 'pwUiStroke', { strokes: node.strokes, weight: typeof node.strokeWeight === 'number' ? node.strokeWeight : 0 });
      const t = uiNum(p.thickness, 3, 0, 30);
      node.strokes = t > 0 ? [{ type: 'SOLID', color: rgb(String(p.color || '#170f33')), opacity: 1 - uiNum(p.transparency, 0, 0, 1) }] : [];
      node.strokeWeight = t || 1;
      try { node.strokeAlign = String(p.mode) === 'outer' ? 'OUTSIDE' : 'INSIDE'; } catch (e) { /* not for this layer */ }
      refreshBg(node);
    } else if (tn === 'uigradient' && 'fills' in node) {
      UI_KEEP(node, 'pwUiFill', node.fills);
      node.fills = linearGradient(String(p.color || '#ff5c9d'), String(p.color2 || '#4cc9ff'), p.rotation === undefined ? 90 : p.rotation);
    } else if (tn === 'uipadding' && isAutoLayout(node)) {
      const all = uiNum(p.pad, 12, 0, 200), pick = (k) => uiNum(p[k], all, 0, 200);
      node.paddingTop = pick('top'); node.paddingRight = pick('right'); node.paddingBottom = pick('bottom'); node.paddingLeft = pick('left');
    } else if (tn === 'uishadow' && 'effects' in node) {
      UI_KEEP(node, 'pwUiFx', node.effects);
      const col = Object.assign(rgb(String(p.color || '#000000')), { a: 1 - uiNum(p.transparency, 0.6, 0, 1) });
      node.effects = (node.effects || []).filter((e) => e.type !== 'DROP_SHADOW').concat([{ type: 'DROP_SHADOW', color: col, offset: { x: 0, y: uiNum(p.y, 4, -60, 60) }, radius: uiNum(p.blur, 8, 0, 80), spread: 0, visible: true, blendMode: 'NORMAL' }]);
    } else if ((tn === 'uilist' || tn === 'uigrid') && 'layoutMode' in node && isContainer(node)) {
      UI_KEEP(node, 'pwUiLayout', { mode: node.layoutMode });
      const gap = uiNum(p.gap, 8, 0, 200);
      node.layoutMode = tn === 'uigrid' || String(p.direction) === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL';
      node.itemSpacing = gap;
      if (tn === 'uigrid') { node.primaryAxisSizingMode = 'FIXED'; node.layoutWrap = 'WRAP'; node.counterAxisSpacing = gap; }
      else { node.layoutWrap = 'NO_WRAP'; const al = String(p.align || 'start'); node.counterAxisAlignItems = al === 'center' ? 'CENTER' : al === 'end' ? 'MAX' : 'MIN'; }
    } else if (tn === 'uiflex' && node.parent && isAutoLayout(node.parent)) {
      const m = String(p.mode || 'grow');
      node.layoutGrow = m === 'grow' ? 1 : 0;
      if ('layoutAlign' in node) node.layoutAlign = m === 'fill' ? 'STRETCH' : 'INHERIT';
    } else if (tn === 'uiaspect' && 'resize' in node) {
      const r = uiNum(p.ratio, 0, 0, 20);
      if (r > 0) node.resize(node.width, Math.max(1, node.width / r));
      if ('lockAspectRatio' in node) node.lockAspectRatio();
    } else if (tn === 'uisize') {
      const mn = (k) => uiNum(p[k], 0, 0, 5000);
      try {
        if ('minWidth' in node) { node.minWidth = mn('minw') || null; node.minHeight = mn('minh') || null; node.maxWidth = uiNum(p.maxw, 0, 0, 5000) || null; node.maxHeight = uiNum(p.maxh, 0, 0, 5000) || null; }
      } catch (e) { /* limits are stored in the tag; Roblox applies them */ }
      const w = Math.min(uiNum(p.maxw, 5000, 0, 5000) || 5000, Math.max(mn('minw'), node.width)), h = Math.min(uiNum(p.maxh, 5000, 0, 5000) || 5000, Math.max(mn('minh'), node.height));
      if ('resize' in node && (Math.abs(w - node.width) > 0.5 || Math.abs(h - node.height) > 0.5)) node.resize(Math.max(1, w), Math.max(1, h));
    } else if (tn === 'uitextsize' && node.type === 'TEXT' && node.fontSize !== figma.mixed) {
      node.fontSize = Math.min(uiNum(p.max, 40, 1, 400), Math.max(uiNum(p.min, 8, 1, 400), node.fontSize));
    }
  } catch (e) { /* a preview only: the tag is still saved for Roblox */ }
}
function removeUiTag(node, tag) {
  const tn = tagName(tag);
  try {
    if (tn === 'uistroke') { const o = UI_BACK(node, 'pwUiStroke'); if (o) { node.strokes = o.strokes; node.strokeWeight = o.weight; refreshBg(node); } }
    else if (tn === 'uigradient') { const o = UI_BACK(node, 'pwUiFill'); if (o) node.fills = o; }
    else if (tn === 'uishadow') { const o = UI_BACK(node, 'pwUiFx'); if (o) node.effects = o; }
    else if (tn === 'uilist' || tn === 'uigrid') { const o = UI_BACK(node, 'pwUiLayout'); if (o) { node.layoutWrap = 'NO_WRAP'; node.layoutMode = o.mode || 'NONE'; } }
    else if (tn === 'uiaspect' && 'unlockAspectRatio' in node) node.unlockAspectRatio();
    else if (tn === 'uiflex') { node.layoutGrow = 0; if ('layoutAlign' in node) node.layoutAlign = 'INHERIT'; }
    else if (tn === 'uisize' && 'minWidth' in node) { node.minWidth = null; node.minHeight = null; node.maxWidth = null; node.maxHeight = null; }
  } catch (e) { /* nothing to undo */ }
}
// Checks shown in "Will it work in Roblox?" for the UI tags.
function checkUiTag(node, t) {
  const tn = tagName(t), p = tagParams(t), parentAuto = isAutoLayout(node.parent);
  if (UI_CLASS[tn]) {
    const type = UI_CLASS[tn].includes(p.type) ? p.type : UI_CLASS[tn][0];
    if (tn === 'uiinput' && type !== 'ImageButton' && node.type !== 'TEXT' && !isContainer(node)) return { ok: false, text: '@' + tn + ' (' + type + ') belongs on a frame or text layer.' };
    if ((type === 'TextLabel' || type === 'TextButton' || type === 'TextBox') && node.type !== 'TEXT' && !(isContainer(node) && node.findOne((c) => c.type === 'TEXT'))) return { ok: false, text: type + ' needs text. Select a text layer, or a frame that has text inside.' };
    return { ok: true, text: type + ' is saved as a tag. Roblox creates a ' + type + ' for this layer when the importer reads it.' };
  }
  if (tn === 'uicorner') return 'cornerRadius' in node ? { ok: true, text: 'UICorner: Figma shows the ' + uiNum(p.r, 8, 0, 999) + 'px corners now; Roblox adds a UICorner.' } : { ok: false, text: 'UICorner needs a frame or shape.' };
  if (tn === 'uistroke') return 'strokes' in node ? { ok: true, text: 'UIStroke: shown as a border in Figma; Roblox adds a UIStroke.' } : { ok: false, text: 'UIStroke needs a frame or shape.' };
  if (tn === 'uigradient') return 'fills' in node ? { ok: true, text: 'UIGradient: shown as a gradient fill in Figma; Roblox adds a UIGradient.' } : { ok: false, text: 'UIGradient needs a frame or shape.' };
  if (tn === 'uipadding') return isAutoLayout(node) ? { ok: true, text: 'UIPadding: padding set on the auto-layout frame.' } : { ok: false, text: 'UIPadding shows in Figma only on an auto-layout frame. Add @uilist or @uigrid to this frame first (Roblox still gets the padding).' };
  if (tn === 'uishadow') return { ok: true, text: 'UIShadow: shown as a drop shadow in Figma; Roblox adds a UIShadow.' };
  if (tn === 'uilist' || tn === 'uigrid') return isContainer(node) ? { ok: true, text: (tn === 'uilist' ? 'UIListLayout' : 'UIGridLayout') + ': the frame is now an auto-layout ' + (tn === 'uilist' ? 'list' : 'wrapping grid') + '.' } : { ok: false, text: '@' + tn + ' belongs on a frame that holds the items.' };
  if (tn === 'uipage' || tn === 'uitable') return { ok: true, text: '@' + tn + ' is saved as a tag. Figma has no page/table layout to show, so Roblox builds it on import.' };
  if (tn === 'uiflex') return parentAuto ? { ok: true, text: 'UIFlexItem: the layer ' + (p.mode === 'fill' ? 'fills' : 'grows into') + ' the free space of its list.' } : { ok: false, text: 'UIFlexItem works on a layer inside an auto-layout frame (a list).' };
  if (tn === 'uiaspect') return { ok: true, text: 'UIAspectRatioConstraint: the shape is locked to its ratio in Figma too.' };
  if (tn === 'uiscale') return { ok: true, text: 'UIScale is saved as a tag (Roblox scales the layer ×' + uiNum(p.scale, 1, 0.1, 5) + '). Figma keeps the layer at its normal size.' };
  if (tn === 'uisize') return { ok: true, text: 'UISizeConstraint: size limits are saved; Figma clamps the current size.' };
  if (tn === 'uitextsize') return node.type === 'TEXT' ? { ok: true, text: 'UITextSizeConstraint: text size kept between ' + uiNum(p.min, 8, 1, 400) + ' and ' + uiNum(p.max, 40, 1, 400) + '.' } : { ok: false, text: 'UITextSizeConstraint belongs on a text layer.' };
  if (tn === 'uiparticle') return { ok: true, text: 'ParticleEmitter2D is saved as a tag. Roblox draws the particles (Figma cannot show them).' };
  return { ok: true, text: '@' + tn + ' saved.' };
}
// Nothing selected: a tile creates a starter layer of that Roblox class.
async function addUiClass(tag) {
  await loadFonts();
  const tn = tagName(tag), p = tagParams(tag), type = (UI_CLASS[tn] || ['Frame']).includes(p.type) ? p.type : (UI_CLASS[tn] || ['Frame'])[0];
  const parent = targetParent();
  const isText = type === 'TextLabel' || type === 'TextButton' || type === 'TextBox';
  const big = tn === 'uigui';
  const node = figma.createFrame();
  node.name = type;
  node.resize(big ? 360 : isText ? 160 : 200, big ? 640 : isText ? 44 : 120);
  node.fills = type === 'TextLabel' ? [] : solid(type === 'TextBox' ? '#ffffff' : type.indexOf('Button') > 0 ? '#3b82f6' : '#2b3550');
  node.cornerRadius = big ? 0 : 8;
  if (isText) {
    node.layoutMode = 'HORIZONTAL'; node.primaryAxisAlignItems = 'CENTER'; node.counterAxisAlignItems = 'CENTER'; node.paddingLeft = node.paddingRight = 12;
    const t = figma.createText(); t.fontName = { family: 'Inter', style: 'Bold' };
    t.characters = type === 'TextBox' ? 'Type here…' : type === 'TextButton' ? 'Button' : 'Label'; t.fontSize = 18; t.fills = solid(type === 'TextBox' ? '#6b7280' : '#ffffff');
    node.appendChild(t); node.name = type;
  }
  parent.appendChild(node);
  applyTagToNode(node, tag, []);
  placeNode(node, parent);
}
function applyTagToNode(node, tag, conflicts) {
  const tn = tagName(tag);
  const { clean, tags } = splitName(node.name);
  const drop = new Set([tn].concat(conflicts || []));
  const kept = tags.filter((t) => !drop.has(tagName(t)));
  kept.push(tag);
  node.name = (clean + ' ' + kept.join(' ')).trim();
  try { syncTextFill(node); } catch (e) { /* preview only */ }
  if (tn === 'bg') {
    if (isContainer(node)) drawBg(node, tag);
    else figma.notify('Put @bg on a frame so the background can be drawn.');
  }
  if (isUiTag(tn)) applyUiTag(node, tag);
  if (tn === 'font') { applyFontPreview(node, tag).catch(() => {}); }
  if (tn === 'border' && isContainer(node)) { try { applyBorderPreview(node, tag); } catch (e) { /* preview only */ } refreshBg(node); }
  if (tn === 'shadow') { try { applyShadowPreview(node, tag); } catch (e) { /* preview only */ } }
  if (tn === 'aura') {
    try {
      if (node.parent && isAutoLayout(node.parent)) figma.notify('@aura sits behind the layer. Put the layer in a plain frame (not auto layout) so it can.');
      else drawAura(node, tag);
    } catch (e) { figma.notify('Aura tag added. The preview could not be drawn, but Roblox will show it.'); }
  }
  return tags.filter((t) => drop.has(tagName(t))).map(tagName).filter((n) => n !== tn);
}
function removeTagFromNode(node, tag) {
  const { clean, tags } = splitName(node.name);
  const kept = tags.filter((t) => t !== tag);
  node.name = (clean + ' ' + kept.join(' ')).trim();
  if (tagName(tag) === 'bg') removeBg(node);
  if (isUiTag(tagName(tag))) removeUiTag(node, tag);
  try { syncTextFill(node); } catch (e) { /* preview only */ }
  if (tagName(tag) === 'font') { removeFontPreview(node).catch(() => {}); }
  if (tagName(tag) === 'border') { try { removeBorderPreview(node); } catch (e) { /* ignore */ } refreshBg(node); }
  if (tagName(tag) === 'shadow') { try { removeShadowPreview(node); } catch (e) { /* ignore */ } }
  if (tagName(tag) === 'aura') { try { removeAura(node); } catch (e) { /* ignore */ } }
}

// ---------- "Will it work?": plain-language checks for the tags on a layer ----------
const PLAYS_IN_ROBLOX = { wisp: 'floating orbs', glow: 'a pulsing halo', shimmer: 'a light sweep', sparkle: 'twinkling stars', pulse: 'a breathing scale', float: 'bobbing up and down', rainbow: 'a spinning rainbow outline', hover: 'grow on hover / squish on press', fadein: 'a fade-in when the screen opens', slidein: 'a slide-in when the screen opens', typewriter: 'letter-by-letter text', aura: 'a soft light glowing behind the layer', rays: 'spinning light beams behind the layer', stars: 'twinkling stars around the layer', halo: 'a glowing ring floating above the layer', orbit: 'orbs circling the layer', border: 'a game-style border on the frame', outline: 'a thick outline around the text', bounce: 'hopping up and down', spin: 'turning around', swing: 'rocking side to side', popin: 'a pop-in when the screen opens', flicker: 'a neon-style flicker', blink: 'blinking on and off', shadow: 'a drop shadow (buttons sink into it when pressed)', gloss: 'a glass pane sweeping left to right', textwave: 'letters bobbing in a wave', textshake: 'trembling letters', textpop: 'letters popping in one by one', textrainbow: 'colors rolling through the letters', textglitch: 'a broken-screen glitch', textgradient: 'a flowing two-color gradient in the text', textglow: 'a pulsing neon edge around the letters', glass: 'a frosted-glass look with a sweeping pane', bevel: 'a chunky 3D button edge' };
// Cartoony effects (v0.10.21): they play in the Live tab. Roblox plays them once the app's importer knows the tag.
const CARTOON_FX = { jello: 'jelly wobble', rubberband: 'squash and stretch', tada: 'celebration shake', wobble: 'side-to-side wobble', heartbeat: 'double heartbeat', headshake: 'a quick no shake', jelly: 'a soft squishy idle', jump: 'a hop with squash and stretch', wiggle: 'an excited wiggle', drop: 'falls in and squashes', stamp: 'slams in like a stamp', flip: 'a coin flip', confetti: 'falling confetti', bubbles: 'rising bubbles' };
Object.assign(PLAYS_IN_ROBLOX, { hoverlift: 'the button lifting up when the mouse is over it', hovergrow: 'growing a little on hover', hovertilt: 'tilting toward the mouse', hovershine: 'a white light sweeping across on hover', hoverglow: 'a glow fading in on hover', hoverbright: 'getting brighter on hover', hoverwiggle: 'a quick wiggle when the mouse arrives', press: 'sinking and shrinking while pressed', ripple: 'a ripple spreading from where you click', clickburst: 'sparkles bursting out where you click', embers: 'glowing embers rising', snow: 'snow falling', fireflies: 'fireflies drifting and blinking', coins: 'coins raining down', hearts: 'hearts floating up', hoverpop: 'an icon tile that lights up on hover: outline, darker tile, picture whitens and grows', print: 'your message printed in the Output window when the layer is clicked', ref: 'a name your scripts can look the layer up by' });
function checkNode(node) {
  const out = [];
  const tags = splitName(node.name).tags;
  if (!tags.length) return out;
  const parentAuto = isAutoLayout(node.parent);
  for (const t of tags) {
    const tn = tagName(t), p = tagParams(t);
    if (isUiTag(tn)) {
      out.push(checkUiTag(node, t));
    } else if (tn === 'bg') {
      if (!isContainer(node)) out.push({ ok: false, text: '@bg needs a frame. Put it on a frame, not on ' + node.type.toLowerCase() + '.' });
      else if (isAutoLayout(node)) out.push({ ok: false, text: '@bg is on an auto-layout frame. Roblox draws it best on a plain frame: wrap the content in a backing frame.' });
      else if (node.children.some(isPreview)) out.push({ ok: true, text: 'Background is drawn in Figma now (the locked layer “Background preview”). Roblox rebuilds it from the tag on import.' });
      else if (p.style === 'image' && p.image) out.push({ ok: true, text: 'Your own image: it appears in Roblox only (Figma cannot show an uploaded Roblox id).' });
      else out.push({ ok: false, text: 'No preview drawn yet. Press the background again, or pick a texture in the Store tab.' });
    } else if (tn === 'float' || tn === 'slidein' || tn === 'bounce' || tn === 'aura' || tn === 'rays') {
      out.push(parentAuto ? { ok: false, text: '@' + tn + ' does nothing for children of an auto-layout frame' + (tn === 'aura' || tn === 'rays' ? ' (the light sits behind the layer as its neighbour)' : '') + '. Put it on a layer in a plain frame.' } : { ok: true, text: '@' + tn + ' plays in Roblox: ' + PLAYS_IN_ROBLOX[tn] + '.' + (tn === 'aura' || tn === 'rays' ? ' It is drawn behind the layer, so use it on the picture of the character or pet.' : '') });
    } else if (tn === 'typewriter') {
      out.push(node.type === 'TEXT' ? { ok: true, text: '@typewriter plays in Roblox: ' + PLAYS_IN_ROBLOX.typewriter + '.' } : { ok: false, text: '@typewriter only works on a text layer.' });
    } else if ((tn === 'gloss' || tn === 'glass' || tn === 'bevel') && !isContainer(node)) {
      out.push({ ok: false, text: '@' + tn + ' belongs on a frame or button. Put it on the frame around this layer.' });
    } else if (tn === 'shadow' && parentAuto) {
      out.push({ ok: true, text: '@shadow in an auto-layout frame becomes a dark inner bottom edge in Roblox (a real shadow needs a plain frame). Figma shows the full shadow.' });
    } else if (TEXT_FX.includes(tn)) {
      out.push(node.type !== 'TEXT' ? { ok: false, text: '@' + tn + ' only works on a text layer.' } : { ok: true, text: '@' + tn + ' plays in Roblox: ' + PLAYS_IN_ROBLOX[tn] + '.' + (LETTER_FX.includes(tn) ? ' Works on one-line text.' : '') + (tn === 'textgradient' || tn === 'textrainbow' ? ' Figma shows a still gradient.' : ' Figma cannot animate it.') });
    } else if (tn === 'font') {
      out.push({ ok: true, text: '@font sets the Roblox font' + (node.type === 'TEXT' ? '' : ' of every text inside this frame') + '. Figma shows the closest Google font (if you have it installed); Roblox uses the real one.' });
    } else if (tn === 'border' && !isContainer(node)) {
      out.push({ ok: false, text: '@border belongs on a frame. Put it on the frame (or card) you want the border around.' });
    } else if (tn === 'wisp' && node.type === 'TEXT') {
      out.push({ ok: false, text: '@wisp needs a frame. Put it on the parent frame.' });
    } else if (tn === 'open' || tn === 'toggle') {
      const target = tagParams(t) && (String(t).match(/:([\w-]+)/) || [])[1];
      const found = target && figma.currentPage.findOne((n) => splitName(n.name).clean === target && splitName(n.name).tags.some((x) => tagName(x) === 'panel'));
      out.push(found ? { ok: true, text: '@' + tn + ':' + target + ' finds its panel “' + target + '”.' } : { ok: false, text: '@' + tn + ':' + target + ' needs a frame named “' + target + '” tagged @panel.' });
    } else if (CARTOON_FX[tn]) {
      out.push({ ok: true, text: '@' + tn + ' (' + CARTOON_FX[tn] + '): preview only for now. It plays in the Live tab; Roblox plays it once the app\u2019s importer knows this tag.' });
    } else if (tn === 'print' || tn === 'ref') {
      out.push(tn === 'print' && !isContainer(node) ? { ok: false, text: '@print belongs on a frame or button (put it on the frame around this layer).' } : { ok: true, text: '@' + tn + ' plays in Roblox: ' + PLAYS_IN_ROBLOX[tn] + '. Figma cannot show it.' });
    } else if (PLAYS_IN_ROBLOX[tn]) {
      out.push({ ok: true, text: '@' + tn + ' plays in Roblox: ' + PLAYS_IN_ROBLOX[tn] + '. Figma cannot animate it.' });
    } else if (tn === 'button' || tn === 'close') {
      out.push(isContainer(node) ? { ok: true, text: '@' + tn + ' becomes a clickable ' + (tn === 'close' ? 'close button' : 'button') + ' in Roblox.' } : { ok: false, text: '@' + tn + ' belongs on a frame (put it on the frame around this layer).' });
    } else if (tn === 'ignore') {
      out.push({ ok: true, text: '@ignore: the Roblox import skips this layer.' });
    }
  }
  return out;
}

// ---------- text that is wider than its card wraps instead of running out the side ----------
function fixTextOverflow(node) {
  if (!('children' in node)) return;
  const auto = isAutoLayout(node);
  const kids = node.children.filter((c) => !isPreview(c) && c.visible !== false);
  if (auto) {
    const inner = node.width - (node.paddingLeft || 0) - (node.paddingRight || 0);
    if (inner > 24) {
      for (const c of kids) {
        if (c.type === 'TEXT' && c.layoutSizingHorizontal !== 'FILL' && c.width > inner + 0.5) { c.textAutoResize = 'HEIGHT'; c.layoutSizingHorizontal = 'FILL'; }
      }
      if (node.layoutMode === 'HORIZONTAL') {
        const inFlow = kids.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
        const total = inFlow.reduce((s, c) => s + c.width, 0) + (node.itemSpacing || 0) * Math.max(0, inFlow.length - 1);
        if (total > inner + 0.5) {
          const wide = inFlow.filter((c) => c.type === 'TEXT' && c.layoutSizingHorizontal !== 'FILL').sort((a, b) => b.width - a.width)[0];
          if (wide) { wide.textAutoResize = 'HEIGHT'; wide.layoutSizingHorizontal = 'FILL'; }
        }
      }
    }
  } else if (node.type === 'FRAME' || node.type === 'COMPONENT') {
    for (const c of kids) {
      if (c.type === 'TEXT' && c.x + c.width > node.width - 4 && node.width - c.x - 8 > 40) { c.textAutoResize = 'HEIGHT'; c.resize(node.width - c.x - 8, c.height); }
    }
  }
  for (const c of node.children) if (isContainer(c) && !isPreview(c)) fixTextOverflow(c);
}

// ---------- "Polish": one press that gives the selected frames a nicer game-UI look (gradient, border, shadow, rounder corners) ----------
const solidHex = (n) => { const f = n.fills; return Array.isArray(f) && f.length === 1 && f[0].type === 'SOLID' && f[0].visible !== false ? toHex(f[0].color) : null; };
const noEffects = (n) => !Array.isArray(n.effects) || n.effects.length === 0;
const noStrokes = (n) => !Array.isArray(n.strokes) || n.strokes.length === 0;
function polish(node, o, depth, stats) {
  if (/@ignore/i.test(node.name) || isPreview(node)) return;
  if (isContainer(node)) {
    const tags = splitName(node.name).tags.map(tagName);
    const base = solidHex(node);
    const w = node.width, h = node.height;
    const isBtn = tags.includes('button') || tags.includes('close') || /(^|\s)(btn|button)/i.test(node.name) || /btn$/i.test(node.name);
    const skip = tags.includes('bg') || tags.includes('image');
    let changed = false;
    if (base && !skip) {
      const big = w >= 120 && h >= 70 && depth > 0;
      const pill = !isBtn && h <= 40 && w > h;
      try {
        if (o.grad && depth === 0) { node.fills = gradient(shade(base, 0.05), shade(base, -0.06)); changed = true; }
        else if (o.grad && isBtn) { node.fills = gradient(shade(base, 0.2), shade(base, -0.08)); changed = true; }
        else if (o.grad && big) { node.fills = gradient(shade(base, 0.07), shade(base, -0.03)); changed = true; }
        if (o.border && depth > 0 && noStrokes(node) && (isBtn || big || pill)) {
          node.strokes = solid(shade(base, isBtn ? -0.35 : 0.2)); node.strokeWeight = isBtn ? 2 : 1.5;
          if ('strokeAlign' in node) node.strokeAlign = 'INSIDE';
          changed = true;
        }
        if (o.shadow && depth > 0 && noEffects(node) && (isBtn || big)) {
          node.effects = isBtn ? dropShadow(rgb(shade(base, -0.1)), 0.55, 4, 12) : dropShadow({ r: 0, g: 0, b: 0 }, 0.35, 8, 20);
          changed = true;
        }
        if (o.round && typeof node.cornerRadius === 'number' && depth > 0) {
          const want = isBtn ? Math.min(14, h / 2) : pill ? h / 2 : big ? 14 : node.cornerRadius;
          if (want > node.cornerRadius) { node.cornerRadius = want; changed = true; }
        }
      } catch (e) { /* a node type that does not take that property: skip it */ }
    }
    if (changed) stats.count += 1;
  }
  if ('children' in node && node.type !== 'INSTANCE') for (const c of node.children) polish(c, o, depth + 1, stats);
}

// ---------- "Add element": drops a ready-made frame/button/text/... into the selected frame (or onto the canvas) ----------
const ELEMENTS = {
  frame: () => ({ t: 'frame', name: 'Frame', w: 300, h: 200, fill: '#ffffff', r: 12 }),
  panel: () => ({ t: 'frame', name: 'Panel', w: 320, h: 240, fill: '#1f2937', r: 16, layout: 'col', gap: 12, pad: 16, children: [
    { t: 'text', name: 'Title', text: 'Title', size: 20, weight: 'bold', color: '#ffffff' },
    { t: 'frame', name: 'Content', w: 288, h: 150, fill: '#111827', r: 10, stretch: true, grow: true }
  ] }),
  button: () => ({ t: 'frame', name: 'Button', w: 160, h: 48, fill: '#2f80ed', fill2: '#1d5fc4', r: 12, layout: 'row', align: 'center', cross: 'center', pad: [0, 16, 0, 16], tags: ['@button'], children: [
    { t: 'text', name: 'Label', text: 'Button', size: 16, weight: 'bold', color: '#ffffff' }
  ] }),
  close: () => ({ t: 'frame', name: 'Close', w: 36, h: 36, fill: '#e5484d', r: 18, layout: 'row', align: 'center', cross: 'center', tags: ['@close'], children: [
    { t: 'text', name: 'X', text: 'X', size: 16, weight: 'bold', color: '#ffffff' }
  ] }),
  text: () => ({ t: 'text', name: 'Text', text: 'Text', size: 16, weight: 'regular', color: '#111111' }),
  image: () => ({ t: 'rect', name: 'Image', w: 120, h: 120, fill: '#c8ced6', r: 8 }),
  rect: () => ({ t: 'rect', name: 'Rectangle', w: 120, h: 80, fill: '#9aa5b1', r: 0 }),
  circle: () => ({ t: 'ellipse', name: 'Circle', w: 80, h: 80, fill: '#9aa5b1' }),
  progress: () => ({ t: 'frame', name: 'Progress bar', w: 240, h: 16, fill: '#374151', r: 8, children: [
    { t: 'rect', name: 'Fill', x: 0, y: 0, w: 150, h: 16, fill: '#22c55e', fill2: '#16a34a', r: 8 }
  ] })
};

async function addElement(kind) {
  const make = ELEMENTS[kind];
  if (!make) return;
  await loadFonts();
  const parent = targetParent();
  const node = build(make(), parent);
  placeNode(node, parent);
}

function targetParent() {
  const sel = figma.currentPage.selection[0];
  if (!sel) return figma.currentPage;
  return isContainer(sel) ? sel : (sel.parent && sel.parent.type !== 'DOCUMENT' ? sel.parent : figma.currentPage);
}

function placeNode(node, parent) {
  const auto = parent.type !== 'PAGE' && isAutoLayout(parent);
  if (parent.type === 'PAGE') {
    const c = figma.viewport.center;
    node.x = Math.round(c.x - node.width / 2); node.y = Math.round(c.y - node.height / 2);
  } else if (!auto) {
    // free-position frame: put the new element under whatever is already inside it
    let bottom = -12;
    for (const ch of parent.children) if (ch !== node && !isPreview(ch)) bottom = Math.max(bottom, ch.y + ch.height);
    node.x = Math.min(16, Math.max(0, parent.width - node.width));
    node.y = bottom + 12;
  }
  figma.currentPage.selection = [node];
  figma.notify('Added ' + node.name + (parent.type === 'PAGE' ? '' : ' inside “' + parent.name + '”'));
}

async function addTextLayer(m) {
  await loadFonts();
  const parent = targetParent();
  const node = figma.createText();
  node.fontName = { family: 'Inter', style: 'Bold' };
  node.characters = String(m.text || 'Text').slice(0, 200);
  node.fontSize = Math.min(100, Math.max(8, Number(m.size) || 32));
  node.fills = solid(String(m.color || '#ffffff'));
  parent.appendChild(node);
  node.name = node.characters.replace(/@/g, '').slice(0, 40) || 'Text';
  if (m.tag) applyTagToNode(node, m.tag, CONFLICT_MAP[tagName(m.tag)]);
  placeNode(node, parent);
}

function addIcon(svg, name) {
  const parent = targetParent();
  const node = figma.createNodeFromSvg(svg);
  node.name = (name || 'Icon') + ' @image';   // @image: Roblox gets it as one picture
  parent.appendChild(node);
  placeNode(node, parent);
}

// size / corner / color edits from the panel
// ---- text style (weight, italic, align, spacing) ----
const STYLE_OF_WEIGHT = { regular: 'Regular', medium: 'Medium', bold: 'Bold', heavy: 'Black' };
function weightOfStyle(style) { return /black|heavy/i.test(style) ? 'heavy' : /bold/i.test(style) ? 'bold' : /medium/i.test(style) ? 'medium' : 'regular'; }
async function loadNodeFonts(node) {
  const fonts = node.fontName === figma.mixed ? node.getRangeAllFontNames(0, Math.max(1, node.characters.length)) : [node.fontName];
  for (const f of fonts) await figma.loadFontAsync(f);
}
async function setWeightItalic(node, weight, italic) {
  const fontTag = splitName(node.name).tags.find((t) => tagName(t) === 'font');
  if (fontTag) {   // Roblox reads the @font tag, so change it there (the Figma preview follows)
    const p = tagParams(fontTag);
    if (weight != null) { if (weight === 'auto') delete p.weight; else p.weight = weight; }
    if (italic != null) { if (italic) p.italic = 'on'; else delete p.italic; }
    const parts = Object.keys(p).map((k) => k + '=' + p[k]);
    applyTagToNode(node, '@font' + (parts.length ? '(' + parts.join(',') + ')' : ''), []);
    return;
  }
  if (node.fontName === figma.mixed) return;
  const cur = node.fontName, wasItalic = /italic/i.test(cur.style);
  const w = weight != null && weight !== 'auto' ? weight : weightOfStyle(cur.style);
  const it = italic != null ? italic : wasItalic;
  const base = STYLE_OF_WEIGHT[w] || 'Regular';
  const tries = it ? [base + ' Italic', base === 'Regular' ? 'Italic' : base, 'Regular'] : [base, 'Regular'];
  for (const style of tries) {
    try { await figma.loadFontAsync({ family: cur.family, style }); node.fontName = { family: cur.family, style }; return; } catch (e) { /* try the next style */ }
  }
  figma.notify('“' + cur.family + '” has no ' + (it ? 'italic ' : '') + w + ' style in Figma.');
}
async function setProps(p) {
  const done = [];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  for (const node of figma.currentPage.selection) {
    try {
      const parentAuto = isAutoLayout(node.parent);
      if (p.w != null || p.h != null) {
        const w = Math.max(1, p.w != null ? p.w : node.width), h = Math.max(1, p.h != null ? p.h : node.height);
        if (parentAuto && 'layoutSizingHorizontal' in node) { if (p.w != null) node.layoutSizingHorizontal = 'FIXED'; if (p.h != null) node.layoutSizingVertical = 'FIXED'; }
        if (node.type === 'TEXT') { if (p.w != null) { node.textAutoResize = 'HEIGHT'; node.resize(w, node.height); } }
        else node.resize(w, h);
        const bg = splitName(node.name).tags.find((t) => tagName(t) === 'bg');
        if (bg && isContainer(node)) drawBg(node, bg);
        done.push(p.w != null && p.h != null ? 'size ' + Math.round(node.width) + '×' + Math.round(node.height) : p.w != null ? 'width ' + Math.round(node.width) : 'height ' + Math.round(node.height));
      }
      if (p.r != null && 'cornerRadius' in node) { node.cornerRadius = Math.max(0, p.r); refreshBg(node); done.push('radius ' + Math.max(0, p.r)); }
      if (p.fill && 'fills' in node) {
        const op = Array.isArray(node.fills) && node.fills[0] && node.fills[0].opacity != null ? node.fills[0].opacity : 1;
        const f = solid(p.fill); f[0] = Object.assign({}, f[0], { opacity: op }); node.fills = f; done.push('color ' + p.fill);
      }
      if (p.fillOpacity != null && 'fills' in node && Array.isArray(node.fills) && node.fills.length) {
        const o = clamp(p.fillOpacity, 0, 1); node.fills = node.fills.map((f) => Object.assign({}, f, { opacity: o })); done.push('transparency ' + Math.round((1 - o) * 100) + '%');
      }
      if (p.opacity != null && 'opacity' in node) { node.opacity = clamp(p.opacity, 0, 1); done.push('layer transparency ' + Math.round((1 - node.opacity) * 100) + '%'); }
      if ((p.stroke || p.strokeW != null) && 'strokes' in node) {
        const had = Array.isArray(node.strokes) && node.strokes[0] && node.strokes[0].type === 'SOLID' ? toHex(node.strokes[0].color) : null;
        if (p.strokeW === 0) node.strokes = [];
        else {
          node.strokes = solid(p.stroke || had || '#ffffff');
          node.strokeWeight = p.strokeW != null ? Math.max(0, p.strokeW) : (typeof node.strokeWeight === 'number' && node.strokeWeight > 0 ? node.strokeWeight : 1);
          try { node.strokeAlign = 'INSIDE'; } catch (e) { /* not for this layer */ }
        }
        refreshBg(node);
        done.push('border');
      }
      if (p.rotation != null && 'rotation' in node) { node.rotation = clamp(p.rotation, -180, 180); done.push('rotation ' + (Math.round(node.rotation * 10) / 10) + '°'); }
      if (!parentAuto && 'x' in node && (p.x != null || p.y != null)) { if (p.x != null) node.x = p.x; if (p.y != null) node.y = p.y; done.push('position'); }
      if (p.name != null) { const t = splitName(node.name).tags; node.name = (String(p.name).trim() + ' ' + t.join(' ')).trim(); done.push('name'); }
      if (p.fontSize != null && node.type === 'TEXT') {
        if (node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName);
        node.fontSize = clamp(p.fontSize, 1, 400); done.push('text size ' + node.fontSize);
      }
      if (p.text != null && node.type === 'TEXT') {   // edit what the text says (every font used in it must be loaded first)
        const fonts = node.fontName === figma.mixed ? node.getRangeAllFontNames(0, node.characters.length) : [node.fontName];
        for (const f of fonts) await figma.loadFontAsync(f);
        node.characters = String(p.text).slice(0, 2000); done.push('text content');
      }
      if (node.type === 'TEXT') {
        if (p.talign) { await loadNodeFonts(node); node.textAlignHorizontal = p.talign; done.push('align'); }
        if (p.tls != null) { await loadNodeFonts(node); node.letterSpacing = { value: clamp(p.tls, -20, 100), unit: 'PIXELS' }; done.push('letter spacing'); }
        if (p.tlh != null) { await loadNodeFonts(node); node.lineHeight = Number(p.tlh) > 0 ? { value: clamp(p.tlh, 1, 400), unit: 'PIXELS' } : { unit: 'AUTO' }; done.push('line height'); }
        if (p.tweight != null || p.titalic != null) { await setWeightItalic(node, p.tweight, p.titalic); done.push('font style'); }
      }
    } catch (e) { say('Could not change that: ' + (e.message || e), true); return; }
  }
  if (done.length && !p.q) say('Applied: ' + done.filter((v, i, a) => a.indexOf(v) === i).join(', ') + '.');
}

// reference image / video dropped on the canvas (named @ignore so the Roblox import skips it)
async function addRef(m) {
  const sel = figma.currentPage.selection[0];
  const top = sel && sel.parent && sel.parent.type === 'PAGE' ? sel : null;   // a top-level frame to sit beside, or trace over
  let w = 480, h = 300, fills;
  if (m.kind === 'video') {
    const v = await figma.createVideoAsync(m.bytes);
    h = 270; fills = [{ type: 'VIDEO', videoHash: v.hash, scaleMode: 'FILL' }];
  } else {
    const img = figma.createImage(m.bytes);
    const s = await img.getSizeAsync();
    const k = Math.min(1, 480 / s.width);
    w = Math.max(1, Math.round(s.width * k)); h = Math.max(1, Math.round(s.height * k));
    fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
  }
  const r = figma.createRectangle();
  r.name = 'Reference ' + String(m.name || '').slice(0, 40) + ' @ignore';
  if (top && m.overlay) {
    r.resize(top.width, top.height); r.x = top.x; r.y = top.y;
    r.fills = fills.map((f) => Object.assign({}, f, { scaleMode: 'FIT' })); r.opacity = 0.4;
  } else if (top) {
    const k = top.height / h; w = Math.max(1, Math.round(w * k)); h = Math.round(top.height);
    r.resize(w, h); r.fills = fills; r.x = Math.round(top.x - w - 60); r.y = top.y;
  } else {
    const c = figma.viewport.center;
    r.resize(w, h); r.fills = fills; r.x = Math.round(c.x - w / 2); r.y = Math.round(c.y - h / 2);
  }
  figma.currentPage.selection = [r];
  say(top ? (m.overlay ? 'Reference laid over “' + top.name + '” at 40%. Copy it, then delete it.' : 'Reference placed to the left of “' + top.name + '” so you can compare. It is @ignore: never imported.') : 'Reference added. It is marked @ignore, so it will not be imported into Roblox.');
}

// a Creator Store texture picked in the Store tab: remember the image, then write the @bg tag
async function applyTexture(m) {
  const sel = figma.currentPage.selection.filter(isContainer);
  if (!sel.length) { say('Select a frame first, then click a texture.', true); return; }
  const id = String(m.id).replace(/\D/g, '');
  if (!id) return;
  const img = figma.createImage(m.bytes);
  figma.root.setPluginData(TEX_KEY(id), img.hash);
  const size = Math.max(6, Math.min(200, Number(m.size) || 24));
  const op = Math.min(1, Math.max(0.05, Number(m.opacity) || 1));
  const tag = '@bg(style=image,store=' + id + ',size=' + size + (op < 1 ? ',opacity=' + op : '') + ')';
  for (const node of sel) applyTagToNode(node, tag, []);
  say('Texture “' + String(m.name || id).slice(0, 30) + '” applied to ' + sel.length + ' frame(s). Tiles show here; Roblox loads it by id ' + id + '.');
}

function textStyleInfo(n) {
  if (n.type !== 'TEXT') return {};
  const out = { talign: n.textAlignHorizontal, tweight: 'regular', titalic: false, tls: 0, tlh: 0 };
  const ft = splitName(n.name).tags.find((t) => tagName(t) === 'font'), fp = ft ? tagParams(ft) : {};
  if (n.fontName !== figma.mixed) { out.tweight = weightOfStyle(n.fontName.style); out.titalic = /italic/i.test(n.fontName.style); }
  if (fp.weight) out.tweight = fp.weight;
  if (fp.italic) out.titalic = fp.italic === 'on';
  if (n.letterSpacing !== figma.mixed && n.letterSpacing) out.tls = Math.round((n.letterSpacing.unit === 'PIXELS' ? n.letterSpacing.value : n.letterSpacing.value * (typeof n.fontSize === 'number' ? n.fontSize : 16) / 100) * 10) / 10;
  if (n.lineHeight !== figma.mixed && n.lineHeight && n.lineHeight.unit === 'PIXELS') out.tlh = Math.round(n.lineHeight.value);
  out.hasFontTag = !!ft;
  return out;
}
function selectionInfo() {
  const sel = figma.currentPage.selection;
  if (!sel.length) return { empty: true };
  const first = sel[0];
  let fill = null;
  if ('fills' in first && Array.isArray(first.fills) && first.fills[0] && first.fills[0].type === 'SOLID') fill = toHex(first.fills[0].color);
  const parentAuto = isAutoLayout(first.parent);
  const fl = 'fills' in first && Array.isArray(first.fills) ? first.fills : [];
  const st = 'strokes' in first && Array.isArray(first.strokes) ? first.strokes : [];
  const more = { id: first.id, hasFill: fl.length > 0, fillOpacity: fl[0] && fl[0].opacity != null ? fl[0].opacity : 1, opacity: 'opacity' in first ? first.opacity : 1,
    lookId: (first.getPluginData && first.getPluginData('pwLook')) || '',
    stroke: st[0] && st[0].type === 'SOLID' ? toHex(st[0].color) : null, strokeW: st.length && typeof first.strokeWeight === 'number' ? first.strokeWeight : 0,
    rotation: typeof first.rotation === 'number' ? Math.round(first.rotation * 10) / 10 : null, x: Math.round(first.x), y: Math.round(first.y), fontSize: first.type === 'TEXT' && typeof first.fontSize === 'number' ? first.fontSize : null,
    chars: first.type === 'TEXT' ? first.characters : null, ...textStyleInfo(first) };
  return { ...more, count: sel.length, name: first.name, type: first.type, tags: splitName(first.name).tags, clean: splitName(first.name).clean, checks: checkNode(first), isFrame: isContainer(first),
    w: Math.round(first.width), h: Math.round(first.height), r: typeof first.cornerRadius === 'number' ? first.cornerRadius : null, fill, isText: first.type === 'TEXT', parentAuto };
}
figma.on('selectionchange', () => { if (previewedFont.size) revertPreviewedFonts(); figma.ui.postMessage({ type: 'selection', info: selectionInfo() }); });

/** Which file / frames are open, so the Pixelworks app can sync without a pasted link. */
function topFrameOf(n) {
  let c = n;
  while (c && c.parent && c.parent.type !== 'PAGE') c = c.parent;
  return c && c.parent && c.parent.type === 'PAGE' ? c : null;
}
function contextInfo() {
  const frames = [];
  for (const c of figma.currentPage.children) if (c.type === 'FRAME' && !/@ignore/i.test(c.name)) frames.push({ id: c.id, name: String(c.name).slice(0, 80) });
  const selected = [];
  for (const n of figma.currentPage.selection) { const t = topFrameOf(n); if (t && t.type === 'FRAME' && !selected.includes(t.id)) selected.push(t.id); }
  let fileKey = '';
  try { fileKey = figma.fileKey || ''; } catch (e) { /* not available */ }
  return { fileKey, fileName: String(figma.root.name).slice(0, 80), page: String(figma.currentPage.name).slice(0, 60), frames: frames.slice(0, 100), selected };
}
let ctxTimer = null;
function pushContext() { clearTimeout(ctxTimer); ctxTimer = setTimeout(() => figma.ui.postMessage({ type: 'context', ctx: contextInfo() }), 300); }
figma.on('selectionchange', pushContext);
figma.on('currentpagechange', pushContext);

function build(n, parent) {
  let node;
  const inAuto = parent && isAutoLayout(parent);
  if (n.t === 'text') {
    node = figma.createText();
    node.fontName = { family: 'Inter', style: WEIGHT[n.weight] || 'Regular' };
    node.characters = n.text || '';
    node.fontSize = n.size || 16;
    node.fills = solid(n.color || '#111111');
    node.textAlignHorizontal = (n.textAlign || 'left').toUpperCase();
    if (n.opacity != null) node.opacity = n.opacity;
  } else if (n.t === 'rect') node = figma.createRectangle();
  else if (n.t === 'ellipse') node = figma.createEllipse();
  else node = figma.createFrame();
  node.name = n.name || n.t;
  parent.appendChild(node);

  if (n.t === 'text') {
    if (n.w) { node.textAutoResize = 'HEIGHT'; node.resize(n.w, node.height); }
    else if (inAuto) {
      // a sentence inside an auto-layout card fills the card's width and wraps; short labels stay one line
      if (n.stretch || n.grow || String(n.text || '').length > 34) { node.textAutoResize = 'HEIGHT'; node.layoutSizingHorizontal = 'FILL'; }
    } else if (parent.type !== 'PAGE') {
      const maxW = parent.width - (n.x || 0) - 8;
      if (maxW > 40 && node.width > maxW) { node.textAutoResize = 'HEIGHT'; node.resize(maxW, node.height); }
    }
  } else {
    node.resize(n.w || 100, n.h || 100);
    style(node, n);
  }
  if (n.t === 'frame') {
    node.clipsContent = false;
    if (n.layout) {
      node.layoutMode = n.layout === 'row' ? 'HORIZONTAL' : 'VERTICAL';
      node.itemSpacing = n.gap || 0;
      const p = Array.isArray(n.pad) ? n.pad : [n.pad || 0, n.pad || 0, n.pad || 0, n.pad || 0];
      node.paddingTop = p[0]; node.paddingRight = p[1]; node.paddingBottom = p[2]; node.paddingLeft = p[3];
      node.primaryAxisAlignItems = MAIN[n.align] || 'MIN';
      node.counterAxisAlignItems = CROSS[n.cross] || 'MIN';
      node.primaryAxisSizingMode = n.hug ? 'AUTO' : 'FIXED';   // "hug": the frame shrinks to fit its content along the layout direction
      node.counterAxisSizingMode = 'FIXED';
    }
  }
  if (n.t !== 'text') {
    if (inAuto) {
      if (n.grow) node.layoutGrow = 1;
      if (n.stretch) node.layoutAlign = 'STRETCH';
    } else if (parent.type !== 'PAGE') {
      node.x = n.x || 0; node.y = n.y || 0;
    }
  } else if (!inAuto && parent.type !== 'PAGE') {
    node.x = n.x || 0; node.y = n.y || 0;
  }
  if (n.t === 'frame') for (const c of n.children || []) build(c, node);
  for (const tag of n.tags || []) applyTagToNode(node, tag, CONFLICT_MAP[tagName(tag)]);
  return node;
}

/** Pictures the user attached in the app: placed in a column to the left of the new design, marked @ignore. */
async function placeRefs(root, refs) {
  let x = root.x - 60;
  for (const ref of refs || []) {
    try {
      const img = figma.createImage(ref.bytes);
      const size = await img.getSizeAsync();
      const k = root.height / size.height;
      const w = Math.max(1, Math.round(size.width * Math.min(k, 1.5))), h = Math.max(1, Math.round(size.height * Math.min(k, 1.5)));
      const r = figma.createRectangle();
      r.name = 'Reference ' + String(ref.name || '').slice(0, 40) + ' @ignore';
      r.resize(w, h);
      r.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
      x -= w; r.x = x; r.y = root.y;
      x -= 40;
    } catch (e) { figma.notify('Pixelworks: could not place “' + (ref && ref.name) + '” (' + (e.message || e) + ')', { error: true }); }
  }
}

async function draw(design, refs) {
  await loadFonts();
  const page = figma.currentPage;
  let right = 0;
  for (const c of page.children) right = Math.max(right, c.x + c.width);
  const root = build(design, page);
  fixTextOverflow(root);
  root.x = page.children.length > 1 ? right + 100 : 0;
  root.y = 0;
  if (refs && refs.length) {
    if (root.x < 600) root.x += 600;   // leave room on the left for the reference pictures
    await placeRefs(root, refs);
  }
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  figma.notify('Pixelworks: drew “' + root.name + '”');
}

/* ---------- Live preview ----------
 * Figma cannot animate anything on the canvas, so the plugin window plays the effects instead.
 * The selected frame is cloned far off-canvas (the original is never touched), every layer that carries an
 * effect tag is exported as its own picture, and ui.html animates those pictures with the same tags.
 * The clone is deleted again as soon as the pictures are exported. */
Object.assign(CARTOON_FX, { barshine: 'a light sweep along the bar', barstripes: 'moving stripes in the bar', barpulse: 'a glowing bar', lowflash: 'a low-health warning flash', damage: 'a health drain with a trail', barfill: 'the bar filling up', barrainbow: 'a rainbow bar', tipspark: 'a spark at the bar tip' });
Object.assign(CARTOON_FX, { torchlight: 'flickering fire glow', lightning: 'electric flashes', holo: 'a rainbow sheen', scanlines: 'old-screen lines', chase: 'a running light around the border', shake: 'a rumble', unroll: 'a scroll unrolling', spinin: 'spinning in', rise: 'floating up in', rain: 'falling rain', leaves: 'drifting leaves', smoke: 'rising smoke', shootingstar: 'shooting stars' });
const PV_EFFECTS = new Set(['wisp', 'glow', 'shimmer', 'sparkle', 'pulse', 'float', 'rainbow', 'hover', 'fadein', 'slidein', 'typewriter', 'aura', 'rays', 'stars', 'halo', 'orbit', 'border', 'outline', 'bounce', 'spin', 'swing', 'popin', 'flicker', 'blink', 'gloss', 'glass', 'bevel', 'jello', 'rubberband', 'tada', 'wobble', 'heartbeat', 'headshake', 'jelly', 'jump', 'wiggle', 'drop', 'stamp', 'flip', 'confetti', 'bubbles', 'hoverlift', 'hovergrow', 'hovertilt', 'hovershine', 'hoverglow', 'hoverbright', 'hoverwiggle', 'press', 'ripple', 'clickburst', 'embers', 'snow', 'fireflies', 'coins', 'hearts', 'print', 'ref', 'hoverpop'].concat(TEXT_FX));
['torchlight', 'lightning', 'holo', 'scanlines', 'chase', 'shake', 'unroll', 'spinin', 'rise', 'rain', 'leaves', 'smoke', 'shootingstar'].concat(['barshine', 'barstripes', 'barpulse', 'lowflash', 'damage', 'barfill', 'barrainbow', 'tipspark']).forEach((id) => { PV_EFFECTS.add(id); KNOWN.add(id); });
const PV_TEXT_DOM = new Set(TEXT_FX.concat(['typewriter']));   // these text layers are redrawn letter by letter in the window
const PV_ROOTS = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP']);
const PV_MAX_PX = 2000, PV_MAX_SPRITES = 40, PV_MAX_NODES = 600;
let pvBusy = false, pvAgain = false, pvDoneAt = 0;
const pvIgnore = new Set();   // ids of the temporary clone, so our own edits do not trigger another refresh

const pvIsAuraPreview = (n) => Boolean((n.getPluginData && n.getPluginData('pwAuraFor')) || /^Aura preview @ignore$/.test(n.name));
function pvRadius(n, w, h) {
  if (n.type === 'ELLIPSE') return Math.min(w, h) / 2;
  const r = n.cornerRadius;
  if (typeof r === 'number') return r;
  return typeof n.topLeftRadius === 'number' ? n.topLeftRadius : 0;
}
function pvTextInfo(n, tags) {
  const mixed = figma.mixed;
  const val = (v, d) => (v === mixed || v == null ? d : v);
  let fills = n.fills;
  const orig = n.getPluginData('pwFillOrig');   // the plugin swaps in a still gradient for @textgradient / @textrainbow; the real color is remembered
  if (orig) { try { fills = JSON.parse(orig); } catch (e) { /* keep current fills */ } }
  let color = '#ffffff';
  if (Array.isArray(fills)) {
    const f = fills.find((x) => x.visible !== false && (x.type === 'SOLID' || (x.type || '').indexOf('GRADIENT') === 0));
    if (f) color = f.type === 'SOLID' ? toHex(f.color) : toHex(f.gradientStops[0].color);
  }
  const fs = Number(val(n.fontSize, 16)) || 16;
  const fn = val(n.fontName, { family: 'Inter', style: 'Regular' });
  const ls = val(n.letterSpacing, { value: 0, unit: 'PIXELS' });
  const lh = val(n.lineHeight, { unit: 'AUTO' });
  let family = fn.family, style = String(fn.style || '');
  const fontTag = tags.find((t) => tagName(t) === 'font');
  let weight = /black|heavy/i.test(style) ? 900 : /extra\s*bold/i.test(style) ? 800 : /semi\s*bold|demi/i.test(style) ? 600 : /bold/i.test(style) ? 700 : /medium/i.test(style) ? 500 : /light/i.test(style) ? 300 : 400;
  let italic = /italic|oblique/i.test(style);
  if (fontTag) {
    const p = tagParams(fontTag);
    family = FIGMA_FONT[p.font || 'Gotham'] || family;
    if (p.weight && FIGMA_WEIGHT[p.weight]) weight = { regular: 400, medium: 500, bold: 700, heavy: 900 }[p.weight];
    if (p.italic === 'true' || p.italic === '1') italic = true;
  }
  return { chars: String(n.characters).slice(0, 400), size: fs, color, family, weight, italic, align: n.textAlignHorizontal || 'LEFT',
    ls: ls.unit === 'PIXELS' ? ls.value : (ls.value / 100) * fs, lh: lh.unit === 'PIXELS' ? lh.value : lh.unit === 'PERCENT' ? (lh.value / 100) * fs : 0 };
}
const pvPngSize = (b) => { const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); return { w: dv.getUint32(16), h: dv.getUint32(20) }; };

async function buildPreview() {
  const sel = figma.currentPage.selection;
  if (!sel.length) return { empty: true, why: 'Select a frame to see its effects play here.' };
  let top = sel[0];
  while (top && top.type !== 'PAGE' && !PV_ROOTS.has(top.type)) top = top.parent;
  if (!top || top.type === 'PAGE' || !top.absoluteBoundingBox) return { empty: true, why: 'Select a frame (or a layer inside one) to preview.' };
  if (top.width < 1 || top.height < 1) return { empty: true, why: 'That frame has no size.' };

  const clone = top.clone();
  const markIds = (n) => { pvIgnore.add(n.id); if ('children' in n) n.children.forEach(markIds); };
  markIds(clone);
  const ids = Array.from(pvIgnore);
  setTimeout(() => ids.forEach((i) => pvIgnore.delete(i)), 6000);
  try {
    if (clone.parent !== figma.currentPage) figma.currentPage.appendChild(clone);
    clone.x = 100000; clone.y = 100000;
    const rb = clone.absoluteBoundingBox;
    const items = [], others = new Set();
    let sprites = 0, scanned = 0, skipped = 0;
    const walk = (n, fxParent) => {
      if (++scanned > PV_MAX_NODES) return;
      if (n !== clone) {
        if (n.visible === false) return;
        if (pvIsAuraPreview(n)) { n.visible = false; return; }   // the animated aura replaces the still preview layer
      }
      const tags = splitName(n.name).tags;
      const fx = tags.filter((t) => PV_EFFECTS.has(tagName(t)));
      tags.forEach((t) => { if (!PV_EFFECTS.has(tagName(t))) others.add(tagName(t)); });
      let mine = fxParent;
      const bb = n.absoluteBoundingBox;
      const isText = n.type === 'TEXT' && tags.some((t) => PV_TEXT_DOM.has(tagName(t)));
      if (n === clone || (fx.length && bb && bb.width > 0 && bb.height > 0)) {
        if (n !== clone && !isText && sprites >= PV_MAX_SPRITES) skipped += 1;
        else {
          if (n !== clone && !isText) sprites += 1;
          const it = { node: n, id: n.id, parent: fxParent, tags, text: isText ? pvTextInfo(n, tags) : null, bb };
          items.push(it); mine = n.id;
        }
      }
      if ('children' in n) for (const c of n.children) walk(c, mine);
    };
    walk(clone, null);

    const S = Math.max(0.25, Math.min(2, PV_MAX_PX / Math.max(rb.width, rb.height)));
    for (const it of items) if (it.text && 'opacity' in it.node) it.node.opacity = 0;   // redrawn in the window
    // children first, so each picture contains its own layer but not the tagged layers on top of it
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i], n = it.node;
      if (it.text) continue;
      try {
        it.png = await n.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: S } });
        const r = n.absoluteRenderBounds || it.bb;
        const sz = pvPngSize(it.png);
        it.rx = r.x - rb.x; it.ry = r.y - rb.y; it.iw = sz.w / S; it.ih = sz.h / S;
      } catch (e) { it.png = null; }
      if (n !== clone && 'opacity' in n) n.opacity = 0;
    }
    return {
      ok: true, W: rb.width, H: rb.height, S, name: splitName(top.name).clean || top.name, skipped, others: Array.from(others),
      nodes: items.map((it) => {
        const n = it.node, w = it.bb.width, h = it.bb.height;
        return { id: it.id, parent: it.parent, name: splitName(n.name).clean || n.name, type: n.type, tags: it.tags, x: it.bb.x - rb.x, y: it.bb.y - rb.y, w, h,
          rx: it.rx, ry: it.ry, iw: it.iw, ih: it.ih, png: it.png || null, text: it.text, radius: pvRadius(n, w, h), autoParent: Boolean(n.parent && isAutoLayout(n.parent)) };
      })
    };
  } finally {
    try { clone.remove(); } catch (e) { /* already gone */ }
  }
}
async function runPreview() {
  if (pvBusy) { pvAgain = true; return; }
  pvBusy = true;
  try { figma.ui.postMessage(Object.assign({ type: 'preview' }, await buildPreview())); }
  catch (e) { figma.ui.postMessage({ type: 'preview', error: String(e && e.message || e) }); }
  finally { pvBusy = false; pvDoneAt = Date.now(); if (pvAgain) { pvAgain = false; runPreview(); } }
}
// Tell the window when the document changes (your own edits, not the temporary clone) so the preview can follow along.
let pvPage = null, pvPageHandler = null;
function watchPage() {
  try { if (pvPage && pvPageHandler) pvPage.off('documentchange', pvPageHandler); } catch (e) { /* page gone */ }
  pvPage = figma.currentPage;
  pvPageHandler = (ev) => {
    if (pvBusy || Date.now() - pvDoneAt < 700) return;
    if (ev.documentChanges.some((c) => !pvIgnore.has(c.id))) figma.ui.postMessage({ type: 'docChanged' });
  };
  try { pvPage.on('documentchange', pvPageHandler); } catch (e) { /* live updates off; the Refresh button still works */ }
}
watchPage();
figma.on('currentpagechange', () => { figma.currentPage.loadAsync().then(watchPage).catch(() => {}); });


/* ---------- Game looks (v0.12): glossy and pixel-style buttons, panels, bars and slots. Pure Figma looks (gradient, border, bevel, shadow), so the importer reads them as normal fills / strokes. ---------- */
const lookRgba = (hex, a) => Object.assign(rgb(hex), { a: a });
function glossFill(a) {
  return { type: 'GRADIENT_LINEAR', gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: [
    { position: 0, color: { r: 1, g: 1, b: 1, a: a } }, { position: 0.48, color: { r: 1, g: 1, b: 1, a: a * 0.22 } }, { position: 0.5, color: { r: 1, g: 1, b: 1, a: 0 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } }] };
}
function applyLook(node, s, withText) {
  if (!('fills' in node) || !('effects' in node)) return false;
  const base = s.fill2 ? linearGradient(s.fill, s.fill2, 90) : solid(s.fill);
  node.fills = base.concat(s.gloss ? [glossFill(s.gloss)] : []);   // last fill is on top, so the gloss sits over the color
  if ('strokes' in node) {
    node.strokes = solid(s.stroke); node.strokeWeight = s.sw;
    try { node.strokeAlign = 'INSIDE'; } catch (e) { /* not for this layer */ }
  }
  if ('cornerRadius' in node) node.cornerRadius = s.r === 'pill' ? Math.min(node.width, node.height) / 2 : s.r;
  const fx = [];
  const inner = (col, a, y, spread) => fx.push({ type: 'INNER_SHADOW', color: lookRgba(col, a), offset: { x: 0, y: y }, radius: 0, spread: spread || 0, visible: true, blendMode: 'NORMAL' });
  if (s.rim) inner(s.rim, 1, 0, s.rimW || 3);       // a bright rim just inside the dark outline (the double border of panels)
  if (s.hi) inner('#ffffff', s.hi, 2, 0);           // light catching the top edge
  if (s.lo) inner('#000000', s.lo, -4, 0);          // darker band along the bottom: the chunky button edge
  if (s.glow) fx.push({ type: 'DROP_SHADOW', color: lookRgba(s.glow, 0.75), offset: { x: 0, y: 0 }, radius: 12, spread: 2, visible: true, blendMode: 'NORMAL' });
  if (s.hard) fx.push({ type: 'DROP_SHADOW', color: lookRgba(s.hard.c || '#000000', 1), offset: { x: 0, y: s.hard.y }, radius: 0, spread: 0, visible: true, blendMode: 'NORMAL' });   // pixel-style flat shadow
  if (s.shadow) fx.push({ type: 'DROP_SHADOW', color: lookRgba('#000000', s.shadow.a), offset: { x: 0, y: s.shadow.y }, radius: s.shadow.blur, spread: 0, visible: true, blendMode: 'NORMAL' });
  node.effects = fx;
  node.setPluginData('pwLook', s.id || '');
  if (withText && 'findAll' in node) {
    node.findAll((x) => x.type === 'TEXT').forEach((t) => {
      try {
        t.fills = solid(s.text || '#ffffff'); t.strokes = solid(s.tstroke || '#14213d'); t.strokeWeight = s.tsw || 3;
        try { t.strokeAlign = 'OUTSIDE'; } catch (e) { /* not for this layer */ }
        const lkFont = s.font || (s.px ? 'Arcade' : ''); if (lkFont && !splitName(t.name).tags.some((x) => tagName(x) === 'font')) applyTagToNode(t, '@font(font=' + lkFont + ')', []);
      } catch (e) { /* one odd text layer must not stop the look */ }
    });
  }
  return true;
}
async function makeLookFrame(s, withText) {
  const w = s.size[0], h = s.size[1], vc = figma.viewport.center;
  const f = figma.createFrame();
  f.name = s.name; f.resize(w, h); f.x = Math.round(vc.x - w / 2); f.y = Math.round(vc.y - h / 2); f.clipsContent = false;
  applyLook(f, s, false);
  if (s.kind === 'bar') {
    const pad = s.sw, fw = Math.round((w - pad * 2) * 0.7);
    const fill = figma.createRectangle(); fill.name = 'Fill'; fill.resize(fw, h - pad * 2); fill.x = pad; fill.y = pad;
    fill.fills = solid(s.barColor); if (typeof s.r === 'number') fill.cornerRadius = Math.max(0, s.r - pad); else fill.cornerRadius = (h - pad * 2) / 2;
    f.appendChild(fill);
    const shine = figma.createRectangle(); shine.name = 'Shine'; shine.resize(fw, Math.max(2, Math.round((h - pad * 2) * 0.28))); shine.x = pad; shine.y = pad;
    shine.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.35 }]; if (typeof s.r === 'number') shine.cornerRadius = Math.max(0, s.r - pad); f.appendChild(shine);
    if (s.seg) for (let i = 1; i < s.seg; i++) {   // pixel-style segments
      const cut = figma.createRectangle(); cut.name = 'Cut'; cut.resize(2, h - pad * 2); cut.x = Math.round(pad + (w - pad * 2) * i / s.seg - 1); cut.y = pad;
      cut.fills = solid(s.stroke); f.appendChild(cut);
    }
  } else if (s.label) {
    let ok = true;
    try { await figma.loadFontAsync({ family: 'Inter', style: 'Bold' }); } catch (e) { ok = false; }
    if (ok) {
      const t = figma.createText(); t.fontName = { family: 'Inter', style: 'Bold' }; t.characters = s.label; t.fontSize = s.fs || 20;
      f.appendChild(t); t.x = Math.round((w - t.width) / 2); t.y = Math.round((h - t.height) / 2);
      applyLook(f, s, withText);
    }
  }
  if (s.bg) { try { applyTagToNode(f, s.bg, (CONFLICT_MAP || {}).bg); } catch (e) { /* preview only */ } }
  if (s.kind === 'button') applyTagToNode(f, '@button', []);
  figma.currentPage.appendChild(f);
  figma.currentPage.selection = [f];
  return f;
}
async function doApplyLook(s, withText, make) {
  const sel = figma.currentPage.selection.filter((n) => n.type !== 'TEXT' && 'fills' in n && 'effects' in n);
  if (!sel.length || make) { await makeLookFrame(s, withText); say('Made a new “' + s.name + '”. Press Ctrl+Z to undo.'); return; }
  sel.forEach((n) => {
    applyLook(n, s, withText);
    if (s.bg && isContainer(n)) { try { applyTagToNode(n, s.bg, (CONFLICT_MAP || {}).bg); } catch (e) { /* preview only */ } }
  });
  say('Applied “' + s.name + '” to ' + sel.length + ' layer' + (sel.length > 1 ? 's' : '') + '. Press Ctrl+Z to undo.');
}

const handleMessage = async (m) => {
  if (!m) return;
  if (m.type === 'getPreview') { runPreview(); return; }
  if (m.type === 'resizeUi') { figma.ui.resize(Math.max(320, Math.min(1000, Number(m.w) || 360)), Math.max(400, Math.min(1000, Number(m.h) || 760))); return; }
  if (m.type === 'applyLook') { try { await doApplyLook(m.look, !!m.text, !!m.make); } catch (e) { say('Could not apply the look (' + e.message + ').', true); } figma.ui.postMessage({ type: 'selection', info: selectionInfo() }); return; }
  if (m.type === 'addTags') {   // a one-tap set of effects
    const sel = figma.currentPage.selection;
    if (!sel.length) { figma.notify('Select a layer first.'); return; }
    const tags = Array.isArray(m.tags) ? m.tags.map(String).filter((t) => /^@[a-zA-Z]+/.test(t)) : [];
    for (const node of sel) tags.forEach((t) => { try { applyTagToNode(node, t, (CONFLICT_MAP || {})[tagName(t)]); } catch (e) { /* skip one bad tag */ } });
    say('Added ' + tags.length + ' effects. Watch them in the ▶ Live tab.');
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'exportGui') {   // Send to Roblox Studio: the selection, or the frames Studio asked for by id
    try {
      let nodes = [];
      if (Array.isArray(m.ids) && m.ids.length) {
        for (const id of m.ids.slice(0, 50)) { const nd = await figma.getNodeByIdAsync(String(id)); if (nd && nd.type !== 'DOCUMENT' && nd.type !== 'PAGE') nodes.push(nd); }
        if (!nodes.length) { figma.ui.postMessage({ type: 'guiData', req: m.req, error: 'Those frames are not in the open Figma file any more. Refresh the list in Studio.' }); return; }
      } else nodes = figma.currentPage.selection.slice();
      if (!nodes.length) { figma.ui.postMessage({ type: 'guiData', req: m.req, error: 'Select a frame in Figma first.' }); return; }
      const data = guiExport(nodes);
      data.images = await guiImages(data);
      figma.ui.postMessage({ type: 'guiData', req: m.req, json: JSON.stringify(data), count: data.nodes, screens: data.screens.length, pics: data.images.length, truncated: data.truncated });
    } catch (e) { figma.ui.postMessage({ type: 'guiData', req: m.req, error: 'Could not read the frame: ' + String((e && e.message) || e) }); }
    return;
  }
  if (m.type === 'getContext') { figma.ui.postMessage({ type: 'context', ctx: contextInfo() }); return; }
  if (m.type === 'init') {
    if (Array.isArray(m.known)) KNOWN = new Set(m.known);
    if (m.conflicts) CONFLICT_MAP = m.conflicts;
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'openExternal') { if (/^https?:\/\/[^\s]+\/figma-bridge\/live$/.test(String(m.url))) figma.openExternal(String(m.url)); return; }   // the Live pop-out window
  if (m.type === 'getFonts') { await pushFonts(); return; }
  if (m.type === 'getAssets') { await pushAssets(); return; }
  if (m.type === 'saveAsset') {   // a picture for a particle effect
    await assetsReady;
    const id = String(m.id || ''), data = String(m.data || '');
    if (!/^[a-z]{3,20}$/.test(id) || !/^data:image\/(png|jpeg|webp);base64,/.test(data) || data.length > 400000) { say('That picture could not be saved. Try a smaller PNG or JPG.', true); return; }
    customAssets[id] = data; await figma.clientStorage.setAsync('pwAssets', customAssets); await pushAssets(); say('Saved your picture for @' + id + '. It is used in the effects list and in the Live tab.');
    return;
  }
  if (m.type === 'deleteAsset') { await assetsReady; delete customAssets[String(m.id || '')]; await figma.clientStorage.setAsync('pwAssets', customAssets); await pushAssets(); return; }
  if (m.type === 'saveFont') {   // a font you added: Roblox name (or rbxassetid) + the Google font Figma should show for it
    await fontsReady;
    const key = String(m.name || '').replace(/[^\w]/g, '').slice(0, 30);
    if (!key) { say('Give the font a name (letters and numbers).', true); return; }
    customFonts[key] = { figma: String(m.figma || 'Inter').slice(0, 60), id: /^rbxassetid:\/\/\d+$/.test(String(m.id || '').trim()) ? String(m.id).trim() : '', cat: 'Mine' };
    await figma.clientStorage.setAsync('pwFonts', customFonts);
    await pushFonts(); say('Saved the font “' + key + '”. It is in your Mine group now.');
    return;
  }
  if (m.type === 'deleteFont') { await fontsReady; delete customFonts[m.name]; await figma.clientStorage.setAsync('pwFonts', customFonts); await pushFonts(); return; }
  if (m.type === 'fontPreview') {   // clicking a font: show it on the layer for now. Nothing is saved until you press Apply.
    for (const node of figma.currentPage.selection) { previewedFont.add(node.id); try { await applyFontPreview(node, m.tag); } catch (e) { /* preview only */ } }
    return;
  }
  if (m.type === 'fontRevert') { await revertPreviewedFonts(); return; }   // leave without applying: back to the saved font (the @font tag, or the original)
  if (m.type === 'setProps') { await setProps(m.props || {}); figma.ui.postMessage({ type: 'selection', info: selectionInfo() }); return; }
  if (m.type === 'polish') {
    const sel = figma.currentPage.selection;
    if (!sel.length) { say('Select a frame to polish first.', true); return; }
    const o = Object.assign({ grad: true, border: true, shadow: true, round: true }, m.opts || {});
    const stats = { count: 0 };
    for (const node of sel) polish(node, o, node.parent && node.parent.type === 'PAGE' ? 0 : 1, stats);
    say(stats.count ? 'Polished ' + stats.count + ' layer(s): gradients, borders, shadows and rounder corners. Press Ctrl+Z to undo.' : 'Nothing to polish. Those layers already have a border/shadow, or use no plain fill.');
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'fixText') {
    const sel = figma.currentPage.selection;
    if (!sel.length) { say('Select a frame first.', true); return; }
    for (const node of sel) fixTextOverflow(node);
    say('Long text now wraps inside its card.');
    return;
  }
  if (m.type === 'applyTexture') {
    try { await applyTexture(m); } catch (e) { say('Could not apply the texture: ' + (e.message || e), true); }
    figma.ui.postMessage({ type: 'textureDone' });
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'addRef') {
    try { await addRef(m); } catch (e) { figma.notify('Could not add the reference: ' + (e.message || e), { error: true }); }
    figma.ui.postMessage({ type: 'refDone' });
    return;
  }
  if (m.type === 'addIcon') {
    try { addIcon(m.svg, m.name); } catch (e) { figma.notify('Could not add the icon: ' + (e.message || e), { error: true }); }
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'addText') {
    try { await addTextLayer(m); } catch (e) { figma.notify('Could not add the text: ' + (e.message || e), { error: true }); }
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'addEl') {
    try { await addElement(m.el); } catch (e) { figma.notify('Could not add it: ' + (e.message || e), { error: true }); }
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'addUi') {   // a Roblox UI tile with nothing selected: make a starter layer
    try { await addUiClass(m.tag); } catch (e) { figma.notify('Could not add it: ' + (e.message || e), { error: true }); }
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'tuneTag') {   // a slider moved: rewrite the tag on the selected layers, quietly (no Apply button)
    for (const node of figma.currentPage.selection) applyTagToNode(node, m.tag, []);
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type === 'addTag' || m.type === 'removeTag') {
    const sel = figma.currentPage.selection;
    if (!sel.length) { figma.notify('Select a layer first.'); return; }
    const replaced = [];
    if (tagName(m.tag) === 'font') previewedFont.clear();   // pressing Apply keeps the previewed font
    for (const node of sel) {
      if (m.type === 'addTag') replaced.push(...applyTagToNode(node, m.tag, CONFLICT_MAP[tagName(m.tag)]));
      else removeTagFromNode(node, m.tag);
    }
    if (m.type === 'addTag') {
      const bad = checkNode(sel[0]).find((c) => !c.ok && c.text.indexOf('@' + tagName(m.tag)) === 0);
      if (bad) say(bad.text, true);
      else say(tagName(m.tag) === 'bg' ? 'Background drawn in Figma. Roblox rebuilds it on import.' : 'Added ' + m.tag + '. Figma only stores the tag: see it play in the ▶ Live tab, or in Roblox.');
      if (replaced.length) figma.notify('Replaced @' + replaced.join(', @') + ' (they can’t be combined).');
    } else say('Removed ' + m.tag + '.');
    figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (m.type !== 'build') return;
  try {
    await draw(m.design, m.refs);
    figma.ui.postMessage({ type: 'done', id: m.id, ok: true, file: figma.root.name });
  } catch (e) {
    figma.notify('Pixelworks: could not draw (' + e.message + ')', { error: true });
    figma.ui.postMessage({ type: 'done', id: m.id, ok: false, error: String(e.message || e), file: figma.root.name });
  }
};

/* ---------- v0.13.3: Undo (Ctrl+Z) and Redo (Ctrl+X) inside the plugin ---------- */
const HIST = { undo: [], redo: [], lastType: '', lastAt: 0 };
const HIST_TYPES = new Set(['addTag', 'removeTag', 'tuneTag', 'addTags', 'setProps', 'applyLook', 'polish', 'fixText', 'applyTexture']);
const HIST_PROPS = ['name', 'opacity', 'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'effects', 'cornerRadius', 'rotation', 'visible', 'x', 'y', 'fontSize', 'letterSpacing', 'lineHeight', 'textAlignHorizontal', 'layoutMode', 'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'];
async function histSnap(ids) {
  const out = [];
  for (const id of ids) {
    let n = null; try { n = await figma.getNodeByIdAsync(id); } catch (e) { /* gone */ }
    if (!n || n.removed) continue;
    const rec = { id, props: {}, data: {} };
    HIST_PROPS.forEach((k) => { try { const v = n[k]; if (v !== undefined && v !== figma.mixed && typeof v !== 'symbol') rec.props[k] = (typeof v === 'object' && v !== null) ? JSON.parse(JSON.stringify(v)) : v; } catch (e) { /* not on this layer */ } });
    try { rec.w = n.width; rec.h = n.height; } catch (e) { /* none */ }
    try { if (n.type === 'TEXT') { rec.chars = n.characters; if (n.fontName !== figma.mixed) rec.font = n.fontName; } } catch (e) { /* none */ }
    try { n.getPluginDataKeys().forEach((k) => { rec.data[k] = n.getPluginData(k); }); } catch (e) { /* none */ }
    out.push(rec);
  }
  return out;
}
async function histRestore(snap) {
  for (const rec of snap) {
    let n = null; try { n = await figma.getNodeByIdAsync(rec.id); } catch (e) { /* gone */ }
    if (!n || n.removed) continue;
    if (n.type === 'TEXT' && rec.font) { try { await figma.loadFontAsync(rec.font); n.fontName = rec.font; if (rec.chars != null && n.characters !== rec.chars) n.characters = rec.chars; } catch (e) { /* font missing */ } }
    else if (n.type === 'TEXT') { try { await Promise.all(n.getRangeAllFontNames(0, n.characters.length).map((f) => figma.loadFontAsync(f))); } catch (e) { /* ignore */ } }
    Object.keys(rec.props).forEach((k) => { try { n[k] = rec.props[k]; } catch (e) { /* read-only here */ } });
    try { if (rec.w != null && (Math.abs(n.width - rec.w) > 0.01 || Math.abs(n.height - rec.h) > 0.01) && typeof n.resize === 'function') n.resize(Math.max(0.01, rec.w), Math.max(0.01, rec.h)); } catch (e) { /* ignore */ }
    try { n.getPluginDataKeys().forEach((k) => { if (!(k in rec.data)) n.setPluginData(k, ''); }); Object.keys(rec.data).forEach((k) => n.setPluginData(k, rec.data[k])); } catch (e) { /* ignore */ }
  }
}
function histIds() {   // the selected layers and what is inside them
  const ids = new Set();
  figma.currentPage.selection.forEach((n) => { ids.add(n.id); try { if ('findAll' in n) n.findAll().slice(0, 300).forEach((c) => ids.add(c.id)); } catch (e) { /* ignore */ } });
  return Array.from(ids);
}
async function histStep(from, to, word) {
  if (!HIST[from].length) { figma.notify('Nothing to ' + word + '.'); return; }
  const e = HIST[from].pop();
  HIST[to].push({ ids: e.ids, snap: await histSnap(e.ids) });
  await histRestore(e.snap);
  figma.notify((word === 'undo' ? 'Undid' : 'Redid') + ' the last change. (' + HIST.undo.length + ' to undo, ' + HIST.redo.length + ' to redo)');
  figma.ui.postMessage({ type: 'selection', info: selectionInfo() });
}
/* ---------- Send to Roblox Studio: turn the selected frame(s) into plain JSON the Studio plugin can rebuild ---------- */
const GUI_MAX_NODES = 3000;
const guiRgb = (c) => [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
const guiNum = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const GUI_TAG_RE = /@[A-Za-z]+(?::[\w-]+)?(?:\([^)]*\))?/g;
const guiClean = (name, type) => String(name || type).replace(/\s*@[A-Za-z]+(?::[\w-]+)?(?:\([^)]*\))?/g, '').trim() || String(type).toLowerCase();
function guiPaint(fills, w, h) {
  if (!Array.isArray(fills)) return null;
  for (let i = fills.length - 1; i >= 0; i -= 1) {   // the top-most visible fill wins
    const f = fills[i];
    if (!f || f.visible === false) continue;
    const op = guiNum(f.opacity, 1);
    if (f.type === 'SOLID') return { k: 'solid', c: guiRgb(f.color), a: op };
    if (f.type.indexOf('GRADIENT') === 0 && Array.isArray(f.gradientStops)) {
      let rot = 90;
      const t = f.gradientTransform;
      if (t) {
        const a = t[0][0], b = t[0][1], c = t[1][0], d = t[1][1], det = a * d - b * c;
        if (det) rot = Math.round(Math.atan2((-c / det) * h, (d / det) * w) * 180 / Math.PI);   // direction of the gradient line in the layer's pixels
      }
      return { k: 'grad', rot, radial: f.type !== 'GRADIENT_LINEAR', stops: f.gradientStops.map((st) => ({ p: st.position, c: guiRgb(st.color), a: guiNum(st.color.a, 1) * op })) };
    }
    if (f.type === 'IMAGE') return { k: 'image', a: op };
  }
  return null;
}
function guiStroke(n) {
  if (!Array.isArray(n.strokes)) return null;
  for (let i = n.strokes.length - 1; i >= 0; i -= 1) {
    const s = n.strokes[i];
    if (!s || s.visible === false || s.type !== 'SOLID') continue;
    let w = n.strokeWeight; if (w === figma.mixed) w = n.strokeTopWeight;
    w = guiNum(w, 1);
    return w > 0 ? { c: guiRgb(s.color), a: guiNum(s.opacity, 1), w } : null;
  }
  return null;
}
function guiLayout(n) {
  if (n.layoutMode !== 'HORIZONTAL' && n.layoutMode !== 'VERTICAL') return null;
  return { dir: n.layoutMode === 'HORIZONTAL' ? 'row' : 'col', gap: guiNum(n.itemSpacing, 0), pad: [guiNum(n.paddingTop, 0), guiNum(n.paddingRight, 0), guiNum(n.paddingBottom, 0), guiNum(n.paddingLeft, 0)], main: n.primaryAxisAlignItems || 'MIN', cross: n.counterAxisAlignItems || 'MIN' };
}
function guiNode(n, base, ctx) {
  if (ctx.count >= GUI_MAX_NODES) { ctx.truncated = true; return null; }
  ctx.count += 1;
  const w = Math.max(1, guiNum(n.width, 1)), h = Math.max(1, guiNum(n.height, 1));
  const rt = n.relativeTransform || [[1, 0, 0], [0, 1, 0]];
  const cx = rt[0][0] * w / 2 + rt[0][1] * h / 2 + rt[0][2];   // layer centre, so rotated layers land in the right place
  const cy = rt[1][0] * w / 2 + rt[1][1] * h / 2 + rt[1][2];
  const out = { n: guiClean(n.name, n.type), id: n.id, x: cx - base.x, y: cy - base.y, w, h };
  const tags = String(n.name || '').match(GUI_TAG_RE); if (tags && tags.length) out.tags = tags;
  const rot = guiNum(n.rotation, 0); if (Math.abs(rot) > 0.01) out.rot = -rot;   // Figma turns anticlockwise, Roblox clockwise
  if (n.visible === false) out.vis = false;
  const op = guiNum(n.opacity, 1); if (op < 1) out.op = op;
  if (n.layoutPositioning === 'ABSOLUTE') out.abs = true;
  if (n.type === 'TEXT') {
    let fs = n.fontSize; if (fs === figma.mixed) fs = n.getRangeFontSize(0, 1);
    let fn = n.fontName; if (fn === figma.mixed) fn = n.getRangeFontName(0, 1);
    let fl = n.fills; if (fl === figma.mixed) fl = n.getRangeFills(0, 1);
    let chars = n.characters;
    if (n.textCase === 'UPPER') chars = chars.toUpperCase(); else if (n.textCase === 'LOWER') chars = chars.toLowerCase();
    out.t = 'text';
    out.txt = { s: chars, size: guiNum(fs, 16), fam: (fn && fn.family) || '', sty: (fn && fn.style) || '', ax: n.textAlignHorizontal || 'LEFT', ay: n.textAlignVertical || 'TOP', fill: guiPaint(fl, w, h) };
    const sk = guiStroke(n); if (sk) out.stroke = sk;
    return out;
  }
  const kind = { RECTANGLE: 'rect', ELLIPSE: 'ellipse', LINE: 'rect', GROUP: 'frame', FRAME: 'frame', COMPONENT: 'frame', COMPONENT_SET: 'frame', INSTANCE: 'frame', SECTION: 'frame' }[n.type];
  out.t = kind || 'vector';   // stars, polygons, vectors and boolean shapes become an image slot
  if (n.type === 'GROUP') out.grp = true;
  const fill = n.fills === figma.mixed ? null : guiPaint(n.fills, w, h);
  if (fill) out.fill = fill;
  const sk = guiStroke(n); if (sk) out.stroke = sk;
  let r = n.cornerRadius; if (r === figma.mixed) r = n.topLeftRadius;
  r = guiNum(r, 0); if (r > 0) out.r = r;
  if (n.clipsContent) out.clip = true;
  const lay = guiLayout(n); if (lay) out.lay = lay;
  if (out.t === 'frame' && Array.isArray(n.children)) {
    const nb = n.type === 'GROUP' ? { x: rt[0][2], y: rt[1][2] } : { x: 0, y: 0 };   // a group's children are measured from the group's parent, a frame's from the frame
    out.ch = n.children.filter((c) => !/@ignore/i.test(String(c.name || ''))).map((c) => guiNode(c, nb, ctx)).filter(Boolean);   // @ignore layers (like the plugin's own "Background preview") are Figma-only helpers: they must not take space in Roblox
  }
  return out;
}
// Pictures and icons: Roblox can only show them as an uploaded image. Export each vector / image layer as a PNG; the app uploads them with your Open Cloud key.
async function guiImages(data) {
  const todo = [];
  const walk = (o) => {
    if (!o || o.vis === false) return;
    const own = o.t === 'vector' || (o.fill && o.fill.k === 'image' && !(o.ch && o.ch.length));
    if (own) todo.push(o);
    (o.ch || []).forEach(walk);
  };
  data.screens.forEach((s) => walk(s.root));
  // your own particle pictures (Use my own pictures): sent with the layers so Roblox gets the PNG too, unless the effect already has a Roblox image id
  const fxUsed = new Set();
  const walkFx = (o) => {
    if (!o) return;
    (o.tags || []).forEach((t) => { const tn = (String(t).match(/^@([a-zA-Z]+)/) || [])[1]; if (tn && !/imageid\s*=\s*\d/.test(t)) fxUsed.add(tn.toLowerCase()); });
    (o.ch || []).forEach(walkFx);
  };
  data.screens.forEach((s) => walkFx(s.root));
  await assetsReady;
  const fxPics = [];
  for (const id of Object.keys(customAssets)) {
    if (!fxUsed.has(id)) continue;
    try {
      const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(customAssets[id]));
      if (!m) continue;
      let b64 = m[2];
      if (m[1] !== 'png') {   // the uploader sends PNG: draw the picture on a layer and export it
        const img = figma.createImage(figma.base64Decode(m[2]));
        const r = figma.createRectangle(); r.resize(128, 128); r.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FIT' }];
        const bytes = await r.exportAsync({ format: 'PNG' }); r.remove(); b64 = figma.base64Encode(bytes);
      }
      fxPics.push({ key: 'fxpic:' + id, name: 'particle ' + id, b64 });
    } catch (e) { /* this particle keeps its drawn shape */ }
  }
  const images = [];
  for (const o of todo.slice(0, 40)) {
    try {
      const node = await figma.getNodeByIdAsync(o.id);
      if (!node || typeof node.exportAsync !== 'function') continue;
      const big = Math.max(o.w, o.h);
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: big <= 256 ? 2 : 1 } });
      if (!bytes || bytes.length > 3 * 1024 * 1024) continue;
      o.img = o.id;
      images.push({ key: o.id, name: o.n, b64: figma.base64Encode(bytes) });
    } catch (e) { /* this one stays an empty picture slot */ }
  }
  return images.concat(fxPics);
}
function guiExport(sel) {
  const ctx = { count: 0, truncated: false };
  const screens = sel.filter((n) => n.type !== 'SLICE').map((n) => ({ name: guiClean(n.name, 'Screen'), w: Math.max(1, Math.round(guiNum(n.width, 1))), h: Math.max(1, Math.round(guiNum(n.height, 1))), root: guiNode(n, { x: 0, y: 0 }, ctx) })).filter((s) => s.root);
  return { v: 1, file: figma.root.name, at: Date.now(), nodes: ctx.count, truncated: ctx.truncated, screens };
}

figma.ui.onmessage = async (m) => {
  if (m && m.type === 'getBridge') { const v = (await figma.clientStorage.getAsync('pwBridge').catch(() => null)) || {}; figma.ui.postMessage({ type: 'bridge', url: v.url || '', user: v.user || '', pass: v.pass || '' }); return; }
  if (m && m.type === 'setBridge') { await figma.clientStorage.setAsync('pwBridge', { url: String(m.url || ''), user: String(m.user || ''), pass: String(m.pass || '') }); return; }
  if (m && m.type === 'undo') { try { await histStep('undo', 'redo', 'undo'); } catch (e) { figma.notify('Could not undo: ' + (e.message || e), { error: true }); } return; }
  if (m && m.type === 'redo') { try { await histStep('redo', 'undo', 'redo'); } catch (e) { figma.notify('Could not redo: ' + (e.message || e), { error: true }); } return; }
  if (m && HIST_TYPES.has(m.type)) {
    const now = Date.now(), burst = (m.type === 'tuneTag' || m.type === 'setProps') && HIST.lastType === m.type && now - HIST.lastAt < 1500;   // one slider drag = one undo step
    HIST.lastType = m.type; HIST.lastAt = now;
    if (!burst) { try { const ids = histIds(); if (ids.length) { HIST.undo.push({ ids, snap: await histSnap(ids) }); if (HIST.undo.length > 50) HIST.undo.shift(); HIST.redo.length = 0; } } catch (e) { /* history is a bonus, never block the edit */ } }
  } else if (m && m.type !== 'getPreview') { HIST.lastType = ''; }
  return handleMessage(m);
};
