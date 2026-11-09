export interface WindowsProtection {
 scope:'CurrentUser';mode:'dpapi-current-user';
 protect(data:Buffer,entropy:Buffer):Promise<Buffer>;
 unprotect(data:Buffer,entropy:Buffer):Promise<Buffer>;
 currentSid():Promise<string>;
}
export function createWindowsProtection(options?:{authorized?:boolean;run?:typeof runWindowsHelper}):WindowsProtection;
export function runWindowsHelper(script:string,input:Buffer,onProcess?:(event:unknown)=>void):Promise<Buffer>;
