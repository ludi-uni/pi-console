import {randomUUID} from 'node:crypto';
import {CONFIRMATION_WAIT_MS,MAX_CONNECTION_MS} from './connection-expiry.mjs';
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v),secret=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false}),string={type:'string'},target={serverId:string,workspaceId:string,sessionId:string,generation:string};
export const piControlCatalog=()=>[
 {name:'begin_pi_control_connection',description:'Explicit request for owner-selected Pi session and finite expiry. Does not enable control or stage/execute instructions.',inputSchema:schema({requestId:string})},
 {name:'get_pi_control_connection',description:'Reconcile this explicit control request; private credential claim stays inside companion memory. Does not resubmit.',inputSchema:schema({requestId:string})},
 {name:'cancel_pi_control_connection',description:'Disconnect only this shared control companion handle. Owner grant removal is in Console. Does not stop Pi or folder connection.',inputSchema:schema({requestId:string,connectionGeneration:string})},
 {name:'get_control_status',description:'Selected Pi control identity and approved ID metadata only. No names, paths or history/final body.',inputSchema:schema({})},
 {name:'list_control_sessions',description:'Read only the owner-selected existing session/generation and idle/queue/approval metadata. Never opens a worker.',inputSchema:schema({serverId:string,workspaceId:string})},
 {name:'submit_instruction',description:'Privately stage an explicitly requested plain-language Pi instruction, once per UUID. Does not start. Shared connection, not chat identity.',inputSchema:schema({...target,requestId:string,message:{type:'string',maxLength:20000},mode:{type:'string',enum:['pi']}})},
 {name:'start_execution',description:'Start the exact staged instruction only on its observed idle generation. Never answers approvals.',inputSchema:schema({...target,instructionId:string})},
 {name:'stop_execution',description:'Request stop of the exact active Pi run only. No background/orchestrator/OS process controls.',inputSchema:schema({...target,requestId:string,runId:string})},
 {name:'get_request',description:'Reconcile instruction/start/stop acknowledgement by exact request UUID. Accepted is not execution completion; unknown never means resend.',inputSchema:schema({...target,requestId:string})},
 {name:'cancel_instruction',description:'Cancel only a staged instruction, never an already started Pi run.',inputSchema:schema({...target,requestId:string})},
];
const names=new Set(piControlCatalog().map(t=>t.name));
/** One independent control lane alongside the existing folder lane. */
export function createPiControlCompanion({post,now=Date.now,generation=randomUUID}){
 const requests=new Map(),flights=new Map();let active,closed=false;
 const wipe=r=>{r.proof=undefined;r.token=undefined};
 const expire=r=>{if(r&&r.expiresAt<=now()&&!['cancelled','expired'].includes(r.state)){wipe(r);r.state='expired'}};
 const view=r=>{expire(r);return{requestId:r.requestId,state:r.state,connectionId:r.connectionId??null,connectionGeneration:r.generation,expiresAt:r.expiresAt,target:r.target??null,authority:'shared_control_companion',disclosure:'Explicitly owner-selected Pi session only. No folder scope change or final/history text.'}};
 const exact=(args,keys)=>{if(!object(args)||Object.keys(args).length!==keys.length||keys.some(k=>!Object.hasOwn(args,k)))throw Error('pi_control_unavailable')};
 async function broker(id,r,route,body,token){const control=new AbortController();flights.set(id,{control,r});const timer=setTimeout(()=>control.abort(),route==='rpc'?5000:1000);try{const abort=new Promise((_,reject)=>control.signal.addEventListener('abort',()=>reject(Error('pi_request_unknown')),{once:true}));const value=await Promise.race([Promise.resolve().then(()=>post(route,body,token,control.signal)),abort]);expire(r);if(closed||control.signal.aborted||r!==active||['cancelled','expired'].includes(r.state))throw Error('pi_request_unknown');return value}finally{clearTimeout(timer);flights.delete(id)}}
 return{handles:name=>names.has(name),catalog:piControlCatalog,
  async call(id,name,args){if(closed)throw Error('pi_control_unavailable');
   if(name==='begin_pi_control_connection'){exact(args,['requestId']);if(!identifier(args.requestId))throw Error();if(requests.has(args.requestId))return view(requests.get(args.requestId));expire(active);if(requests.size>=32||active&&!['cancelled','expired'].includes(active.state))throw Error();const g=generation();if(!identifier(g)||[...requests.values()].some(r=>r.generation===g))throw Error();const r={requestId:args.requestId,generation:g,state:'requesting',expiresAt:now()+CONFIRMATION_WAIT_MS};active=r;requests.set(r.requestId,r);
    try{const value=await broker(id,r,'request',{name:'MCP control companion'});if(!object(value)||!identifier(value.connectionId)||!secret(value.proof)||value.connectionId===value.proof||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now()||value.expiresAt>r.expiresAt+1000)throw Error();r.connectionId=value.connectionId;r.proof=value.proof;r.expiresAt=value.expiresAt;r.state='pending'}catch{if(r.state!=='cancelled'){wipe(r);r.state='unknown'}}return view(r);
   }
   if(name==='get_pi_control_connection'){exact(args,['requestId']);if(!identifier(args.requestId))throw Error();const r=requests.get(args.requestId);if(!r)return{requestId:args.requestId,state:'unknown',connectionId:null,connectionGeneration:null,target:null};expire(r);if(r!==active||!r.proof||!['pending','connected','unknown'].includes(r.state))return view(r);
    try{const value=await broker(id,r,'claim',{connectionId:r.connectionId,proof:r.proof});if(value.state==='pending'&&r.state!=='connected'){r.state='pending';r.token=undefined}
     else if(value.state==='connected'&&value.connectionId===r.connectionId&&secret(value.token)&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now()&&value.expiresAt<=now()+MAX_CONNECTION_MS&&object(value.target)&&Object.keys(value.target).length===5&&Number.isSafeInteger(value.target.revision)&&value.target.revision>=0&&['instance','workspaceId','sessionId','generation'].every(k=>identifier(value.target[k]))&&!Object.values(value.target).some(v=>v===value.token||v===r.proof)&&value.connectionId!==value.token){r.token=value.token;r.target=value.target;r.expiresAt=value.expiresAt;r.state='connected'}else throw Error()
    }catch{if(!['cancelled','expired'].includes(r.state)){r.token=undefined;r.state='unknown'}}return view(r);
   }
   if(name==='cancel_pi_control_connection'){exact(args,['requestId','connectionGeneration']);const r=requests.get(args.requestId);if(!r||r.generation!==args.connectionGeneration)throw Error();wipe(r);r.state='cancelled';for(const f of flights.values())if(f.r===r)f.control.abort();return view(r)}
   if(!names.has(name)||!object(args))throw Error();expire(active);if(!active||active.state!=='connected'||!active.token)throw Error();const r=active;
   const value=await broker(id,r,'rpc',{name,arguments:args},r.token);const serialized=JSON.stringify(value);if([r.token,r.proof].filter(Boolean).some(k=>serialized.includes(k)))throw Error('pi_response_unavailable');return value;
  },cancel(id){flights.get(id)?.control.abort()},close(){closed=true;for(const f of flights.values())f.control.abort();requests.forEach(r=>{wipe(r);r.state='cancelled'})}
 };
}
