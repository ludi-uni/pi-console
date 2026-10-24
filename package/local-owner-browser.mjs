import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
const execute=promisify(execFile);

export function localOwnerAddress(value){
 const match=typeof value==='string'&&/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/local-owner\/$/.exec(value);
 if(!match||match[0]!==value||Number(match[1])<1024||Number(match[1])>65535)throw Error('local owner address rejected');
 return value;
}

/** The caller has verified the management response. This helper receives only
 * the nonsecret literal-loopback URL, never a bootstrap code or auth object. */
export async function openOwnerLoginBrowser(value,{exec=execute,platform=process.platform,env=process.env}={}){
 const url=localOwnerAddress(value);
 if(platform!=='win32')return {opened:false};
 const browserEnv={};
 for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','ComSpec','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])if(env[key])browserEnv[key]=env[key];
 const file=join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 // URL is strict ASCII with no quotes/whitespace/metacharacters. Encoding does
 // not conceal a secret: the script contains this public URL and fixed syntax.
 const script=`$ErrorActionPreference='Stop'; Start-Process -FilePath '${url}' -WindowStyle Normal`;
 const args=['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
 try{await exec(file,args,{windowsHide:true,timeout:5000,maxBuffer:8192,env:browserEnv});return {opened:true};}
 catch{return {opened:false};} // Never print browser/PowerShell error output.
}
