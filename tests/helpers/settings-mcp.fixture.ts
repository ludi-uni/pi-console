import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAccessPrincipalVerifier, type VerifiedAccessPrincipal } from '../../server/access.ts';
import { SettingsOwner, type OwnerRecord, type OwnerStore } from '../../server/settings-owner.ts';
import { createSettingsMcp, nativeDiscoveryRequest } from '../../server/settings-mcp.ts';
import { setup } from './folder-mcp.fixture.ts';
import { ownerOrigin } from '../../package/local-folder-mcp.mjs';

export const access = { origin: 'https://console.example.test', host: 'console.example.test', issuer: 'https://dummy.cloudflareaccess.com', audience: 'dummy-audience-1234567890' };
const keys = await generateKeyPair('RS256'), jwk = await exportJWK(keys.publicKey); jwk.kid='dummy';jwk.alg='RS256';
const verifier = createAccessPrincipalVerifier(access,createLocalJWKSet({keys:[jwk]}));
export async function principal(subject='dummy-owner',lifetime='1h') { return (await verifier(await new SignJWT({sub:subject,type:'app'}).setProtectedHeader({alg:'RS256',kid:'dummy'}).setIssuer(access.issuer).setAudience(access.audience).setIssuedAt().setExpirationTime(lifetime).sign(keys.privateKey)))!; }
export function memoryOwnerStore() { let value: unknown, writes=0, broken=false;const store:OwnerStore={read:async()=>structuredClone(value),write:async(v:OwnerRecord)=>{writes++;if(broken)throw Error();value=structuredClone(v)}};return{store,value:()=>value,writes:()=>writes,break:()=>{broken=true}} }
export async function ownerFixture(lifetime='1h') {const store=memoryOwnerStore(), p=await principal('dummy-owner',lifetime), other=await principal('dummy-other');let time=Date.now();const owners=new SettingsOwner(store.store,access,()=>time);await owners.load();const register=async()=>{const requestId=randomUUID();owners.request(p,{requestId});await owners.approve({requestId,confirmed:true},()=>{});return requestId};return{store,p,other,owners,register,advance:(n:number)=>{time+=n}}}
export async function settingsFixture(extra:any={}) {
  const f=setup(), store=memoryOwnerStore(), p=await principal(), other=await principal('dummy-other'), principals=new WeakMap<object,VerifiedAccessPrincipal>();let broker=false,starts=0;
  const app=await createSettingsMcp({store:store.store,access,principal:r=>principals.get(r),localVerify:r=>r.headers['x-dummy-local-owner']==='verified',folders:f.app,startBroker:async()=>{broker=true;starts++},broker:()=>({listening:broker,port:broker?40001:null}),consolePort:40000,...extra});
  async function call(route:string,body:unknown={},options:{who?:'owner'|'other'|'none';local?:boolean;headers?:Record<string,string|undefined>;duplicate?:string;remote?:boolean}={}) {
    const headers:any=options.local?{host:'127.0.0.1:40001',origin:'http://127.0.0.1:40001','sec-fetch-site':'same-origin','content-type':'application/json','x-dummy-local-owner':'verified'}:{host:access.host,origin:access.origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-pi-console-admin':'1','cf-access-jwt-assertion':'DUMMY_NOT_A_JWT'};
    Object.assign(headers,options.headers);for(const k of Object.keys(headers))if(headers[k]===undefined)delete headers[k];
    const req:any=Readable.from([Buffer.from(JSON.stringify(body))]);req.headers=headers;req.rawHeaders=Object.entries(headers).flat();if(options.duplicate)req.rawHeaders.push(options.duplicate,headers[options.duplicate]);req.method='POST';req.url=(options.local?'/local-owner/settings-owner/':'/api/settings-local-mcp/')+route;req.socket={localAddress:'127.0.0.1',localPort:40000,remoteAddress:options.remote?'192.0.2.1':'127.0.0.1'};
    if(!options.local&&options.who!=='none')principals.set(req,options.who==='other'?other:p);
    let status=0,value:any;const res:any={writeHead:(s:number)=>{status=s},end:(v:string)=>{value=JSON.parse(v)}};
    const handled=await(options.local?app.handleLocal(req,res):app.handlePublic(req,res));assert(handled);return{status,body:value};
  }
  const register=async()=>{const requestId=randomUUID();app.owners.request(p,{requestId});assert.equal((await call('approve-owner',{requestId,confirmed:true},{local:true})).status,200);return requestId};
  return{...f,folders:f.app,app,store,p,other,call,register,starts:()=>starts};
}
