// Test-only application guard, not OS egress/isolation evidence.
import net from 'node:net';
import child from 'node:child_process';
import dns from 'node:dns';
import {syncBuiltinESMExports} from 'node:module';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const a=Array.isArray(args[0])?args[0][0]:args[0];
  const host=typeof a==='object'?a.host??a.hostname:typeof args[1]==='string'?args[1]:undefined;
  if(typeof a==='string'||host!=='127.0.0.1')throw Error('TEST_EXTERNAL_NETWORK_FORBIDDEN');
  return original.apply(this,args);
};
const lookup=dns.lookup;
dns.lookup=(host,...args)=>{if(host!=='127.0.0.1')throw Error('TEST_DNS_FORBIDDEN');return lookup(host,...args);};
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){const a=args[0],host=typeof a==='object'?a.host:args[1];if(host!=='127.0.0.1')throw Error('TEST_NON_LOOPBACK_BIND_FORBIDDEN');return listen.apply(this,args);};
const esbuild=resolve('node_modules/@esbuild/win32-x64/esbuild.exe');
const owned=[];
const handles=[];
function record(){if(process.env.TRUSTED_LOCAL_TEST_CHILD_RECORD)writeFileSync(process.env.TRUSTED_LOCAL_TEST_CHILD_RECORD,JSON.stringify({testParentPid:process.pid,children:owned})+'\n');}
for(const name of ['spawn','spawnSync','execFile','execFileSync']){const fn=child[name];child[name]=function(file,...args){const tool=resolve(file)===esbuild;if(!tool&&(!process.env.TRUSTED_LOCAL_TEST_BROWSER||resolve(file)!==resolve(process.env.TRUSTED_LOCAL_TEST_BROWSER)))throw Error('TEST_NON_TOOL_CHILD_FORBIDDEN');const p=fn.call(this,file,...args);if(p?.pid){const item={pid:p.pid,kind:tool?'build-tool':'dummy-browser',closed:false};owned.push(item);if(tool&&p.once)handles.push({p,item});record();p.once?.('close',()=>{item.closed=true;record();});}return p;};}
// esbuild deliberately unrefs its service. Close only the child handles created
// by this test process, without inspecting or signaling any host process.
process.on('beforeExit',()=>{for(const {p,item}of handles)if(!item.closed){p.ref();p.kill();}});
process.on('exit',record);
// Vite probes mapped Windows drives with `net use`. Return its documented
// failure path without running a shell or inspecting host network mappings.
child.exec=(command,...args)=>{if(command==='net use'&&typeof args.at(-1)==='function'){queueMicrotask(()=>args.at(-1)(Error('TEST_HOST_MAPPING_PROBE_DISABLED'),'',''));return;}throw Error('TEST_NON_TOOL_CHILD_FORBIDDEN');};
for(const name of ['execSync','fork'])child[name]=()=>{throw Error('TEST_NON_TOOL_CHILD_FORBIDDEN');};
syncBuiltinESMExports();
