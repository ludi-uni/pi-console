import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPets, petFile, petRoots, PetRegistry } from '../server/runtime/pets.ts';

test('Codex pet discovery prefers first root and serves only its validated manifest/sheet',async()=>{
  const base=await mkdtemp(join(tmpdir(),'pi-console-pets-'));const first=join(base,'console');const second=join(base,'codex');
  try{
    await mkdir(join(first,'fio-observer'),{recursive:true});await mkdir(join(second,'fio-observer'),{recursive:true});
    const sheet=Buffer.concat([Buffer.from('RIFF0000WEBP'),Buffer.alloc(32)]);
    await writeFile(join(first,'fio-observer','pet.json'),JSON.stringify({id:'fio-observer',displayName:'フィオ',spriteVersionNumber:2,spritesheetPath:'spritesheet.webp'}));
    await writeFile(join(first,'fio-observer','spritesheet.webp'),sheet);
    await writeFile(join(second,'fio-observer','pet.json'),JSON.stringify({displayName:'shadow'}));
    await writeFile(join(second,'fio-observer','spritesheet.webp'),sheet);
    const roots=[{path:first,source:'pi-console'},{path:second,source:'codex'}];
    assert.deepEqual(await listPets(roots),[{id:'fio-observer',displayName:'フィオ',description:'',source:'pi-console'},{id:'fio-observer',displayName:'shadow',description:'',source:'codex'}]);
    assert.equal(JSON.parse((await petFile('fio-observer','pet.json',roots,'codex')).data.toString()).displayName,'shadow');
    await assert.rejects(()=>petFile('fio-observer','pet.json',roots,'other'));
    assert.deepEqual((await petFile('fio-observer','spritesheet.webp',roots)).data,sheet);
    assert.equal(JSON.parse((await petFile('fio-observer','pet.json',roots)).data.toString()).spriteVersionNumber,2);
    for(const [id,file] of [['..','pet.json'],['fio-observer','../pet.json'],['fio-observer','secret.webp'],['fio-observer','fio.json'],['fio-observer','C:\\secret.webp']])await assert.rejects(()=>petFile(id,file,roots));
    await mkdir(join(first,'escape'),{recursive:true});
    let linked=false;try{await symlink(join(first,'fio-observer','spritesheet.webp'),join(first,'escape','spritesheet.webp'));linked=true}catch(e){if((e as NodeJS.ErrnoException).code!=='EPERM')throw e}
    if(linked){await writeFile(join(first,'escape','pet.json'),JSON.stringify({spritesheetPath:'spritesheet.webp'}));await assert.rejects(()=>petFile('escape','spritesheet.webp',roots))}
  }finally{await rm(base,{recursive:true,force:true})}
});

test('custom Fio wins unqualified lookup; explicit bundled source stays addressable',async()=>{
  const base=await mkdtemp(join(tmpdir(),'pi-console-pets-'));const custom=join(base,'custom');const bundled=join(base,'bundled');
  try{
    const image=Buffer.concat([Buffer.from('RIFF0000WEBP'),Buffer.alloc(32)]);
    for(const [root,name] of [[custom,'Custom Fio'],[bundled,'Bundled Fio']]){
      await mkdir(join(root,'fio'),{recursive:true});await writeFile(join(root,'fio','pet.json'),JSON.stringify({id:'fio',displayName:name,author:'DOLL',format:'codex-compatible',spriteVersionNumber:2}));await writeFile(join(root,'fio','spritesheet.webp'),image);
    }
    const roots=[{path:custom,source:'pi-console'},{path:bundled,source:'bundled'}];
    assert.deepEqual((await listPets(roots)).map(p=>p.source),['pi-console','bundled']);
    assert.equal(JSON.parse((await petFile('fio','pet.json',roots)).data.toString()).displayName,'Custom Fio');
    assert.equal(JSON.parse((await petFile('fio','pet.json',roots,'bundled')).data.toString()).displayName,'Bundled Fio');
  }finally{await rm(base,{recursive:true,force:true})}
});

test('missing or invalid artwork is not offered; manifest identity is normalized and links cannot escape',async()=>{
  const base=await mkdtemp(join(tmpdir(),'pi-console-pets-'));const root=join(base,'pets');const outside=join(base,'outside');
  try{
    await mkdir(join(root,'fio-observer'),{recursive:true});await mkdir(outside);
    await writeFile(join(root,'fio-observer','pet.json'),JSON.stringify({id:'../../other',displayName:'Fio',spriteVersionNumber:2,spritesheetPath:'spritesheet.webp'}));
    const roots=[{path:root,source:'bundled'}];
    assert.deepEqual(await listPets(roots),[]);
    await writeFile(join(root,'fio-observer','spritesheet.webp'),'not an image');
    assert.deepEqual(await listPets(roots),[]);
    const sheet=Buffer.concat([Buffer.from('RIFF0000WEBP'),Buffer.alloc(32)]);
    await writeFile(join(root,'fio-observer','spritesheet.webp'),sheet);
    assert.deepEqual(await listPets(roots),[{id:'fio-observer',displayName:'Fio',description:'',source:'bundled'}]);
    assert.equal(JSON.parse((await petFile('fio-observer','pet.json',roots,'bundled')).data.toString()).id,'fio-observer');
    assert.deepEqual(await new PetRegistry(roots).definitions(),[{id:'fio-observer',source:'bundled',displayName:'Fio',description:'',author:'',format:'codex-compatible',spriteVersionNumber:2,spritesheetPath:'spritesheet.webp'}]);
    await mkdir(join(outside,'escape'));await writeFile(join(outside,'escape','pet.json'),'{}');await writeFile(join(outside,'escape','spritesheet.webp'),sheet);
    try{await symlink(join(outside,'escape'),join(root,'escape'),'dir');await assert.rejects(()=>petFile('escape','pet.json',roots));}catch(e){if((e as NodeJS.ErrnoException).code!=='EPERM')throw e}
  }finally{await rm(base,{recursive:true,force:true})}
});

test('discovery skips missing roots, malformed manifests, missing sheets and unsafe paths independently',async()=>{
  const base=await mkdtemp(join(tmpdir(),'pi-console-discovery-'));
  const local=join(base,'local'),codex=join(base,'codex');
  const sheet=Buffer.concat([Buffer.from('RIFF0000WEBP'),Buffer.alloc(32)]);
  const add=async(root:string,id:string,manifest:string,withSheet=true)=>{
    const dir=join(root,id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'pet.json'),manifest);
    if(withSheet)await writeFile(join(dir,'spritesheet.webp'),sheet);
  };
  try{
    await add(local,'good',JSON.stringify({displayName:'Local'}));
    await add(codex,'codexpet',JSON.stringify({displayName:'Codex'}));
    await add(codex,'broken','{');
    await add(local,'missing',JSON.stringify({}),false);
    await add(local,'traversal',JSON.stringify({spritesheetPath:'../outside.webp'}));
    await add(local,'absolute',JSON.stringify({spritesheetPath:join(base,'outside.webp')}));
    await add(local,'unsupported',JSON.stringify({spriteVersionNumber:3}));
    const roots=[{path:join(base,'absent'),source:'pi-console'},{path:local,source:'pi-console'},{path:codex,source:'codex'}];
    assert.deepEqual((await listPets(roots)).map(p=>[p.id,p.source]),[['codexpet','codex'],['good','pi-console']]);
  }finally{await rm(base,{recursive:true,force:true})}
});

test('bundled Fio is available without a user-installed package; custom roots precede bundled',async()=>{
  const roots=petRoots();const root=roots.at(-1);assert.ok(root);
  assert.equal(root.source,'bundled');assert.equal(roots[0].source,'pi-console');
  assert.equal(root.path.endsWith(join('package','pets')),true);
  const metadata=JSON.parse(await readFile(join(root.path,'fio','pet.json'),'utf8'));
  assert.equal(metadata.id,'fio');assert.equal(metadata.author,'DOLL');assert.equal(metadata.format,'codex-compatible');assert.equal(metadata.spriteVersionNumber,2);
  const license=await readFile(join(root.path,'fio','FIO_ASSET_LICENSE.md'),'utf8');
  assert.match(license,/Copyright © DOLL Project \/ Ludi/);
  assert.match(license,/not.*automatically licensed under the open-source license/);
  assert.deepEqual((await listPets([root])).map(p=>[p.id,p.source]),[['fio','bundled']]);
  const image=(await petFile('fio','spritesheet.webp',[root],'bundled')).data;
  assert.ok(image.length>1000);
  assert.equal(image.toString('ascii',0,4),'RIFF');
  assert.equal(image.toString('ascii',8,12),'WEBP');
});
