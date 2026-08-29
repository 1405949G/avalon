# Avalon — Quest of Shadows

Static, instant-load Avalon with real cross-device sync.

## Host for free

### Option A — Cloudflare Pages (recommended, works for phones on any network)

1. Push this folder to GitHub
2. Cloudflare Dashboard → Pages → Create project → Connect to GitHub → Build settings: **Framework preset: None**, **Build command: (empty)**, **Output directory: `.`** (or `/`)
3. After first deploy: Pages → Settings → Functions → KV namespace bindings → Create namespace `AVALON_ROOMS` → Bind variable `AVALON_ROOMS` → Save → Redeploy
4. Your game is live at `https://<your-pages>.pages.dev` — share `?room=XXXX` links, cross-device works globally.

Local preview with KV:
```bash
npx wrangler pages dev . --kv AVALON_ROOMS
```

### Option B — Same WiFi (no Cloudflare, just local)

```bash
python serve.py 8000
# On phones: http://192.168.0.14:8000  (see ipconfig)
```

`serve.py` serves correct `application/javascript` MIME + `/api/room/<code>` for cross-device on same WiFi. `npx serve` has correct MIME but **no API** — joining will fail across devices.

## API

- `GET /api/room/EQKH` → `{code, players, state, hostId}`
- `POST /api/room/EQKH` body `{players, state}` → stored 6h

Works on both `serve.py` (in-memory) and Cloudflare Pages Functions (`functions/api/room/[code].js` with KV).

## Theme

Dark Table Party palette — solid `#0a1e2e` background, cards `#142a3d` / `#29546c` / `#0f2231`. No light toggle — always dark for readability and screenshot fidelity.
