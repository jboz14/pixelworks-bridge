'use strict';
/**
 * Pixelworks Bridge (cloud version).
 * The same small server the desktop app runs on 127.0.0.1:4871, trimmed to what Figma -> Roblox Studio needs, so it can live on
 * Render (https) and work without the desktop app being open.
 *
 *   Figma plugin  --POST /figma-bridge/gui-->  this server (uploads pictures to Roblox)  <--GET /figma-bridge/gui--  Studio plugin
 *
 * Every route except /health needs the username and password (HTTP Basic login).
 * Your Roblox key lives only in this server's environment variables.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const figmaEffects = require('./src/figma-effects');
const helpers = require('./src/helpers');
const robloxUpload = require('./src/roblox-upload');

const PORT = Number(process.env.PORT) || 4871;
const USER = String(process.env.BRIDGE_USER || '');
const PASS = String(process.env.BRIDGE_PASSWORD || '');
const ROBLOX_KEY = String(process.env.ROBLOX_API_KEY || '');
const CREATOR_ID = String(process.env.ROBLOX_CREATOR_ID || '').trim();
const CREATOR_TYPE = String(process.env.ROBLOX_CREATOR_TYPE || 'user').toLowerCase() === 'group' ? 'group' : 'user';
const MAX_UPLOADS_PER_SEND = Math.max(0, Number(process.env.MAX_UPLOADS_PER_SEND) || 30);
const MAX_BODY = 25 * 1024 * 1024;

if (!USER || PASS.length < 8) {
  console.error('Set BRIDGE_USER and BRIDGE_PASSWORD (at least 8 characters) in the environment before starting.');
  process.exit(1);
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const USER_HASH = sha(USER);
const PASS_HASH = sha(PASS);

/* ---- login: HTTP Basic, compared in constant time, with a lock-out after repeated wrong tries ---- */
const fails = new Map(); // ip -> { n, until }
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function checkLogin(req) {
  const ip = clientIp(req);
  const f = fails.get(ip);
  if (f && f.until > Date.now()) return 'locked';
  const m = String(req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  let ok = false;
  if (m) {
    const raw = Buffer.from(m[1], 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i >= 0) {
      const a = crypto.timingSafeEqual(sha(raw.slice(0, i)), USER_HASH);
      const b = crypto.timingSafeEqual(sha(raw.slice(i + 1)), PASS_HASH);
      ok = a && b;
    }
  }
  if (ok) { fails.delete(ip); return 'ok'; }
  const n = ((f && f.n) || 0) + 1;
  fails.set(ip, { n, until: n >= 8 ? Date.now() + 15 * 60 * 1000 : 0 });
  if (fails.size > 500) fails.clear();
  return 'bad';
}

/* ---- state (in memory: a restart or a redeploy clears it, which is fine because designs are imported within minutes) ---- */
const state = {
  lastSeen: 0,
  context: null,
  gui: null,          // { json, v, at, fetchedAt, req }
  guiBusy: null,
  guiErr: null,
  guiReq: null,       // a Studio request for frames, answered by the Figma plugin
  guiReqId: 0,
  live: { v: 0, json: null, polled: 0 },
  imageCache: new Map() // sha1 of the picture -> Roblox asset id (saves uploads while the server stays awake)
};
const connected = () => Date.now() - state.lastSeen < 10000;

const CACHE_FILE = path.join(process.env.DATA_DIR || __dirname, 'image-cache.json');
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')))) state.imageCache.set(k, String(v)); } catch { /* first run */ }
const saveCache = () => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(state.imageCache))); } catch { /* optional */ } };

/** Uploads the pictures the Figma plugin sent and returns { ids, notes }. Same picture twice = same asset. */
async function uploadGuiImages(items) {
  const ids = {};
  const notes = [];
  if (!ROBLOX_KEY || !CREATOR_ID) {
    return { ids, notes: ['Pictures were not uploaded: the bridge has no ROBLOX_API_KEY / ROBLOX_CREATOR_ID set.'] };
  }
  const list = [];
  for (const it of items) {
    const buf = Buffer.from(String(it.b64 || ''), 'base64');
    if (!buf.length || buf.length > 8 * 1024 * 1024) continue;
    const key = crypto.createHash('sha1').update(buf).digest('hex');
    const known = state.imageCache.get(key);
    if (known) ids[it.key] = known; else list.push({ key: it.key, name: String(it.name || it.key), buf, sha: key });
  }
  const todo = list.slice(0, MAX_UPLOADS_PER_SEND);
  if (list.length > todo.length) notes.push(`${list.length - todo.length} picture(s) were skipped: this bridge uploads at most ${MAX_UPLOADS_PER_SEND} new pictures per send (MAX_UPLOADS_PER_SEND).`);
  let done = 0;
  for (const it of todo) {
    state.guiBusy = { text: `Uploading picture ${done + 1}/${todo.length} to Roblox…` };
    try {
      const r = await robloxUpload.uploadImage({ apiKey: ROBLOX_KEY, creatorType: CREATOR_TYPE, creatorId: CREATOR_ID, buffer: it.buf, ext: '.png', displayName: `Figma ${it.name}`.slice(0, 50) });
      state.imageCache.set(it.sha, String(r.assetId));
      ids[it.key] = String(r.assetId);
      done += 1;
    } catch (e) {
      notes.push(`"${it.name}" was not uploaded: ${String((e && e.message) || e).slice(0, 120)}`);
      if (/401|403|429/.test(String((e && e.message) || e))) break;
    }
  }
  if (done) { saveCache(); notes.unshift(`${done} picture(s) uploaded.`); }
  return { ids, notes };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (ch) => {
      size += ch.length;
      if (size > limit) { reject(new Error('too big')); req.destroy(); return; }
      body += ch;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const send = (code, body) => { res.writeHead(code, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const sendRaw = (code, type, data) => { res.writeHead(code, { ...CORS, 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(data); };
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const u = new URL(req.url, 'http://localhost');
  const url = u.pathname;
  const q = u.searchParams;

  if (req.method === 'GET' && (url === '/health' || url === '/')) { return sendRaw(200, 'text/plain; charset=utf-8', 'ok'); }   // no login: the keep-awake ping uses this

  const login = checkLogin(req);
  if (login === 'locked') return send(429, { error: 'Too many wrong logins. Try again in 15 minutes.' });
  if (login !== 'ok') {
    res.writeHead(401, { ...CORS, 'WWW-Authenticate': 'Basic realm="Pixelworks Bridge", charset="UTF-8"', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Wrong username or password.' }));
    return;
  }

  try {
    // ---- the Figma plugin's heartbeat, file list and effect catalog ----
    if (req.method === 'GET' && url === '/figma-bridge/next') {   // the desktop app queues AI designs here; the cloud bridge has none
      state.lastSeen = Date.now();
      return send(200, { id: null, needContext: !state.context });
    }
    if (req.method === 'GET' && url === '/figma-bridge/ping') { state.lastSeen = Date.now(); return send(200, { ok: true }); }
    if (req.method === 'GET' && url === '/figma-bridge/catalog') {
      state.lastSeen = Date.now();
      return send(200, { effects: figmaEffects.catalog(), behaviors: figmaEffects.BEHAVIOR_TAGS });
    }
    if (req.method === 'POST' && url === '/figma-bridge/context') {
      const body = await readBody(req, 60000);
      try { state.lastSeen = Date.now(); state.context = helpers.sanitizeContext(JSON.parse(body || '{}')); } catch { /* ignore a bad body */ }
      return send(200, { ok: true });
    }
    if (req.method === 'POST' && url === '/figma-bridge/done') { await readBody(req, 20000); state.lastSeen = Date.now(); return send(200, { ok: true }); }

    // ---- icons and Creator Store textures ----
    if (req.method === 'GET' && url === '/figma-bridge/icons') return send(200, await helpers.searchIcons(q.get('q') || ''));
    if (req.method === 'GET' && url === '/figma-bridge/icon') return sendRaw(200, 'image/svg+xml', await helpers.fetchIconSvg(q.get('id'), q.get('color'), q.get('size')));
    if (req.method === 'GET' && url === '/figma-bridge/store-search') return send(200, await helpers.searchStore(ROBLOX_KEY, q.get('q') || ''));
    if (req.method === 'GET' && url === '/figma-bridge/thumb') return sendRaw(200, 'image/png', await helpers.fetchThumb(q.get('id'), q.get('size')));

    // ---- pop-out live preview (opens in a browser; the browser asks for the login) ----
    if (req.method === 'GET' && url === '/figma-bridge/live') {
      return sendRaw(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, 'figma-plugin', 'ui.html'), 'utf8'));
    }
    if (req.method === 'POST' && url === '/figma-bridge/live') {
      const body = await readBody(req, MAX_BODY);
      if (body.length) { state.live.json = body; state.live.v += 1; }
      return send(200, { ok: true, viewing: Date.now() - state.live.polled < 5000 });
    }
    if (req.method === 'GET' && url === '/figma-bridge/live/data') {
      state.live.polled = Date.now();
      const v = Number(q.get('v')) || 0;
      if (!state.live.json || v === state.live.v) return send(200, { v: state.live.v, same: true });
      return sendRaw(200, 'application/json', '{"v":' + state.live.v + ',"data":' + state.live.json + '}');
    }

    // ---- Send to Roblox Studio: the Figma plugin posts the frame data, the Studio plugin fetches it ----
    if (req.method === 'POST' && url === '/figma-bridge/gui') {
      let body;
      try { body = await readBody(req, MAX_BODY); } catch { return send(413, { error: 'That design is too big (25 MB limit).' }); }
      let j;
      try { j = JSON.parse(body || '{}'); } catch { return send(400, { error: 'That was not valid frame data.' }); }
      if (!j || !Array.isArray(j.screens) || !j.screens.length) return send(400, { error: 'No frames in that data.' });
      const rq = Number(q.get('req')) || 0;
      if (Array.isArray(j.images) && j.images.length) {
        state.guiBusy = { req: rq, text: 'Uploading ' + j.images.length + ' picture(s) to Roblox…' };
        try {
          const r = await uploadGuiImages(j.images.slice(0, 60));
          j.imageIds = r.ids || {}; j.imageNotes = r.notes || [];
        } catch (e) { j.imageIds = {}; j.imageNotes = ['Pictures were not uploaded: ' + String((e && e.message) || e).slice(0, 160)]; }
        state.guiBusy = null;
        delete j.images;
        body = JSON.stringify(j);
      }
      state.gui = { json: body, v: (state.gui ? state.gui.v : 0) + 1, at: Date.now(), fetchedAt: 0, req: rq };
      state.lastSeen = Date.now();
      return send(200, { ok: true, v: state.gui.v });
    }
    if (req.method === 'GET' && url === '/figma-bridge/gui') {   // polled by the Roblox Studio plugin
      const g = state.gui;
      if (!g) return send(200, { v: 0, empty: true });
      const v = Number(q.get('v')) || 0;
      if (v === g.v) return send(200, { v: g.v, same: true });
      g.fetchedAt = Date.now();
      return sendRaw(200, 'application/json', '{"v":' + g.v + ',"data":' + g.json + '}');
    }
    if (req.method === 'GET' && url === '/figma-bridge/gui/status') {
      const g = state.gui;
      return send(200, { has: !!g, v: g ? g.v : 0, req: g ? g.req || 0 : 0, at: g ? g.at : 0, fetchedAt: g ? g.fetchedAt : 0, err: state.guiErr || null, busy: state.guiBusy ? state.guiBusy.text : null });
    }

    // ---- pick frames from inside Studio: the Studio plugin asks, the Figma plugin (polling) answers ----
    if (req.method === 'GET' && url === '/figma-bridge/frames') return send(200, { connected: connected(), context: state.context || null });
    if (req.method === 'POST' && url === '/figma-bridge/gui-request') {
      const body = await readBody(req, 20000);
      let j;
      try { j = JSON.parse(body || '{}'); } catch { return send(400, { error: 'That was not a valid request.' }); }
      const ids = (Array.isArray(j.ids) ? j.ids : []).map(String).filter((id) => helpers.NODE_ID.test(id)).slice(0, 50);
      if (!ids.length) return send(400, { error: 'No frames picked.' });
      state.guiReqId += 1;
      state.guiReq = { id: state.guiReqId, ids, at: Date.now(), taken: false };
      state.guiErr = null;
      return send(200, { ok: true, id: state.guiReqId, pluginConnected: connected() });
    }
    if (req.method === 'GET' && url === '/figma-bridge/gui-request') {   // polled by the Figma plugin
      const r = state.guiReq;
      if (r && !r.taken && Date.now() - r.at < 30000) { r.taken = true; return send(200, { id: r.id, ids: r.ids }); }
      return send(200, { id: null });
    }
    if (req.method === 'POST' && url === '/figma-bridge/gui-error') {
      const body = await readBody(req, 5000);
      try { const j = JSON.parse(body || '{}'); state.guiErr = { req: Number(j.req) || 0, error: String(j.error || 'unknown error').slice(0, 200) }; } catch { /* ignore */ }
      return send(200, { ok: true });
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    return send(502, { error: String((e && e.message) || e).slice(0, 300) });
  }
}

http.createServer((req, res) => { handle(req, res).catch((e) => { try { res.writeHead(500); res.end(String(e && e.message || e)); } catch { /* closed */ } }); })
  .listen(PORT, () => console.log(`Pixelworks Bridge listening on ${PORT}`));
