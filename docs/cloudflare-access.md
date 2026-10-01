# Cloudflare Tunnel + Access (opt-in)

This is an **operator-configured remote mode**, not an automatically published service. The app always listens on `127.0.0.1`; it has no unauthenticated remote mode. The pi-web Tunnel/hostname need not be changed. Set up a **separate public hostname and a separate Cloudflare Access Self-hosted application** for pi-console (different application AUD); do not route two apps to the same hostname. Allow only your identity, preferably with MFA, and do not add public Bypass policies. Everyone allowed by this Access policy can operate the **same single-user Pi runtime and local workspaces**. This is not multi-user isolation.

## Setup (on the machine running pi-console and cloudflared)

1. In Cloudflare Zero Trust, create a Self-hosted Access application covering `console.example.com` with an explicit Allow policy limited to your identity. Copy its **Application Audience (AUD) Tag** under Applications → Configure → Additional settings. Find your team domain (`https://<team>.cloudflareaccess.com`). Do not confuse it with the console public hostname.
2. Add a public hostname to the **existing Tunnel**: `console.example.com` → `http://127.0.0.1:31717`. Keep `cloudflared` on the same machine, leave the origin Host header as the **public hostname** (no `httpHostHeader` rewrite), and do not strip `Cf-Access-Jwt-Assertion`. Cloudflare's **Protect with Access** Tunnel option is recommended as an additional verification layer. Do not point the tunnel at pi-web's port `31415`.
3. Configure **all three** fields. For `/pi-console` or Windows Startup, put them in the stable `~/.pi/agent/pi-console/.env` (Windows: `%USERPROFILE%\.pi\agent\pi-console\.env`), outside the installed npm package:
   ```dotenv
   PI_CONSOLE_PUBLIC_ORIGIN=https://console.example.com
   PI_CONSOLE_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
   PI_CONSOLE_ACCESS_AUD=your-application-audience-tag
   PORT=31717
   ```
   Replace the example hostname, team and AUD. The file is explicitly loaded on each start; a workspace's `.env` is **not** loaded through Pi. An incoming `PI_CONSOLE_DATA_DIR` selects a different directory's `.env`; otherwise `PI_CODING_AGENT_DIR` changes the agent directory. Incoming process variables (including empty strings) take precedence over the file, and `/pi-console <port>` takes precedence over its `PORT`. Read errors or partial remote configuration fail startup, rather than falling back to local-only serving. See [startup configuration](operations.en.md#env-for-pi-and-windows-startup) for editing and restart instructions.

   For standalone source development, configure the launching terminal instead and build/start:
   ```powershell
   cd <pi-console-checkout>
   $env:PI_CONSOLE_PUBLIC_ORIGIN = 'https://console.example.com'
   $env:PI_CONSOLE_ACCESS_TEAM_DOMAIN = 'https://<team>.cloudflareaccess.com'
   $env:PI_CONSOLE_ACCESS_AUD = '<application-audience-tag>'
   npm install
   npm run build
   npm start
   ```
   Use your actual hostname, team and AUD. The origin must be HTTPS, exact and without a trailing slash; use no alternate Host override or arbitrary JWKS URL. In remote mode **all** requests (HTML, JS, API, SSE, icons and service worker), including direct localhost requests, require a valid Access application JWT. For local-only use, unset all three variables before starting a separate instance; partial configuration refuses startup. Never store Access service credentials in this repository.
4. Visit `https://console.example.com` and complete Access login. In browser DevTools confirm Chat loads, session list and prompt/stream/Stop work, SSE stays connected, and a mobile browser can reconnect. Test unsigned `GET /api/workspaces` / `/api/events` and unsigned POST locally against public Host: they must return `401`. An unknown Host must return `403`. This code has local simulated-token/HTTP tests, **not** a live Cloudflare end-to-end test; do not claim public readiness without these operator checks.

## Operator verification

`/pi-console` and Windows Startup explicitly load the stable Console `.env` above and never discover arbitrary workspace configuration. Standalone `npm start` and `npm run dev` instead load a repo-root `.env` if present (Node 24 `--env-file-if-exists`); explicit process environment variables take precedence in both cases. Repository `.env` files are gitignored. Do not rely on bare `tsx server/index.ts` to load `.env`. Start the server with your own Access configuration from the setup above, then sign in at your public hostname and verify Chat, SSE and Stop before relying on it. Local simulated-token tests are not a substitute for authenticated end-to-end verification. Keep actual hostnames, team domains, application AUDs, tunnel configuration and operational logs out of a public repository.

### Diagnosing `invalid host`

This `403` comes from Console's Host allowlist, not necessarily from Cloudflare. If the three remote variables are absent, Console is local-only and rejects the public hostname. If remote mode is configured, the request Host must exactly match `PI_CONSOLE_PUBLIC_ORIGIN`; a Tunnel `httpHostHeader` rewrite to `localhost` also fails. Verify the stable `.env`, inherited variables, the correct server/port and restart ownership. With the correct public Host but no Access JWT, a configured remote server returns `401`, not `invalid host`. Never bypass the check or authentication to fix a hostname mismatch.

## Security contract

Origin auth validates `Cf-Access-Jwt-Assertion` (not the cookie or an unverified forwarded identity), RS256 signature via Cloudflare's rotating JWKS, exact team `iss`, exact application `aud`, `iat`/`exp` and optional `nbf`, and a nonempty interactive subject. Service-token identities with empty `sub` are rejected. Header length is bounded and JWKS fetch has a deadline; verification failures fail closed. Every POST requires the configured exact public `Origin`, same-site fetch metadata and JSON; the server does not grant CORS. Host is the exact configured public hostname; `X-Forwarded-Host` is ignored. No request header can switch off auth. Default local mode also rejects common forwarded/Cloudflare headers as an accidental-exposure guard; a proxy stripping those headers and rewriting Host could still expose an unprotected local instance, so this is **not** a substitute for enabling remote mode before adding the Tunnel route. No `0.0.0.0` listener or plaintext public-origin mode is available. CSP/frame protection, no-referrer and no-sniff headers apply to all responses.

The PWA caches **only** public app-shell assets, never authenticated API or session content. Previously loaded offline shell may still appear after Access expires, but its API/SSE requests fail and it cannot run Pi. On reauthentication, reload the public page. A leaked Access token, a malicious allowed user, compromised origin, or Cloudflare policy misconfiguration can run tools as the OS account running pi-console. Keep the Access policy narrow, update dependencies/OS, avoid using powerful unattended workspace credentials, and do not treat this as an approval sandbox. Existing Pi extension dialogs remain cancelled (Phase 1–3 behavior). Remote access to pi-console is separate from and does not migrate pi-web-specific state.

Cloudflare documentation: [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/), [Self-hosted Access app](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [Tunnel configuration](https://developers.cloudflare.com/tunnel/configuration/).
