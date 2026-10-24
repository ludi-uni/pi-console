import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startupEnvironment} from '../package/startup-environment.mjs';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'startup-env-dummy-')),agent=join(root,'agent'),data=join(agent,'pi-console'),install=join(agent,'install'),pkg=join(install,'releases','1.1.0','node_modules','@earendil-works','pi-coding-agent'),cli=join(pkg,'dist','bundle','cli.js');
 const env={PATH:'',USERPROFILE:root,APPDATA:root,PI_CODING_AGENT_DIR:agent,PI_CONSOLE_DATA_DIR:data};
 try{await mkdir(data,{recursive:true});await mkdir(join(pkg,'dist','bundle'),{recursive:true});await writeFile(join(install,'current-version'),'1.1.0\n');await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@earendil-works/pi-coding-agent',version:'1.1.0',bin:{pi:'dist/bundle/cli.js'}}));await writeFile(cli,"throw Error('DUMMY_PI_MUST_NOT_EXECUTE');\n");await writeFile(join(data,'.env'),'PI_CONSOLE_READONLY_MCP=1\nPI_CONSOLE_PUBLIC_ORIGIN=https://console.example.test\nPI_CONSOLE_ACCESS_TEAM_DOMAIN=https://team.cloudflareaccess.com\nPI_CONSOLE_ACCESS_AUD='+ 'a'.repeat(64)+'\n');await fn({root,agent,data,install,pkg,cli,env});}finally{await rm(root,{recursive:true,force:true});}}
test('Startup resolves installed selected Pi code, preserves Access and overrides legacy MCP OFF without mutations',()=>fixture(async f=>{
 const before=await readFile(join(f.data,'.env')),selector=await readFile(join(f.install,'current-version'));const copy={...f.env};const v=await startupEnvironment(f.env);
 assert.equal(v.PI_CONSOLE_PI_COMMAND,f.cli);assert.equal(v.PI_CONSOLE_READONLY_MCP,'0');assert.equal(v.PI_CONSOLE_PUBLIC_ORIGIN,'https://console.example.test');assert.equal(v.PI_CONSOLE_ACCESS_AUD,'a'.repeat(64));assert.deepEqual(f.env,copy);assert.deepEqual(await readFile(join(f.data,'.env')),before);assert.deepEqual(await readFile(join(f.install,'current-version')),selector);
}));
test('Startup honors an explicit installed CLI and refuses a broken explicit override',()=>fixture(async f=>{const explicit=join(f.root,'explicit-cli.js');await writeFile(explicit,'/* dummy */');assert.equal((await startupEnvironment({...f.env,PI_CONSOLE_PI_COMMAND:explicit})).PI_CONSOLE_PI_COMMAND,explicit);await assert.rejects(()=>startupEnvironment({...f.env,PI_CONSOLE_PI_COMMAND:join(f.root,'missing.js')}),/must point to an existing absolute/);}));
test('Startup rejects invalid managed selectors and mismatched/bin-escaping manifests',()=>fixture(async f=>{
 for(const version of ['../escape','1.1.0/../../','', 'x'.repeat(129)]){await writeFile(join(f.install,'current-version'),version);await assert.rejects(()=>startupEnvironment(f.env),/Managed Pi installation unavailable/);}
 await writeFile(join(f.install,'current-version'),'1.1.0');
 for(const pkg of [{name:'wrong',version:'1.1.0',bin:{pi:'dist/bundle/cli.js'}},{name:'@earendil-works/pi-coding-agent',version:'9.9.9',bin:{pi:'dist/bundle/cli.js'}},{name:'@earendil-works/pi-coding-agent',version:'1.1.0',bin:{pi:'../../escape.js'}}]){await writeFile(join(f.pkg,'package.json'),JSON.stringify(pkg));await assert.rejects(()=>startupEnvironment(f.env),/Managed Pi installation unavailable/);}
}));
test('Startup missing installation fails closed without creating it or invoking Pi',()=>fixture(async f=>{await rm(join(f.install,'current-version'));await assert.rejects(()=>startupEnvironment(f.env),/Managed Pi installation unavailable/);await assert.rejects(readFile(join(f.install,'current-version')),e=>e.code==='ENOENT');}));
test('startup entry passes stable Access, installed code and explicit OFF to the manager without starting a real server',()=>fixture(async f=>{
 const recordFile=join(f.root,'startup-record.json'),env={...f.env,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PI_CONSOLE_PI_COMMAND:f.cli,STARTUP_FIXTURE_RECORD:recordFile};
 const child=spawn(process.execPath,['--import',new URL('./helpers/startup-entry-preload.mjs',import.meta.url).href,fileURLToPath(new URL('../package/startup.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,0,output);const v=JSON.parse(await readFile(recordFile,'utf8'));assert.equal(v.closed,true);assert.equal(v.calls,1);assert.equal(v.realConsoleStarted,false);assert.equal(v.legacyMcpOff,true);assert.equal(v.publicOrigin,'https://console.example.test');assert.equal(v.explicitPiCli,f.cli);assert.equal(v.dataDir,f.data);}finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('close',r));}}
}));
test('startup entry does not forward a manager error containing a secret/log tail',()=>fixture(async f=>{
 const recordFile=join(f.root,'failure-record.json'),env={...f.env,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PI_CONSOLE_PI_COMMAND:f.cli,STARTUP_FIXTURE_RECORD:recordFile,STARTUP_FIXTURE_FAIL:'1'};
 const child=spawn(process.execPath,['--import',new URL('./helpers/startup-entry-preload.mjs',import.meta.url).href,fileURLToPath(new URL('../package/startup.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stderr.on('data',x=>output+=x);child.stdout.resume();
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,1);assert.match(output,/startup refused/);assert(!output.includes('dummy-startup-secret-log-tail'));const v=JSON.parse(await readFile(recordFile,'utf8'));assert.equal(v.calls,1);assert.equal(v.closed,true);assert.equal(v.realConsoleStarted,false);}finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('close',r));}}
}));
