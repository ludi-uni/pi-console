import React,{useEffect,useRef,useState}from'react';
import type{SpeechModelId,SpeechOwnerStatus,SpeechPublicStatus}from'../shared/speech.ts';
import{SPEECH_DEFAULT_MODEL,SPEECH_MODELS,speechModelId}from'../shared/speech.ts';
import{localOwnerLoginCommand}from'./local-resume-config.ts';
import type{LocalResumeSetup}from'./local-resume-config.ts';

const OWNER_PREFIX='/local-owner/voice/';
// The polling ceiling matches the server's bounded install/model-fetch jobs
// (archive + GGUF download timeouts) with headroom; unmount aborts the poll.
const JOB_POLL_LIMIT_MS=35*60*1000,JOB_POLL_INTERVAL_MS=2000;
const jobRunning=(status:SpeechOwnerStatus|undefined)=>status?.job?.state==='running';

const jaPhase:Record<string,string>={off:'無効',installing:'インストール中',['model-fetch']:'モデル取得中',validating:'確認中',stopped:'停止中（必要時に自動起動）',starting:'起動中',ready:'動作中',transcribing:'認識中',error:'エラー'};
const enPhase:Record<string,string>={off:'Off',installing:'Installing',['model-fetch']:'Fetching model',validating:'Validating',stopped:'Stopped (starts on demand)',starting:'Starting',ready:'Ready',transcribing:'Transcribing',error:'Error'};

const jaError:Record<string,string>={
  speech_busy:'別の処理が進行中です。終了または取り消しを待ってから操作してください。',
  speech_confirmation_required:'確認チェックが必要です。',
  speech_download_not_allowed:'ダウンロードへの同意が必要です。',
  speech_install_conflict:'管理先に未検証のファイルがあります。上書きは行いません。「既存の実行ファイル」で確認して使用してください。',
  speech_executable_invalid:'実行ファイルのパスを確認してください（ローカルドライブ上の .exe のみ）。',
  speech_model_directory_invalid:'モデルキャッシュのフォルダーパスを確認してください。',
  speech_platform_unsupported:'speech.cpp は Windows x64 のみ対応です。',
  speech_vulkan_loader_missing:'Vulkan loader が見つかりません。GPU ドライバーまたは Vulkan Runtime を導入してください。',
  speech_not_enabled:'ローカル音声認識が有効化されていません。',
  speech_cancelled:'処理を取り消しました。',
  owner_session_expired:'本人確認の期限が切れました。再認証してから状態を再取得してください。',
};
const enError:Record<string,string>={
  speech_busy:'Another job is running. Wait for it to finish or cancel it first.',
  speech_confirmation_required:'Confirmation is required.',
  speech_download_not_allowed:'Download consent is required.',
  speech_install_conflict:'The managed directory contains unverified files and will not be overwritten. Use the existing-executable option to confirm and adopt your installation.',
  speech_executable_invalid:'Check the executable path (a .exe on a local drive only).',
  speech_model_directory_invalid:'Check the model cache directory path.',
  speech_platform_unsupported:'speech.cpp supports Windows x64 only.',
  speech_vulkan_loader_missing:'The Vulkan loader is missing. Install a GPU driver or the Vulkan Runtime.',
  speech_not_enabled:'Local speech recognition is not enabled.',
  speech_cancelled:'The job was cancelled.',
  owner_session_expired:'Owner verification expired. Sign in again, then refresh the status.',
};
const errorText=(code:string|undefined,ja:boolean,fallback:string)=>code?(ja?jaError:enError)[code]??(ja?`処理できませんでした（${code}）。状態を再取得して確認してください。`:`Could not complete the request (${code}). Refresh the status to reconcile.`):fallback;

/**
 * Local on-device speech recognition (speech.cpp) settings.
 *
 * `owner: false` renders the sanitized public panel for the normal Settings
 * page: GET /api/voice/status only, plus owner-verification guidance. Install,
 * enable and process actions never leave the owner boundary — `owner: true`
 * inside the authenticated local-owner area is the only surface that POSTs to
 * /local-owner/voice/*. No credentials, audio or local paths are stored here;
 * the component keeps only the status bodies the API returned.
 */
export default function SettingsSpeech({ja=true,owner=false,ownerExpiresAt}:{ja?:boolean;owner?:boolean;ownerExpiresAt?:number}={}){
 const text=(en:string,jp:string)=>ja?jp:en;
 const[pubStatus,setPubStatus]=useState<SpeechPublicStatus|undefined>(undefined);
 const[status,setStatus]=useState<SpeechOwnerStatus|undefined>(undefined);
 const[source,setSource]=useState<'managed'|'existing'>('managed');
 const[modelId,setModelId]=useState<SpeechModelId>(SPEECH_DEFAULT_MODEL);
 const[exePath,setExePath]=useState(''),[modelDir,setModelDir]=useState('');
 const[dlConsent,setDlConsent]=useState(false),[exeConsent,setExeConsent]=useState(false);
 const[busy,setBusy]=useState(false),[error,setError]=useState<{code?:string;http?:number}>();
 const[expired,setExpired]=useState(false);
 const[clock,setClock]=useState(Date.now);
 // Owner-verification renewal command source; display-only, nothing persisted.
 const[setup,setSetup]=useState<LocalResumeSetup>({source:'npm'});
 const[repoRoot,setRepoRoot]=useState(''),[nodeCommand,setNodeCommand]=useState('');
 const lock=useRef(false);
 const request=async(route:string,body:unknown):Promise<SpeechOwnerStatus>=>{
   const r=await fetch(OWNER_PREFIX+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   const v=await r.json().catch(()=>({}));
   if(!r.ok){const e=Object.assign(Error('owner_request_unavailable'),{status:r.status});if(r.status===409&&typeof v?.error==='string')(e as any).code=v.error;throw e}
   return v as SpeechOwnerStatus;
 };
 const ownerExpired=(e:unknown)=>(e as{status?:number;code?:string})?.status===401||(e as{code?:string})?.code==='owner_session_expired';
 const refresh=async()=>{const v=await request('status',{});setStatus(v);setPubStatus(undefined);setExpired(false);return v};
 const run=async(work:()=>Promise<unknown>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);setExpired(false);try{await work()}catch(e){if(ownerExpired(e))setExpired(true);else setError({code:(e as{code?:string})?.code,http:(e as{status?:number})?.status})}finally{lock.current=false;setBusy(false)}};
 // Public panel: one sanitized status read on mount. No management action is
 // ever possible from this surface.
 useEffect(()=>{if(owner)return;let mounted=true;fetch('/api/voice/status',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(v=>{if(mounted&&v?.providerId==='speech-cpp')setPubStatus(v)}).catch(()=>{if(mounted)setPubStatus(undefined)});return()=>{mounted=false}},[owner]);
 // Owner panel: initial status read; a running job is polled bounded only.
 useEffect(()=>{if(!owner)return;void run(()=>refresh());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[owner]);
 useEffect(()=>{if(!owner||!jobRunning(status))return;let stopped=false;const started=Date.now();let timer:ReturnType<typeof setTimeout>;
   const poll=async()=>{if(stopped)return;if(Date.now()-started>JOB_POLL_LIMIT_MS)return;try{await refresh()}catch(e){if(!stopped){if(ownerExpired(e))setExpired(true);else setError({code:(e as{code?:string})?.code});return}}
     if(!stopped)timer=setTimeout(()=>void poll(),JOB_POLL_INTERVAL_MS)};
   timer=setTimeout(()=>void poll(),JOB_POLL_INTERVAL_MS);
   return()=>{stopped=true;clearTimeout(timer)}},[owner,status?.job?.id,status?.job?.state]);
 const enable=()=>run(async()=>{
   const body=source==='managed'
     ?{source:'managed',modelId,confirmed:true,allowDownload:true}
     :{source:'existing',executablePath:exePath.trim(),...(modelDir.trim()?{modelDirectory:modelDir.trim()}:{}),modelId,confirmed:true,allowDownload:dlConsent};
   await request('enable',body);await refresh();setDlConsent(false);setExeConsent(false);
 });
 const action=(route:string)=>run(async()=>{await request(route,{});await refresh()});
 const fresh=typeof ownerExpiresAt==='number'?ownerExpiresAt>clock:true;
 const loginCommand=localOwnerLoginCommand(setup.source==='clone'?{source:'clone',repoRoot,...(nodeCommand.trim()?{nodeCommand:nodeCommand.trim()}:{})}:{source:setup.source});
 const ownerHelp=<div className="speech-owner-guidance"><p>{text('Installation and enablement run only on the Console PC itself. On that PC, open a terminal and run the command below; it shows a one-time code and opens the local owner page. Enter the code there (10-minute session, never saved).','導入・有効化は Console PC 本体だけで行えます。Console PC のターミナルで次のコマンドを自分で実行すると、一回コードが表示され本人管理画面が開きます。コードはその画面だけに入力してください（10分間・保存されません）。')}</p>
   <label>{text('Command source','コマンドの取得元')}<select aria-label={text('Owner login command source','本人確認コマンドの取得元')} value={setup.source} onChange={e=>setSetup({source:e.target.value as LocalResumeSetup['source']})}><option value="npm">{text('npm package','npm パッケージ')}</option><option value="clone">{text('Local clone','ローカル clone')}</option></select></label>
   {setup.source==='clone'&&<><label>{text('Repository root','リポジトリの場所')}<input aria-label={text('Owner login clone repository root','本人確認 clone のリポジトリ')} value={repoRoot} autoComplete="off" placeholder="D:\Develop\pi-console" onChange={e=>setRepoRoot(e.target.value)}/></label>
   <label>{text('Node command (optional)','Node コマンド（省略時は node）')}<input aria-label={text('Owner login clone node command','本人確認 clone の Node コマンド')} value={nodeCommand} autoComplete="off" placeholder="node" onChange={e=>setNodeCommand(e.target.value)}/></label></>}
   {loginCommand?<textarea aria-label={text('Owner verification command','本人確認コマンド')} readOnly rows={2} value={loginCommand} style={{width:'100%',boxSizing:'border-box'}}/>:<p role="status">{text('Enter the repository root to build the command.','リポジトリの場所を入力するとコマンドが生成されます。')}</p>}
   <p>{text('If the browser does not open automatically, the command output shows the owner page URL to open on the Console PC. This page never sends setup actions to the public API.','ブラウザーが自動で開かない場合は、コマンド出力に表示される本人管理画面の URL を Console PC で開いてください。この画面から公開 API へ導入操作を送ることはありません。')}</p></div>;
 const phaseLabel=(phase:string)=>text(enPhase[phase]??phase,jaPhase[phase]??phase);
 if(!owner)return <div className="speech-public">
   {pubStatus===undefined?<p role="status">{text('Local speech recognition status could not be loaded.','ローカル音声認識の状態を読み込めませんでした。')}</p>:<>
   <div className="settings-row"><span>{text('Local recognition (speech.cpp)','ローカル音声認識（speech.cpp）')}</span><strong>{pubStatus.enabled?phaseLabel(pubStatus.phase):text('Not configured','未設定')}</strong></div>
   {pubStatus.enabled&&<small>{text('When enabled, the 🎙 voice input can use on-device recognition on the Console PC even in browsers without Web Speech API support. Audio goes only to this server’s local endpoint; it is never stored.','有効な場合、Web Speech API が使えないブラウザーでも、🎙 音声入力で Console PC 上のローカル認識を利用できます。音声はこのサーバーのローカルエンドポイントにだけ送られ、保存されません。')}{pubStatus.modelId&&` · ${SPEECH_MODELS.find(m=>m.id===pubStatus.modelId)?.label??pubStatus.modelId}`}</small>}
   {!pubStatus.enabled&&<small>{text('Enable on-device speech recognition to dictate without Web Speech API. Setup downloads or adopts a speech.cpp runtime on the Console PC (Windows x64 + Vulkan loader).','Web Speech API なしで音声入力するには、ローカル音声認識を有効化します。導入は Console PC 上で speech.cpp ランタイムの取得または既存実行ファイルの利用を選びます（Windows x64 + Vulkan loader）。')}</small>}</>}
   {ownerHelp}
 </div>;
 const running=jobRunning(status);
 return <section className="speech-owner" aria-label={text('Local speech recognition','ローカル音声認識')}>
  <h2>{text('Local speech recognition (speech.cpp)','ローカル音声認識（speech.cpp）')}</h2>
  {expired&&<div role="alert"><p>{text('Owner verification expired or the session changed. Confirm the request state, then re-run the command below on the Console PC and refresh — do not resend blindly.','本人確認の期限が切れたか、セッションが変わりました。処理状態を照合してから、Console PC で次のコマンドを再実行して再取得してください。無判断での再送はしないでください。')}</p>{ownerHelp}</div>}
  {status&&<>
   <dl className="speech-status"><div><dt>{text('State','状態')}</dt><dd>{status.enabled?phaseLabel(status.phase):text('Off','無効')}{status.modelId&&` · ${SPEECH_MODELS.find(m=>m.id===status.modelId)?.label??status.modelId}`}{status.version&&` · v${status.version}`}</dd></div>
    {status.executablePath&&<div><dt>{text('Executable','実行ファイル')}</dt><dd><code dir="ltr">{status.executablePath}</code></dd></div>}
    {status.modelDirectory&&<div><dt>{text('Model cache','モデルキャッシュ')}</dt><dd><code dir="ltr">{status.modelDirectory}</code></dd></div>}
    {status.vulkanRequired&&<div><dt>{text('Runtime requirement','動作要件')}</dt><dd>{text('Windows x64 + Vulkan loader (GPU driver or Vulkan Runtime)','Windows x64 + Vulkan loader（GPU ドライバーまたは Vulkan Runtime）')}</dd></div>}
    {status.lastError&&<div role="alert"><dt>{text('Settings error','設定エラー')}</dt><dd>{errorText(status.lastError,ja,status.lastError)}</dd></div>}
    {status.job&&<div><dt>{text('Job','処理')}</dt><dd>{status.job.kind} · {status.job.state}{status.job.error&&` · ${errorText(status.job.error,ja,status.job.error)}`}</dd></div>}
   </dl>
   {running&&<p role="status">{text('A job is running. New requests are rejected until it finishes, is cancelled or expires (polling is bounded to about 35 minutes).','処理を実行中です。終了・取り消し・期限まで新しい操作は拒否されます（状態確認は約35分で打ち切ります）。')}</p>}
   {status.job&&status.job.state!=='running'&&status.job.state!=='done'&&<p role="status">{text('Last job ended as','前回の処理は')} “{status.job.state}”{status.job.error?` (${errorText(status.job.error,ja,status.job.error)})`:''}{text('. Review the state, then retry or reconfigure.','。状態を確認してから、再試行または再設定してください。')}</p>}
   {error&&<p role="alert">{errorText(error.code,ja,text('Could not reach the owner endpoint. Refresh and reconcile before retrying.','本人管理エンドポイントへ接続できませんでした。再取得して照合してから操作してください。'))}</p>}
   <div className="speech-owner-actions">
    {running?<button disabled={busy||!fresh} onClick={()=>void action('cancel')}>{text('Cancel running job','実行中の処理を取り消す')}</button>:<>
    <button disabled={busy||!fresh} onClick={()=>void run(refresh)}>{text('Refresh status','状態を再取得')}</button>
    {status.enabled&&status.phase==='stopped'&&<button disabled={busy||!fresh} onClick={()=>void action('start')}>{text('Start local server now','ローカルサーバーを今すぐ起動')}</button>}
    {status.enabled&&status.phase==='error'&&<button disabled={busy||!fresh} onClick={()=>void action('start')}>{text('Retry start','起動を再試行')}</button>}
    {status.enabled&&<button disabled={busy||!fresh} onClick={()=>void action('disable')}>{text('Disable local recognition','ローカル音声認識を無効化')}</button>}
    </>}
   </div>
   {!status.enabled&&!running&&<div className="speech-enable">
    <p>{text('Choose how the Console PC gets the speech.cpp runtime. Both options can later reuse the installed copy — enable is idempotent against the stored settings.','Console PC が speech.cpp ランタイムを得る方法を選びます。どちらも導入済みの内容は再利用します（有効化は保存済み設定に対して冪等です）。')}</p>
    <label>{text('Setup source','導入方法')}<select aria-label={text('Speech setup source','音声認識の導入方法')} value={source} disabled={busy} onChange={e=>setSource(e.target.value as 'managed'|'existing')}><option value="managed">{text('Official download + portable install','公式ダウンロード＋ポータブルインストール')}</option><option value="existing">{text('Existing speech.exe on this PC','このPC上の既存 speech.exe')}</option></select></label>
    <label>{text('Model','モデル')}<select aria-label={text('Speech model','音声認識モデル')} value={modelId} disabled={busy} onChange={e=>{if(speechModelId(e.target.value))setModelId(e.target.value)}}>{SPEECH_MODELS.map(m=><option key={m.id} value={m.id}>{m.label}{m.default?text(' (default)','（初期値）'):''}</option>)}</select></label>
    {source==='managed'?<>
      <p role="status">{text('Downloads the official speech.cpp Windows x64 release into the Console data directory (portable, no system install), then fetches the selected model GGUF. The 0.6B model alone is about 0.84 GB; a network connection, free space at the install location and a Windows x64 Vulkan loader are required.','公式 speech.cpp Windows x64 リリースを Console データディレクトリへダウンロードします（ポータブル・システムインストールなし）。その後、選択したモデル GGUF を取得します。0.6B モデルだけでも約 0.84 GB 必要で、ネット接続・保存先の空き容量・Windows x64 の Vulkan loader が必要です。')}</p>
      <label className="speech-consent"><input aria-label={text('Consent to download speech.cpp release and model','speech.cpp リリースとモデルのダウンロードに同意')} type="checkbox" checked={dlConsent} disabled={busy} onChange={e=>setDlConsent(e.target.checked)}/><span>{text('I consent to downloading the official release archive and the selected model to the Console PC.','公式リリースアーカイブと選択モデルを Console PC へダウンロードすることに同意します。')}</span></label>
    </>:<>
      <p>{text('Runs an existing speech.exe already on this PC; nothing is installed by default. Enter the absolute path of the executable. To reuse an existing model cache, enter that directory too — when left empty the Console data directory cache is used, so an existing cache elsewhere needs the input.','このPC上の既存 speech.exe を実行します。標準では何もインストールしません。実行ファイルの絶対パスを入力してください。既存のモデルキャッシュを再利用する場合はそのフォルダーも入力します。空のままでは Console データディレクトリ内のキャッシュを使うため、別場所の既存キャッシュを再利用するには入力が必要です。')}</p>
      <label>{text('speech.exe path','speech.exe のパス')}<input aria-label={text('Existing speech.exe absolute path','既存 speech.exe の絶対パス')} value={exePath} autoComplete="off" placeholder="C:\Tools\speech.cpp\speech.exe" disabled={busy} onChange={e=>setExePath(e.target.value)}/></label>
      <label>{text('Model cache directory (optional)','モデルキャッシュのフォルダー（任意）')}<input aria-label={text('Existing model cache directory','既存モデルキャッシュのフォルダー')} value={modelDir} autoComplete="off" placeholder="C:\Tools\speech.cpp\models" disabled={busy} onChange={e=>setModelDir(e.target.value)}/></label>
      <label className="speech-consent"><input aria-label={text('Confirm running the existing speech.exe','既存 speech.exe の実行を確認')} type="checkbox" checked={exeConsent} disabled={busy} onChange={e=>setExeConsent(e.target.checked)}/><span>{text('I confirm this executable is mine and Pi Console may run it for local speech recognition.','この実行ファイルが自分のもので、ローカル音声認識のために Pi Console が実行することを確認します。')}</span></label>
      <label className="speech-consent"><input aria-label={text('Allow model download if the selected model is missing','選択モデルが無い場合のダウンロードを許可')} type="checkbox" checked={dlConsent} disabled={busy} onChange={e=>setDlConsent(e.target.checked)}/><span>{text('Allow downloading the selected model GGUF if it is not already cached (off by default).','選択モデルがキャッシュに無い場合、GGUF のダウンロードを許可します（初期値はオフ）。')}</span></label>
    </>}
    <button disabled={busy||!fresh||(source==='managed'?!dlConsent:(!exeConsent||!exePath.trim()))} onClick={()=>void enable()}>{text('Enable local recognition','ローカル音声認識を有効化')}</button>
   </div>}
   {status.enabled&&!running&&status.phase!=='ready'&&status.phase!=='transcribing'&&<small>{text('Installed runtime and cached model are reused on the next transcription — the server starts lazily on first use.','導入済みのランタイムとキャッシュ済みモデルは次の認識時に再利用されます（初回利用時に自動起動）。')}</small>}
  </>}
  {!status&&!expired&&<p role="status">{text('Loading owner status…','本人管理の状態を読み込み中…')}</p>}
  {!expired&&<small>{text('Owner verification expires in 10 minutes; no credentials, audio or transcripts are stored by this page.','本人確認は10分で終了します。この画面は資格情報・音声・認識結果を保存しません。')}</small>}
 </section>;
}
