import fs from'node:fs/promises';import path from'node:path';import{randomUUID}from'node:crypto';
import{exact,validateOwner,fail}from'./local-mcp-identity.mjs';
const id=s=>`${s.dev}:${s.ino}:${s.birthtimeMs}`,same=(a,b)=>id(a)===id(b),regular=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1;
/** Trusted fixed managed data directory; same-user hostile code is outside the trust boundary.
 * No RPC-selected path, recursive deletion, plaintext body or automatic stale-lock removal. */
export function createLocalFileBackend({directory,createOnCommit=false,onOwnedFile=()=>{},fault=()=>{}}){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||/^\\\\|^\/\/|[\x00-\x1f]/.test(directory))fail('storage_path_rejected');
 const root=path.resolve(directory);let pinned,closed=false,lease,binding;const full=n=>path.join(root,n);
 async function anchor(missing=false){if(closed)fail('storage_closed');const parsed=path.parse(root);let p=parsed.root;for(const part of root.slice(parsed.root.length).split(path.sep)){if(!part)continue;p=path.join(p,part);let st;try{st=await fs.lstat(p)}catch(e){if(missing&&p===root&&e.code==='ENOENT')return false;throw e}if(!st.isDirectory()||st.isSymbolicLink())fail('storage_directory_replaced')}
  const st=await fs.lstat(root),real=await fs.realpath(root);if(real.toLowerCase()!==root.toLowerCase()||pinned&&!same(st,pinned))fail('storage_directory_replaced');pinned??=st;return true;
 }
 async function exists(n){try{return await fs.lstat(full(n))}catch(e){if(e.code==='ENOENT')return null;throw e}}
 async function load(){await anchor();const st=await exists('state.dpapi');if(!st)return null;if(!regular(st)||st.size>2*1024*1024)fail('storage_file_rejected');const h=await fs.open(full('state.dpapi'),'r');try{if(!same(st,await h.stat()))fail('storage_file_replaced');const text=await h.readFile('utf8');await anchor();const after=await exists('state.dpapi');if(!after||!same(st,after))fail('storage_file_replaced');const v=JSON.parse(text);if(!exact(v,['schema','revision','owner','body'])||v.schema!==1||!Number.isSafeInteger(v.revision)||v.revision<1||typeof v.body!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(v.body))fail('storage_envelope_invalid');validateOwner(v.owner);if(binding&&JSON.stringify(v.owner)!==JSON.stringify(binding))fail('storage_owner_changed');return{owner:v.owner,revision:v.revision,bytes:Buffer.from(v.body,'base64')}}finally{await h.close()}}
 async function removeOwn(n,identity){await anchor();const st=await exists(n);if(!st||!regular(st)||id(st)!==identity)fail('storage_cleanup_identity_changed');await fs.unlink(full(n))}
 async function abort(){if(lease){await lease.handle.close();lease=undefined}}
 return{
  bindOwner(owner){binding=structuredClone(validateOwner(owner))},
  async peekOwner(){if(!await anchor(true))return null;return (await load())?.owner??null},
  async read(){if(!await anchor(true))return null;if(await exists('.lock'))fail('storage_transaction_unresolved');return load()},
  async begin(expected,guard){if(lease)fail('storage_transaction_busy');await guard();if(!await anchor(true)){if(!createOnCommit)fail('storage_not_provisioned');await fs.mkdir(root);await anchor()}
   const handle=await fs.open(full('.lock'),'wx',0o600);lease={handle,identity:id(await handle.stat())};onOwnedFile({name:'.lock',identity:lease.identity});try{await handle.writeFile(JSON.stringify({purpose:'PiConsole.StoreLock.v1',pid:process.pid}));await handle.sync();const old=await load();if((old?.revision??0)!==expected)fail('storage_revision_changed');await guard()}catch(e){await abort();throw e}
  },
  async compareAndSwap(expected,bytes,guard){if(!lease)fail('storage_transaction_required');const transaction=lease;let temp,tempId;const name='pending-'+randomUUID()+'.dpapi';let complete=false;
   try{const old=await load();if((old?.revision??0)!==expected)fail('storage_revision_changed');await guard();await fault('before');
    temp=await fs.open(full(name),'wx',0o600);tempId=id(await temp.stat());onOwnedFile({name,identity:tempId});await temp.writeFile(JSON.stringify({schema:1,revision:expected+1,owner:binding,body:bytes.toString('base64')}));await temp.sync();await temp.close();temp=undefined;
    await anchor();await guard();const current=await load();if((current?.revision??0)!==expected)fail('storage_revision_changed');await fault('rename');await fs.rename(full(name),full('state.dpapi'));tempId=undefined;const head=await fs.lstat(full('state.dpapi'));onOwnedFile({name:'state.dpapi',identity:id(head)});await anchor();await fault('after');await guard();complete=true;return true;
   }finally{await temp?.close();await abort();if(tempId)await removeOwn(name,tempId);if(complete)await removeOwn('.lock',transaction.identity)}
  },abort,
  async close(){await abort();closed=true}
 };
}
