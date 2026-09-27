import {promises as fs, type Stats} from 'node:fs';
import type {FileHandle} from 'node:fs/promises';
import {extname, isAbsolute, relative, sep} from 'node:path';
import type {WorkspaceStore} from './workspaces.ts';
import {resolveWorkspaceFile} from './workspace-text.ts';
import {workspaceMediaType} from '../../shared/workspace-files.ts';

export type WorkspaceMedia={handle:FileHandle;path:string;format:'image'|'video';mime:string;size:number};
const imageLimit=20*1024*1024,videoLimit=512*1024*1024;
const inside=(root:string,target:string)=>{const rel=relative(root,target);return rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel)};
function validSignature(extension:string,head:Buffer){
  if(extension==='.png')return head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(extension==='.jpg'||extension==='.jpeg')return head[0]===255&&head[1]===216&&head[2]===255;
  if(extension==='.gif')return ['GIF87a','GIF89a'].includes(head.toString('ascii',0,6));
  if(extension==='.webp')return head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP';
  if(extension==='.mp4')return head.toString('ascii',4,8)==='ftyp';
  if(extension==='.webm')return head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  return false;
}
/** Resolve inside a registered workspace and verify the opened inode, not just a prior symlink path. */
export async function openWorkspaceMedia(store:WorkspaceStore,workspaceId:string,path:string):Promise<WorkspaceMedia>{
  const {root,target}=await resolveWorkspaceFile(store,workspaceId,path);
  const extension=extname(target).toLowerCase(),type=workspaceMediaType(extension);
  if(!type)throw new Error('unsupported media file extension');
  const handle=await fs.open(target,'r');
  try{
    const opened=await handle.stat();
    const currentPath=await fs.realpath(target);
    if(!inside(root,currentPath))throw new Error('file changed while opening the preview');
    const current=await fs.stat(currentPath);
    if(!sameFile(opened,current))throw new Error('file changed while opening the preview');
    if(!opened.isFile()||!opened.size||opened.size>(type.format==='image'?imageLimit:videoLimit))throw new Error('media file is empty, not regular, or exceeds the preview size limit');
    const head=Buffer.alloc(16);await handle.read(head,0,head.length,0);
    if(!validSignature(extension,head))throw new Error('media file signature does not match its extension');
    return {handle,path:relative(root,currentPath),format:type.format,mime:type.mime,size:opened.size};
  }catch(error){await handle.close();throw error}
}
function sameFile(left:Stats,right:Stats){return left.dev===right.dev&&left.ino===right.ino&&left.size===right.size&&left.mtimeMs===right.mtimeMs}

/** Single HTTP byte range only; malformed and unsatisfiable requests return 416. */
export function mediaRange(range:string|undefined,size:number):{status:200|206|416;start:number;end:number}{
  if(!range)return {status:200,start:0,end:size-1};
  const parts=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!parts||(!parts[1]&&!parts[2]))return {status:416,start:0,end:0};
  let start:number,end:number;
  if(!parts[1]){
    const count=Number(parts[2]);if(!Number.isSafeInteger(count)||count<1)return {status:416,start:0,end:0};
    start=Math.max(0,size-count);end=size-1;
  }else{
    start=Number(parts[1]);end=parts[2]?Number(parts[2]):size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return {status:416,start:0,end:0};
    end=Math.min(end,size-1);
  }
  return {status:206,start,end};
}
