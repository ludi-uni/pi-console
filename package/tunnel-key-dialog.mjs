import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, lstat, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerGuiBinding } from './owner-gui-dialog.mjs';

const script=fileURLToPath(new URL('./tunnel-key-dialog.ps1',import.meta.url));
const binding=fileURLToPath(new URL('./tunnel-binding.psm1',import.meta.url));
const nativeTemp='C:\\Users\\leade\\AppData\\Local\\Temp';
const pins={script:'f1967fe90a1ee6a974c596767988161c4c8ef271f2a2dba0120c483e628f16d8',binding:'59c3d96893ff0da221318684aa3136766301add6f1dafe7f27f52fa0c68a3cbd'};
const states=['input-open','starting','tunnel-ready','cancelled','expired','unavailable','noninteractive','conflict','input-busy','daemon-unattributed','stopped','stop-unconfirmed'];
const completed=['cancelled','expired','unavailable','noninteractive','conflict','input-busy','daemon-unattributed','stopped'];
const quote=value=>JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export function tunnelDisplay(view){
  const {leaseUntil,...owner}=view;
  if(owner.bindingDigest!==ownerGuiBinding(owner)||!Number.isSafeInteger(leaseUntil)||leaseUntil<owner.expiresAt)throw Error('tunnel_view_unavailable');
  return [
    '• 対象：既存 App pi-console-echo-test の固定 echo Tunnel',
    '• この画面は Console PC に開きます。Web / mobile にキーを入力しません。',
    '• 既存の Restricted runtime key (Tunnels Read + Use) のみ入力。新規発行・保存なし。',
    '• 入力して接続 を本人が押すまで daemon は起動しません。閉じる / 取消は接続を止めます。',
    '• 同じ Tunnel が別の PC / terminal で動いている場合は取消してください。',
    '• Tunnel ready と実 App 接続確認は別です。MCP 権限の承認も別です。',
    '• 1か月は転送の保持許可です。本人認証・credential・Pi/folder操作許可は延長しません。',
    '', '【本人と申請】','• Subject: '+quote(owner.subject),'• Issuer: '+quote(owner.issuer),'• AUD: '+quote(owner.audience),
    '• 申請 ID: '+owner.requestId,'• 入力期限 (UTC): '+new Date(owner.expiresAt).toISOString(),'• 接続期限 (UTC): '+new Date(leaseUntil).toISOString(),
    '', '【Console】','• 世代: '+owner.generation,'• PID / port: '+owner.pid+' / '+owner.port,'• 起動 (UTC): '+owner.startedAt,
    '', '• 親フォルダ許可・repo 作成・Pi 指示・run/history/final 本文公開は行いません。',
  ].join('\n');
}
export async function assertTunnelLauncherFiles(){
  for(const [file,pin] of [[script,pins.script],[binding,pins.binding]]){
    const stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||createHash('sha256').update(await readFile(file)).digest('hex')!==pin)throw Error('tunnel_launcher_identity_mismatch');
  }
}
/** No user command/path/env/key option. Injection seam is only for pure transport tests. */
export function createWindowsTunnelLauncher({spawnProcess=spawn}={}){
  const owned=new WeakMap();
  const launch=async(view,{signal,onState})=>{
    let display,runtime;
    try{
      display=tunnelDisplay(view);
      if(view.port!==31717)throw Error('fixed_console_port_required');
      await assertTunnelLauncherFiles();
      if(signal.aborted)return{stopped:true};
      runtime=await mkdtemp(join(nativeTemp,'pi-console-tunnel-'));
    }catch{onState('unavailable');return{stopped:true}}
    if(signal.aborted){await rm(runtime,{recursive:true});return{stopped:true}}
    // This copy targets the explicitly approved Windows Console PC only.
    const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows'};
    for(const name of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])env[name]=runtime;
    return new Promise(resolve=>{
      let child,buffer='',last='',settled=false,stopTimer,startTimer,probe;
      const finishProbe=value=>{if(!probe)return;const current=probe;probe=undefined;clearTimeout(current.timer);current.resolve(value)};
      owned.set(view,()=>{
        if(settled||signal.aborted||last!=='tunnel-ready'||Date.now()>=view.leaseUntil)return Promise.resolve(false);
        if(probe)return probe.promise;
        let resolve;const promise=new Promise(r=>resolve=r);probe={promise,resolve,id:randomUUID(),timer:setTimeout(()=>finishProbe(false),2000)};
        try{child.stdin.write(JSON.stringify({requestId:view.requestId,action:'verify',probeId:probe.id})+'\n')}catch{finishProbe(false)}
        return promise;
      });
      const finish=async(stopped)=>{
        if(settled)return;settled=true;finishProbe(false);owned.delete(view);clearTimeout(startTimer);clearTimeout(stopTimer);signal.removeEventListener('abort',cancel);
        // Preserve uncertain runtime metadata; never remove a directory that may still be used.
        if(stopped)await rm(runtime,{recursive:true,force:true}).catch(()=>{});
        resolve({stopped});
      };
      const cancel=()=>{
        clearTimeout(startTimer);
        try{child?.stdin.write(JSON.stringify({requestId:view.requestId,action:'cancel'})+'\n')}catch{}
        stopTimer??=setTimeout(()=>void finish(false),7000);
      };
      try{
        child=spawnProcess('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-STA','-File',script],{shell:false,windowsHide:false,cwd:runtime,env,stdio:['pipe','pipe','pipe']});
        child.on('error',()=>{onState('unavailable');if(child.pid)cancel();else void finish(true)});
        child.stdout.on('data',chunk=>{
          if(settled)return;
          buffer+=chunk.toString('utf8');
          if(buffer.length>2048){buffer='';cancel();return}
          let offset;
          while((offset=buffer.indexOf('\n'))>=0){
            const line=buffer.slice(0,offset).trim();buffer=buffer.slice(offset+1);
            try{
              const event=JSON.parse(line);
              if(Object.keys(event).length===3&&event.requestId===view.requestId&&typeof event.probeId==='string'&&['connection-verified','connection-unverified'].includes(event.state)){
                if(!probe||event.probeId!==probe.id)continue;
                finishProbe(event.state==='connection-verified'&&!settled&&!signal.aborted&&last==='tunnel-ready'&&Date.now()<view.leaseUntil);continue;
              }
              if(Object.keys(event).length!==2||event.requestId!==view.requestId||!states.includes(event.state)){cancel();continue}
              last=event.state;if(last!=='tunnel-ready')finishProbe(false);clearTimeout(startTimer);onState(last);
              if(completed.includes(last)||last==='stop-unconfirmed')stopTimer??=setTimeout(()=>void finish(false),7000);
            }catch{cancel()}
          }
        });
        child.stderr.on('data',()=>{}); // Never display/log/store native or daemon raw output.
        child.on('close',()=>void finish(completed.includes(last)));
        child.stdin.on('error',()=>cancel());
        signal.addEventListener('abort',cancel,{once:true});
        child.stdin.write(JSON.stringify({requestId:view.requestId,DisplayText:display,expiresAt:view.expiresAt,leaseUntil:view.leaseUntil,RuntimeRoot:runtime})+'\n');
        startTimer=setTimeout(()=>{onState('unavailable');cancel()},10000);
        if(signal.aborted)cancel();
      }catch{onState('unavailable');if(child)cancel();else void finish(true)}
    });
  };
  launch.verifyConnection=async view=>{
    // Same frozen view object + held native pipe, never a disk record or PID-name adoption.
    const verify=owned.get(view);if(!verify)return false;
    try{await assertTunnelLauncherFiles();return owned.get(view)===verify&&await verify()}catch{return false}
  };
  return launch;
}
