// TEST ONLY instrumentation, not an OS sandbox. Block before any prohibited helper executes.
import {createRequire,syncBuiltinESMExports} from 'node:module';
const require=createRequire(import.meta.url),cp=require('node:child_process'),fs=require('node:fs'),fsp=require('node:fs/promises'),testing=require('node:test');
const counts={osProcessCalls:0,osFixtureCalls:0,setupHelperReads:0,executableOsCases:0,skippedOsCases:0};
const blocked=()=>{throw Error('OS_SIDE_EFFECT_PROBE_BLOCKED');};
const forbidden=/powershell(?:\.exe)?|pwsh(?:\.exe)?|icacls(?:\.exe)?|netsh(?:\.exe)?|runas(?:\.exe)?|(?:^|[\\/])net\.exe|os-acceptance[\\/].*\.entry\.ts|setup-readonly-mcp-auth|ReadOnlyMcpSecret\.psm1/i;
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']){const original=cp[name];cp[name]=function(command,...args){if(forbidden.test(String(command))){counts.osProcessCalls++;return blocked();}return original.call(this,command,...args);};}
for(const api of [fs,fsp])for(const name of ['mkdtemp','mkdtempSync','readFile','readFileSync']){if(typeof api[name]!=='function')continue;const original=api[name];api[name]=function(path,...args){const p=String(path);const fixture=/pi-readonly-manual-|pi-guarded-launch-/.test(p)&&name.startsWith('mkdtemp'),helper=/ReadOnlyMcpSecret\.psm1|setup-readonly-mcp-auth\.ps1|readonly-launch\.fixture\.ps1/.test(p)&&name.startsWith('readFile');if(fixture||helper){counts[fixture?'osFixtureCalls':'setupHelperReads']++;if(api===fsp)return Promise.reject(Error('OS_SIDE_EFFECT_PROBE_BLOCKED'));return blocked();}return original.call(this,path,...args);};}
const register=testing.test;testing.test=function(name,options,...args){if(/manual Windows setup protects only a dummy key|guarded launcher pins profile\/source\/scope/.test(String(name))){if(options?.skip)counts.skippedOsCases++;else{counts.executableOsCases++;return blocked();}}return register.call(this,name,options,...args);};
syncBuiltinESMExports();
process.on('exit',()=>console.log('OS_SIDE_EFFECT_PROBE:'+JSON.stringify(counts)));
