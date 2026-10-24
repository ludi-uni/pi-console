import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {isExplicitOsAcceptanceEntry} from '../helpers/os-acceptance-entry.ts';

// Not a *.test.ts: never part of automatic discovery. Import/Node test-worker execution
// registers nothing and never calls setup. No environment flag enables this entry.
// The CLI switch selects OS work; it does NOT supply the separately required user approval.
if(isExplicitOsAcceptanceEntry(import.meta.url,process.argv,process.execArgv,process.env.NODE_TEST_CONTEXT)){
  console.warn('OS acceptance selected, NOT authorized by this switch. Separate explicit user approval must already exist. This test changes a Temp dummy key ACL.');
  test('manual Windows setup protects only a dummy key, pins scope and preserves existing config', {skip:process.platform!=='win32',timeout:15000}, async()=>{
    const root=await mkdtemp(join(tmpdir(),'pi-readonly-manual-'));
    const before='DUMMY_SETTING=preserved\r\nPI_CONSOLE_READONLY_MCP=1\r\n';
    const scope=JSON.stringify({version:1,workspaces:[{id:'fixture',path:root,sessionIds:['closed']}]});
    try {
      await writeFile(join(root,'.env'),before);
      await writeFile(join(root,'readonly-mcp-scope.json'),scope);
      const script=join(root,'fixture.ps1');
      await writeFile(script,`$ErrorActionPreference='Stop'
Import-Module $env:DUMMY_MODULE -Force
$key=ConvertTo-SecureString $env:DUMMY_KEY -AsPlainText -Force
$phase='scope'
try {
  $rejected=$false
  try{$null=Install-ProtectedReadOnlyMcpKey -DataDir $env:DUMMY_ROOT -Key $key -ApprovedScopeSha256 ('0'*64)}catch{$rejected=$true}
  if(-not $rejected -or (Test-Path -LiteralPath (Join-Path $env:DUMMY_ROOT 'readonly-mcp.key'))){throw 'Scope check failed'}
  $phase='install'
  $result=Install-ProtectedReadOnlyMcpKey -DataDir $env:DUMMY_ROOT -Key $key -ApprovedScopeSha256 $env:DUMMY_SCOPE_HASH
  $phase='read'
  $value=Get-ProtectedReadOnlyMcpKey -DataDir $env:DUMMY_ROOT
  if($value -cne $env:DUMMY_KEY -or $result.scopeChanged -or $result.restarted){throw 'Setup failed'}
  $phase='overwrite';$rejected=$false
  try{$null=Install-ProtectedReadOnlyMcpKey -DataDir $env:DUMMY_ROOT -Key $key -ApprovedScopeSha256 $env:DUMMY_SCOPE_HASH}catch{$rejected=$true}
  if(-not $rejected){throw 'Existing key not protected'}
  $phase='broad_acl';$path=Join-Path $env:DUMMY_ROOT 'readonly-mcp.key'
  $null=& (Join-Path $env:SystemRoot 'System32/icacls.exe') $path /grant '*S-1-5-32-545:R'
  $broad=@((Get-Acl -LiteralPath $path).GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {$_.IdentityReference.Value -eq 'S-1-5-32-545' -and $_.AccessControlType -eq 'Allow'})
  if($broad.Count -eq 0){$phase='grant_did_not_change';throw 'Dummy ACL fixture could not be broadened'}
  $phase='read_broad';$rejected=$false
  try{$value=Get-ProtectedReadOnlyMcpKey -DataDir $env:DUMMY_ROOT}catch{$rejected=$true}
  if(-not $rejected){throw 'Broad ACL accepted'}
  Write-Output '{"ok":true,"scopePinned":true,"overwriteRejected":true,"broadAclRejected":true}'
}catch{Write-Output ('{"ok":false,"phase":"'+$phase+'","errorType":"'+$_.Exception.GetType().Name+'"}');exit 1}finally{$key.Dispose();$value=$null}
`);
      const windowsRoot=process.env.SystemRoot??'C:\\Windows';
      const proc=spawn(join(windowsRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,stdio:'pipe',env:{SystemRoot:windowsRoot,
        PATH:join(windowsRoot,'System32'),PATHEXT:'.COM;.EXE;.BAT;.CMD',
        TEMP:tmpdir(),TMP:tmpdir(),DUMMY_ROOT:root,DUMMY_MODULE:join(process.cwd(),'scripts','ReadOnlyMcpSecret.psm1'),DUMMY_KEY:'a7'.repeat(32),
        DUMMY_SCOPE_HASH:createHash('sha256').update(scope).digest('hex')}});
      let output='';proc.stdout.on('data',data=>output+=data.toString());proc.stderr.on('data',data=>output+=data.toString());
      const [code]=await once(proc,'close');
      assert.equal(code,0,output);assert.equal(JSON.parse(output).ok,true);assert.ok(!output.includes('a7'.repeat(32)));
      assert.equal(await readFile(join(root,'.env'),'utf8'),before+'PI_CONSOLE_READONLY_MCP_AUTH=shared_secret\r\n');
      assert.equal(await readFile(join(root,'readonly-mcp-scope.json'),'utf8'),scope);
      assert.equal(await readFile(join(root,'readonly-mcp.key'),'utf8'),'a7'.repeat(32));
    } finally {await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  });
}
