'use strict';
// Uploads one PNG/JPEG to your Roblox account with the Open Cloud Assets API and returns { assetId }.
// Trimmed copy from the Pixelworks desktop app (the 3D model upload was removed).
const BASE = 'https://apis.roblox.com/assets/v1';
const MAX_BYTES = 20 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function explain(status, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body || {});
  const msg = (body && (body.message || body.error || body.errors?.[0]?.message)) || raw.slice(0, 200);
  if (status === 401) return `Roblox rejected the API key (401). Re-paste the key in Settings. ${msg}`;
  if (status === 403) return `Roblox says this key may not upload (403). Give the key the “Assets” API with Read + Write permission, and make sure the creator ID matches the key owner. ${msg}`;
  if (status === 429) return 'Roblox rate-limited the upload (429). Wait a minute and try again.';
  return `Roblox upload failed (HTTP ${status}). ${msg}`;
}

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** Uploads one PNG/JPEG (a Buffer) as an Image asset and returns { assetId }. Same operation polling as models. */
async function uploadImage({ apiKey, creatorType, creatorId, buffer, ext = '.png', displayName, fetchImpl = fetch, pollMs = 1500, maxWaitMs = 60000 }) {
  if (!apiKey) throw new Error('No Roblox Open Cloud key saved. Add one in Settings.');
  const id = String(creatorId || '').trim();
  if (!/^\d{1,19}$/.test(id)) throw new Error('Enter your Roblox user ID (or group ID) first.');
  if (!IMAGE_MIME[ext]) throw new Error('Only PNG and JPEG images can be uploaded.');
  if (!buffer || buffer.length > MAX_BYTES) throw new Error('The image is empty or over Roblox’s 20 MB limit.');
  const creator = creatorType === 'group' ? { groupId: id } : { userId: id };
  const form = new FormData();
  form.append('request', JSON.stringify({
    assetType: 'Image',
    displayName: String(displayName || 'Figma image').replace(/[^\w .-]+/g, ' ').trim().slice(0, 50) || 'Figma image',
    description: 'Imported from Figma with Pixelworks AI Office',
    creationContext: { creator }
  }));
  form.append('fileContent', new Blob([buffer], { type: IMAGE_MIME[ext] }), `image${ext}`);
  const res = await fetchImpl(`${BASE}/assets`, { method: 'POST', headers: { 'x-api-key': apiKey }, body: form, signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(explain(res.status, body));
  const opId = String(body?.path || '').replace(/^operations\//, '');
  if (!/^[A-Za-z0-9._-]+$/.test(opId)) throw new Error('Roblox accepted the image but did not return an operation id.');
  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    await sleep(pollMs);
    const r = await fetchImpl(`${BASE}/operations/${opId}`, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    let b; try { b = JSON.parse(t); } catch { b = t; }
    if (!r.ok) throw new Error(explain(r.status, b));
    if (b?.done) {
      if (b.error) throw new Error(`Roblox could not import the image: ${b.error.message || JSON.stringify(b.error)}`);
      const assetId = String(b.response?.assetId || '').trim();
      if (!/^\d+$/.test(assetId)) throw new Error('Roblox finished but returned no asset id.');
      return { assetId: Number(assetId) };
    }
  }
  throw new Error('Roblox is still processing an image. It may appear in your Creator Dashboard shortly.');
}

module.exports = { uploadImage, MAX_BYTES };
