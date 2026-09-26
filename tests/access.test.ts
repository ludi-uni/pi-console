import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { accessConfig, allowedHost, allowedPost, createAccessVerifier } from '../server/access.ts';

const env={PI_CONSOLE_PUBLIC_ORIGIN:'https://console.example.com',PI_CONSOLE_ACCESS_TEAM_DOMAIN:'https://my-team.cloudflareaccess.com',PI_CONSOLE_ACCESS_AUD:'a'.repeat(64)};
const config=accessConfig(env)!;
test('remote config is explicit and fails closed; local and public Host/Origin stay separate',()=>{
  assert.equal(accessConfig({}),undefined);
  assert.throws(()=>accessConfig({PI_CONSOLE_PUBLIC_ORIGIN:env.PI_CONSOLE_PUBLIC_ORIGIN}),/requires/);
  for(const origin of ['http://console.example.com','https://console.example.com/evil','https://user@console.example.com','https://console.example.com:8443'])
    assert.throws(()=>accessConfig({...env,PI_CONSOLE_PUBLIC_ORIGIN:origin}));
  assert.throws(()=>accessConfig({...env,PI_CONSOLE_ACCESS_TEAM_DOMAIN:'https://attacker.example.com'}));
  assert.equal(allowedHost('console.example.com',config),true);assert.equal(allowedHost('127.0.0.1:31717',config),false);
  assert.equal(allowedHost('localhost:31717'),true);assert.equal(allowedHost('attacker.example.com'),false);
  assert.equal(allowedPost({headers:{host:'console.example.com',origin:'https://console.example.com'}},config),true);
  assert.equal(allowedPost({headers:{host:'console.example.com'}},config),false);
  assert.equal(allowedPost({headers:{host:'console.example.com',origin:'https://evil.example.com'}},config),false);
  assert.equal(allowedPost({headers:{host:'console.example.com',origin:'https://console.example.com','sec-fetch-site':'cross-site'}},config),false);
});

test('Cloudflare Access JWT requires rotating-key signature, RS256, iss/aud/time and interactive subject',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='key-1';jwk.alg='RS256';jwk.use='sig';
  const verify=createAccessVerifier(config,createLocalJWKSet({keys:[jwk]}));
  const sign=(claims:Record<string,unknown>)=>new SignJWT({type:'app',sub:'user-1',...claims}).setProtectedHeader({alg:'RS256',kid:'key-1'}).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const valid=await sign({});assert.equal(await verify(valid),true);assert.equal(await verify(undefined),false);
  assert.equal(await verify(valid.slice(0,-2)+'zz'),false);
  assert.equal(await verify(await new SignJWT({type:'app',sub:'u'}).setProtectedHeader({alg:'RS256',kid:'key-1'}).setIssuer('https://other.cloudflareaccess.com').setAudience(config.audience).setIssuedAt().setExpirationTime('1h').sign(privateKey)),false);
  assert.equal(await verify(await new SignJWT({type:'app',sub:'u'}).setProtectedHeader({alg:'RS256',kid:'key-1'}).setIssuer(config.issuer).setAudience('b'.repeat(64)).setIssuedAt().setExpirationTime('1h').sign(privateKey)),false);
  assert.equal(await verify(await new SignJWT({type:'app',sub:'u'}).setProtectedHeader({alg:'RS256',kid:'key-1'}).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime('-1s').sign(privateKey)),false);
  assert.equal(await verify(await sign({sub:''})),false);
  assert.equal(await verify(await sign({nbf:Math.floor(Date.now()/1000)+3600})),false);
  assert.equal(await verify('x'.repeat(8193)),false);
});
