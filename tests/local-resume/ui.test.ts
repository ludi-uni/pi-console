import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';

// Source-only fixture: no Console, owner authentication, DPAPI or npm launch.
test('resume UI preserves unknown saves and shares npm/clone setup with renewal', { timeout: 60000 }, async () => {
  const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import LocalResumeMcp from '/web/LocalResumeMcp.tsx';function App(){const[e,s]=useState(Date.now()+600000);window.expireFixture=()=>s(Date.now()-1);return React.createElement(LocalResumeMcp,{available:true,ownerExpiresAt:e})}createRoot(document.getElementById('root')).render(React.createElement(App));`;
  const bundle = await build({
    configFile: false, envFile: false, logLevel: 'error',
    plugins: [{ name: 'resume-ui-fixture', resolveId: id => id === 'virtual:resume-ui' ? '\0virtual:resume-ui' : undefined, load: id => id === '\0virtual:resume-ui' ? source : undefined }],
    build: { write: false, minify: false, rollupOptions: { input: 'virtual:resume-ui' } },
  });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as import('rollup').RollupOutput;
  const entry = output.output.find(asset => asset.type === 'chunk' && asset.isEntry)!;
  const assets = new Map(output.output.map(asset => ['/' + asset.fileName, {
    body: asset.type === 'chunk' ? asset.code : asset.source,
    type: asset.fileName.endsWith('.css') ? 'text/css' : 'application/javascript',
  }]));
  const css = [...assets.keys()].filter(path => path.endsWith('.css')).map(path => `<link rel="stylesheet" href="${path}">`).join('');
  const server = createServer((req, res) => {
    const asset = assets.get(req.url ?? '');
    res.setHeader('content-type', asset?.type ?? 'text/html');
    res.end(asset?.body ?? `<!doctype html><head>${css}</head><div id="root"></div><script type="module" src="/${entry.fileName}"></script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let approvals = 0, recoveries = 0;
    // Stored approvals that outlived a restart show approved/expired without a
    // runtime binding; revoked and pending entries stay non-revocable here.
    const view = { connections: [
      { connectionId: 'conn-1', name: 'Dummy', state: 'pending', expiresAt: Date.now() + 3600000 },
      { connectionId: 'conn-2', name: 'Stored grant', state: 'approved', runtimeBound: false, parent: 'D:\\Dummy\\Allowed', expiresAt: Date.now() + 86400000 },
      { connectionId: 'conn-3', name: 'Stored lapse', state: 'expired', runtimeBound: false, parent: 'D:\\Dummy\\Allowed', expiresAt: Date.now() - 1 },
      { connectionId: 'conn-4', name: 'Other live', state: 'connected', runtimeBound: true, expiresAt: Date.now() + 300000 },
      { connectionId: 'conn-5', name: 'Gone', state: 'revoked', runtimeBound: false, expiresAt: Date.now() - 1000 },
      { connectionId: 'conn-6', name: 'Expired request', state: 'expired', runtimeBound: false, parent: null, expiresAt: Date.now() - 1000 },
    ], revokeRequestId: 'revoke-1' };
    await page.route('**/local-owner/resume/*', async route => {
      const name = route.request().url().split('/').at(-1);
      if (name === 'approve') { approvals++; await route.abort('failed'); return; }
      const result = name === 'view' ? view : name === 'revoke' ? {
        state: 'committed', requestId: JSON.parse(route.request().postData() ?? '{}').requestId,
      } : name === 'review' ? {
        reviewId: 'review-1', requestId: 'request-1', connectionId: 'conn-1', parent: { path: 'D:\\Dummy\\Allowed' },
        operations: ['list'], expiresAt: Date.now() + 86400000, reviewUntil: Date.now() + 300000,
      } : name === 'result' ? { state: 'unknown', current: view }
        : name === 'recover' ? (++recoveries === 1 ? {} : { state: 'not_committed', current: view }) : undefined;
      assert(result, `unexpected request: ${name}`);
      await route.fulfill({ json: result });
    });
    const address = server.address() as import('node:net').AddressInfo;
    await page.goto(`http://127.0.0.1:${address.port}`);
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    await button('ローカル連携を始める').click();
    await page.getByLabel('Resume pending connection').selectOption('conn-1');
    await page.getByLabel('Resume parent folder').fill('D:\\Dummy\\Allowed');
    await button('許可内容を確認').click();
    await page.getByLabel('Confirm resumed parent scope').check();
    await button('この内容で始める').click();
    const discard = button('この申請を破棄して入力に戻る');
    await expect(discard).toBeVisible();
    await button('保存結果を照合').click();
    await expect(discard).toBeEnabled();
    // Unknown lookup and even a malformed 200 response never unlock a new save.
    await discard.click();
    await expect(discard).toBeEnabled();
    assert.notEqual(await page.evaluate(() => sessionStorage.getItem('pi-console-resume-request-v1')), null);
    await discard.click();
    await expect(discard).toHaveCount(0);
    await expect(page.getByLabel('Resume parent folder')).toBeVisible();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('pi-console-resume-request-v1')), null);
    assert.equal(approvals, 1, 'recovery must not resend approval');

    // Stored approvals without a runtime binding (restart-surviving grants)
    // keep an individual revoke; pending and revoked entries do not offer one.
    const row = (id: string) => page.locator('li', { hasText: id });
    const revokes: string[] = [];
    await page.unroute('**/local-owner/resume/revoke');
    await page.route('**/local-owner/resume/revoke', async route => {
      const connectionId=JSON.parse(route.request().postData() ?? '{}').connectionId;
      revokes.push(connectionId);
      const grant=view.connections.find(connection=>connection.connectionId===connectionId);
      assert(grant);grant.state='revoked';
      await route.fulfill({ json: { state: 'committed', requestId: 'revoke-1' } });
    });
    const grantButtons = row('conn-2').getByRole('button', { name: 'この連携を解除' });
    await expect(grantButtons).toHaveCount(1);
    await expect(row('conn-3').getByRole('button', { name: 'この連携を解除' })).toHaveCount(1);
    await expect(row('conn-4').getByRole('button', { name: 'この連携を解除' })).toHaveCount(1);
    await expect(row('conn-1').getByRole('button', { name: 'この連携を解除' })).toHaveCount(0);
    await expect(row('conn-5').getByRole('button', { name: 'この連携を解除' })).toHaveCount(0);
    await expect(row('conn-6').getByRole('button', { name: 'この連携を解除' })).toHaveCount(0);
    await grantButtons.click();
    await expect.poll(() => revokes).toEqual(['conn-2']);
    await expect(row('conn-2').getByRole('button', { name: 'この連携を解除' })).toHaveCount(0);
    await expect(row('conn-4')).toContainText('connected');
    await expect(row('conn-4').getByRole('button', { name: 'この連携を解除' })).toBeEnabled();
    await page.route('**/local-owner/resume/revoke', async route => route.fulfill({ json: { state: 'committed', requestId: 'revoke-1' } }));

    await page.getByLabel('Open local connection instructions').click();
    await page.locator('summary').filter({ hasText: '手順2' }).click();
    await expect(page.getByLabel('Local MCP launch configuration')).toContainText('npx');
    await page.getByLabel('Local MCP install source').selectOption('clone');
    await expect(page.getByLabel('Local MCP launch configuration')).toHaveCount(0);
    await page.getByLabel('Local clone repository root').fill('D:\\Owner Space\\pi-console');
    await page.getByLabel('Local clone node command').fill('C:\\Node Space\\node.exe');
    await expect(page.getByLabel('Local MCP launch configuration')).toContainText('Owner Space');
    await page.evaluate(() => (window as unknown as { expireFixture: () => void }).expireFixture());
    await expect(page.getByLabel('Renew owner verification command')).toContainText('Owner Space');
    await expect(page.getByLabel('Renewal command install source')).toHaveValue('clone');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
