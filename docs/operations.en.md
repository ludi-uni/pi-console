# Operations and development (Windows)

[Home](../README.en.md) · [日本語](operations.ja.md) · [Using Pi Console](usage.en.md)

## Installation

Requires Node.js 24+ and a compatible Pi SDK (0.99.2 / 1.0.0 / 1.0.2). Besides the [published package](../README.en.md#quick-start), you can register a source checkout as a local Pi package:

```powershell
npm install
npm run build                     # build dist/
pi install (Resolve-Path .).Path  # register this folder in Pi
pi list                           # confirm registration
```

Restart Pi or run `/reload`, then start `/pi-console`. The checkout and built `dist/` must remain available. `dist/` is not committed, so installing directly from the git URL is not supported. The published npm tarball contains the built browser assets and Pi installs its runtime dependencies. Installation alone does not connect or start the server; until a session is selected the Web status reads `Server ready · no Pi session`.

You can also manage the same server without Pi, from any directory:

```powershell
# from a source checkout or an installed package folder
.\scripts\pi-console.ps1 start          # or: node package\pi-console.mjs start
.\scripts\pi-console.ps1 status
.\scripts\pi-console.ps1 stop
.\scripts\pi-console.ps1 restart 31718 # restart on a chosen port
.\scripts\pi-console.ps1 port          # print the configured port
```

For standalone use without the Pi package, install `@earendil-works/pi-coding-agent` and configure a Pi model:

```powershell
npm install
npm run build
npm start  # loads optional repo-root .env (Node 24)
# in local mode, open http://127.0.0.1:31717
```

If Pi CLI discovery fails, set `PI_CONSOLE_PI_COMMAND` to the absolute path of Pi's `dist/bundle/cli.js` (not `pi.cmd`). Package startup never reads an arbitrary workspace's `.env`; it explicitly reads the stable Console file described below.

### `.env` for Pi and Windows Startup

Both `/pi-console` and Windows Startup read `~/.pi/agent/pi-console/.env` by default (`%USERPROFILE%\.pi\agent\pi-console\.env` on Windows). It lives outside the replaceable npm package and survives Console upgrades. To edit the default location:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.pi\agent\pi-console" | Out-Null
notepad "$env:USERPROFILE\.pi\agent\pi-console\.env"
```

Example remote configuration (replace every value with your actual configuration):

```dotenv
PI_CONSOLE_PUBLIC_ORIGIN=https://console.example.com
PI_CONSOLE_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
PI_CONSOLE_ACCESS_AUD=your-application-audience-tag
# Optional; match the Tunnel's origin port.
PORT=31717
```

- An incoming `PI_CONSOLE_DATA_DIR` selects `<that directory>/.env`. Otherwise an incoming `PI_CODING_AGENT_DIR` selects `<agent directory>/pi-console/.env`. **Set these location selectors in the environment that starts Pi/Windows Startup, not inside the file.** Loading a file does not recursively discover another one.
- Explicit process environment values override file values, including empty strings. An explicit `/pi-console 31718` also overrides the file's `PORT`. If edits seem ignored, check for stale variables in the launching process.
- A missing file keeps environment-only startup. Read errors fail startup; partially configured Cloudflare variables also refuse startup. Do not disable authentication to work around configuration errors.
- Restart Console and reload the browser after editing. Use `/pi-console restart` (or `pi-console.ps1 restart`) and reload the browser — restart interrupts active Web sessions. A server started by an older, unmanaged version must still be stopped from its own process; the new manager reports it but never kills it.
- Only trusted operators should edit this file. Do not store it inside a workspace/npm package or commit real values to a public repository. Use `C:/...` for Windows paths: Node's double-quoted `.env` syntax interprets `\n` as a newline.

Standalone `npm start` / `npm run dev` still load the repository-root `.env`; the stable file above is for Pi-package and Windows Startup launches. See the [Cloudflare guide](cloudflare-access.md) for Tunnel Host and authentication settings.

## Security and startup

The default server binds only to `127.0.0.1` without authentication. Do not expose it through a LAN or unprotected tunnel. The separate protected remote mode requires Cloudflare Tunnel + Access, verifies signed Access JWTs on every request, and still binds only to loopback. Follow [Cloudflare Tunnel + Access](cloudflare-access.md) before configuring a hostname.

Since 0.4.3 the server is an **independent background process**: `/pi-console start`, the `pi-console.ps1` CLI and Windows Startup all launch the same detached server through a shared manager, so it survives Pi exit, `/reload` and even a crashed Pi. `/pi-console stop` (or `pi-console.ps1 stop`) shuts it down from any of them. In 0.5.0 each Web session uses a Console-owned SDK worker, loading the public SDK from the selected Pi installation rather than standard CLI RPC. History comes directly from Pi's session projection, without injecting a history prompt. Bidirectional chunk transport preserves oversized final, aggregate and tool events and image-bearing commands. The existing 8 MiB JSONL parser guard is unchanged; transport frames are at most 64 KiB, with 32 KiB raw chunks, generation/sequence checks and SHA-256 integrity. Delta events omit cumulative assistant snapshots; final events retain their full content.

The worker uses normal Pi user settings/resources, session storage, codemode, tool search, MCP and the Console report-safety extension. Project resources load only after trust resolution: bootstrap user-extension hooks, saved Pi trust decisions and an explicit global `defaultProjectTrust: "always"` are honored; otherwise unconfirmed projects are denied. Remembering a new trust decision through an extension is refused — confirm it in Pi CLI instead. Unsupported dialogs safely cancel, and session creation/switching/fork/tree navigation from extensions explicitly fail; use Console's session controls. Unsupported SDK versions or missing safety extensions fail startup, with no automatic legacy RPC fallback. `PI_CONSOLE_WORKER_COMMAND` is an explicit test-fixture seam, not a compatibility workaround.

Before extensions load, Console passes the verified selected SDK installation as the worker-local `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT`. The SDK worker's entry script is not the Pi CLI, and global npm installations are invisible to ordinary extension-relative module resolution. This prevents background subagents from reporting `neither is available` when Pi is actually installed. A stale inherited host override is replaced with the installation selected by `PI_CONSOLE_PI_COMMAND`, without mutating the server environment. Applying this fix requires restarting Console and its workers; first confirm that active work may be interrupted. Missing host dependencies, unsupported SDK versions and provider authentication failures remain separate errors, not bypassed by this locator.

Transport is bounded: 192 MiB per logical JSON record, 256 MiB queued serialized output, 64 pending commands / 256 MiB pending command bytes, 60-second incomplete-transfer timeout and 15-second write timeout. There is one in-flight transfer per direction; messages are published only after complete validation. Overflow, malformed input, timeout or disconnect fails closed rather than truncating. Whole-record JSON serialization/reassembly still allocates memory; this is not a disk-spooled transport. Abort releases SDK pressure listeners without dropping queued records. Console's durable FIFO, attachment/body limits and uncertain-delivery hold/no-auto-resend rules remain unchanged.

Managed state lives in the Console data directory, not the package: `server-state.json` (pid/port), `server-token` (a per-start random management secret) and `server.log` (server output). Identity verifies a fresh HMAC challenge response plus PID and start time; shutdown also requires an HMAC proof — the token is never sent on the wire. Stale management state may be safely cleared, but recycled PIDs and foreign listeners receive no shutdown request. Old or unreadable `server.lock` files are never automatically removed: remove only that lock manually after confirming that no management command is running. The manager never kills a process it cannot prove is its own, and has no signal fallback at all: a managed server that does not exit within the shutdown window is reported `stopping`, never SIGTERM'd. Management routes additionally reject requests carrying proxy/tunnel headers even with a loopback Host.

`/pi-console restart` (or `pi-console.ps1 restart`) stops then starts the managed server and interrupts every active Web session. On Windows, **Settings → Start with Windows** installs or removes the current user's Startup shortcut; the Startup entry runs the same manager, so a login start joins the running server instead of duplicating it. Pi has no post-install hook, so the extension installs the shortcut when first loaded in a trusted interactive Pi session (or use **Install now**).

## Storage and model configuration

| Data | Location and ownership |
| --- | --- |
| Pi package / Windows Startup workspace registrations and quick prompts | `~/.pi/agent/pi-console/workspaces.json`, or under `PI_CODING_AGENT_DIR`; override explicitly with `PI_CONSOLE_DATA_DIR`. |
| Console-owned queued prompts | `queue/<sessionId>.json` in the same directory; includes prompt and attachment contents. Restart restores held items requiring explicit Resume. |
| Prompt delivery receipts | `prompt-receipts/<requestId>.json` in the same directory; stores a payload hash and acknowledgement outcome, not prompt or attachment contents. Prevents redispatching the same request ID across restarts. |
| Automatic session cleanup settings | `session-retention.json` in the same stable data directory. |
| Managed-server state, token and log | `server-state.json`, `server-token`, `server.log` in the same directory; the token is a local-only random secret, regenerated every start. |
| Standalone `npm start` | `.pi-console/` in the working directory by default. |
| Pi conversations | Pi's session directory; override with `PI_CODING_AGENT_SESSION_DIR`. Browser reconnects do not remove them. |
| Appearance and other browser preferences | Stored in the browser; not shared with pi-web. |

If a submission loses its HTTP acknowledgement, the browser displays an unconfirmed-delivery warning. **Check delivery · same request** uses the persisted request ID, text and attachments rather than creating another submission. If the server could not persist the acknowledgement, it refuses to dispatch that request again and requires history inspection and explicit manual resolution. Receipts are not automatically removed; deleting them removes deduplication for old requests. Legacy API clients that omit the request ID do not get this deduplication.

Browser drafts also retain unacknowledged submissions. Cross-tab writes compare revisions, preventing stale tabs from overwriting newer drafts. A conflicting tab keeps its local text and files in memory and asks before loading the saved draft. Copy unsaved input somewhere safe before choosing **Load saved draft**.

**Before upgrading an older Windows Startup installation, follow the [backup and migration procedure](upgrade-storage.md).** npm may remove the former package-local `.pi-console/` before new code can read it.

Pi owns chat history; the Orchestrator's existing SQLite owns kit run history. Canonical event history and observed foreground child progress are in memory. The ludi-agent-kit npm Pi package is auto-detected; optional `PI_CONSOLE_KIT_ROOT` overrides discovery and `PI_CONSOLE_ORCHESTRATOR_STORE` selects a nondefault kit DB. The status adapter reads these sources without modifying their records. Explicitly choosing the kit send target invokes the kit API with an exact Pi-session binding; the kit writes its own run store. Only a verified binding appears as a session-bound Orchestrator run. Without the kit, that send target is unavailable.

**Orchestrator settings** manages up to 16 freely named models and usage permissions, with a selected Pi session's model catalog or manual provider/model IDs. Registrations and their edited routes persist in the Console data directory's `orchestrator-models.json`. Console merges them into the kit's in-memory routing at start/resume without changing installed backend definitions; the kit CLI does not read this overlay. Legacy fixed assignments retain `ludi-agent-kit/models.local.json` under the Pi agent directory. Legacy capability routes and built-in disable markers remain in the installed kit's `routing/routing.local.json` and **must be backed up separately before upgrading that kit**. Follow the [kit override backup and restore procedure](upgrade-storage.md#upgrading-ludi-agent-kit) for a compatibility-checked, no-overwrite preview. Registration permissions/routes apply at the next start/resume, not to currently running work, and do not alter the Pi session model, credentials or shared defaults. Creating a capability does not automatically assign it to an agent; disabling a built-in may make dependent agents unavailable.

## Tests

```powershell
npm run build
npm test           # unit, fake Pi HTTP, isolated local-package install, SDK initialization/trust/history, large-record transport (no model call)
npm run test:real  # actual Pi: harmless PowerShell command and a cancelled sleep
npm run test:e2e   # Playwright + real Pi; uses installed Chrome channel
npm run test:compat # mocked UI smoke tests: Chrome / Firefox / WebKit (no model call)
```

`test:compat` starts a dedicated Vite server (`127.0.0.1:31719`) and mocks APIs and SSE. It does not start the Console server, Pi workers or models. It checks text/attachment submission, draft restoration, navigation and unavailable speech recognition, notification and clipboard APIs at desktop, portrait and landscape viewport sizes. Chrome uses the installed channel; Firefox / WebKit require binaries matching the current Playwright version. If missing or mismatched, install them with `npx playwright install firefox webkit`. To check Chrome alone, use `npm run test:compat -- --project=chromium`. Passing WebKit does not establish physical Safari / iOS verification.

`test:real` and `test:e2e` may invoke a configured provider and incur a small model charge. To check the actual installed kit's decision/continuation API without a model call, use the opt-in isolated test below. It copies the kit to a temporary directory and fails if a model invocation is attempted.

```powershell
$env:PI_CONSOLE_REAL_KIT_ROOT = Join-Path $env:USERPROFILE '.pi\agent\npm\node_modules\@ludi-uni\ludi-agent-kit'
node --import tsx --test tests/real-kit-decisions.test.mjs
```

## Architecture

For workspace/session/mobile/PWA/reconnect behavior, see [Phase 3](phase-3-daily-driver.md). For child/Orchestrator audits, see [Phase 2 observability](phase-2-observability.md). For correlation and state rules, see [Phase 2 execution model](phase-2-execution-model.md); for the runtime, [Phase 1](phase-1-runtime.md); for the initial contract, [Phase 0](phase-0-architecture-contract.md).

## License and distribution

Pi Console source is under the [MIT License](../LICENSE). Runtime dependency licenses and copyright notices are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and linked from Settings → About the app. Pi CLI is a separate installation; pet artwork comes from separately installed packages and is **not** covered by this project's license. Check dependency and added-artwork rights before redistributing a modified package.

The package is published as [`@ludi-uni/pi-console`](https://www.npmjs.com/package/@ludi-uni/pi-console). To inspect a local tarball use `npm pack --dry-run`, then `npm pack` if needed; `prepack` builds browser assets. Consumers need a compatible Pi CLI and a Node.js/npm installation of runtime dependencies. Never publish the unauthenticated loopback server directly to a public interface.
