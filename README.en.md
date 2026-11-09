# Pi Console

[日本語](README.md)

A local-first web console for Pi conversations and execution timelines on Windows PCs and mobile browsers. Requires Node.js 24+ and a compatible Pi (stable 0.99.2–1.5.0). Its Web conversation is a **separate Pi session managed by a Console-owned SDK worker**, not a mirror of the TUI conversation. SDK initialization, extension integration and direct history reads were checked without model calls on Pi 1.5.0 and 1.4.0; package installation and start/stop were also checked on 1.5.0. Stable versions within the supported range are accepted, but not every version was individually exercised.

> **Security:** The default server binds only to `127.0.0.1` without authentication. Do not expose it directly to a LAN or the internet. Protected remote access requires [Cloudflare Tunnel + Access](docs/cloudflare-access.md).
>
> **Upgrading an older version:** An older Windows Startup installation may have saved workspace registrations inside a directory npm removes on update. Run the [pre-upgrade backup and migration procedure](docs/upgrade-storage.md) **before** upgrading. The old data may be unrecoverable afterwards.

## Dots and local MCP temporarily unavailable

This release temporarily excludes Pi Console's Dots and MCP integrations (local resume, folders, Pi control and readonly). Connection settings, MCP endpoints and the `local-resume` CLI are unavailable; previous environment variables or stored settings do not re-enable them. Implementation code and saved configuration are preserved for later work.

Normal Pi sessions and Pi's own MCP extension, Chat, Execution, voice input and remote connections remain available. `owner-login` remains for local identity verification used by voice settings and other non-MCP management. Dots/local-MCP design and verification documents are historical development records, not activation instructions for this release.

## Quick start

To install the published Pi package:

```powershell
pi install npm:@ludi-uni/pi-console@latest
```

Restart Pi or run `/reload`, then enter `/pi-console` in Pi. Open the displayed local URL, choose a workspace (Pi's working directory), and select a session. **Installing the package alone does not start the server.**

The server is an independent background process — it keeps running when Pi exits or reloads, and `/pi-console status|stop|restart` (or `scripts\pi-console.ps1 <command>` / `node package/pi-console.mjs <command>` from any directory) manages the same instance. `restart` interrupts active Web sessions; a server started by an older version is reported but never auto-stopped.

For a local source checkout or standalone `npm start`, see [Operations and development](docs/operations.en.md#installation).

Pi and Windows Startup explicitly read `~/.pi/agent/pi-console/.env` by default, keeping Cloudflare configuration outside the replaceable npm package. See [startup `.env` configuration](docs/operations.en.md#env-for-pi-and-windows-startup) for location, precedence and restart instructions.

### Optional pet artwork

Fio (artwork attribution: DOLL Project / Ludi) is bundled in `package/pets/fio/` under the separate [Fio Character Asset License](package/pets/fio/FIO_ASSET_LICENSE.md), not the MIT software license, and is available without Codex or user-installed packages (8 columns × 11 rows, sprite version 2). Official Codex built-in pet artwork is not distributed with Pi Console. Pi Console supports Codex-compatible custom pet packages. Pi Console is an independent project, not affiliated with or endorsed by OpenAI. Pi Console also discovers pet packages in `~/.pi-console/pets`, `~/.codex/pets`, and legacy Pi agent locations on the server; custom packages take precedence. Settings → Pet selects a source and package or refreshes discovery; when no usable sheets exist, the companion stays hidden. Only use artwork you have the right to use.

## Find a guide

| Task | Guide |
| --- | --- |
| Chat, preview files, inspect execution | [Using Pi Console](docs/usage.en.md) |
| Storage, startup configuration, testing | [Operations and development](docs/operations.en.md) |
| Safely upgrade an older installation | [Pre-upgrade backup and migration](docs/upgrade-storage.md) |
| Configure protected remote access | [Cloudflare Tunnel + Access](docs/cloudflare-access.md) |
| Explore internals | [Architecture documents](docs/operations.en.md#architecture) |
| See what changed in this release | [0.5.4 release notes](docs/releases/0.5.4.en.md) |

Source code is under the [MIT License](LICENSE). See [distribution notes](docs/operations.en.md#license-and-distribution) for dependency and artwork rights.
