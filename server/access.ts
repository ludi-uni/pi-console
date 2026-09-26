import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { IncomingMessage } from 'node:http';

export interface AccessConfig { origin: string; host: string; issuer: string; audience: string }

export function accessConfig(env: NodeJS.ProcessEnv): AccessConfig | undefined {
  const origin=env.PI_CONSOLE_PUBLIC_ORIGIN,team=env.PI_CONSOLE_ACCESS_TEAM_DOMAIN,audience=env.PI_CONSOLE_ACCESS_AUD;
  if (![origin,team,audience].some(Boolean)) return undefined;
  if (!origin||!team||!audience) throw new Error('Remote mode requires PI_CONSOLE_PUBLIC_ORIGIN, PI_CONSOLE_ACCESS_TEAM_DOMAIN and PI_CONSOLE_ACCESS_AUD together');
  const publicUrl=new URL(origin),teamUrl=new URL(team);
  if (publicUrl.protocol!=='https:'||publicUrl.origin!==origin||!publicUrl.hostname.includes('.')||publicUrl.username||publicUrl.password||publicUrl.port ||
      teamUrl.protocol!=='https:'||teamUrl.origin!==team||!teamUrl.hostname.endsWith('.cloudflareaccess.com')||teamUrl.hostname==='.cloudflareaccess.com'||teamUrl.port||
      !/^[\w-]{16,256}$/.test(audience)) throw new Error('Invalid remote origin, Access team domain or application AUD');
  return {origin:publicUrl.origin,host:publicUrl.host,issuer:teamUrl.origin,audience};
}

export function allowedHost(host: string | undefined, config?: AccessConfig): boolean {
  if (!host) return false;
  if (config) return host.toLowerCase()===config.host.toLowerCase();
  try { const url=new URL(`http://${host}`);return ['127.0.0.1','localhost','[::1]'].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
}

export function allowedPost(req: Pick<IncomingMessage,'headers'>, config?: AccessConfig): boolean {
  if (req.headers['sec-fetch-site']==='cross-site') return false;
  const origin=req.headers.origin;
  if (config) return origin===config.origin;
  if (!origin) return true; // Retain local CLI compatibility; remote mode never permits absent Origin.
  try { return new URL(origin).host===req.headers.host; } catch { return false; }
}

export function createAccessVerifier(config: AccessConfig, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`), {timeoutDuration:3000,cooldownDuration:30000,cacheMaxAge:600000})) {
  return async (token: string | undefined): Promise<boolean> => {
    if (!token || token.length>8192) return false;
    try {
      const {payload}=await jwtVerify(token,keys,{issuer:config.issuer,audience:config.audience,algorithms:['RS256'],requiredClaims:['iat','exp'],clockTolerance:'5s'});
      // Browser UI is interactive only. Cloudflare service tokens have an empty sub.
      return payload.type==='app' && typeof payload.sub==='string' && payload.sub.length>0 &&
        typeof payload.iat==='number' && payload.iat<=Date.now()/1000+5 && typeof payload.exp==='number' && payload.exp>payload.iat;
    } catch { return false; }
  };
}
