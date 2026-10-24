import {createHmac,timingSafeEqual} from 'node:crypto';
import {managedResumeBroker} from './managed-resume-broker.mjs';
const match=(value,expected)=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value,'hex'),Buffer.from(expected,'hex'));
/** Explicit installed-client transport ensure; never invokes owner-login or a resume service route. */
export async function ensureManagedResumeBroker({directory,io}={}){
 try{
  if(!io)throw Error();const state=await io.readState(directory),token=await io.readToken(directory);if(!state||!/^[0-9a-f]{48}$/.test(token??''))throw Error();
  const challenge=io.challenge();if(!/^[0-9a-f]{48}$/.test(challenge))throw Error();const reply=await io.request(state.port,{identityChallenge:challenge}),v=reply?.body;
  if(reply?.status!==200||v?.service!=='pi-console'||v.pid!==state.pid||v.startedAt!==state.startedAt||!/^[0-9a-f]{32}$/.test(v.nonce??'')||!match(v.proof,createHmac('sha256',token).update('pi-console-identity:'+challenge).digest('hex')))throw Error();
  if(v.resumeBroker)return await managedResumeBroker({directory,io:{readState:async()=>state,readToken:async()=>token,challenge:()=>challenge,request:async()=>reply}});
  const requestId=io.requestId();if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId))throw Error();
  const binding=JSON.stringify([v.nonce,v.pid,v.startedAt,state.port,requestId]),proof=createHmac('sha256',token).update('pi-console-resume-open:'+binding).digest('hex');
  const r=await io.request(state.port,{method:'POST',path:'/api/manage/local-resume/open',proof,body:{challenge:v.nonce,pid:v.pid,startedAt:v.startedAt,requestId}}),b=r?.body;
  if(r?.status!==200||b?.service!=='pi-console'||b.pid!==v.pid||b.startedAt!==v.startedAt||b.nonce!==v.nonce||b.requestId!==requestId||!Number.isInteger(b.broker?.port)||b.broker.port<1||b.broker.port>65535||b.broker.port===state.port||!match(b.broker.signature,createHmac('sha256',token).update('pi-console-resume-open-result:'+JSON.stringify([v.nonce,v.pid,v.startedAt,state.port,requestId,b.broker.port])).digest('hex')))throw Error();
  return{origin:'http://127.0.0.1:'+b.broker.port,pid:v.pid,startedAt:v.startedAt,generation:v.nonce};
 }catch{throw Error('managed_resume_open_unavailable')}
}
