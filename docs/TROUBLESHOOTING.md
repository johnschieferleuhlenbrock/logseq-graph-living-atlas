# Troubleshooting

## `npx logseq-graph-living-atlas` Is Not Found

Confirm npm can see the package:

```bash
npm view logseq-graph-living-atlas version
```

If the package is not available yet, run from source:

```bash
git clone https://github.com/johnschieferleuhlenbrock/logseq-graph-living-atlas.git
cd logseq-graph-living-atlas
npm install
npm run demo
```

## Missing `pages/`

`--root` must point at the Logseq graph folder, not the `pages/` folder:

```text
my-logseq-graph/
  pages/
  journals/
```

Check it with:

```bash
ls /absolute/path/to/my-logseq-graph/pages
```

## Port Already In Use

Use another local port:

```bash
living-atlas --root /absolute/path/to/logseq --port 8790
```

## `401` From `/api/*`

Real graph reads are token-protected by default. Open the `#token=...` URL printed by the service, or provide your own:

```bash
LIVING_ATLAS_TOKEN=<random-local-token> living-atlas --root /absolute/path/to/logseq
```

PowerShell:

```powershell
$env:LIVING_ATLAS_TOKEN = "<random-local-token>"
living-atlas --root "D:\LogseqGraph"
```

For fixture-only local experiments, you can opt out:

```bash
living-atlas --root /path/to/public-fixture --allow-unauthenticated-read
```

## Split Dev CORS

When running Vite and the API separately, allow the local Vite origin and open the token URL:

```bash
LIVING_ATLAS_TOKEN=<random-local-token> npm run dev:api -- --root /absolute/path/to/logseq --allowed-origin http://127.0.0.1:5177
npm run dev
```

Open `http://127.0.0.1:5177/#token=<random-local-token>`.

PowerShell:

```powershell
$env:LIVING_ATLAS_TOKEN = "<random-local-token>"
npm run dev:api -- --root "D:\LogseqGraph" --allowed-origin http://127.0.0.1:5177
npm run dev
```

## MCP Changes Do Not Appear In Atlas

Confirm both processes point at the same graph root:

```bash
living-atlas --root /absolute/path/to/logseq
npx logseq-graph-mcp --root /absolute/path/to/logseq --readonly
```

Atlas does not subscribe to the MCP protocol directly. It sees MCP writes as filesystem changes, so either keep Atlas running with `--watch` or call `POST /api/reindex` after a guarded MCP write. If you use a custom cache path, keep the cache outside the graph folder.

Run the public compatibility smoke when debugging install or path issues:

```bash
npm run smoke:mcp
```

## Blank Or Unsupported WebGL

Living Atlas needs WebGL for the cinematic field. If WebGL is unavailable, the app should show the fallback graph-inspection panel with totals, top regions, and high-signal pages.

Try another browser, disable low-power/restricted graphics settings, or run the fixture smoke path:

```bash
npm run demo
```

## UI Smoke Test Browser Missing

Install the Playwright browser once:

```bash
npx playwright install chromium
```

On Linux CI-like systems:

```bash
npx playwright install --with-deps chromium
```

## Safe Bug Reports

Do not attach real graph files, private screenshots, cache files, token URLs, or terminal output containing local paths. Reproduce with the public fixture whenever possible:

```bash
npm run demo
npm run test:ui
```

For API-shaped bug reports from a real graph, request redacted JSON:

```bash
curl -H "Authorization: Bearer <token>" "http://127.0.0.1:8787/api/snapshot?redact=1"
```
