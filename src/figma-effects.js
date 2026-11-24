'use strict';
/**
 * UI effects you can attach to a Figma layer. The runtime that plays them is src/luau/UIEffects.luau,
 * which is copied into your project next to the generated screens.
 *
 * Three ways to add an effect (all end up as the same Roblox attributes):
 *   1. In Figma: put a tag in the layer name        "Play button @glow @hover"   "Hero @wisp(color=#7cf,count=10)"
 *   2. In this app: pick a layer + effect in the Figma panel
 *   3. In Studio: select any GuiObject ▸ Attributes ▸ add string  Fx = "wisp|glow"  (optional  Fx_wisp = '{"count":10}')
 */

const num = (def, min, max, label) => ({ type: 'number', def, min, max, label });
const color = (def, label) => ({ type: 'color', def, label });
const choice = (def, options, label) => ({ type: 'choice', def, options, label });
const text = (def, label) => ({ type: 'text', def, label });

const EFFECTS = {
  wisp: {
    label: 'Wisp (floating glow orbs)',
    hint: 'Soft glowing orbs that drift and flicker over the layer, like will-o’-the-wisps.',
    params: {
      color: color('#9be7ff', 'Color'),
      color2: color('#c9a7ff', 'Second color'),
      count: num(6, 1, 24, 'Orbs'),
      size: num(16, 6, 60, 'Orb size (px)'),
      speed: num(1, 0.2, 4, 'Speed'),
      drift: num(1, 0.2, 3, 'Drift range')
    }
  },
  glow: {
    label: 'Glow (pulsing halo)',
    hint: 'A soft colored halo around the layer that breathes in and out.',
    params: { color: color('#7cc4ff', 'Color'), size: num(10, 2, 40, 'Halo size (px)'), speed: num(1, 0.2, 4, 'Speed') }
  },
  shimmer: {
    label: 'Shimmer (light sweep)',
    hint: 'A bright streak that sweeps across the layer, great for buttons and rare items.',
    params: { color: color('#ffffff', 'Color'), speed: num(1, 0.2, 4, 'Speed'), strength: num(0.6, 0.1, 1, 'Strength'), angle: num(20, -80, 80, 'Angle') }
  },
  sparkle: {
    label: 'Sparkles',
    hint: 'Tiny stars that twinkle at random spots on the layer.',
    params: { color: color('#fff4b0', 'Color'), count: num(8, 1, 30, 'Sparkles'), size: num(6, 3, 20, 'Size (px)'), speed: num(1, 0.2, 4, 'Speed') }
  },
  pulse: {
    label: 'Pulse (breathing scale)',
    hint: 'The layer gently grows and shrinks.',
    params: { amount: num(0.05, 0.01, 0.3, 'Amount'), speed: num(1, 0.2, 4, 'Speed') }
  },
  float: {
    label: 'Float (bobbing)',
    hint: 'The layer drifts up and down. Not for children of an auto-layout frame.',
    params: { distance: num(6, 1, 60, 'Distance (px)'), speed: num(1, 0.2, 4, 'Speed') }
  },
  rainbow: {
    label: 'Rainbow (spinning gradient)',
    hint: 'A spinning rainbow on the layer’s stroke (or its fill if it has no stroke).',
    params: { speed: num(1, 0.2, 4, 'Speed') }
  },
  hover: {
    label: 'Hover & press',
    hint: 'Grows when the mouse is over it and squishes when pressed. Do not combine with Pulse.',
    params: { amount: num(0.06, 0.01, 0.3, 'Grow amount') }
  },
  fadein: {
    label: 'Fade in',
    hint: 'Fades the layer (and everything inside it) in when the screen opens.',
    params: { time: num(0.5, 0.1, 5, 'Seconds'), delay: num(0, 0, 10, 'Delay (s)') }
  },
  slidein: {
    label: 'Slide in',
    hint: 'Slides the layer into place when the screen opens. Not for auto-layout children.',
    params: { from: choice('bottom', ['bottom', 'top', 'left', 'right'], 'From'), distance: num(40, 5, 400, 'Distance (px)'), time: num(0.5, 0.1, 5, 'Seconds'), delay: num(0, 0, 10, 'Delay (s)') }
  },
  bg: {
    label: 'Background (studs, grid, pattern, image)',
    hint: 'Fills the layer with a Roblox-style background: studs, baseplate grid, checker, stripes, dots, a gradient, a Roblox Creator Store texture, or your own image. Put it on a frame; not for auto-layout frames (use a backing frame).',
    params: {
      style: choice('studs', ['studs', 'baseplate', 'grid', 'checker', 'stripes', 'dots', 'gradient', 'image'], 'Style'),
      color: color('#6b7a8f', 'Base color'),
      color2: color('#8d9db3', 'Second color'),
      size: num(24, 6, 200, 'Tile size (px)'),
      opacity: num(1, 0.05, 1, 'Opacity'),
      image: text('', 'Your image (rbxassetid://…)'),
      store: text('', 'Creator Store texture id'),
      fit: choice('tile', ['tile', 'stretch', 'fit', 'crop'], 'Image mode')
    }
  },
  aura: {
    label: 'Aura (light behind the layer)',
    hint: 'A soft colored light that glows BEHIND a character or pet and breathes. Put it on the picture layer (not inside an auto-layout frame).',
    params: {
      color: color('#b57cff', 'Inner color'),
      color2: color('#5b8cff', 'Outer color'),
      size: num(1.5, 1.05, 3, 'Size (× layer)'),
      strength: num(0.55, 0.1, 1, 'Strength'),
      shape: choice('round', ['round', 'oval'], 'Shape'),
      speed: num(1, 0.2, 4, 'Breathing speed')
    }
  },
  rays: {
    label: 'Rays (spinning light beams)',
    hint: 'Light beams that slowly spin behind the layer, like a hero spotlight. Not for auto-layout children.',
    params: {
      color: color('#fff1a8', 'Color'),
      count: num(10, 4, 24, 'Rays'),
      size: num(1.8, 1.1, 4, 'Length (× layer)'),
      strength: num(0.45, 0.1, 1, 'Strength'),
      speed: num(0.4, 0, 4, 'Spin speed')
    }
  },
  stars: {
    label: 'Stars (twinkles around it)',
    hint: 'Twinkling stars, moons, hearts or snow scattered around the layer, also outside its edges.',
    params: {
      symbol: choice('star', ['star', 'sparkle', 'moon', 'heart', 'snow', 'diamond'], 'Symbol'),
      color: color('#fff4b0', 'Color'),
      color2: color('#c9a7ff', 'Second color'),
      count: num(10, 1, 30, 'Count'),
      size: num(14, 6, 40, 'Size (px)'),
      spread: num(1.25, 1, 2, 'Spread (× layer)'),
      speed: num(1, 0.2, 4, 'Speed')
    }
  },
  halo: {
    label: 'Halo (floating ring on top)',
    hint: 'A glowing golden ring that floats above the layer, like an angel halo on a pet.',
    params: {
      color: color('#ffd54a', 'Color'),
      width: num(0.55, 0.2, 1.2, 'Width (× layer)'),
      thickness: num(4, 1, 14, 'Ring thickness (px)'),
      lift: num(0.04, -0.2, 0.5, 'Height above top (× layer)'),
      speed: num(1, 0.2, 4, 'Bob speed')
    }
  },
  orbit: {
    label: 'Orbit (orbs circling it)',
    hint: 'Glowing orbs that circle around the layer in a tilted ring.',
    params: {
      color: color('#9be7ff', 'Color'),
      color2: color('#c9a7ff', 'Second color'),
      count: num(6, 2, 16, 'Orbs'),
      size: num(10, 4, 30, 'Orb size (px)'),
      radius: num(1.15, 0.7, 2, 'Ring size (× layer)'),
      tilt: num(0.35, 0.1, 1, 'Tilt (1 = flat circle)'),
      speed: num(1, 0.2, 4, 'Speed')
    }
  },
  border: {
    label: 'Border (UI frame edge)',
    hint: 'A game-style border on the frame: solid, double, animated gradient, chasing light, neon or studded corners.',
    params: {
      style: choice('double', ['solid', 'double', 'gradient', 'chase', 'neon', 'studded'], 'Style'),
      color: color('#ffd54a', 'Color'),
      color2: color('#ff8a3d', 'Second color'),
      thickness: num(3, 1, 12, 'Thickness (px)'),
      speed: num(1, 0.2, 4, 'Speed')
    }
  },
  outline: {
    label: 'Outline (bold text border)',
    hint: 'A thick outline around text (like a title with a dark blue edge). On a frame it draws a plain border.',
    params: { color: color('#10264f', 'Color'), thickness: num(3, 1, 10, 'Thickness (px)') }
  },
  bounce: {
    label: 'Bounce (hopping)',
    hint: 'The layer hops up and down. Not for auto-layout children. Do not combine with Float.',
    params: { height: num(10, 2, 60, 'Height (px)'), speed: num(1, 0.2, 4, 'Speed') }
  },
  spin: {
    label: 'Spin (turning)',
    hint: 'The layer keeps turning around. Do not combine with Swing.',
    params: { speed: num(1, 0.2, 4, 'Speed') }
  },
  swing: {
    label: 'Swing (rocking)',
    hint: 'The layer rocks left and right like a pendulum. Do not combine with Spin.',
    params: { angle: num(8, 1, 45, 'Angle (°)'), speed: num(1, 0.2, 4, 'Speed') }
  },
  popin: {
    label: 'Pop in (grow into place)',
    hint: 'The layer pops from nothing to full size with a little overshoot when the screen opens. Do not combine with Pulse.',
    params: { time: num(0.5, 0.1, 3, 'Seconds'), delay: num(0, 0, 10, 'Delay (s)') }
  },
  flicker: {
    label: 'Flicker (neon buzz)',
    hint: 'The layer randomly dips in brightness, like a buzzing neon sign. Do not combine with Blink.',
    params: { strength: num(0.5, 0.1, 1, 'Dip depth'), speed: num(1, 0.2, 4, 'Speed') }
  },
  blink: {
    label: 'Blink (on / off)',
    hint: 'The layer blinks off for a moment every couple of seconds. Do not combine with Flicker.',
    params: { strength: num(1, 0.1, 1, 'Dip depth'), speed: num(1, 0.2, 4, 'Speed') }
  },
  shadow: {
    label: 'Shadow (button / card drop shadow)',
    hint: 'A drop shadow under the layer. Styles: soft, hard (flat 3D edge) and glow (colored). Buttons sink into it when pressed. Best on a layer in a plain frame.',
    params: {
      style: choice('soft', ['soft', 'hard', 'glow'], 'Style'),
      color: color('#000000', 'Color'),
      strength: num(0.45, 0.05, 1, 'Strength'),
      offsetY: num(6, -30, 40, 'Down (px)'),
      offsetX: num(0, -30, 30, 'Sideways (px)'),
      blur: num(8, 0, 30, 'Softness (px)')
    }
  },
  gloss: {
    label: 'Gloss (glass pane sweeping across)',
    hint: 'A glass pane with a bright edge that runs from left to right across the layer, then rests. Great on buttons.',
    params: {
      color: color('#ffffff', 'Color'),
      strength: num(0.6, 0.05, 1, 'Strength'),
      width: num(0.32, 0.1, 0.9, 'Pane width (× layer)'),
      angle: num(20, -45, 45, 'Slant (°)'),
      speed: num(1, 0.2, 4, 'Speed'),
      pause: num(1.2, 0, 10, 'Rest between (s)')
    }
  },
  glass: {
    label: 'Glass (frosted panel look)',
    hint: 'Glass-panel look: bright reflection on top, a thin light rim and a slow sweeping pane.',
    params: {
      color: color('#ffffff', 'Tint'),
      strength: num(0.35, 0.05, 1, 'Strength'),
      rim: num(1.5, 1, 6, 'Rim (px)'),
      sweep: choice('on', ['on', 'off'], 'Sweeping pane')
    }
  },
  bevel: {
    label: 'Bevel (chunky button edge)',
    hint: 'A light lip on top and a dark edge at the bottom so a flat button looks like a chunky 3D game button.',
    params: {
      color: color('#000000', 'Edge color'),
      depth: num(0.14, 0.04, 0.4, 'Edge size (× height)'),
      light: num(0.35, 0.05, 1, 'Top light')
    }
  },
  font: {
    label: 'Font (Roblox text font)',
    hint: 'Sets the Roblox font of a text layer. On a frame it changes every text inside. Figma previews the closest Google font. Fun picks: FredokaOne, LuckiestGuy, Bangers, PermanentMarker.',
    params: {
      font: choice('FredokaOne', ['Gotham', 'Montserrat', 'Nunito', 'Roboto', 'RobotoCondensed', 'Oswald', 'Ubuntu', 'TitilliumWeb', 'JosefinSans', 'FredokaOne', 'LuckiestGuy', 'Bangers', 'PermanentMarker', 'DenkOne', 'PatrickHand', 'Kalam', 'IndieFlower', 'AmaticSC', 'Creepster', 'SpecialElite', 'Fondamento', 'GrenzeGotisch', 'Merriweather', 'Michroma', 'Jura', 'Sarpanch', 'RobotoMono', 'Arcade', 'SciFi', 'Fantasy'], 'Font'),
      weight: choice('auto', ['auto', 'regular', 'medium', 'bold', 'heavy'], 'Weight'),
      italic: choice('off', ['off', 'on'], 'Italic')
    }
  },
  textwave: {
    label: 'Text wave (letters bob)',
    hint: 'Letters bob up and down one after another, like a wave. One-line text only.',
    params: { height: num(6, 1, 30, 'Height (px)'), speed: num(1, 0.2, 4, 'Speed'), spread: num(0.5, 0.1, 2, 'Gap between letters') }
  },
  textshake: {
    label: 'Text shake (trembling)',
    hint: 'Every letter trembles. Good for angry, scary or powerful titles. One-line text only.',
    params: { amount: num(2, 0.5, 10, 'Shake (px)'), speed: num(1, 0.2, 4, 'Speed') }
  },
  textpop: {
    label: 'Text pop (letters pop in)',
    hint: 'Letters pop in one by one with a little overshoot. One-line text only.',
    params: { stagger: num(0.06, 0.01, 0.5, 'Gap between letters (s)'), time: num(0.35, 0.1, 2, 'Pop time (s)'), delay: num(0, 0, 10, 'Delay (s)'), repeatMode: choice('once', ['once', 'repeat'], 'Play') }
  },
  textrainbow: {
    label: 'Text rainbow (colors roll)',
    hint: 'Colors roll through the letters. One-line text only.',
    params: { speed: num(1, 0.2, 4, 'Speed'), saturation: num(0.75, 0.1, 1, 'Color strength'), spread: num(0.06, 0, 0.3, 'Color gap between letters') }
  },
  textglitch: {
    label: 'Text glitch (broken screen)',
    hint: 'Now and then the letters tear sideways and flash two colors. One-line text only.',
    params: { color: color('#00ffff', 'Color'), color2: color('#ff00ff', 'Second color'), amount: num(4, 1, 20, 'Tear (px)'), speed: num(1, 0.2, 4, 'How often') }
  },
  textgradient: {
    label: 'Text gradient (flowing colors)',
    hint: 'A two-color gradient that flows through the text. Figma shows a still gradient.',
    params: { color: color('#ff6ad5', 'Color'), color2: color('#5bc8ff', 'Second color'), speed: num(1, 0, 4, 'Speed'), angle: num(0, -90, 90, 'Angle (°)') }
  },
  textglow: {
    label: 'Text glow (neon edge)',
    hint: 'A colored edge around the letters that pulses like neon. Do not combine with Outline.',
    params: { color: color('#7cf3ff', 'Color'), thickness: num(3, 1, 10, 'Thickness (px)'), strength: num(0.7, 0.1, 1, 'Strength'), speed: num(1, 0.2, 4, 'Speed') }
  },
  typewriter: {
    label: 'Typewriter (text)',
    hint: 'Reveals text one letter at a time. Only for text layers.',
    params: { speed: num(1, 0.2, 6, 'Speed') }
  }
};

const NAMES = Object.keys(EFFECTS);

/** Effects that fight over the same property. Only one of each pair can be on a layer: adding one replaces the other. */
const CONFLICT_PAIRS = [['pulse', 'hover'], ['float', 'bounce'], ['pulse', 'popin'], ['spin', 'swing'], ['flicker', 'blink']];
const LETTER_FX = ['textwave', 'textshake', 'textpop', 'textrainbow', 'textglitch', 'typewriter']; // all rebuild the text letter by letter: one at a time
for (let i = 0; i < LETTER_FX.length; i += 1) for (let j = i + 1; j < LETTER_FX.length; j += 1) CONFLICT_PAIRS.push([LETTER_FX[i], LETTER_FX[j]]);
for (const t of LETTER_FX.filter((x) => x !== 'typewriter')) CONFLICT_PAIRS.push(['textgradient', t]);
CONFLICT_PAIRS.push(['textglow', 'outline']);
const CONFLICTS = {};
for (const [a, b] of CONFLICT_PAIRS) {
  (CONFLICTS[a] = CONFLICTS[a] || []).push(b);
  (CONFLICTS[b] = CONFLICTS[b] || []).push(a);
}
const HEX = /^#?([0-9a-f]{6})$/i;

function normalizeHex(v, def) {
  const m = String(v || '').trim().match(HEX);
  if (m) return '#' + m[1].toLowerCase();
  const short = String(v || '').trim().match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return ('#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toLowerCase();
  return def;
}

/** Keeps only known params, clamps numbers, fills defaults. Unknown effect → null. */
function normalizeEffect(type, params) {
  const spec = EFFECTS[String(type || '').toLowerCase()];
  if (!spec) return null;
  const out = {};
  for (const [k, p] of Object.entries(spec.params)) {
    const raw = params && Object.prototype.hasOwnProperty.call(params, k) ? params[k] : undefined;
    if (p.type === 'number') {
      const n = Number(raw);
      out[k] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.def;
    } else if (p.type === 'color') {
      out[k] = normalizeHex(raw, p.def);
    } else if (p.type === 'choice') {
      out[k] = p.options.includes(String(raw)) ? String(raw) : p.def;
    } else if (p.type === 'text') {
      const t = String(raw == null ? p.def : raw).trim();
      out[k] = /^(rbxassetid:\/\/)?\d{1,19}$/.test(t) ? (t.startsWith('rbx') ? t : `rbxassetid://${t}`) : p.def;
    }
  }
  return { type: String(type).toLowerCase(), params: out };
}

/**
 * "Play button @glow @hover(amount=0.1) @wisp(color=#7cf,count=10)"
 * → { cleanName: "Play button", effects: [{type, params}, …], button: false, … }
 *
 * Behaviour tags (Framewisp style, written with @ or _ in front):
 *   @button  @scroll  @ignore  @image   structure
 *   @close  @open:Name  @toggle:Name  @panel   menus & buttons
 *   @tabgroup  @tab:Name  @active   tabs
 * They are not effects. Names after ":" may contain letters, digits, "_" and "-".
 */
const BEHAVIOR_TAGS = ['button', 'scroll', 'ignore', 'image', 'export', 'close', 'open', 'toggle', 'panel', 'tabgroup', 'tab', 'active'];

function parseLayerTags(rawName) {
  const name = String(rawName || '');
  const effects = [];
  const out = { button: false, image: false, ignore: false, scroll: false, panel: false, close: false, tabgroup: false, active: false, open: null, toggle: null, tab: null };
  const reAt = /@([a-zA-Z]+)(?::([\w-]+))?(?:\(([^)]*)\))?/g;
  const reUnder = new RegExp(`(^|\\s)_(${BEHAVIOR_TAGS.join('|')})(?::([\\w-]+))?(?=\\s|$)`, 'gi');
  const apply = (tagRaw, arg) => {
    const tag = tagRaw.toLowerCase();
    if (tag === 'image' || tag === 'export') out.image = true;
    else if (['button', 'scroll', 'ignore', 'panel', 'close', 'tabgroup', 'active'].includes(tag)) out[tag] = true;
    else if (['open', 'toggle', 'tab'].includes(tag)) { if (arg) out[tag] = arg; }
    else return false;
    return true;
  };
  let m;
  while ((m = reAt.exec(name))) {
    const tag = m[1].toLowerCase();
    if (apply(tag, m[2])) continue;
    if (!EFFECTS[tag]) continue;
    const params = {};
    for (const part of String(m[3] || '').split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    const eff = normalizeEffect(tag, params);
    if (eff) effects.push(eff);
  }
  while ((m = reUnder.exec(name))) apply(m[2], m[3]);
  const cleanName = name.replace(reAt, (all, t) => (BEHAVIOR_TAGS.includes(t.toLowerCase()) || EFFECTS[t.toLowerCase()] ? '' : all))
    .replace(reUnder, ' ').replace(/\s{2,}/g, ' ').trim() || 'Layer';
  // a layer that reacts to clicks must be a button
  const clickable = out.button || out.close || Boolean(out.open) || Boolean(out.toggle) || Boolean(out.tab);
  const behaviors = [];
  for (const k of ['button', 'scroll', 'panel', 'close', 'tabgroup', 'active']) if (out[k]) behaviors.push(k);
  for (const k of ['open', 'toggle', 'tab']) if (out[k]) behaviors.push(`${k}:${out[k]}`);
  return { cleanName, effects, ...out, clickable, behaviors };
}

/** Summary for the page (no functions). */
function catalog() {
  return NAMES.map((id) => ({ id, label: EFFECTS[id].label, hint: EFFECTS[id].hint, params: EFFECTS[id].params, conflicts: CONFLICTS[id] || [] }));
}

module.exports = { EFFECTS, NAMES, CONFLICTS, BEHAVIOR_TAGS, normalizeEffect, parseLayerTags, catalog, normalizeHex };
