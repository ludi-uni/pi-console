import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateReadOnlyMcpScope, loadReadOnlyMcpScope } from '../server/readonly-mcp-scope.ts';

test('read-only MCP requires a nonempty strict workspace/session allowlist and copies it', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-mcp-scope-'));
  try {
    const valid={version:1,workspaces:[{id:'workspace',path:root,sessionIds:['existing-session']}]};
    const copy=validateReadOnlyMcpScope(valid); valid.workspaces[0].sessionIds.push('new');
    assert.deepEqual(copy.workspaces[0].sessionIds,['existing-session']);
    for(const bad of [undefined,{},[],{version:1,workspaces:[]},{...valid,extra:true},
      {version:2,workspaces:valid.workspaces},
      {version:1,workspaces:[{...valid.workspaces[0],sessionIds:[]}]},
      {version:1,workspaces:[{...valid.workspaces[0],sessionIds:['same','same']}]},
      {version:1,workspaces:[{...valid.workspaces[0],sessionIds:['invalid/id']}]},
      {version:1,workspaces:[{...valid.workspaces[0],path:'relative'}]},
      {version:1,workspaces:[{...valid.workspaces[0],path:'\\\\server\\share'}]},
      {version:1,workspaces:[{...valid.workspaces[0],allowAll:true}]},
      {version:1,workspaces:[valid.workspaces[0],valid.workspaces[0]]}]) assert.throws(()=>validateReadOnlyMcpScope(bad));
    const file=join(root,'readonly-mcp-scope.json');
    await assert.rejects(loadReadOnlyMcpScope(file),/requires a valid readonly-mcp-scope/);
    await writeFile(file,JSON.stringify(valid)); assert.deepEqual(await loadReadOnlyMcpScope(file),valid);
    await writeFile(file,'SECRET_INVALID_SCOPE');
    await assert.rejects(loadReadOnlyMcpScope(file),error=>error instanceof Error && !error.message.includes('SECRET'));
    await writeFile(file,'x'.repeat(16*1024+1)); await assert.rejects(loadReadOnlyMcpScope(file));
    await assert.rejects(loadReadOnlyMcpScope(root));
  } finally { await rm(root,{recursive:true,force:true}); }
});
