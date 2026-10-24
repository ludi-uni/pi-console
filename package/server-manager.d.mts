export interface ManagerOptions {env?:Record<string,string|undefined>;port?:number;timeoutMs?:number}
export interface ManagedServerState {status:string;action?:string;managed?:boolean;pid?:number;port?:number;url?:string;startedAt?:string;version?:string;error?:string;note?:string;pidAlive?:boolean;portOccupied?:boolean}
export declare function consolePort(env:Record<string,string|undefined>):number;
export declare function startManagedServer(options?:ManagerOptions):Promise<ManagedServerState>;
export declare function stopManagedServer(options?:Omit<ManagerOptions,'port'>):Promise<ManagedServerState>;
export declare function restartManagedServer(options?:ManagerOptions):Promise<ManagedServerState>;
export declare function managedServerStatus(options?:Pick<ManagerOptions,'env'>):Promise<ManagedServerState>;
/** Trusted caller only; returns the single-use code once, never the manager token. */
export declare function requestManagedOwnerLogin(options?:Pick<ManagerOptions,'env'>):Promise<{url:string;code:string;expiresAt:number}>;
export interface ManagedOwnerIdentity {pid:number;startedAt:string;port:number;generation:string}
/** Trusted composition only. io is for isolated tests, never settings/env/HTTP. */
export declare function verifyManagedOwnerServer(options:{expected:ManagedOwnerIdentity;env?:Record<string,string|undefined>;io?:{loadEnvironment:(env:Record<string,string|undefined>)=>Promise<Record<string,string|undefined>>;dataDir:(env:Record<string,string|undefined>)=>string;readState:(dir:string)=>Promise<unknown>;readToken:(dir:string)=>Promise<string|undefined>;request:(port:number,options:{identityChallenge:string})=>Promise<unknown>;challenge:()=>string}}):Promise<ManagedOwnerIdentity>;

/** Read-only dedicated broker proof; never returns the management token. */
export declare function managedResumeBroker(options:{directory:string;io?:{readState:(dir:string)=>Promise<any>;readToken:(dir:string)=>Promise<string|undefined>;request:(port:number,options:{identityChallenge:string})=>Promise<any>;challenge:()=>string}}):Promise<{origin:string;pid:number;startedAt:string;generation:string}>;
/** Explicit management-proof transport ensure; never issues a code/cookie/grant. */
export declare function ensureManagedResumeBroker(options:{directory:string;io?:{readState:(dir:string)=>Promise<any>;readToken:(dir:string)=>Promise<string|undefined>;request:(port:number,options:any)=>Promise<any>;challenge:()=>string;requestId:()=>string}}):Promise<{origin:string;pid:number;startedAt:string;generation:string}>;
