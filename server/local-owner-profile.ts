import { randomUUID, createHash } from 'node:crypto';
import { lstat, readFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dedicatedKey } from './local-mcp-owner.ts';
import { strictPermissionObject, PermissionFault } from './workspace-permissions.ts';
type Credentials = {
    read: string;
    control: string;
    final: string;
    expiresAt: number;
};
type Profile = {
    version: 1;
    enabled: false;
    revision: number;
    credentials: Credentials;
    requests: {
        id: string;
        hash: string;
        revision: number;
    }[];
};
export class LocalOwnerProfile {
    private poisoned = false;
    constructor(readonly file: string, private readonly legacy: readonly string[] = [], private readonly reserved: (key: string) => boolean = () => false, private readonly now = Date.now) { }
    private validate(value: any): Profile {
        strictPermissionObject(value, ['version', 'enabled', 'revision', 'credentials', 'requests']);
        strictPermissionObject(value.credentials, ['read', 'control', 'final', 'expiresAt']);
        const c = value.credentials, keys = [c.read, c.control, c.final];
        if (value.version !== 1 || value.enabled !== false || !Number.isSafeInteger(value.revision) || value.revision < 1 || !keys.every(dedicatedKey) || new Set(keys).size !== 3 || keys.some(k => this.legacy.includes(k)) || !Number.isSafeInteger(c.expiresAt) || !Array.isArray(value.requests) || value.requests.length > 64)
            throw new PermissionFault('local_profile_unavailable');
        const ids = new Set();
        for (const r of value.requests) {
            strictPermissionObject(r, ['id', 'hash', 'revision']);
            if (typeof r.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.id) || ids.has(r.id) || !dedicatedKey(r.hash) || !Number.isSafeInteger(r.revision) || r.revision < 1 || r.revision > value.revision)
                throw new PermissionFault('local_profile_unavailable');
            ids.add(r.id);
        }
        return value as unknown as Profile;
    }
    async read(): Promise<Profile | null> {
        if (this.poisoned)
            throw new PermissionFault('local_profile_unavailable');
        try {
            const s = await lstat(this.file);
            if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 32768)
                throw Error();
            return this.validate(JSON.parse(await readFile(this.file, 'utf8')));
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return null;
            throw new PermissionFault('local_profile_unavailable');
        }
    }
    async view() { const p = await this.read(); return { configured: !!p, enabled: false, revision: p?.revision ?? 0, expiresAt: p?.credentials.expiresAt ?? null, credentialActive: !!p && p.credentials.expiresAt > this.now(), activation: 'separate_approval_and_restart' as const }; }
    async result(id: string) {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
            throw new PermissionFault('invalid_request_id');
        const p = await this.read(), r = p?.requests.find(r => r.id === id);
        return { state: r ? 'committed' : 'unknown', revision: r?.revision ?? null, current: await this.view() };
    }
    async save(body: any, check: () => void) {
        strictPermissionObject(body, ['requestId', 'revision', 'credentials', 'confirmed']);
        strictPermissionObject(body.credentials, ['read', 'control', 'final', 'expiresAt']);
        const c = body.credentials, keys = [c.read, c.control, c.final];
        if (body.confirmed !== true || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.requestId) || !keys.every(dedicatedKey) || new Set(keys).size !== 3 || keys.some(k => this.legacy.includes(k) || this.reserved(k)) || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= this.now() || c.expiresAt > this.now() + 86400000)
            throw new PermissionFault('credential_input_rejected');
        await mkdir(dirname(this.file), { recursive: true });
        let lock;
        try {
            lock = await open(this.file + '.lock', 'wx', 0o600);
        }
        catch {
            throw new PermissionFault('local_profile_busy');
        }
        const temp = this.file + '.' + randomUUID() + '.tmp';
        try {
            const old = await this.read();
            if (old?.requests.some(r => r.id === body.requestId))
                throw new PermissionFault('request_already_recorded');
            if (body.revision !== (old?.revision ?? 0) || old && old.requests.length >= 64)
                throw new PermissionFault('local_profile_stale');
            check();
            const next: Profile = { version: 1, enabled: false, revision: (old?.revision ?? 0) + 1, credentials: { read: c.read, control: c.control, final: c.final, expiresAt: c.expiresAt }, requests: [...old?.requests ?? [], { id: body.requestId, hash: createHash('sha256').update(JSON.stringify(c)).digest('hex'), revision: (old?.revision ?? 0) + 1 }] };
            this.validate(next);
            const h = await open(temp, 'wx', 0o600);
            try {
                await h.writeFile(JSON.stringify(next));
                await h.sync();
            }
            finally {
                await h.close();
            }
            check();
            await rename(temp, this.file);
            return this.view();
        }
        catch (e) {
            if (!(e instanceof PermissionFault))
                this.poisoned = true;
            throw e instanceof PermissionFault ? e : new PermissionFault('local_profile_save_failed');
        }
        finally {
            await lock.close();
            await rm(temp, { force: true }).catch(() => { });
            await rm(this.file + '.lock').catch(() => { this.poisoned = true; });
        }
    }
}
