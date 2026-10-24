import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {isExplicitOsAcceptanceEntry} from '../helpers/os-acceptance-entry.ts';

// External PowerShell module import is OS/external acceptance, not a unit-test helper.
// Path environment variables are inputs, NOT approval. Import/test-worker execution is inert.
if(isExplicitOsAcceptanceEntry(import.meta.url,process.argv,process.execArgv,process.env.NODE_TEST_CONTEXT)){
  console.warn('OS/external acceptance selected, NOT authorized by this switch. Separate explicit user approval of the external module and operations must already exist.');
  test('guarded launcher pins profile/source/scope and exact child configuration before dummy key reads and process start',{
    skip:process.platform!=='win32'||!process.env.PI_CONSOLE_TEST_GUARDED_LAUNCHER,timeout:20000,
  },async()=>{
    const modulePath=process.env.PI_CONSOLE_TEST_GUARDED_LAUNCHER!;
    const root=await mkdtemp(join(tmpdir(),'pi-guarded-launch-'));
    const launch=join(root,'secure-mcp-readonly'),repo=join(root,'repo'),data=join(root,'dummy-data');
    try{
      for(const path of[launch,data,join(root,'secure-mcp-echo-test','client'),join(repo,'server'),join(repo,'server','runtime'),join(repo,'scripts')])await mkdir(path,{recursive:true});
      await copyFile(join(dirname(modulePath),'readonly-guarded.yaml'),join(launch,'readonly-guarded.yaml'));
      await copyFile(process.env.PI_CONSOLE_TEST_TUNNEL_CLIENT!,join(root,'secure-mcp-echo-test','client','tunnel-client.exe'));
      for(const path of['server/readonly-mcp-guard.ts','server/readonly-mcp.ts','server/readonly-mcp-auth.ts','server/runtime/manager.ts','server/runtime/readonly-sessions.ts','scripts/readonly-mcp-guard.ts','scripts/ReadOnlyMcpSecret.psm1'])await copyFile(join(process.cwd(),path),join(repo,path));
      await writeFile(join(data,'readonly-mcp-scope.json'),'dummy approved scope bytes');
      const script=join(root,'dummy.ps1');await copyFile(join(process.cwd(),'tests','readonly-launch.fixture.ps1'),script);
      const windows=process.env.SystemRoot??'C:\\Windows';
      const proc=spawn(join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,stdio:'pipe',env:{SystemRoot:windows,
        PATH:[dirname(process.execPath),join(windows,'System32')].join(';'),PATHEXT:'.COM;.EXE;.BAT;.CMD',TEMP:tmpdir(),TMP:tmpdir(),DUMMY_MODULE:modulePath,DUMMY_REPO:repo,DUMMY_DATA:data,DUMMY_LAUNCH:launch,DUMMY_KEY:'a7'.repeat(32)}});
      let output='';proc.stdout.on('data',part=>output+=part.toString());proc.stderr.on('data',part=>output+=part.toString());const[code]=await once(proc,'close');
      assert.equal(code,0,output);assert.equal(JSON.parse(output).ok,true);assert.ok(!output.includes('a7'.repeat(32)));assert.ok(!output.includes('offline_dummy'));
    }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  });
}
