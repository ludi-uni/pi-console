import {test} from 'node:test';
// No external module/helper import here, even when legacy launcher env inputs exist.
test('guarded launcher pins profile/source/scope and exact child configuration before dummy key reads and process start',
  {skip:'OS/external acceptance deferred: tests/os-acceptance/readonly-launch.entry.ts; separate user approval required'},
  ()=>{throw new Error('OS/external acceptance is not part of unit/regression');});
