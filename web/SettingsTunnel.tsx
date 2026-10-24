import React,{useEffect,useRef,useState} from 'react';
import ExpiryCountdown from './ExpiryCountdown.tsx';
type Request=(route:string,body:unknown)=>Promise<any>;
const labels:Record<string,string>={
  pending:'申請待ち。Console PC の入力画面を準備しています。',
  'input-open':'入力画面の表示を本人が確認してください。Web から可視性は確認できません。',
  starting:'本人の入力後、Tunnel を起動しています。',
  'tunnel-ready':'Tunnel ready。実 App 接続は未確認です。',
  stopping:'取消 / 停止を確認中です。再起動せず結果を照合してください。',
  cancelled:'取消済み。キーを保存していません。',
  expired:'期限切れ。接続を停止しました。新しい申請で再接続できます。',
  'input-not-visible':'入力画面が見えないため取消しました。Console PC の対話画面を確認してください。',
  unavailable:'入力画面または接続を起動できませんでした。',
  noninteractive:'Console PC の対話デスクトップが利用できません。',
  'input-busy':'Console PC で別の入力画面が開いているため、新しい画面を開きませんでした。接続は停止していません。',
  'daemon-unattributed':'動作中の daemon を今回の Console 世代・本人・接続先に結び付けて確認できないため、入力画面を開きませんでした。既存接続は保護しています。',
  conflict:'既存の daemon があるため起動を拒否しました。他の Tunnel は停止していません。',
  stopped:'daemon は終了しました。新しい申請で再接続できます。',
  'stop-unconfirmed':'daemon の停止が未確認です。重複起動は拒否します。Console PC で状態を確認してください。',
  unknown:'結果未確認。同じ申請 ID で照合してください。再送していません。',
};
export default function SettingsTunnel({request}:{request:Request}){
  const [durationMinutes,setDurationMinutes]=useState(480);
  const [open,setOpen]=useState(false),[view,setView]=useState<any>(),[receipt,setReceipt]=useState<any>(),[pending,setPending]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const lock=useRef(false),alive=useRef(true),current=useRef<string|undefined>(undefined),slot='pi-console-settings-tunnel-request';
  const run=async(work:()=>Promise<void>)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{await work()}catch{if(alive.current)setError('認証または結果を確認できません。申請 ID を保持しています。結果を照合し、未確認のまま再送しないでください。')}
    finally{lock.current=false;if(alive.current)setBusy(false)}
  };
  const inspect=async(id:string)=>{
    const v=await request('tunnel/result',{requestId:id});
    if(alive.current&&current.current===id){setReceipt(v);if(v.finished){sessionStorage.removeItem(slot);current.current=undefined;setPending(undefined);setView((old:any)=>({...old,active:null}))}}
    return v;
  };
  const refresh=async()=>{
    const v=await request('tunnel/status',{});
    if(!alive.current)return;setView(v);
    if(v.active){if([60,480,44640].includes(v.active.durationMinutes))setDurationMinutes(v.active.durationMinutes);sessionStorage.setItem(slot,v.active.requestId);current.current=v.active.requestId;setPending(v.active.requestId);setReceipt(v.active)}
  };
  useEffect(()=>{
    alive.current=true;try{const id=sessionStorage.getItem(slot);if(id){current.current=id;setPending(id);setOpen(true);void run(refresh)}}catch{}
    return()=>{alive.current=false};
  },[]);
  useEffect(()=>{
    if(!pending||!open)return;
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{const v=await inspect(pending);if(!stopped&&!v.finished&&!['unknown','stop-unconfirmed'].includes(v.state))timer=setTimeout(()=>void poll(),1000)}
      catch{if(!stopped&&alive.current)setError('接続状態が未確認です。キーを再入力せず、同じ申請 ID で照合してください。')}
    };
    timer=setTimeout(()=>void poll(),1000);return()=>{stopped=true;clearTimeout(timer)};
  },[pending,open]);
  return <section aria-label="トンネル接続">
    <h3>トンネル接続</h3>
    <p>既存の pi-console-echo-test に接続します。キー入力画面は Console PC に開きます。Web / mobile の端末には開きません。キーをこの Web 画面やチャットへ貼り付けないでください。</p>
    {!open?<button disabled={busy} onClick={()=>void run(async()=>{await refresh();setOpen(true)})}>トンネル接続を選ぶ</button>:<>
      <p>本人が PC の入力画面で既存の runtime key を入力して「入力して接続」を押します。保存なし。Tunnel 起動だけでは親フォルダ権限は付与されません。</p>
      {error&&<p role="alert">{error}</p>}
      <label>接続期間<select aria-label="Tunnel duration" value={durationMinutes} disabled={busy||!!pending||!!view?.active} onChange={e=>setDurationMinutes(Number(e.target.value))}><option value={60}>1時間</option><option value={480}>8時間</option><option value={44640}>1か月（31日）</option></select></label>
      <p>新しい接続だけに適用します。1時間・8時間は本人認証期限で短縮されます。1か月は転送の保持を別に許可し、元のログイン期限後も登録解除・Console停止・期限まで維持します。入力確認は本人認証期限内の最大5分です。管理操作には新鮮な本人認証が必要です。</p>
      {view&&!view.available&&<p role="status">固定入力ランチャーが利用できません。Console PC の管理起動を確認してください。</p>}
      <p>長期Tunnelはcredential、親フォルダ・Pi controlの操作許可、idle条件を延長しません。runtime key失効やPC停止で切断される場合があります。期限なしは扱いません。</p>
      <button disabled={busy||!!pending||!!view?.active||!view?.available||typeof crypto.randomUUID!=='function'} onClick={()=>void run(async()=>{
        const requestId=crypto.randomUUID();sessionStorage.setItem(slot,requestId);current.current=requestId;setPending(requestId);
        const v=await request('tunnel/request',{requestId,confirmed:true,durationMinutes});if(alive.current)setReceipt(v);
      })}>Console PC に入力画面を開く</button>
      {receipt?.state==='tunnel-ready'&&<button disabled={busy} onClick={()=>void run(async()=>{
        try{const v=await request('tunnel/reuse',{requestId:receipt.requestId,confirmed:true});if(alive.current)setReceipt(v)}
        catch{if(alive.current){setReceipt((old:any)=>({...old,reused:false}));setError('既存接続の本人・Console世代・期限・readyを確認できませんでした。新規起動、既存接続の停止、期限延長はしていません。')}}
      })}>既存の接続を確認して使う</button>}
      {receipt?.reused&&receipt.state==='tunnel-ready'&&<p role="status">今回の本人・Console世代に属する既存接続の ready を確認しました。入力や再起動なしで利用します。元の接続期限を維持しています。</p>}
      {typeof crypto.randomUUID!=='function'&&<p>この browser は申請に対応していません。HTTPS または対応 browser を使用してください。</p>}
      {receipt&&<><p role="status">{labels[receipt.state]??'状態を確認できません。'} 実 App 接続済み：未確認</p>
        {receipt.expiresAt&&<p>{['pending','input-open'].includes(receipt.state)&&<>入力確認: <ExpiryCountdown expiresAt={receipt.expiresAt}/><br/></>}転送の保持期限: <ExpiryCountdown expiresAt={receipt.leaseUntil}/></p>}</>}
      {pending&&<><p style={{overflowWrap:'anywhere'}}>申請 / 結果照合 ID：{pending}</p>
        <button disabled={busy} onClick={()=>void run(async()=>{await inspect(pending);await refresh()})}>トンネル接続の結果を照合</button>
        <button disabled={busy||receipt?.state==='stop-unconfirmed'} onClick={()=>void run(async()=>{const v=await request('tunnel/cancel',{requestId:pending});if(alive.current)setReceipt(v);await inspect(pending)})}>取消 / トンネルを停止</button>
        {['pending','input-open','unknown'].includes(receipt?.state)&&<button disabled={busy} onClick={()=>void run(async()=>{await request('tunnel/cancel',{requestId:pending,notVisible:true});await inspect(pending)})}>入力画面が見えないので取消</button>}
      </>}
      <p>Tunnel ready は local stdio の準備完了です。実 App 接続は対応 App 側で tool 一覧と接続を確認する別の手順です。この画面では未確認と表示します。</p>
      <p>親フォルダは「ローカル連携を始める」で本人が接続 ID・操作・期限を承認します。Pi の任意コマンドを OS で隔離する機能ではありません。</p>
      <p>戻る操作は接続を停止しません。停止する場合は「取消 / トンネルを停止」を選びます。</p>
      <button disabled={busy} onClick={()=>setOpen(false)}>トンネル設定から戻る</button>
      <button disabled={busy} onClick={()=>void run(refresh)}>トンネル状態を再取得</button>
    </>}
  </section>;
}
