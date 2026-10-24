import{createHmac,timingSafeEqual}from'node:crypto';
const diagnostics=new WeakMap();
class BrokerFailure extends Error{
 constructor(reason,httpStatus=null,message='managed_resume_unavailable'){
  super(message);const diagnostic=Object.freeze({reason,httpStatus});
  diagnostics.set(this,diagnostic);Object.defineProperty(this,'diagnostic',{value:diagnostic,enumerable:true});
 }
}
/** Trusted observer output only: never inspect arbitrary error messages, codes or payloads. */
export function managedResumeDiagnostic(error){return{...(diagnostics.get(error)??{reason:'unclassified_failure',httpStatus:null})}}
export async function managedResumeBroker({directory,io}={}){
 const source=io;if(!source)throw new BrokerFailure('io_unavailable',null,'managed_resume_io_required');
 let stage='state_read_failed',httpStatus=null;
 const fail=reason=>{throw new BrokerFailure(reason,httpStatus)};
 try{
  const state=await source.readState(directory);stage='token_read_failed';const token=await source.readToken(directory);
  if(!state)fail('state_unavailable');if(!/^[0-9a-f]{48}$/.test(token??''))fail('token_invalid');
  stage='challenge_failed';const challenge=source.challenge();if(!/^[0-9a-f]{48}$/.test(challenge))fail('challenge_invalid');
  stage='identity_request_failed';const reply=await source.request(state.port,{identityChallenge:challenge});
  stage='identity_reply_invalid';httpStatus=Number.isInteger(reply?.status)&&reply.status>=100&&reply.status<=599?reply.status:null;
  const v=reply?.body,b=v?.resumeBroker;
  const match=(actual,expected)=>typeof actual==='string'&&/^[0-9a-f]{64}$/.test(actual)&&timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
  if(reply?.status!==200)fail(reply==null?'identity_response_unavailable':'identity_http_rejected');
  if(v?.service!=='pi-console')fail('service_mismatch');
  if(v.pid!==state.pid)fail('pid_mismatch');
  if(v.startedAt!==state.startedAt)fail('started_at_mismatch');
  if(!/^[0-9a-f]{32}$/.test(v.nonce??''))fail('generation_invalid');
  if(!match(v.proof,createHmac('sha256',token).update('pi-console-identity:'+challenge).digest('hex')))fail('identity_proof_invalid');
  if(!b)fail('broker_not_advertised');
  if(!Number.isInteger(b.port)||b.port<1||b.port>65535)fail('broker_port_invalid');
  if(b.port===state.port)fail('broker_port_conflict');
  if(!match(b.signature,createHmac('sha256',token).update('pi-console-resume-broker:'+JSON.stringify([challenge,v.pid,v.startedAt,state.port,v.nonce,b.port])).digest('hex')))fail('broker_signature_invalid');
  return{origin:'http://127.0.0.1:'+b.port,pid:v.pid,startedAt:v.startedAt,generation:v.nonce};
 }catch(error){if(diagnostics.has(error))throw error;throw new BrokerFailure(stage,httpStatus)}
}
