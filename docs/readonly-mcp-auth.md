# Dedicated authentication for the read-only MCP

This is an opt-in local boundary for an authenticated tunnel. It does not add
execution, approval, stop, prompt, resource, result-file or scope-selection tools.
Only `get_status`, `list_sessions`, `get_progress` remain available. Browser
authentication and the fixed operator-owned session allowlist stay unchanged.

**Use the [fixed local guard and guarded launcher](readonly-mcp-guard.md).**
The direct client connection leaked a dummy header on a same-origin metadata
redirect. The guard blocks every upstream 3xx. Previous direct instructions
are superseded by the guard guide.

## Server configuration and trust

`PI_CONSOLE_READONLY_MCP_AUTH` unset/empty/`native` preserves the original gate:
native loopback requests without a proxy header can read the limited scope.
`shared_secret` requires a separate 256-bit key (64 lowercase hex characters).
The server reads `PI_CONSOLE_READONLY_MCP_KEY` when explicitly present, otherwise
the fixed `<PI_CONSOLE_DATA_DIR>/readonly-mcp.key`. Missing/bad mode, invalid key
or unreadable key file fails startup. Never reuse a runtime API key, browser JWT,
management token or account credential. File paths and expected keys are local
configuration; an MCP caller cannot change them.

In `shared_secret` mode **every** intercepted MCP/metadata request requires exactly
one `X-Pi-Console-Readonly-Key` header matching that key. Missing, wrong, malformed
and duplicated headers return fixed HTTP 401 (`mcp_auth_failed`) with no key or
raw error. Authentication uses a fixed-length timing-safe comparison.

Valid authentication permits *the presence* of `Forwarded`, `Via`, `X-Real-IP`
and `X-Forwarded-*`; their values never establish identity or permissions.
Literal IPv4 loopback peer and `Host: 127.0.0.1:<actual port>` remain mandatory.
Any Origin, Cloudflare header or disallowed Sec-Fetch-Site still returns 403,
even with the correct key. No CORS, OAuth or browser bypass is added. After
authentication the two exact OAuth metadata GETs still return no-store 404.

The tunnel/control plane must independently authenticate and authorize Dots.
Possession of this dedicated key permits the limited reads and should be
restricted to the intended local tunnel process. It grants no Pi execution.
The server is not suitable for direct public binding. Keep the same loopback
port, tunnel, single `main` channel and disabled harpoon/public UI/raw logging.

## Official client header behavior

Use an environment **reference**, never a literal secret in YAML or argv:

```yaml
mcp:
  extra_headers:
    X-Pi-Console-Readonly-Key: env:PI_CONSOLE_READONLY_MCP_LOCAL_KEY
```

Keep client URL fixed to `http://127.0.0.1:31718/mcp/readonly` and guard upstream
fixed to `http://127.0.0.1:31717/mcp/readonly`. The prepared
`start-readonly-auth.ps1` uses the equivalent `--mcp.extra-headers` setting while
using the new guarded draft profile and pinned binary. It reads the protected file
privately and puts the dedicated key only into the child environment; it does
not add the key to the control-plane HTTP authorization or save a runtime key.
Preview reads neither key. Preflight POSTs prohibit redirects.

Official tunnel-client v0.0.15 applies caller-forwarded headers after static
headers, so a caller **can physically override** this header. Wrong/empty/
duplicated overrides fail closed at pi-console; they cannot reconfigure its
expected key, bypass the scope or gain execution. They can make their request
fail. Strictly immutable client-side headers need an upstream client change or
a reviewed transport guard; this implementation does not claim immutability.
See [official configuration](https://github.com/openai/tunnel-client/blob/v0.0.15/docs/configuration.md).

Isolated tests with the pinned official binary verify successful discovery,
catalog and all three reads with proxy headers, denial of header overrides and
Origin, rejection of other targets, and no key in control-plane requests,
responses or diagnostic output. A cross-origin redirect fixture receives zero
requests at the second origin. These tests are not a live Dots connection test.

## Storage, retention and manual setup

The key file is plaintext. The Windows helper sets the owner to the current user,
disables inherited ACLs and allows only that user and SYSTEM, **before** writing
secret bytes. Its reader rejects broad/inherited ACLs and reparse-point files.
The Node loader checks regular-file status/size/format and POSIX permission bits;
it does **not** inspect Windows ACLs itself. Use the helper and keep the data
directory private. Same-user processes, SYSTEM and administrators able to take
ownership remain outside this local isolation boundary. Environment and JS/PS
strings may remain in process memory; only the matcher's decoded buffer and
temporary byte/BSTR buffers are explicitly cleared. Do not claim full wiping.

The file remains until the operator rotates or deletes it. The server caches
the key at startup; guard and tunnel retain copies until those children exit. Do not
put the key in chat, command history, a profile, logs or a report. Backups of
the data directory also need the same access and retention policy.

The following is a **future operator procedure**, not applied by installing code:

1. Review this change and separately approve the live secret/configuration and
   idle restart window. Confirm the existing one-workspace/one-session scope;
   this helper neither creates nor expands it. Confirm no work/report/uncertain
   queue is active across the whole instance, using its management flow.
2. In your own interactive PowerShell, run the command below. Obtain a NEW random
   256-bit key from your password manager and enter it only at the masked prompt.
   The helper requires the approved scope hash, refuses an existing key or auth
   setting, keeps every existing `.env` byte and appends only the auth-mode line.
   It does not restart anything. If it fails, inspect private state before retry;
   a protected key file or appended mode may already exist after partial failure.
3. During the approved idle window restart **only** the managed target instance.
   Independently confirm its management ownership, loopback port and exact
   registered scope. Privately authenticate the three reads and update
   `target-attestation.json` to its new opaque IDs. Old IDs intentionally fail.
   No automatic newest-session selection is allowed. The prepared launcher
   fails preflight until a current attestation exists.
4. Follow the guard guide: stop the previous tunnel using Q; start the separate
   `start-readonly-auth.ps1`, supplying the runtime key at its masked prompt.
   It now starts its fixed guard before the tunnel. Keep one poller for the
   same tunnel and `main` channel. Check readiness,
   perform Dots discovery and verify exactly three read-only tools and no workers
   started. A running v0.0.15 client does not retry a finalized discovery denial;
   a fresh authorized client startup is required.

```powershell
& 'D:\Develop\pi-console\scripts\setup-readonly-mcp-auth.ps1' `
  -DataDir 'C:\Users\leade\.pi\agent\pi-console' `
  -ApprovedScopeSha256 '7386a4d095c323b0686ee1801c5aaf109370e8a0b5ffc7273ce2b7b53e4a8f13'
```

That hash identifies the already approved scope in this investigation. Verify
it locally before use; do not substitute an unrelated scope to make setup pass.
No secret value appears in this command.

For rotation/revocation, arrange a separate idle window, stop the intended
tunnel/guard/server, replace the dedicated key privately with restricted
ACLs, then restart all three and re-attest IDs. Deleting the file without restarting
does not revoke cached keys. Removing only `PI_CONSOLE_READONLY_MCP_AUTH` and
restarting restores legacy **unauthenticated native loopback reads** and proxy
denial; it is not revocation of all local reading. Disable
`PI_CONSOLE_READONLY_MCP=1` and restart if all MCP access must be revoked. Keep
the existing scope and browser configuration intact.

## Code and verification

- `server/readonly-mcp-auth.ts`: explicit config loading, fixed-size comparison,
  duplicate detection, fixed errors and matcher disposal.
- `server/readonly-mcp.ts`: hard native boundaries, auth gate before dispatch,
  proxy presence exception only after authentication.
- `server/index.ts`: startup-only loader and disposal; existing browser gate.
- `scripts/ReadOnlyMcpSecret.psm1`, `scripts/setup-readonly-mcp-auth.ps1`: manual
  Windows ACL setup, approved scope hash and no overwriting existing settings.
- `tests/readonly-mcp.test.ts`: dummy auth, real isolated HTTP entry/browser gate,
  secret-free diagnostics and dummy-only Windows setup fixture.
- `tests/readonly-tunnel.test.ts`: official client on isolated ports/control
  plane with dummy credentials, including caller overrides and destination scope.

No real key or live auth-mode configuration has been created/applied during
this change. Live Dots discovery/calls and account permissions remain unverified.
