import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export type PetSummary={id:string;displayName:string;description:string;source:string};
export type PetDefinition=PetSummary&{author:string;format:'codex-compatible';spriteVersionNumber:1|2;spritesheetPath:string};
type Manifest={id?:string;displayName?:string;description?:string;author?:string;format?:string;spriteVersionNumber?:number;spritesheetPath?:string};
type PetRoot={path:string;source:string};
export const petRoots=():PetRoot[]=>[
  {path:join(homedir(),'.pi-console','pets'),source:'pi-console'},
  {path:join(homedir(),'.codex','pets'),source:'codex'},
  {path:join(homedir(),'.pi','agent','pi-console','pets'),source:'pi-console'},
  {path:join(homedir(),'.pi','agent','pi-web','pets'),source:'pi-web'},
  {path:fileURLToPath(new URL('../../package/pets',import.meta.url)),source:'bundled'}
];
const validId=(s:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(s);
const validSheet=(s:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}\.(webp|png)$/.test(s)&&!s.includes('..');
const inside=(path:string,root:string)=>path.startsWith(root+sep);
const validImage=(file:string,data:Buffer)=>file.endsWith('.webp')?data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
async function manifestFor(root:PetRoot,id:string){
  const realRoot=await fs.realpath(root.path);const realDir=await fs.realpath(join(root.path,id));
  if(!inside(realDir,realRoot))throw Error('invalid pet location');
  const manifestPath=await fs.realpath(join(realDir,'pet.json'));
  if(!inside(manifestPath,realDir)||(await fs.stat(manifestPath)).size>32768)throw Error('invalid manifest');
  const data=JSON.parse(await fs.readFile(manifestPath,'utf8')) as Manifest;
  if(!data||typeof data!=='object'||Array.isArray(data)||data.format!==undefined&&data.format!=='codex-compatible'||data.spriteVersionNumber!==undefined&&data.spriteVersionNumber!==1&&data.spriteVersionNumber!==2)throw Error('invalid manifest');
  const sheet=data.spritesheetPath??'spritesheet.webp';if(typeof sheet!=='string'||!validSheet(sheet))throw Error('invalid spritesheet path');
  const imagePath=await fs.realpath(join(realDir,sheet));const imageStat=await fs.stat(imagePath);
  if(!inside(imagePath,realDir)||!imageStat.isFile()||imageStat.size>5*1024*1024||!validImage(sheet,await fs.readFile(imagePath)))throw Error('invalid spritesheet');
  const definition:PetDefinition={id,source:root.source,displayName:typeof data.displayName==='string'&&data.displayName.trim()?data.displayName.slice(0,100):id,description:typeof data.description==='string'?data.description.slice(0,300):'',author:typeof data.author==='string'?data.author.slice(0,100):'',format:'codex-compatible',spriteVersionNumber:data.spriteVersionNumber===2?2:1,spritesheetPath:sheet};
  return {dir:realDir,definition};
}
// One normalized boundary for discovery and serving; roots are ordered custom-first.
export class PetRegistry {
  constructor(readonly roots:PetRoot[]=petRoots()){}
  async definitions():Promise<PetDefinition[]>{
    const result:PetDefinition[]=[];const seen=new Set<string>();
    for(const root of this.roots){let names:string[];try{names=(await fs.readdir(root.path,{withFileTypes:true})).filter(e=>e.isDirectory()&&validId(e.name)).slice(0,100).map(e=>e.name)}catch{continue}
      for(const id of names){const key=`${root.source}:${id}`;if(seen.has(key))continue;try{result.push((await manifestFor(root,id)).definition);seen.add(key)}catch{/* Ignore malformed, incomplete or inaccessible packages. */}}
    }
    return result.sort((a,b)=>a.id.localeCompare(b.id));
  }
  async file(id:string,file:string,source?:string):Promise<{data:Buffer;mime:string}>{
    if(!validId(id)||!file||file!=='pet.json'&&!validSheet(file))throw Error('invalid pet file');
    for(const root of this.roots){
      if(source!==undefined&&root.source!==source)continue;
      let packageInfo:Awaited<ReturnType<typeof manifestFor>>;
      try{packageInfo=await manifestFor(root,id)}catch{continue}
      const {dir,definition}=packageInfo;
      if(file!=='pet.json'&&file!==definition.spritesheetPath)throw Error('unsupported pet file');
      const path=await fs.realpath(join(dir,file));if(!inside(path,dir))throw Error('invalid pet file');
      const stat=await fs.stat(path);if(!stat.isFile()||stat.size>(file==='pet.json'?32768:5*1024*1024))throw Error('pet file too large');
      const data=await fs.readFile(path);
      if(file!=='pet.json'&&!validImage(file,data))throw Error('invalid pet image');
      return {data:file==='pet.json'?Buffer.from(JSON.stringify(definition)):data,mime:file==='pet.json'?'application/json':file.endsWith('.webp')?'image/webp':'image/png'};
    }
    throw Error('pet not found');
  }
}
export async function listPets(roots=petRoots()):Promise<PetSummary[]>{
  return (await new PetRegistry(roots).definitions()).map(({id,displayName,description,source})=>({id,displayName,description,source}));
}
export async function petFile(id:string,file:string,roots=petRoots(),source?:string):Promise<{data:Buffer;mime:string}>{
  return new PetRegistry(roots).file(id,file,source);
}
