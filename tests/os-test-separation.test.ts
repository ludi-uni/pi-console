import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {spawn} from 'node:child_process';import {once} from 'node:events';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {isExplicitOsAcceptanceEntry} from './helpers/os-acceptance-entry.ts';
const entry=new URL('./os-acceptance/readonly-key.entry.ts',import.meta.url),launcher=new URL('./os-acceptance/readonly-launch.entry.ts',import.meta.url);
test('OS acceptance selection is structural: direct explicit entry only, never imports or test workers',()=>{
 const direct=['node',fileURLToPath(entry),'--execute-os-acceptance'];assert.equal(isExplicitOsAcceptanceEntry(entry.href,direct,[],undefined),true);
 for(const argv of [['node',fileURLToPath(entry)],['node','parent-suite.ts','--execute-os-acceptance'],[...direct,'extra']])assert.equal(isExplicitOsAcceptanceEntry(entry.href,argv,[],undefined),false);
 assert.equal(isExplicitOsAcceptanceEntry(entry.href,direct,[],'child-v8'),false);assert.equal(isExplicitOsAcceptanceEntry(entry.href,direct,['--test'],undefined),false);assert.equal(isExplicitOsAcceptanceEntry(entry.href,direct,['--test=true'],undefined),false);
});
test('normal npm test selection contains inert placeholders/probe, not OS entries or name-based exclusions',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')),selection=manifest.scripts.test;
 assert(selection.includes('tests/os-test-separation.test.ts'));assert(selection.includes('tests/readonly-mcp.test.ts'));assert(selection.includes('tests/readonly-launch.test.ts'));assert(!selection.includes('os-acceptance/'));assert(!selection.includes('test-name-pattern'));
 for(const file of ['readonly-mcp.test.ts','readonly-launch.test.ts']){const source=await readFile(new URL(file,import.meta.url),'utf8');assert(source.includes("{skip:'OS"));assert(!/Install-ProtectedReadOnlyMcpKey|icacls|Import-Module|ReadOnlyMcpSecret\.psm1/.test(source));assert(!source.includes("from './os-acceptance/"));}
});
test('OS test bodies retained; migration changes registration only, not setup/helper operations',async()=>{
 const baseline=JSON.parse(await readFile(new URL('../docs/os-test-separation-preservation.json',import.meta.url),'utf8'));
 const body=(source:string)=>source.match(/async\(\)=>\{([\s\S]+?)\n\s*\}\);/)?.[1].split('\n').map(line=>line.trim()).join('\n');
 for(const [file,url] of [['tests/readonly-mcp.test.ts',entry],['tests/readonly-launch.test.ts',launcher]] as const){const original=Buffer.from(baseline.originals.find((v:any)=>v.path===file).base64,'base64').toString('utf8');assert(body(original));assert.equal(body(await readFile(url,'utf8')),body(original));}
});
async function child(script:string){
 const root=await mkdtemp(join(tmpdir(),'os-separation-probe-'));try{
  const path=join(root,'parent.mjs');await writeFile(path,script);
  const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec'])if(process.env[key])env[key]=process.env[key];
  for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','PI_CODING_AGENT_DIR','PI_CODING_AGENT_SESSION_DIR'])env[key]=root;
  env.PI_OFFLINE='1'; // Poisoned legacy inputs must not enable any OS case/helper.
  env.PI_CONSOLE_TEST_GUARDED_LAUNCHER=join(root,'NEVER_READ.psm1');env.PI_CONSOLE_TEST_TUNNEL_CLIENT=join(root,'NEVER_RUN.exe');env.OS_ACCEPTANCE='1';
  const proc=spawn(process.execPath,['--import','tsx','--import',new URL('./helpers/os-side-effect-probe.mjs',import.meta.url).href,path],{cwd:process.cwd(),env,stdio:'pipe',windowsHide:true});
  let stdout='',stderr='';proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);const [exit]=await once(proc,'close');assert.equal(exit,0,stderr+'\n'+stdout);const line=stdout.split('\n').find(s=>s.startsWith('OS_SIDE_EFFECT_PROBE:'));assert(line);return {counts:JSON.parse(line.slice('OS_SIDE_EFFECT_PROBE:'.length)),stdout};
 }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
test('instrumentation positive control blocks OS spawn/helper before execution',async()=>{
 const r=await child(`import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,readFile} from 'node:fs/promises';assert.throws(()=>spawn('powershell.exe'),/OS_SIDE_EFFECT_PROBE_BLOCKED/);await assert.rejects(mkdtemp('pi-readonly-manual-never-create-'),/OS_SIDE_EFFECT_PROBE_BLOCKED/);await assert.rejects(readFile('ReadOnlyMcpSecret.psm1'),/OS_SIDE_EFFECT_PROBE_BLOCKED/);`);
 assert.deepEqual(r.counts,{osProcessCalls:1,osFixtureCalls:1,setupHelperReads:1,executableOsCases:0,skippedOsCases:0});
});
test('parent suite imports normal modules and both OS entries with flags: zero setup/helpers/OS body registrations',{timeout:30000},async()=>{
 const paths=['readonly-mcp.test.ts','readonly-launch.test.ts'].map(p=>new URL(p,import.meta.url).href).concat([entry.href,launcher.href]);
 const r=await child(`process.argv.push('--execute-os-acceptance');${paths.map(url=>`await import(${JSON.stringify(url)});`).join('\n')}`);
 assert.deepEqual(r.counts,{osProcessCalls:0,osFixtureCalls:0,setupHelperReads:0,executableOsCases:0,skippedOsCases:2});assert(r.stdout.includes('OS acceptance deferred'));assert(r.stdout.includes('OS/external acceptance deferred'));
 console.log('NORMAL_PARENT_OS_PROBE:'+JSON.stringify(r.counts));
});
