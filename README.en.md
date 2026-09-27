# Pi Console

[日本語](README.md)

A local-first web console for Pi conversations and execution timelines on Windows PCs and mobile browsers. Requires Node.js 24+ and Pi 0.87.1+. Its Web conversation is a **separate Pi RPC session**, not a mirror of the TUI conversation.

> **Security:** The default server binds only to `127.0.0.1` without authentication. Do not expose it directly to a LAN or the internet. Protected remote access requires [Cloudflare Tunnel + Access](docs/cloudflare-access.md).
>
> **Upgrading an older version:** An older Windows Startup installation may have saved workspace registrations inside a directory npm removes on update. Run the [pre-upgrade backup and migration procedure](docs/upgrade-storage.md) **before** upgrading. The old data may be unrecoverable afterwards.

## Quick start

To install the published Pi package:

```powershell
pi install npm:@ludi-uni/pi-console@latest
```

Restart Pi or run `/reload`, then enter `/pi-console` in Pi. Open the displayed local URL, choose a workspace (Pi's working directory), and select a session. **Installing the package alone does not start the server.**

For a local source checkout or standalone `npm start`, see [Operations and development](docs/operations.en.md#installation).

## Find a guide

| Task | Guide |
| --- | --- |
| Chat, preview files, inspect execution | [Using Pi Console](docs/usage.en.md) |
| Storage, startup configuration, testing | [Operations and development](docs/operations.en.md) |
| Safely upgrade an older installation | [Pre-upgrade backup and migration](docs/upgrade-storage.md) |
| Configure protected remote access | [Cloudflare Tunnel + Access](docs/cloudflare-access.md) |
| Explore internals | [Architecture documents](docs/operations.en.md#architecture) |

Source code is under the [MIT License](LICENSE). See [distribution notes](docs/operations.en.md#license-and-distribution) for dependency and artwork rights.
