import type { ManagedOwnerIdentity } from './server-manager.mjs';
export interface OwnerGuiView extends ManagedOwnerIdentity {requestId:string;subject:string;issuer:string;audience:string;expiresAt:number;bindingDigest:string}
export type OwnerGuiDecision='approved'|'cancelled'|'unavailable'|'noninteractive';
export interface OwnerGuiResult {decision:OwnerGuiDecision;bindingDigest:string}
export type OwnerGuiDialog=(view:Readonly<OwnerGuiView>,options:{signal:AbortSignal})=>Promise<OwnerGuiResult>;
export declare function ownerGuiBinding(view:Omit<OwnerGuiView,'bindingDigest'>|OwnerGuiView):string;
export declare function ownerGuiDisplay(view:OwnerGuiView):string;
export declare const ownerGuiScript:string;
export interface OwnerGuiTransportInput {file:string;args:string[];input:string;env:Record<string,string>;signal:AbortSignal}
export declare function windowsDialogTransport(input:OwnerGuiTransportInput):Promise<OwnerGuiDecision>;
export declare function createWindowsOwnerDialog(options?:{transport?:(input:OwnerGuiTransportInput)=>Promise<string>;platform?:string;env?:Record<string,string|undefined>}):OwnerGuiDialog;
