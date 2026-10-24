import {randomBytes, timingSafeEqual, createHash} from 'node:crypto';
export const fail=code=>{throw new Error(code)};
export const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
export const key=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const equal=(a,b)=>key(a)&&key(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export function validateOwner(v){if(!exact(v,['sid','installationId','ownerId'])||!/^S-1-5-(?:\d+-)*\d+$/.test(v.sid)||!identifier(v.installationId)||!identifier(v.ownerId))fail('owner_binding_unavailable');return v}
/** Installed-code injection only. No OS, environment, profile or network discovery. */
export function createLocalIdentity({readSid,readInstallationId,readRegisteredOwner}={}){
 const current=async()=>{const sid=await readSid?.();return validateOwner({sid,installationId:await readInstallationId?.(),ownerId:await readRegisteredOwner?.(sid)})};
 return {current,async assert(expected){if(JSON.stringify(await current())!==JSON.stringify(validateOwner(expected)))fail('owner_binding_changed')}};
}
export function createLocalIssuer({secret=()=>randomBytes(32).toString('hex'),reserved=[]}={}){
 const used=new Set(reserved),digests=new Set();if(!reserved.every(key))fail('credential_separation_unknown');
 const issue=()=>{if(used.size>=131072)fail('issuer_capacity');const value=secret();if(!key(value)||used.has(value)||digests.has(hash(value)))fail('credential_generation_failed');used.add(value);return value};
 return {issue,reserve(values,hashes=[]){if(![...values,...hashes].every(key))fail('credential_separation_unknown');for(const v of values)used.add(v);for(const v of hashes)digests.add(v)},bundle(epoch,expiresAt){if(!Number.isSafeInteger(epoch)||epoch<1||!Number.isSafeInteger(expiresAt)||expiresAt<0)fail('bundle_invalid');return{read:issue(),control:issue(),final:issue(),handoff:issue(),renewal:issue(),epoch,expiresAt}}};
}
