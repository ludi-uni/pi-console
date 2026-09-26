import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';

export type PetSummary={id:string;displayName:string;description:string;source:string};
type Manifest={id?:string;displayName?:string;description?:string;spriteVersionNumber?:number;spritesheetPath?:string};
export const petRoots=()=>[
  {path:join(homedir(),'.pi','agent','pi-console','pets'),source:'pi-console'},
  {path:join(homedir(),'.codex','pets'),source:'codex'},
  {path:join(homedir(),'.pi','agent','pi-web','pets'),source:'pi-web'}
];
const validId=(s:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(s);
const validSheet=(s:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}\.(webp|png)$/.test(s)&&!s.includes('..');
const inside=(path:string,root:string)=>path.startsWith(root+sep);
async function manifestFor(root:string,id:string){
  const dir=join(root,id);
  const realRoot=await fs.realpath(root);const realDir=await fs.realpath(dir);
  if(!inside(realDir,realRoot))throw Error('invalid pet location');
  const manifestPath=await fs.realpath(join(realDir,'pet.json'));
  if(!inside(manifestPath,realDir)||(await fs.stat(manifestPath)).size>32768)throw Error('invalid manifest');
  const data=JSON.parse(await fs.readFile(manifestPath,'utf8')) as Manifest;
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid manifest');
  const sheet=data.spritesheetPath??'spritesheet.webp';if(typeof sheet!=='string'||!validSheet(sheet))throw Error('invalid spritesheet path');
  const imagePath=await fs.realpath(join(realDir,sheet));const imageStat=await fs.stat(imagePath);
  if(!inside(imagePath,realDir)||!imageStat.isFile()||imageStat.size>5*1024*1024)throw Error('invalid spritesheet');
  return {dir:realDir,manifest:{id:typeof data.id==='string'?data.id:id,displayName:typeof data.displayName==='string'?data.displayName.slice(0,100):id,description:typeof data.description==='string'?data.description.slice(0,300):'',spriteVersionNumber:data.spriteVersionNumber===2?2:1,spritesheetPath:sheet}};
}
export async function listPets(roots=petRoots()):Promise<PetSummary[]>{
  const result:PetSummary[]=[];const seen=new Set<string>();
  for(const root of roots){let names:string[];try{names=(await fs.readdir(root.path,{withFileTypes:true})).filter(e=>e.isDirectory()&&validId(e.name)).slice(0,100).map(e=>e.name)}catch{continue}
    for(const id of names){if(seen.has(id))continue;try{const {manifest}=await manifestFor(root.path,id);result.push({id,displayName:manifest.displayName,description:manifest.description,source:root.source});seen.add(id)}catch{/* Ignore malformed or inaccessible packages. */}}
  }
  return result.sort((a,b)=>a.id.localeCompare(b.id));
}
export async function petFile(id:string,file:string,roots=petRoots()):Promise<{data:Buffer;mime:string}>{
  if(!validId(id)||!file||file!=='pet.json'&&!validSheet(file))throw Error('invalid pet file');
  for(const root of roots){
    let packageInfo:Awaited<ReturnType<typeof manifestFor>>;
    try{packageInfo=await manifestFor(root.path,id)}catch{continue}
    const {dir,manifest}=packageInfo;
    if(file!=='pet.json'&&file!==manifest.spritesheetPath)throw Error('unsupported pet file');
    const path=await fs.realpath(join(dir,file));if(!inside(path,dir))throw Error('invalid pet file');
    const stat=await fs.stat(path);if(!stat.isFile()||stat.size>(file==='pet.json'?32768:5*1024*1024))throw Error('pet file too large');
    const data=await fs.readFile(path);
    if(file!=='pet.json'&&!(file.endsWith('.webp')?data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))throw Error('invalid pet image');
    return {data:file==='pet.json'?Buffer.from(JSON.stringify(manifest)):data,mime:file==='pet.json'?'application/json':file.endsWith('.webp')?'image/webp':'image/png'};
  }
  throw Error('pet not found');
}
