import type { TunnelView } from '../server/settings-tunnel.ts';
export function tunnelDisplay(view:Readonly<TunnelView>):string;
export function assertTunnelLauncherFiles():Promise<void>;
export function createWindowsTunnelLauncher(options?:{spawnProcess?:typeof import('node:child_process').spawn}):((view:Readonly<TunnelView>,options:{signal:AbortSignal;onState(state:string):void})=>Promise<{stopped:boolean}>) & {verifyConnection(view:Readonly<TunnelView>):Promise<boolean>};
