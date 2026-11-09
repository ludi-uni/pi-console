import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/css-stub-register.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultPreferences } from '../web/preferences.ts';

const { default: SettingsPage } = await import('../web/SettingsPage.tsx');
const remoteModule = await import('../web/SettingsRemoteConnections.tsx');
const RemoteConnections: React.ComponentType<{ ja?: boolean }> = remoteModule.default;
const { friendlyRemoteError, isLocalHttps, parsePublicConnectionJson, remoteSetupState, savedCertificate } = remoteModule;
const future = new Date(Date.now() + 86_400_000).toISOString();
const readyView = (overrides: Record<string, unknown> = {}) => ({
  connection: { connection: 'caivi-vm', hostName: 'AI-DESKTOP-01', gui: { address: '10.0.0.1', port: 47831, pinSha256: 'A'.repeat(64), expiresUtc: future, generation: '1' }, transfer: { address: '10.0.0.1', port: 47832, pinSha256: 'B'.repeat(64), expiresUtc: future, generation: '1' } },
  enabled: true, operatorGranted: true, grants: { read: true, operate: false, send: false }, roles: { gui: { tokenRegistered: true, pinApproved: true, error: null, pending: [] }, transfer: { tokenRegistered: true, pinApproved: true, error: null, pending: [] } }, uncertain: { preserved: true }, tombstones: {}, revision: 7, ...overrides,
});

test('default remote card keeps advanced controls collapsed and presents one setup CTA', () => {
  const html = renderToStaticMarkup(React.createElement(RemoteConnections, { ja: false }));
  assert.match(html, /caivi-vm · AI-DESKTOP-01/);
  assert.match(html, /Checking setup…/);
  assert(!html.includes('<details class="remote-advanced" open=""'));
  assert(!html.includes('type="password"'));
  assert(!html.includes('name="token"'));
});

test('current GUI proof is successful even when transfer remains deliberately untested', () => {
  const view = readyView();
  const proof = { revision: 7, at: new Date().toISOString(), gui: { ok: true, error: null, outcome: 'ok' }, transfer: { state: 'UNTESTED', reason: 'no probe' } };
  assert.equal(remoteSetupState(view as any, proof), 'gui-proven');
  assert.equal(remoteSetupState(readyView({ roles: { ...view.roles, gui: { tokenRegistered: true, pinApproved: false, error: null } } }) as any), 'pin-missing');
  assert.equal(remoteSetupState(readyView({ connection: { ...view.connection, gui: { ...view.connection.gui, expiresUtc: '2000-01-01T00:00:00.000Z' } } }) as any), 'expired');
  assert.equal(remoteSetupState(readyView({ operatorGranted: false }) as any), 'ready-to-test');
  assert.equal(remoteSetupState(readyView({ connection: { ...view.connection, transfer: { ...view.connection.transfer, expiresUtc: '2000-01-01T00:00:00.000Z' } } }) as any), 'ready-to-test');
  assert.equal(remoteSetupState(view as any, { ...proof, gui: { ok: false, error: 'UNKNOWN', outcome: 'refused' } }), 'gui-failed');
  assert.deepEqual(savedCertificate(view as any, 'gui'), { pinSha256: 'A'.repeat(64), expiresUtc: future });
});

test('friendly state and error helpers do not turn raw operator errors into main UI copy', () => {
  assert.match(friendlyRemoteError('remote_local_operator_required', false), /local Console owner/);
  assert.match(friendlyRemoteError('unexpected_code', false), /Refresh the status/);
  assert.equal(remoteSetupState(undefined), 'loading');
  assert.equal(remoteSetupState(readyView({ connection: null }) as any), 'unconfigured');
});

test('public connection import accepts only complete public role metadata and normalizes it locally', () => {
  const imported = parsePublicConnectionJson(`\uFEFF${JSON.stringify({ Role: 'GUI', Generation: 'gen-20261031T120000Z-a1b2c3d4', GuestAddress: '192.168.50.4', Port: 47831, CertificateSha256: 'a'.repeat(64), CertificateExpiresUtc: '2026-12-01T00:00:00+09:00' })}`);
  assert.equal(imported.role, 'gui');
  assert.equal(imported.endpoint.pinSha256, 'A'.repeat(64));
  assert.equal(imported.endpoint.expiresUtc, '2026-11-30T15:00:00.000Z');
  for (const invalid of [
    { Role: 'gui', Generation: 'g', GuestAddress: '8.8.8.8', Port: 47831, CertificateSha256: 'A'.repeat(64), CertificateExpiresUtc: future },
    { Role: 'transfer', Generation: 'gen-20261031T120000Z-a1b2c3d4', GuestAddress: '10.0.0.4', Port: 47831, CertificateSha256: 'A'.repeat(64), CertificateExpiresUtc: future },
    { Role: 'gui', Generation: 'gen-20261031T120000Z-a1b2c3d4', GuestAddress: '10.0.0.4', Port: 47831, CertificateSha256: 'A'.repeat(64), CertificateExpiresUtc: future, token: 'never accepted' },
  ]) assert.throws(() => parsePublicConnectionJson(JSON.stringify(invalid)), /invalid_public_connection_file/);
  assert.throws(() => parsePublicConnectionJson(`{"Role":"gui","Role":"gui","Generation":"g","GuestAddress":"10.0.0.4","Port":47831,"CertificateSha256":"${'A'.repeat(64)}","CertificateExpiresUtc":"${future}"}`), /invalid_public_connection_file/);
});

test('remote settings keep guarded routes, saved-PIN approval, confirmations, and no mount POST', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../web/SettingsRemoteConnections.tsx', import.meta.url), 'utf8');
  assert(source.includes("'x-pi-remote-admin': '1'"));
  assert(source.includes("'/credential-channel'"));
  assert(source.includes("const savedPin = view?.connection?.[role].pinSha256"));
  assert(source.includes('await file.text()'));
  assert(source.includes('invalid_public_connection_file'));
  assert(source.includes('confirmed: true'));
  assert(source.includes("'/approval'"));
  assert(source.includes('pendingApproval'));
  assert(source.includes('Approve this one action'));
  assert(source.includes('Approve this one request?'));
  assert(source.includes('Transfer is untested and is not treated as a connection failure'));
  assert(source.includes("useEffect(() => { void run(refresh); }, []);"));
  // Grant UI: toggles post to /grants, prerequisites shown, operate depends on read
  assert(source.includes("'/grants'"));
  assert(source.includes('grants: { [grant]: granted }'));
  assert(source.includes('remote_grant_requires_read'));
  assert(source.includes('Permissions for this connection'));
  // Target bind via server-side probe only; no identity fields accepted from the client
  assert(source.includes("'/target'"));
  assert(source.includes('action: \'probe\''));
  assert(source.includes('you cannot type identity values here'));
  // Artifact registration by staged name only; no path input in the UI
  assert(source.includes("'/artifacts'"));
  assert(source.includes('you cannot type an arbitrary path here'));
  // Easy file selection: picker upload, staged list, separate register approval
  assert(source.includes("'/artifacts-upload'"));
  assert(source.includes('dataBase64'));
  assert(source.includes('bytesToBase64'));
  assert(source.includes('await file.arrayBuffer()'));
  assert(source.includes('maxArtifactBytes'));
  assert(source.includes('artifact_too_large'));
  assert(source.includes('artifact_invalid_name'));
  assert(source.includes("action: 'register'"));
  assert(source.includes("action: 'unstage'"));
  assert(source.includes('Confirm registration'));
  assert(source.includes('staged'));
  assert(source.includes('artifact_manifest_untrusted'));
  assert(!source.includes('type="password"'));
  assert(!source.includes('name="token"'));
  assert(!source.includes('localStorage'));
});

test('credential links stay loopback HTTPS-only and always require an explicit certificate checkbox', () => {
  const source = String(remoteModule.default);
  assert.match(source, /Confirm local HTTPS certificate/);
  assert.equal(isLocalHttps('https://127.0.0.1:47831/#opaque'), true);
  assert.equal(isLocalHttps('https://localhost:47831/#opaque'), true);
  assert.equal(isLocalHttps('https://localhost/#opaque'), false);
  assert.equal(isLocalHttps('http://127.0.0.1:47831/'), false);
});

test('settings navigation includes one remote-connections section', () => {
  const html = renderToStaticMarkup(React.createElement(SettingsPage, { preferences: defaultPreferences, onChange: () => {}, onBack: () => {}, workspaceCount: 0, sessionCount: 0, connected: true }));
  assert.match(html, /Remote connections/);
});
