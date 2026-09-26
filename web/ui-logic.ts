import type { SessionInfo, Workspace } from '../shared/types.ts';
export function groupWorkspaces(items: Workspace[], query: string) {
  const filtered=items.filter(w=>`${w.name} ${w.path}`.toLowerCase().includes(query.toLowerCase()));
  const pinned=filtered.filter(w=>w.pinned).sort((a,b)=>b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  const rest=filtered.filter(w=>!w.pinned).sort((a,b)=>b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  return {pinned,recent:rest.slice(0,5),all:rest.slice(5)};
}
export function filterSessions(items:SessionInfo[],query:string) {return items.filter(s=>`${s.name??''} ${s.id}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(!!b.decisionCount)-Number(!!a.decisionCount)||Number(!!b.running)-Number(!!a.running)||(b.updatedAt??'').localeCompare(a.updatedAt??''));}
export function connectionLabel(input:{online:boolean;server:boolean;sse:'connecting'|'connected'|'reconnecting'|'offline';runtime?:string}) {
  if(!input.online)return 'Browser offline';
  if(!input.server)return 'Server unavailable';
  if(input.runtime==='failed')return 'Pi process failed';
  if(input.runtime==='stopped')return 'Pi process stopped';
  if(input.sse==='reconnecting')return 'SSE reconnecting';
  if(input.sse==='connecting')return 'Connecting';
  return input.sse==='connected'?'Runtime healthy':'Browser disconnected';
}
export function validQuickPrompts(values:unknown):values is string[] {return Array.isArray(values)&&values.length<=8&&values.every(v=>typeof v==='string'&&!!v.trim()&&v.length<=200);}
