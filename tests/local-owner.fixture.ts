import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, appendFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac, randomUUID } from 'node:crypto';
import { createLocalOwnerBootstrap } from '../server/local-owner-bootstrap.ts';
import { createTrustedLocalMcp } from '../server/trusted-local-mcp.ts';
import { WorkspacePermissions } from '../server/workspace-permissions.ts';
import { PromptReceipts } from '../server/runtime/prompt-receipts.ts';
export const token = 'a'.repeat(48), nonce = 'b'.repeat(32), keys = { read: '1'.repeat(64), control: '2'.repeat(64), final: '3'.repeat(64) };
export async function ownerFixture(options: any = {}) {
    const root = await mkdtemp(join(tmpdir(), 'dummy-owner-')), records: {
        server: Server;
        closed: boolean;
    }[] = [];
    if(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT)await appendFile(join(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT,'pi-fixtures.jsonl'),JSON.stringify({root,pid:process.pid,phase:'created',provider:'dummy-owner-loopback'})+'\n');
    let app: ReturnType<typeof createLocalOwnerBootstrap> | undefined, consoleApp: ReturnType<typeof createTrustedLocalMcp> | undefined, time = Date.now(), closed = false;
    const cleanup = async () => {
        if (closed)
            return;
        closed = true;
        consoleApp?.dispose();
        await app?.dispose();
        assert(!app?.status().listening);
        for (const r of records) {
            r.server.closeAllConnections();
            if (r.server.listening)
                await new Promise<void>(done => r.server.close(() => done()));
            r.closed = !r.server.listening;
            assert(r.closed);
        }
        assert.equal((await realpath(root)).toLowerCase(),root.toLowerCase());
        await rm(root, { recursive: true, force: true });
        if(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT)await appendFile(join(process.env.PI_CONSOLE_TEST_EVIDENCE_ROOT,'pi-fixtures.jsonl'),JSON.stringify({root,pid:process.pid,phase:'removed',provider:'dummy-owner-loopback',listenersClosed:records.every(r=>r.closed),realPiCalls:0})+'\n');
        const evidence = process.env.TRUSTED_LOCAL_TEST_OWNER_EVIDENCE;
        if (evidence) {
            let rows: any[] = [];
            try {
                rows = JSON.parse(await readFile(evidence, 'utf8'));
            }
            catch { }
            rows.push({ kind: 'dummy-local-owner-listeners', ownerListenerClosed: !app?.status().listening, managerListeners: records.map(r => ({ closed: r.closed })), tempRemoved: true, realCredentials: false, realPiProviderMcp: false, osIsolationTest: false });
            await writeFile(evidence, JSON.stringify(rows) + '\n');
        }
    };
    try {
        const assets = join(root, 'assets-root');
        await mkdir(join(assets, 'assets'), { recursive: true });
        await writeFile(join(assets, 'owner.html'), '<script src="/assets/owner.js"></script>');
        await writeFile(join(assets, 'assets', 'owner.js'), '/* DUMMY NONSECRET ASSET */');
        app = createLocalOwnerBootstrap({ enabled: true, managementToken: token, nonce, profileFile: join(root, 'credentials.json'), legacyKeys: ['4'.repeat(64)], assetsRoot: assets, now: () => time, delegate: async (req, res) => consoleApp ? await consoleApp.handleOwner(req, res) || await consoleApp.handleOwnerScope(req, res) : false, ...options });
        if (options.withConsole)
            consoleApp = createTrustedLocalMcp({ workspaces: { list: () => [] }, open: () => { throw Error('REAL_PI_FORBIDDEN'); } } as any, new WorkspacePermissions(join(root, 'permissions.json')), new PromptReceipts(join(root, 'receipts')), { grantFile: join(root, 'grants.json') }, { enabled: false, owner: { mode: 'local-session', verify: app.verify }, legacyCredentialKeys: [] });
        const manager = createServer((req, res) => void (async () => {
            if (req.url === '/api/manage/identity') {
                const challenge = req.headers['x-pi-console-manage-challenge'];
                res.end(JSON.stringify({ service: 'pi-console', pid: 1234, startedAt: 'dummy-start', nonce, proof: createHmac('sha256', token).update(`pi-console-identity:${challenge}`).digest('hex') }));
                return;
            }
            let text = '';
            for await (const c of req)
                text += c;
            await app!.issue(req, res, JSON.parse(text));
        })().catch(() => {
            if (!res.writableEnded) {
                res.writeHead(409);
                res.end('{}');
            }
        }));
        records.push({ server: manager, closed: false });
        manager.listen(0, '127.0.0.1');
        await once(manager, 'listening');
        const a = manager.address();
        assert(a && typeof a === 'object');
        const managerPort = a.port;
        const call = (port: number, path: string, body: any = {}, headers: any = {}, method = 'POST') => new Promise<{
            status: number;
            body: any;
            text: string;
            headers: any;
        }>((done, fail) => {
            const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, res => {
                let text = '';
                res.on('data', c => text += c);
                res.on('end', () => {
                    let body;
                    try {
                        body = JSON.parse(text);
                    }
                    catch {
                        body = null;
                    }
                    done({ status: res.statusCode!, body, text, headers: res.headers });
                });
                res.on('error', fail);
            });
            req.setTimeout(5000, () => req.destroy(Error('dummy_http_timeout')));
            req.on('error', fail);
            req.end(method === 'POST' ? JSON.stringify(body) : undefined);
        });
        const issue = async (body: any = { challenge: nonce, requestId: randomUUID() }, headers: any = {}) => call(managerPort, '/api/manage/local-owner/open', body, { 'x-pi-console-manage-proof': createHmac('sha256', token).update(`pi-console-local-owner:${nonce}:${body.requestId}`).digest('hex'), ...headers });
        const browser = (path: string, body: any = {}, cookie?: string, headers: any = {}, method = 'POST') => { const port = app!.status().port!; return call(port, '/local-owner/' + path, body, { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...headers }, method); };
        const login = async () => { const issued = await issue(); assert.equal(issued.status, 200); const claim = await browser('auth/claim', { code: issued.body.code }); assert.equal(claim.status, 200); return { cookie: claim.headers['set-cookie'][0].split(';')[0], issued, claim }; };
        return { root, assets, app, records, managerPort, call, issue, browser, login, cleanup, advance: (ms: number) => { time += ms; }, credentials: () => ({ ...keys, expiresAt: time + 60000 }), now: () => time };
    }
    catch (e) {
        await cleanup();
        throw e;
    }
}
