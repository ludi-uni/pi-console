# Operations and development (Windows)

[Home](../README.en.md) · [日本語](operations.ja.md) · [Using Pi Console](usage.en.md)

## Installation

Requires Node.js 24+ and Pi 0.87.1+. Besides the [published package](../README.en.md#quick-start), you can register a source checkout as a local Pi package:

```powershell
npm install
npm run build                     # build dist/
pi install (Resolve-Path .).Path  # register this folder in Pi
pi list                           # confirm registration
```

Restart Pi or run `/reload`, then start `/pi-console`. The checkout and built `dist/` must remain available. `dist/` is not committed, so installing directly from the git URL is not supported. The published npm tarball contains the built browser assets and Pi installs its runtime dependencies. Installation alone does not connect or start the server; until a session is selected the Web status reads `Server ready · no Pi session`.

For standalone use without the Pi package, install `@earendil-works/pi-coding-agent` and configure a Pi model:

```powershell
npm install
npm run build
npm start  # loads optional repo-root .env (Node 24)
# in local mode, open http://127.0.0.1:31717
```

If Pi CLI discovery fails, set `PI_CONSOLE_PI_COMMAND` to the absolute path of Pi's `dist/bundle/cli.js` (not `pi.cmd`). Package startup does not read an arbitrary workspace's `.env`; pass remote-mode variables in the host Pi environment.

## Security and startup

The default server binds only to `127.0.0.1` without authentication. Do not expose it through a LAN or unprotected tunnel. The separate protected remote mode requires Cloudflare Tunnel + Access, verifies signed Access JWTs on every request, and still binds only to loopback. Follow [Cloudflare Tunnel + Access](cloudflare-access.md) before configuring a hostname.

`/pi-console stop` stops the Pi-owned server. A normal Pi shutdown stops it too; an abruptly killed Pi process may leave its child running. On Windows, **Settings → Start with Windows** installs or removes the current user's Startup shortcut. Pi has no post-install hook, so the extension installs the shortcut when first loaded in a trusted interactive Pi session (or use **Install now**).

## Storage and model configuration

| Data | Location and ownership |
| --- | --- |
| Pi package / Windows Startup workspace registrations and quick prompts | `~/.pi/agent/pi-console/workspaces.json`, or under `PI_CODING_AGENT_DIR`; override explicitly with `PI_CONSOLE_DATA_DIR`. |
| Automatic session cleanup settings | `session-retention.json` in the same stable data directory. |
| Standalone `npm start` | `.pi-console/` in the working directory by default. |
| Pi conversations | Pi's session directory; override with `PI_CODING_AGENT_SESSION_DIR`. Browser reconnects do not remove them. |
| Appearance and other browser preferences | Stored in the browser; not shared with pi-web. |

**Before upgrading an older Windows Startup installation, follow the [backup and migration procedure](upgrade-storage.md).** npm may remove the former package-local `.pi-console/` before new code can read it.

Pi owns chat history; the Orchestrator's existing SQLite owns kit run history. Canonical event history and observed foreground child progress are in memory. The ludi-agent-kit npm Pi package is auto-detected; optional `PI_CONSOLE_KIT_ROOT` overrides discovery and `PI_CONSOLE_ORCHESTRATOR_STORE` selects a nondefault kit DB. The status adapter reads these sources without modifying their records. Explicitly choosing the kit send target invokes the kit API with an exact Pi-session binding; the kit writes its own run store. Only a verified binding appears as a session-bound Orchestrator run. Without the kit, that send target is unavailable.

**Orchestrator settings** manages up to 16 freely named models and usage permissions, with a selected Pi session's model catalog or manual provider/model IDs. Registrations and their edited routes persist in the Console data directory's `orchestrator-models.json`. Console merges them into the kit's in-memory routing at start/resume without changing installed backend definitions; the kit CLI does not read this overlay. Legacy fixed assignments retain `ludi-agent-kit/models.local.json` under the Pi agent directory. Legacy capability routes and built-in disable markers remain in the installed kit's `routing/routing.local.json` and **must be backed up separately before upgrading that kit**. Follow the [kit override backup and restore procedure](upgrade-storage.md#upgrading-ludi-agent-kit) for a compatibility-checked, no-overwrite preview. Registration permissions/routes apply at the next start/resume, not to currently running work, and do not alter the Pi session model, credentials or shared defaults. Creating a capability does not automatically assign it to an agent; disabling a built-in may make dependent agents unavailable.

## Tests

```powershell
npm run build
npm test           # unit, fake Pi HTTP, isolated local-package install and real Pi RPC handshake (no model call)
npm run test:real  # actual Pi: harmless PowerShell command and a cancelled sleep
npm run test:e2e   # Playwright + real Pi; uses installed Chrome channel
```

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
