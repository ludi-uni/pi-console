import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isVerifiedAccessPrincipal, type AccessConfig, type VerifiedAccessPrincipal } from './access.ts';
import { permissionOwnerRequest } from './dots-permissions-api.ts';
export type LocalMcpOwnerConfig = {
    mode: 'local';
    key: string;
} | {
    mode: 'local-session';
    verify: (req: IncomingMessage) => boolean;
} | {
    mode: 'access-verified-owner';
    subject: string;
    access: AccessConfig;
    principal: (req: IncomingMessage) => VerifiedAccessPrincipal | undefined;
};
export const dedicatedKey = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function createLocalMcpOwner(config: LocalMcpOwnerConfig | undefined, active: () => boolean, now = Date.now) {
    const expected = config?.mode === 'local' && dedicatedKey(config.key) ? Buffer.from(config.key, 'hex') : undefined;
    const pinned = config?.mode === 'access-verified-owner' ? { subject: config.subject, access: { ...config.access }, principal: config.principal } : undefined;
    const localSession = config?.mode === 'local-session' && typeof config.verify === 'function' ? config.verify : undefined;
    const configured = !!expected || !!localSession || !!(pinned && typeof pinned.subject === 'string' && pinned.subject.length > 0 && pinned.subject.length <= 200 && typeof pinned.principal === 'function');
    let disposed = false;
    const count = (req: IncomingMessage, n: string) => req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === n).length;
    return { configured, verify(req: IncomingMessage) {
            if (disposed || !configured || !localSession && !active())
                return false;
            if (localSession)
                return localSession(req) && permissionOwnerRequest(req);
            if (expected) {
                const v = req.headers['x-pi-console-local-owner-key'], ok = dedicatedKey(v), b = ok ? Buffer.from(v, 'hex') : Buffer.alloc(32);
                const match = timingSafeEqual(expected, b);
                b.fill(0);
                return match && ok && count(req, 'x-pi-console-local-owner-key') === 1 && permissionOwnerRequest(req);
            }
            const p = pinned!.principal(req), a = pinned!.access;
            return isVerifiedAccessPrincipal(p) && p.subject === pinned!.subject && p.issuer === a.issuer && p.audience === a.audience && p.expiresAt > now() &&
                req.method === 'POST' && req.headers.host === a.host && req.headers.origin === a.origin && req.headers['sec-fetch-site'] === 'same-origin' && req.headers['content-type'] === 'application/json' && req.headers['x-pi-console-admin'] === '1' &&
                ['host', 'origin', 'sec-fetch-site', 'content-type', 'x-pi-console-admin', 'cf-access-jwt-assertion'].every(n => count(req, n) === 1);
        }, dispose() { disposed = true; expected?.fill(0); } };
}
