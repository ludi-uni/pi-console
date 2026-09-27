import React, {useState} from 'react';

export type KitDecision={id:string;runId:string;question:string;reason:string;options:{id:string;summary:string}[];recommended?:string};
export type KitDecisions={runId?:string;decisions:KitDecision[];canResume?:boolean};

export default function KitDecisionPanel({data,onAnswer,onResume,onContinueChat,chatAllowed}:{data:KitDecisions;onAnswer:(runId:string,decisionId:string,answer:string)=>Promise<void>;onResume:(runId:string)=>Promise<void>;onContinueChat?:()=>void;chatAllowed?:boolean}){
  const [draft,setDraft]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  if(!data.runId||!data.decisions.length&&!data.canResume)return null;
  const submit=async(decision:KitDecision)=>{
    const answer=draft[decision.id]?.trim();if(!answer||busy)return;
    setBusy(true);setError('');
    try{await onAnswer(data.runId!,decision.id,answer);setDraft(current=>({...current,[decision.id]:''}))}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  };
  const retry=async()=>{
    if(!data.runId||busy)return;
    setBusy(true);setError('');
    try{await onResume(data.runId)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  };
  return <section className="kit-decision-panel" aria-label="Orchestrator questions">
    {data.decisions.length?<><h3>Orchestrator needs your answer · {data.decisions.length}</h3>
    <p>Choose an option or provide an answer. The kit saves your answer in repository-scoped decision memory. After all questions are answered, it resumes and may make additional model calls.</p></>:<><h3>Answer saved · run paused</h3><p>Your answer is already saved. Retry the kit continuation without submitting it again. This may make additional model calls.</p></>}
    {error&&<p role="alert">{error}</p>}
    {data.decisions.map(decision=><div className="kit-decision" key={decision.id}>
      <strong>{decision.question}</strong>{decision.reason&&<p>{decision.reason}</p>}
      {decision.options.length?<label>Answer
        <select aria-label={`Answer to decision ${decision.id}`} value={draft[decision.id]??''} disabled={busy} onChange={e=>setDraft(current=>({...current,[decision.id]:e.target.value}))}>
          <option value="">Choose an option…</option>{decision.options.map(option=><option key={option.id} value={option.id}>{option.id}{option.summary?` — ${option.summary}`:''}{option.id===decision.recommended?' (recommended)':''}</option>)}
        </select>
      </label>:<label>Answer<textarea aria-label={`Answer to decision ${decision.id}`} maxLength={4000} value={draft[decision.id]??''} disabled={busy} onChange={e=>setDraft(current=>({...current,[decision.id]:e.target.value}))}/></label>}
      <button className="button-primary" disabled={busy||!draft[decision.id]?.trim()} onClick={()=>void submit(decision)}>{busy?'Sending…':'Submit answer'}</button>
    </div>)}
    {!data.decisions.length&&data.canResume&&<><button className="button-primary" disabled={busy} onClick={()=>void retry()}>{busy?'Resuming…':'Retry continuation'}</button>
      {onContinueChat&&(chatAllowed?<p role="status">Pi chat is available. The kit run remains paused until you retry.</p>:<button disabled={busy} onClick={onContinueChat}>Continue Pi chat while kit is paused</button>)}</>}
  </section>;
}
