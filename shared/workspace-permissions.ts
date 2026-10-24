export type PermissionScope = 'read' | 'control';
export type WorkspacePermission = { id: string; path: string; scope: PermissionScope; sessions: { id: string; generation: string }[] };
import type { ResultTarget } from './results-read.ts';
export type FinalPublication = {target:ResultTarget;feature:'final_answer';expiresAt:number;credentialEpoch:string;requestId:string};
export type FinalSaveResult = {requestId:string;instance:string;credentialEpoch:string;action:'grant'|'revoke';revision:number};
export type PermissionSnapshot = { version: 1 | 2; revision: number; workspaces: WorkspacePermission[]; finalPublication?:FinalPublication|null; finalRequests?:FinalSaveResult[] };
export type PermissionInventory = { id: string; path: string; eligible: boolean; sessions: { id: string; generation: string }[] };
export type PermissionReview = { instance: string; snapshot: PermissionSnapshot; inventory: PermissionInventory[]; grant: string; controlAvailable: boolean };
