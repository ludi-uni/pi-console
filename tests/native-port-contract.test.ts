import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativePort } from '../package/native/windows-folder-port.mjs';
import { windowsDirectoryPolicy as pin, windowsTraversalPolicy as traversal } from '../server/windows-folder-provider.ts';
function stub() {
  const events: any[] = [];
  const binding = { candidateOnly: true, policyVersion: 2,
    openVolumeRoot(...args: any[]) { events.push(['root', ...args]); return {}; },
    openDirectory(...args: any[]) { events.push(['open', ...args]); return {}; },
    createDirectory(...args: any[]) { events.push(['create', ...args]); return {}; },
    createFile(...args: any[]) { events.push(['file', ...args]); return {}; },
    info() {}, assertLocalNtfs() {}, close() {}, audit() {}, closeAll() {}
  };
  return { binding, events };
}
test('adapter sends only explicit traversal or selected-parent pin role to native directory opens', () => {
  const s = stub(), p = nativePort(s.binding, pin, traversal), h = {};
  p.openVolumeRoot('d:', traversal); p.openDirectory(h, 'Data', traversal); p.openDirectory(h, 'Allowed', pin);
  assert.equal(s.events[1].at(-1), false); assert.equal(s.events[2].at(-1), true);
  assert.throws(() => p.openVolumeRoot('d:', pin as any)); assert.throws(() => p.openDirectory(h, 'X', { ...pin }));
});
test('creation always uses restrictive pin policy; traversal policy never reaches a creator', () => {
  const s = stub(), p = nativePort(s.binding, pin, traversal), h = {};
  assert.throws(() => p.createDirectory(h, 'X', traversal as any)); assert.throws(() => p.createFile(h, 'HEAD', Buffer.from('dummy'), traversal as any));
  assert.equal(s.events.length, 0); p.createDirectory(h, 'X', pin); p.createFile(h, 'HEAD', Buffer.from('dummy'), pin); assert.equal(s.events.length, 2);
});
test('old binding or missing policy version is rejected before invoking any method', () => {
  const s = stub(); assert.throws(() => nativePort({ ...s.binding, policyVersion: 1 }, pin, traversal));
  assert.throws(() => nativePort({ ...s.binding, policyVersion: undefined }, pin, traversal)); assert.equal(s.events.length, 0);
});
