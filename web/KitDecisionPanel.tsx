import React, {useState} from 'react';

export type KitDecision={id:string;runId:string;question:string;reason:string;options:{id:string;summary:string}[];recommended?:string};
export type KitDecisions={runId?:string;decisions:KitDecision[];canResume?:boolean};
export type KitDecisionDrafts=Record<string,string>;

export default function KitDecisionPanel({data,onAnswer,onResume,onContinueChat,chatAllowed,drafts,onDraftChange,onShowExecution,ja}:{data:KitDecisions;onAnswer:(runId:string,decisionId:string,answer:string)=>Promise<void>;onResume:(runId:string)=>Promise<void>;onContinueChat?:()=>void;chatAllowed?:boolean;drafts:KitDecisionDrafts;onDraftChange:(decisionId:string,value:string)=>void;onShowExecution?:()=>void;ja?:boolean}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  if(!data.runId||!data.decisions.length&&!data.canResume)return null;
  const submit=async(decision:KitDecision)=>{
    const answer=drafts[decision.id]?.trim();if(!answer||busy)return;
    setBusy(true);setError('');
    try{await onAnswer(data.runId!,decision.id,answer);onDraftChange(decision.id,'')}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  };
  const retry=async()=>{
    if(!data.runId||busy)return;
    setBusy(true);setError('');
    try{await onResume(data.runId)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  };
  return <section className="kit-decision-panel" aria-label="Orchestrator questions" tabIndex={-1}>
    {data.decisions.length?<><h3>{ja?'Orchestrator の質問 · ':''}Orchestrator needs your answer · {data.decisions.length}</h3>
    <p>{ja?'選択肢を選ぶか回答を入力してください。回答はリポジトリー単位の判断記録に保存されます。すべての質問に回答するとkitが再開し、追加のモデル呼び出し（料金）が発生する場合があります。':'Choose an option or provide an answer. The kit saves your answer in repository-scoped decision memory. After all questions are answered, it resumes and may make additional model calls.'}</p></>:<><h3>{ja?'回答済み · 実行は一時停止中':'Answer saved · run paused'}</h3><p>{ja?'回答は保存済みです。回答を再送せずにkitの続行だけを再試行できます。追加のモデル呼び出し（料金）が発生する場合があります。':'Your answer is already saved. Retry the kit continuation without submitting it again. This may make additional model calls.'}</p></>}
    {error&&<p role="alert">{error}</p>}
    {data.decisions.map(decision=><div className="kit-decision" key={decision.id}>
      <strong>{decision.question}</strong>{decision.reason&&<p>{decision.reason}</p>}
      {decision.options.length?<label>Answer
        <select aria-label={`Answer to decision ${decision.id}`} value={drafts[decision.id]??''} disabled={busy} onChange={e=>onDraftChange(decision.id,e.target.value)}>
          <option value="">{ja?'選択肢を選んでください…':'Choose an option…'}</option>{decision.options.map(option=><option key={option.id} value={option.id}>{option.id}{option.summary?` — ${option.summary}`:''}{option.id===decision.recommended?(ja?'（推奨）':' (recommended)'):''}</option>)}
        </select>
      </label>:<label>Answer<textarea aria-label={`Answer to decision ${decision.id}`} maxLength={4000} value={drafts[decision.id]??''} disabled={busy} onChange={e=>onDraftChange(decision.id,e.target.value)}/></label>}
      <button className="button-primary" disabled={busy||!drafts[decision.id]?.trim()} onClick={()=>void submit(decision)}>{busy?(ja?'送信中…':'Sending…'):(ja?'回答を送信':'Submit answer')}</button>
    </div>)}
    {!data.decisions.length&&data.canResume&&<><button className="button-primary" disabled={busy} onClick={()=>void retry()}>{busy?(ja?'再開中…':'Resuming…'):(ja?'続行を再試行':'Retry continuation')}</button>
      {onContinueChat&&(chatAllowed?<p role="status">{ja?'Piチャットを利用できます。kitの実行は再試行するまで一時停止したままです。':'Pi chat is available. The kit run remains paused until you retry.'}</p>:<button disabled={busy} onClick={onContinueChat}>{ja?'kitを一時停止したままPiチャットを続ける':'Continue Pi chat while kit is paused'}</button>)}</>}
    {onShowExecution&&<button className="kit-open-execution" disabled={busy} onClick={onShowExecution}>{ja?'実行画面で確認':'View in Execution'}</button>}
  </section>;
}
