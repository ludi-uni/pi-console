// Explicitly injected candidate binding. No loader, env switch, or Console composition.
export function nativePort(binding, expectedPolicy, expectedTraversalPolicy) {
  if (binding.candidateOnly !== true || binding.policyVersion !== 2) throw Error('unexpected_binding');
  if (!expectedTraversalPolicy || expectedTraversalPolicy === expectedPolicy || expectedTraversalPolicy.shareWrite !== true || expectedTraversalPolicy.shareDelete !== true || expectedPolicy.shareWrite !== false || expectedPolicy.shareDelete !== false) throw Error('unexpected_policy_contract');
  for (const method of ['openVolumeRoot','openDirectory','createDirectory','createFile','info','assertLocalNtfs','close','audit','closeAll']) if (typeof binding[method] !== 'function') throw Error('incomplete_binding');
  const policy = p => { if (p !== expectedPolicy) throw Error('unexpected_handle_policy'); };
  return {
    implementation: 'native',
    openVolumeRoot(drive, p) { if (p !== expectedTraversalPolicy) throw Error('unexpected_handle_policy'); return binding.openVolumeRoot(drive); },
    openDirectory(parent, name, p) { if (p !== expectedPolicy && p !== expectedTraversalPolicy) throw Error('unexpected_handle_policy'); return binding.openDirectory(parent, name, p === expectedPolicy); },
    createDirectory(parent, name, p) { policy(p); return binding.createDirectory(parent, name); },
    createFile(parent, name, bytes, p) { policy(p); const b = Buffer.from(bytes); if (b.length > 4096) throw Error('write_limit'); return binding.createFile(parent, name, b); },
    info(handle) { return binding.info(handle); },
    assertLocalNtfs(handle) { binding.assertLocalNtfs(handle); },
    close(handle) { binding.close(handle); }
  };
}
