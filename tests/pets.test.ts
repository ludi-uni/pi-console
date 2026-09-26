import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPets, petFile } from '../server/runtime/pets.ts';

test('Codex pet discovery prefers first root and serves only its validated manifest/sheet',async()=>{
  const base=await mkdtemp(join(tmpdir(),'pi-console-pets-'));const first=join(base,'console');const second=join(base,'codex');
  try{
    await mkdir(join(first,'fio-observer'),{recursive:true});await mkdir(join(second,'fio-observer'),{recursive:true});
    const sheet=Buffer.concat([Buffer.from('RIFF0000WEBP'),Buffer.alloc(32)]);
    await writeFile(join(first,'fio-observer','pet.json'),JSON.stringify({id:'fio-observer',displayName:'フィオ',spriteVersionNumber:2,spritesheetPath:'spritesheet.webp'}));
    await writeFile(join(first,'fio-observer','spritesheet.webp'),sheet);
    await writeFile(join(second,'fio-observer','pet.json'),JSON.stringify({displayName:'shadow'}));
    const roots=[{path:first,source:'pi-console'},{path:second,source:'codex'}];
    assert.deepEqual(await listPets(roots),[{id:'fio-observer',displayName:'フィオ',description:'',source:'pi-console'}]);
    assert.deepEqual((await petFile('fio-observer','spritesheet.webp',roots)).data,sheet);
    assert.equal(JSON.parse((await petFile('fio-observer','pet.json',roots)).data.toString()).spriteVersionNumber,2);
    for(const [id,file] of [['..','pet.json'],['fio-observer','../pet.json'],['fio-observer','secret.webp'],['fio-observer','fio.json'],['fio-observer','C:\\secret.webp']])await assert.rejects(()=>petFile(id,file,roots));
    await mkdir(join(first,'escape'),{recursive:true});
    let linked=false;try{await symlink(join(first,'fio-observer','spritesheet.webp'),join(first,'escape','spritesheet.webp'));linked=true}catch(e){if((e as NodeJS.ErrnoException).code!=='EPERM')throw e}
    if(linked){await writeFile(join(first,'escape','pet.json'),JSON.stringify({spritesheetPath:'spritesheet.webp'}));await assert.rejects(()=>petFile('escape','spritesheet.webp',roots))}
  }finally{await rm(base,{recursive:true,force:true})}
});
