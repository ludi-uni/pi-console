import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import type { LocalControlGrant, LocalControlTarget } from '../shared/trusted-local-mcp.ts';
export const localIdentifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(v);
export function validateLocalTarget(v: unknown): asserts v is LocalControlTarget {
    strictPermissionObject(v, ['instance', 'revision', 'workspaceId', 'sessionId', 'generation']);
    if (!Number.isSafeInteger(v.revision) || v.revision < 0 || !['instance', 'workspaceId', 'sessionId', 'generation'].every(k => localIdentifier(v[k])))
        throw new PermissionFault('invalid_target');
}
type Saved = {
    requestId: string;
    instance: string;
    credentialEpoch: string;
    revision: number;
    action: 'grant' | 'revoke';
};
type Snapshot = {
    version: 1;
    revision: number;
    grant: LocalControlGrant | null;
    requests: Saved[];
};
function validate(v: any): Snapshot {
    strictPermissionObject(v, ['version', 'revision', 'grant', 'requests']);
    if (v.version !== 1 || !Number.isSafeInteger(v.revision) || v.revision < 0 || !Array.isArray(v.requests) || v.requests.length > 64)
        throw new PermissionFault('local_grant_unavailable');
    const seen = new Set<string>();
    for (const r of v.requests) {
        strictPermissionObject(r, ['requestId', 'instance', 'credentialEpoch', 'revision', 'action']);
        if (!localIdentifier(r.requestId) || !localIdentifier(r.instance) || !localIdentifier(r.credentialEpoch) || !Number.isSafeInteger(r.revision) || r.revision < 1 || r.revision > v.revision || !['grant', 'revoke'].includes(r.action) || seen.has(r.requestId))
            throw new PermissionFault('local_grant_unavailable');
        seen.add(r.requestId);
    }
    if (v.grant !== null) {
        strictPermissionObject(v.grant, ['target', 'expiresAt', 'credentialEpoch']);
        validateLocalTarget(v.grant.target);
        if (!Number.isSafeInteger(v.grant.expiresAt) || v.grant.expiresAt < 0 || !localIdentifier(v.grant.credentialEpoch) || !v.requests.some((r: Saved) => r.action === 'grant' && r.revision === v.revision && r.instance === v.grant.target.instance && r.credentialEpoch === v.grant.credentialEpoch))
            throw new PermissionFault('local_grant_unavailable');
    }
    return structuredClone(v) as Snapshot;
}
/** Additional expiring local grant; never migrates or widens WorkspacePermissions.
 * Lock corruption/save failure is a tombstone. Startup creates no files. */
export class LocalMcpGrants {
    private poisoned = false;
    constructor(readonly file: string) { }
    private async read(): Promise<Snapshot> {
        try {
            const s = await lstat(this.file);
            if (!s.isFile() || s.isSymbolicLink() || s.size > 65536)
                throw Error();
            return validate(JSON.parse(await readFile(this.file, 'utf8')));
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return { version: 1, revision: 0, grant: null, requests: [] };
            throw new PermissionFault('local_grant_unavailable');
        }
    }
    private async locked<T>(fn: (s: Snapshot) => Promise<T>): Promise<T> {
        if (this.poisoned)
            throw new PermissionFault('local_grant_unavailable');
        await mkdir(dirname(this.file), { recursive: true });
        let h;
        try {
            h = await open(this.file + '.lock', 'wx', 0o600);
        }
        catch {
            throw new PermissionFault('local_grant_busy');
        }
        try {
            return await fn(await this.read());
        }
        finally {
            await h.close();
            if (!this.poisoned)
                await rm(this.file + '.lock').catch(() => { this.poisoned = true; });
        }
    }
    snapshot() { return this.locked(async (s) => s); }
    save(instance: string, revision: number, requestId: string, epoch: string, grant: LocalControlGrant | null, check: () => Promise<void>) {
        return this.locked(async (old) => {
            if (old.requests.some(r => r.requestId === requestId))
                throw new PermissionFault('request_already_recorded');
            if (revision !== old.revision || old.revision >= Number.MAX_SAFE_INTEGER)
                throw new PermissionFault('local_grant_stale');
            if (!localIdentifier(instance) || !localIdentifier(requestId) || !localIdentifier(epoch) || old.requests.length >= 64)
                throw new PermissionFault('request_capacity');
            const next = validate({ version: 1, revision: old.revision + 1, grant, requests: [...old.requests, { requestId, instance, credentialEpoch: epoch, revision: old.revision + 1, action: grant ? 'grant' : 'revoke' }] });
            await check();
            const temp = this.file + '.' + randomUUID() + '.tmp';
            try {
                const h = await open(temp, 'wx', 0o600);
                try {
                    await h.writeFile(JSON.stringify(next));
                    await h.sync();
                }
                finally {
                    await h.close();
                }
                await check(); await rename(temp, this.file);
            }
            catch {
                this.poisoned = true;
                throw new PermissionFault('local_grant_save_failed');
            }
            finally {
                await rm(temp, { force: true }).catch(() => { });
            }
            return next;
        });
    }
}
