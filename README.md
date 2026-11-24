# Pixelworks Bridge (cloud)

Figma plugin  ->  this server on Render (https)  ->  Roblox Studio plugin.
The desktop app does not need to be open. Your Roblox key stays on the server. Everything except `/health` needs the username and password.

## What is in this folder
| Path | What it is |
|---|---|
| `server.js`, `src/` | the bridge server (no npm packages needed) |
| `figma-plugin/` | the Figma plugin, with a "Connection" box for the address + login |
| `studio-plugin/FigmaToStudio.lua` | the Studio plugin, with a "Connection" section |
| `render.yaml` | tells Render how to run the server |
| `.github/workflows/keep-awake.yml` | the bot that visits the server every 5 minutes |

## 1. Put it on GitHub
Create a repo, upload everything in this folder (not `.env`). Public is simplest for the keep-awake bot, and it is safe because no secrets are in the files.

## 2. Create the server on Render
1. render.com > New > Blueprint (or Web Service) > pick your repo. Plan: Free.
2. Set the environment variables:
   - `BRIDGE_USER`: a username you choose
   - `BRIDGE_PASSWORD`: a long password you choose (8+ characters)
   - `ROBLOX_API_KEY`: Open Cloud key with the Assets API (read + write)
   - `ROBLOX_CREATOR_ID`: your Roblox user ID (or group ID, with `ROBLOX_CREATOR_TYPE=group`)
3. After deploy you get `https://something.onrender.com`. Open `/health` in a browser: it should say `ok`.

## 3. Keep it awake (free plan)
In the GitHub repo: Settings > Secrets and variables > Actions > Variables > add `BRIDGE_URL` = your Render address. The workflow then visits `/health` every 5 minutes. (GitHub may run it late, and may switch off scheduled runs in a public repo after about 60 days without activity: push any small change to turn it back on.) Render's paid plan never sleeps and needs no bot.

## 4. Install the plugins
- Figma: Plugins > Development > Import plugin from manifest > `figma-plugin/manifest.json`. Run it, open "Connection", type the address, username and password, Save. The manifest allows `https://*.onrender.com`; for a custom domain, add it under `allowedDomains` in `manifest.json`.
- Studio: copy `studio-plugin/FigmaToStudio.lua` into your Plugins folder as a plugin (same way you installed the old one). Allow HTTP when Studio asks. Open the plugin, "Connection", same address, username, password, Save, Refresh.

## Limits to know
- Free Render sleeps after 15 minutes without traffic and takes about a minute to wake. The Figma plugin pings every 2 seconds while it is open, which also keeps it awake.
- Saved designs and the picture cache live in memory / a temp file. A restart or redeploy clears them: send again from Figma.
- Roblox allows a limited number of uploads a month and reviews every new image. `MAX_UPLOADS_PER_SEND` (default 30) caps one send. The old desktop app asked "Upload N pictures?" first; the cloud bridge does not ask, so check the Figma plugin's picture count before sending.
- After 8 wrong logins from one address the bridge locks that address for 15 minutes.
- The password is saved on your computer in Figma's and Studio's plugin storage.
