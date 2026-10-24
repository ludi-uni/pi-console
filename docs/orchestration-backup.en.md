# Full backup and restore verification of the orchestration store

[Home](../README.en.md) · [日本語](orchestration-backup.ja.md)

`package/orchestration-backup.mjs` backs up the whole Orchestrator (ludi-agent-kit) SQLite store (`<kit>/.orchestration/state.db`), together with the console-owned client snapshot/journal JSON files, into a **new bundle directory**. The goal is to preserve the entire DB — run history (`runs/tasks/decisions/trace`) plus every user table such as `decision_memory` — as evidence before a real-model test or a kit replacement.

This is a **point-in-time backup**, not a migration or cutover. Live writers may commit after the snapshot, so stop Pi Console and Pi orchestration before a final migration. The tool never modifies the source DB and never switches the live store.

## Usage

Run from this checkout; every path must be absolute.

```powershell
# Back up the whole DB plus optional auxiliary JSON into a new bundle
node .\package\orchestration-backup.mjs backup `
  --source 'C:\...\ludi-agent-kit\.orchestration\state.db' `
  --output 'C:\...\orchestration-backups\bundle-2025-xx' `
  --kit-root 'C:\...\ludi-agent-kit' `
  --history-dir 'C:\...\pi-console\orchestration-history'

# Verify a bundle and restore it offline into a new directory (re-verified read-only)
node .\package\orchestration-backup.mjs restore-check `
  --bundle 'C:\...\orchestration-backups\bundle-2025-xx' `
  --output 'C:\...\orchestration-restore-check'
```

- `--source` (required): absolute path to an existing SQLite DB. It is opened read-only and a committed, WAL-consistent snapshot is taken via the SQLite backup API (`backup()` from `node:sqlite`). No writes or checkpoints on the source.
- `--output` (required): a **new** bundle directory. Existing paths, output inside the source/kit/history trees, and output equal to the source are refused. The bundle is assembled in a temp sibling directory, then the output is reserved exclusively. Handled errors clean up owned outputs; forced termination or power loss can leave incomplete output. Use only bundles that pass `restore-check`.
- `--kit-root` (optional): kit root. When given, only `pi-web-*.json` under `.orchestration/activity/clients/` (client snapshots and run-binding journals) are saved to `auxiliary/kit-clients/`. Symlinks and out-of-root references are refused; `.env` and token files are never copied.
- `--history-dir` (optional): console history-mirror directory. Only `pi-web-*.json` under it are saved to `auxiliary/history/`.
- `restore-check`: verifies `manifest.json` hashes, schema, all table row counts and `integrity_check`, then copies `state.db` and auxiliary files into a **new** output directory with `COPYFILE_EXCL` and re-opens it read-only. It never overwrites existing paths, updates configuration, swaps the live store, or returns run owners to execution.

`manifest.json` (version 1) records the creation timestamp, source path/size/mtime, the backup DB's sha256/bytes/all-table row counts/`integrity_check` result, and each auxiliary file's sha256. History contents are not embedded in the manifest. The DB and auxiliary files may contain confidential conversation and decision data: protect the entire bundle as sensitive data. The DB and auxiliary JSON are not one atomic snapshot; stop all writers before a final migration.

## Operational limits

- If read-only opening fails, check the original DB/WAL/SHM set and directory permissions. Do not delete WAL files or bypass replay with immutable mode. This tool does not checkpoint or repair the source automatically.
- Hashes detect corruption and accidental changes, not an attacker who can rewrite both the manifest and files. Use trusted local directories with no adversarial writers changing their ancestors during the operation.

## Remaining acceptance on real data

1. **Stop** Pi Console and Pi orchestration. Pass the exact real `state.db` path to `--source` (there is no automatic discovery).
2. Run `backup` and confirm `status: "backed-up"`, `database.tables` (runs/tasks/decisions/trace plus every user table such as `decision_memory`), and the `auxiliary` count. Keep the bundle in a durable location **outside** npm/kit directories.
3. Run `restore-check` on the same bundle and confirm `status: "verified"` with table counts matching the manifest. This is fully offline/read-only; the live store is untouched.
4. Only after these pass, proceed to the real-model test, then commit/deploy. A backup alone does not prove writers stopped — stop services and back up again immediately before any final migration.
