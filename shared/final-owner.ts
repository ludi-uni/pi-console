import type {ResultTarget} from './results-read.ts';
export interface FinalOwnerView {available:boolean;reason:string|null;instance?:string;revision?:number;choices:{target:ResultTarget}[];publication:{target:ResultTarget;expiresAt:number;active:boolean}|null}
export interface FinalOwnerReview {reviewId:string;requestId:string;target:ResultTarget|null;expiresAt:number|null;previous:FinalOwnerView['publication'];instance:string;revision:number}
