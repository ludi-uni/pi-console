# Preserve metadata before upgrading an older Pi Console

[Home](../README.en.md) · [日本語](upgrade-storage.ja.md)

Older Windows Startup installations saved workspace registrations, quick prompts, and session-retention settings inside the replaceable npm package (`<Pi agent directory>/npm/node_modules/@ludi-uni/pi-console/.pi-console/`). npm may remove this directory **before the new version runs**. Run this procedure **before** updating the installed package. The helper must come from a checkout containing `package/prepare-upgrade.mjs`; an old installed package does not have it.

1. In a checkout of this version, preview and back up both the legacy and stable locations:

   ```powershell
   node .\package\prepare-upgrade.mjs
   ```

   By default the helper reads the legacy directory under `PI_CODING_AGENT_DIR` (otherwise `~/.pi/agent`) and the stable directory from `PI_CONSOLE_DATA_DIR` (otherwise `<Pi agent directory>/pi-console`). For a nonstandard installation, pass absolute `--legacy` and `--data-dir` directories. The output contains the backup directory, missing workspace count, and any conflicts. It copies each existing `workspaces.json` and `session-retention.json` to a uniquely named `pre-upgrade-*` directory **outside the npm installation**. Keep this backup even when no migration is needed.
2. If `status` is `needs-review`, **do not update yet**. Inspect the `legacy-*` and `stable-*` backup files. Conflicting workspace IDs, different quick prompts, or different retention settings are never resolved automatically. Reconcile the stable registry manually, keeping its existing entries and settings unless you explicitly choose otherwise. Back up your edits. Never replace the stable registry with the old file without comparing them.
3. If `status` is `preview` and you want the missing registrations copied, stop Pi Console (including the Windows Startup server), then run:

   ```powershell
   node .\package\prepare-upgrade.mjs --apply
   ```

   `--apply` takes another backup, adds only workspace paths missing from the stable registry, preserves existing stable workspace metadata and quick prompts, and copies old retention settings only when the stable file is absent. It refuses conflicting data or a stable registry changed during preparation. Confirm the output says `applied`; if it reports `needs-review`, inspect the new backup instead. Recheck the stable files before updating. `no-legacy-data` means the old directory was not found; if the old package was already replaced, consult an external backup.
4. Upgrade the npm Pi package only after confirming the stable files contain the registrations/settings you need. This helper does not update npm, change Pi sessions, or remove legacy files.

> Run from the source checkout, not from a directory that npm is about to replace. For example, use `node D:\Develop\pi-console\package\prepare-upgrade.mjs` before `pi update` if your checkout is at that path. Running `--apply` while the server is writing metadata risks concurrent changes; stop it first.

## Upgrading ludi-agent-kit

This is separate from Pi Console's registry migration. The installed kit's `routing/routing.local.json` (capability overrides) and optional `adapters/pi/models.local.json` may be lost when the kit is replaced. **Before upgrading the kit**, stop processes using the kit and run this from a Pi Console source checkout outside the replaceable package:

```powershell
node .\package\kit-overrides.mjs backup
```

Keep the absolute `backup` path in the output. Snapshots are stored under `PI_CONSOLE_DATA_DIR/kit-override-backups/` (by default under the Pi agent directory). `no-kit-local-overrides` means there was nothing to snapshot. These files may contain model names; do not publish the backup. The user-level `ludi-agent-kit/models.local.json` is outside the kit and is not part of this snapshot. After upgrading the kit, **stop Pi Console and the kit**, then preview:

```powershell
node .\package\kit-overrides.mjs restore --backup 'C:\...\kit-override-backups\snapshot-...'
```

The restore verifies backup hashes, checks the new kit's routing/registry loaders, and **never overwrites a differing existing override**. If `status` is `ready` with no conflicts, compare the old and new shared routing before applying:

```powershell
node .\package\kit-overrides.mjs restore --backup 'C:\...\kit-override-backups\snapshot-...' --apply
```

If `baseChanged` is true, review the changed shared routing and capability meanings first. Only after that review, and only if compatibility validation succeeds, use `--accept-base-changes --apply`. An incompatible override or conflicting target cannot be forced. Confirm `restored` or `already-present`, then restart Pi Console and inspect the effective Orchestrator settings. The helper does not upgrade the kit or change Pi sessions, run history, or user-level model bindings. For nonstandard installations, provide absolute `--kit` and `--data-dir` paths.
