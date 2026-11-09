# Pi Remote Desktop

Pi package for the Remote Connections feature in pi-console. Console supplies a
run-scoped IPC broker when the connection is enabled; this package contains no
endpoint, certificate pin, credential file path, process identifier or secret.
Outside that Console integration it grants no remote authority and registers no
tools. Existing Computer Use and development tools are not replaced.

`remote_gui_inspect` and `remote_gui_screenshot` observe the operator-bound CAIVI
window through the existing guest Worker and require the operator's **read**
grant. `remote_file_send` admits only artifact names registered through the
server-owned staging manifest (maximum 16 MiB) and requires the **send** grant.
Files are staged from the Settings → Remote connections file picker (or a manual
copy into the owned staging folder) and registered as a separate explicit step;
the manifest is re-read live on every send, so registering works without a
restart and unregistering revokes immediately.
The three `remote_caivi_*` tools require the **operate** grant and run only the
fixed Phase7 guest operations: the host cannot select click positions, typed
text, or drag coordinates, and there is no arbitrary command, target,
coordinate, or host GUI fallback.

Grants are connection-scoped operator decisions managed in Settings → Remote
connections (`read`, `operate`, `send`; `operate` also requires `read`). A write
dispatch is additionally journaled per request before transport: only an
authenticated KNOWN-ok proof retires that request's entry; unresolved entries
keep the role's writes refused. The guest Worker's own one-shot action journal
(`mutation_already_attempted`) remains authoritative — a grant or approval does
not reset it, and repeated fixed operations may be refused by the guest until a
guest-side change allows them. No automatic retry after UNKNOWN.

Historical UNKNOWN/tombstone ledgers are never cleared by changing Pi sessions,
disabling, deleting or recreating a connection. Do not reset either ledger to
retry an operation.

Disable the connection or revoke grants in Settings → Remote connections to
refuse subsequent requests and omit this package from newly created Console
workers. Already dispatched operations cannot be assumed cancelled or safe to
resend.
