import type { SessionInfo, Workspace, ExecutionEvent, ExecutionStateSnapshot } from '../shared/types.ts';
/** The banner is transient; older failures remain available in Execution history. */
export function recentIssue(events: ExecutionEvent[], dismissed: readonly string[], now = Date.now()): ExecutionEvent | undefined {
  let issue: ExecutionEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) if (['RunFailed','ToolFailed','ErrorEvent'].includes(events[i].type)) { issue = events[i]; break; }
  if (!issue || dismissed.includes(issue.eventId) || !Number.isFinite(Date.parse(issue.timestamp)) || now - Date.parse(issue.timestamp) >= 10 * 60_000) return;
  if (events.some(e => e.seq > issue.seq && e.type === 'RunCompleted')) return;
  return issue;
}
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
export function visibleExecutionRows(state:ExecutionStateSnapshot|undefined,open:ReadonlySet<string>,collapsed:ReadonlySet<string>):ExecutionStateSnapshot['rows'] {
  const visible:ExecutionStateSnapshot['rows']=[],ancestors:string[]=[];
  const withAgent=new Set(state?.nodes.filter(node=>node.kind==='agent'&&node.parentId).map(node=>node.parentId!)??[]);
  for(const row of state?.rows??[]){
    ancestors.length=row.depth;
    if(ancestors.some(id=>collapsed.has(id)))continue;
    if(row.node.kind==='tool'&&row.node.status!=='running'&&!open.has(row.node.parentId??'')&&!withAgent.has(row.node.id)){ancestors[row.depth]=row.node.id;continue;}
    visible.push(row);ancestors[row.depth]=row.node.id;
  }
  return visible;
}
export function validQuickPrompts(values:unknown):values is string[] {return Array.isArray(values)&&values.length<=8&&values.every(v=>typeof v==='string'&&!!v.trim()&&v.length<=200);}
