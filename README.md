# pi-console

Local-first web console for Pi on Windows (Node.js 24+, Pi 0.87.1+). Open a server-local workspace, chat in a separate Pi RPC session, and inspect its execution timeline in a desktop or mobile PWA. This is **not** pi-web and does not depend on its runtime. Pi tools, observed foreground pi-subagents and session-bound Orchestrator activity appear when available; missing relationships remain Unattached. There is no approval action UI.

## Install as a Pi package (Windows)

Requires Node.js 24+ and Pi 0.87.1+. From this checkout:

```powershell
npm install
npm run build                    # local Pi packages load files in place
pi install (Resolve-Path .).Path # registers this directory in Pi's user settings
pi list                          # confirms the package
```

Restart Pi or run `/reload`, then enter `/pi-console` in Pi. This starts a **loopback-only** Web server; open the displayed URL, select a workspace, and create/select a session. `/pi-console 31719` chooses another port when 31717 is already occupied; `/pi-console stop` stops this Pi-owned server. The Web session is a **separate Pi RPC worker**, not a mirror of the TUI conversation. Merely installing the package does not connect or start a server; the Web status says `Server ready · no Pi session` until a session is selected. On a normal host Pi shutdown, the extension stops its server; an abruptly killed Pi process may leave the child running. Package metadata defaults to `~/.pi/agent/pi-console/`; override with `PI_CONSOLE_DATA_DIR` before starting Pi. Package startup does not read an arbitrary workspace's `.env`; pass remote-mode configuration in the host Pi environment if needed. A local Pi package requires the checkout and built `dist/` to remain available. `dist/` is intentionally not committed, so installing directly from the git URL is not supported. Once the npm release is published, use `pi install npm:@ludi-uni/pi-console@0.1.0` and then `/pi-console` in Pi; the npm tarball includes built browser assets and runtime dependencies are installed by Pi. Until then, install from this checkout as shown above.

## Run standalone (Windows)

Requires an installed `@earendil-works/pi-coding-agent` CLI and a configured Pi model. On this machine Pi is installed globally. If discovery fails, set `PI_CONSOLE_PI_COMMAND` to the absolute path of Pi's `dist/bundle/cli.js` (not `pi.cmd`).

```powershell
npm install
npm run build
npm start  # loads optional repo-root .env (Node 24)
# open http://127.0.0.1:31717 in local mode; see Cloudflare doc for remote mode
```

A workspace is one server-local folder used as Pi's working directory; there is no separate "project" entity. On a phone, start at Workspaces, choose a workspace, pick or create a session, then use Chat and Execution within that session. Back links and the phone's browser Back/Forward return through the session and workspace lists without stopping Pi. Settings (⚙) offers browser-local session view, app overview, language (settings/navigation only), appearance and Codex-compatible pet controls; preferences are not shared with pi-web. Pet packages (`pet.json` + spritesheet) are discovered on the server in the Pi Console, Codex and pi-web pet folders; Auto prefers Fio if installed. The pet roams on-screen; drag it by mouse or touch to move it out of the way. Tap an existing workspace to open it; to add a new one, use **Browse folders** (or enter an absolute path) under Add a workspace, then Add & open. Manage workspace lets you rename, pin or remove the registration; removing a workspace does not delete its folder or Pi sessions. Choose **Send with: Pi (direct)** or **ludi-agent-kit orchestrator** for each prompt. The kit option is offered only when its installed API is available; it starts a separate run bound to the exact Pi session and workspace, with status in Execution. Kit model routing is independent of the Pi session model and may incur provider charges. Kit runs do not support browser attachments or Stop, and their requests/results are not added to Pi chat history. The selection defaults to Pi when switching sessions or reloading. Choose the Pi model and thinking level within a session; Context shows Pi's reported usage after a response. Attach up to four small UTF-8 text files or PNG/JPEG/GIF/WebP images from the browser before sending. Send a prompt and follow the conversation and Activity. The landing screen lists observed running sessions and sessions needing input across workspaces; select one to open it. While a tool runs, its observed program/command is shown when Pi provides it. The Instructions button lists previous user prompts and jumps to the chosen message; Copy all sits below the assistant bubble. Sessions can be moved to the server's Windows Recycle Bin individually, or automatically after a configurable number of days since their last modification (off by default; enable in Settings → Automatic cleanup). This affects Pi session files shared with other apps. On Windows, Settings → Start with Windows installs or removes the current user's Pi Console Startup shortcut; it starts at sign-in. Pi installs do not expose a post-install hook, so the extension installs the shortcut on its first trusted interactive Pi session (or select Install now). The folder browser shows directories on the **machine running pi-console**, not the phone/browser device. Stop clears queued prompts and sends Pi `abort`. A browser reconnect does not kill its worker. A new unprompted session exists in the current server only until Pi writes its first session file on the first prompt.

By default the server binds **only** to 127.0.0.1 with no authentication: do not expose the default mode through a tunnel/LAN. An **explicit** Cloudflare Tunnel + Access mode verifies signed Access JWTs on every request and still binds only to loopback; follow [`docs/cloudflare-access.md`](docs/cloudflare-access.md) before configuring a separate protected hostname. Installing the PWA does not make Pi available offline. Workspace and editable quick-prompt metadata are in `.pi-console/workspaces.json` (override directory with `PI_CONSOLE_DATA_DIR`), Pi sessions stay in Pi's session directory (override with `PI_CODING_AGENT_SESSION_DIR`). Canonical event history and foreground child progress are in memory; Pi owns chat history and the Orchestrator's existing SQLite owns task/trace history. Optional `PI_CONSOLE_KIT_ROOT` identifies the installed ludi-agent-kit, and `PI_CONSOLE_ORCHESTRATOR_STORE` supplies a nondefault kit state DB path. The status adapter reads both sources without modifying their records. Explicitly selecting the kit send target invokes the installed kit API with an exact Pi-session binding and lets the kit write its own run store; a missing kit disables this target. An Orchestrator run is visible only with an exact validated Pi-session binding. The console does not cancel kit runs or resume pending kit decisions; use the kit's own controls for those actions.

## License and distribution

Pi Console source code is offered under the [MIT License](LICENSE). Runtime dependency licenses and copyright notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and linked from Settings → About the app. Pi CLI is a separate installation; pet artwork is loaded from separately installed packages and is **not** covered by this project's license. Review the dependency inventory and rights to any artwork you add before redistributing a modified package.

The package is prepared for public npm distribution as `@ludi-uni/pi-console` (MIT); publication requires npm's two-factor approval or a suitable granular publishing token. For a local distributable tarball, run `npm pack --dry-run` to inspect the included files, then `npm pack` if desired; `prepack` builds the browser assets. A consumer still needs a compatible Pi CLI and a Node.js/npm install of runtime dependencies. Do not publish or expose the unauthenticated loopback server directly on a public interface. See the installation steps above and the remote-access requirements in [`docs/cloudflare-access.md`](docs/cloudflare-access.md).

## Tests

```powershell
npm run build
npm test           # unit, fake Pi HTTP, isolated local-package install + real Pi RPC handshake (no model call)
npm run test:real  # actual Pi; runs a harmless powershell command and a cancelled sleep
npm run test:e2e   # Playwright + real Pi; uses installed Chrome channel
```

`test:real`/`test:e2e` invoke a configured provider and can incur a small model charge. See [`docs/phase-3-daily-driver.md`](docs/phase-3-daily-driver.md) for workspace/session/mobile/PWA/reconnect behavior. See [`docs/phase-2-observability.md`](docs/phase-2-observability.md) for real child/Orchestrator audit and [`docs/phase-2-execution-model.md`](docs/phase-2-execution-model.md) for correlation, state and reconnect rules. Phase 1 runtime: [`docs/phase-1-runtime.md`](docs/phase-1-runtime.md); Phase 0 contract: [`docs/phase-0-architecture-contract.md`](docs/phase-0-architecture-contract.md).
