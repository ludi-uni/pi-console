import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccessConfig, VerifiedAccessPrincipal } from './access.ts';
import { SettingsOwner, type OwnerStore } from './settings-owner.ts';
import { folderOwnerAction, type FolderMcp } from './folder-mcp.ts';
import { readJsonBody } from './body.ts';
import { PermissionFault, strictPermissionObject } from './workspace-permissions.ts';
import { randomUUID } from 'node:crypto';
import { OwnerGuiEnrollment, type OwnerGuiOptions } from './owner-gui.ts';
import { SettingsTunnel, type TunnelOptions } from './settings-tunnel.ts';
import {piControlOwnerAction} from './pi-control-http.ts';
import type {PiControlActivation} from './pi-control-activation.ts';

const count = (r: IncomingMessage, n: string) => r.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === n).length;
const proxy = (r: IncomingMessage) => Object.keys(r.headers).some(n => n === 'forwarded' || n === 'via' || n === 'x-real-ip' || n.startsWith('cf-') || n.startsWith('x-forwarded-'));
const send = (r: ServerResponse, status: number, value: unknown) => { r.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); r.end(JSON.stringify(value)); };
export function nativeDiscoveryRequest(r: IncomingMessage) { return r.method === 'GET' && r.url === '/api/local-mcp-discovery' && r.socket.localAddress === '127.0.0.1' && r.socket.remoteAddress === '127.0.0.1' && r.headers.host === `127.0.0.1:${r.socket.localPort}` && count(r, 'host') === 1 && !proxy(r) && !r.headers.origin && !r.headers['sec-fetch-site'] && !r.headers.cookie && !r.headers.authorization; }
export async function createSettingsMcp(options: { store: OwnerStore; access?: AccessConfig; principal: (r: IncomingMessage) => VerifiedAccessPrincipal | undefined; localVerify: (r: IncomingMessage) => boolean; localExpiry?: (r: IncomingMessage) => number | undefined; folders: FolderMcp; resumeRevokeOwner?:(requestId:string,check:()=>void)=>Promise<void>; startBroker: () => Promise<void>; broker: () => { listening: boolean; port: number | null }; consolePort: number; now?: () => number; ownerGui?: OwnerGuiOptions; tunnel?: TunnelOptions; piControl?:()=>PiControlActivation }) {
  const owners = new SettingsOwner(options.store, options.access, options.now); await owners.load();
  const gui = new OwnerGuiEnrollment(owners, options.ownerGui, options.now);
  const tunnel = new SettingsTunnel(owners, options.tunnel, options.now);
  const browser = (r: IncomingMessage) => {
    const a = options.access;
    return !!a && r.method === 'POST' && r.headers.host === a.host && r.headers.origin === a.origin && r.headers['sec-fetch-site'] === 'same-origin' && r.headers['content-type'] === 'application/json' && r.headers['x-pi-console-admin'] === '1' && ['host', 'origin', 'sec-fetch-site', 'content-type', 'x-pi-console-admin', 'cf-access-jwt-assertion'].every(n => count(r, n) === 1) && owners.fresh(options.principal(r));
  };
  const verify = (r: IncomingMessage) => browser(r) && owners.owns(options.principal(r));
  const metadata = () => ({ consoleOrigin: `http://127.0.0.1:${options.consolePort}`, brokerReady: options.broker().listening, guiAvailable: gui.available() });
  const revokeConnections = () => options.folders.revoke({ connectionId: 'all', requestId: randomUUID() }, () => {});
  async function handle(req: IncomingMessage, res: ServerResponse, local: boolean): Promise<boolean> {
    const prefix = local ? '/local-owner/settings-owner/' : '/api/settings-local-mcp/';
    if (!req.url?.startsWith(prefix)) return false;
    try {
      const localStatus = !local && !options.access && req.url === prefix + 'status' && req.method === 'POST' && req.socket.localAddress === '127.0.0.1' && req.socket.remoteAddress === '127.0.0.1' && !proxy(req) && req.headers.host === `127.0.0.1:${req.socket.localPort}` && req.headers.origin === `http://127.0.0.1:${req.socket.localPort}` && req.headers['sec-fetch-site'] === 'same-origin' && req.headers['content-type'] === 'application/json' && ['host','origin','sec-fetch-site','content-type'].every(n => count(req,n) === 1);
      if (req.url.includes('?') || !(local ? options.localVerify(req) : browser(req) || localStatus)) throw new PermissionFault('verified_owner_browser_required');
      const route = req.url.slice(prefix.length), p = options.principal(req);
      const assertOwner = () => { if (!(local ? options.localVerify(req) : verify(req))) throw new PermissionFault('owner_session_expired'); };
      const b = await readJsonBody(req, 8192); let result: unknown;
      if (route === 'status') { strictPermissionObject(b, []); const state = options.broker(); result = { ...(local ? owners.localView() : owners.status(p)), ...metadata(), ...(localStatus && state.listening && state.port ? { ownerUrl: `http://127.0.0.1:${state.port}/local-owner/` } : {}) }; }
      else if (!local && route === 'request-owner') result = gui.request(p, b);
      else if (!local && route === 'owner-result') result = gui.result(p, (strictPermissionObject(b, ['requestId']), b.requestId));
      else if (!local && route === 'cancel-owner') result = gui.cancel(p, b);
      else if (local && route === 'approve-owner') { if (gui.manages(b.requestId)) throw new PermissionFault('owner_gui_browser_approval_rejected'); result = await owners.approve(b, assertOwner); }
      else if (route === 'revoke-owner') { assertOwner(); result = await owners.revoke(b, assertOwner, async()=>{await options.resumeRevokeOwner?.(b.requestId,assertOwner);await tunnel.stopAll();await options.piControl?.().stopAll();await revokeConnections()}); }
      else if(!local&&route.startsWith('pi-control/')&&options.piControl){assertOwner();result=await piControlOwnerAction(options.piControl(),route.slice(11),b,JSON.stringify([p!.subject,p!.issuer,p!.audience]),assertOwner)}
      else if (!local && route.startsWith('tunnel/')) {
        assertOwner();
        if(route==='tunnel/status'){strictPermissionObject(b,[]);result=tunnel.status(p)}
        else if(route==='tunnel/request')result=tunnel.request(p,b);
        else if(route==='tunnel/reuse'){result=await tunnel.reuse(p,b);assertOwner()}
        else if(route==='tunnel/result'){strictPermissionObject(b,['requestId']);result=tunnel.result(p,b.requestId)}
        else if(route==='tunnel/cancel')result=tunnel.cancel(p,b);
        else throw new PermissionFault('settings_route_unavailable');
      }
      else if (!local && route === 'start') { strictPermissionObject(b, []); assertOwner(); await options.startBroker(); assertOwner(); result = { ...owners.status(p), ...metadata() }; }
      else if (!local && route.startsWith('folder/')) { assertOwner(); result = await folderOwnerAction(options.folders, route.slice(7), b, assertOwner, local ? options.localExpiry?.(req) : p?.expiresAt); }
      else throw new PermissionFault('settings_route_unavailable');
      send(res, 200, result);
    } catch (e) { req.resume(); send(res, 409, { error: e instanceof PermissionFault ? e.code : 'settings_request_unavailable' }); }
    return true;
  }
  return { owners, gui, tunnel, dispose: async () => {await Promise.all([gui.dispose(),tunnel.dispose()])}, verify, handlePublic: (r: IncomingMessage, s: ServerResponse) => handle(r, s, false), handleLocal: (r: IncomingMessage, s: ServerResponse) => handle(r, s, true), discovery(req: IncomingMessage, res: ServerResponse) {
    if (!req.url?.startsWith('/api/local-mcp-discovery')) return false;
    if (!nativeDiscoveryRequest(req)) { send(res, 403, { error: 'local_discovery_boundary_rejected' }); return true; }
    const state = options.broker();
    if (!state.listening || state.port === null) send(res, 409, { error: 'start_local_connection_in_settings' });
    else send(res, 200, { version: 1, brokerOrigin: `http://127.0.0.1:${state.port}` });
    return true;
  } };
}
