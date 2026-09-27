import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceStore} from '../server/runtime/workspaces.ts';
import {openWorkspaceMedia,mediaRange} from '../server/runtime/workspace-media.ts';
import {workspaceReference} from '../web/MarkdownContent.tsx';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GKsAAAAASUVORK5CYII=','base64');
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000isom')]);
test('workspace media previews allow known signatures and deny traversal, symlink escape, unknown formats and oversized files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-console-media-'));
  try{
    const workspace=join(root,'workspace');await mkdir(workspace);await mkdir(join(workspace,'media'));
    await writeFile(join(workspace,'media','portrait.png'),png);
    await writeFile(join(workspace,'media','clip.mp4'),mp4);
    await writeFile(join(workspace,'fake.png'),'<script>alert(1)</script>');
    await writeFile(join(workspace,'drawing.svg'),'<svg/>');
    const large=await open(join(workspace,'oversized.png'),'w');try{await large.write(png);await large.truncate(20*1024*1024+1)}finally{await large.close()}
    await writeFile(join(root,'outside.png'),png);
    await symlink(root,join(workspace,'outside'),'junction');
    const store=new WorkspaceStore(join(root,'registry.json')),ws=await store.add(workspace);
    const image=await openWorkspaceMedia(store,ws.id,'media/portrait.png');
    assert.deepEqual({path:image.path,format:image.format,mime:image.mime,size:image.size},{path:join('media','portrait.png'),format:'image',mime:'image/png',size:png.length});await image.handle.close();
    const video=await openWorkspaceMedia(store,ws.id,'media/clip.mp4');assert.equal(video.mime,'video/mp4');await video.handle.close();
    for(const file of ['../outside.png','outside/outside.png',join(root,'outside.png')])await assert.rejects(openWorkspaceMedia(store,ws.id,file),/outside the workspace/);
    for(const file of ['fake.png','drawing.svg','oversized.png','media'])await assert.rejects(openWorkspaceMedia(store,ws.id,file));
    assert.deepEqual(workspaceReference('media/portrait.png'),{path:'media/portrait.png'});
    assert.deepEqual(workspaceReference('media/clip.mp4'),{path:'media/clip.mp4'});
    assert.equal(workspaceReference('media/clip.mp4:42'),undefined);
    assert.equal(workspaceReference('https://example.com/portrait.png'),undefined);
  }finally{await rm(root,{recursive:true,force:true})}
});
test('video byte ranges permit seeking but refuse malformed or unsatisfiable ranges',()=>{
  assert.deepEqual(mediaRange(undefined,100),{status:200,start:0,end:99});
  assert.deepEqual(mediaRange('bytes=0-',100),{status:206,start:0,end:99});
  assert.deepEqual(mediaRange('bytes=7-20',100),{status:206,start:7,end:20});
  assert.deepEqual(mediaRange('bytes=-5',100),{status:206,start:95,end:99});
  assert.deepEqual(mediaRange('bytes=90-999',100),{status:206,start:90,end:99});
  for(const input of ['bytes=100-','bytes=10-9','bytes=-0','bytes=0-1,3-5','bytes=','bytes=999999999999999999-'])assert.equal(mediaRange(input,100).status,416);
});
