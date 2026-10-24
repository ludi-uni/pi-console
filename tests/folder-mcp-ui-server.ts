// Manual/in-app UI acceptance ONLY: deterministic DUMMY authentication and fake provider.
// Never imports server/index, production environment, profiles, SDK or a real MCP client.
import { build } from 'vite';
import { join, resolve, dirname } from 'node:path';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { folderFixture } from './helpers/folder-mcp.fixture.ts';
let auth = 0;
const f = await folderFixture({randomKey: () => (++auth).toString(16).padStart(64, '0')});
try {
  const bundle = await build({configFile:false,envFile:false,root:process.cwd(),build:{write:false,minify:false,rollupOptions:{input:resolve('owner.html')}}});
  for (const a of (Array.isArray(bundle)?bundle[0]:bundle as any).output) { const path=join(f.assets,a.fileName); await mkdir(dirname(path),{recursive:true}); await writeFile(path,a.type==='chunk'?a.code:a.source); }
  const issued = await f.issue();
  if(issued.status!==200)throw Error('dummy_fixture_unavailable');
  f.folders.pair();
  console.log(JSON.stringify({kind:'DUMMY_UI_ONLY',url:issued.body.url,root:f.root,dummyCodeDescription:'64 hexadecimal digits representing integer 1',noRealCredentials:true,provider:'fake'}));
  const input=createInterface({input:process.stdin});
  for await(const line of input){
    if(line.trim()==='close')break;
    if(line.trim()==='status')console.log(JSON.stringify({kind:'DUMMY_UI_ONLY',view:f.folders.app.view(),issues:f.folders.issues(),created:f.folders.f.created.length,registered:f.folders.f.registered.length}));
    if(line.trim()==='renew'){const issued=await f.issue();console.log(JSON.stringify({kind:'DUMMY_UI_ONLY',url:issued.body.url,dummyCodeInteger:auth}));}
    if(line.trim()==='new-client'){f.folders.pair();console.log('DUMMY pending client added');}
  }
  input.close();
} finally { await f.cleanup(); console.log('DUMMY_UI_ONLY fixture closed, both listeners stopped, Temp removed.'); }
