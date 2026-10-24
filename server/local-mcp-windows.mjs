import{spawn}from'node:child_process';
import{HELPER_SOURCE}from'./local-mcp-dpapi-helper.mjs';
import{fail}from'./local-mcp-identity.mjs';
const EXE='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SID_SOURCE="$ErrorActionPreference='Stop';[Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)";
/** No discovery or launch on import/construction. Only explicit calls create owned helpers. */
export function runWindowsHelper(script,input,onProcess=()=>{}){return new Promise((resolve,reject)=>{
 const child=spawn(EXE,['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows'}});
 let output=Buffer.alloc(0),errors=0,failed=false,settled=false,cleanupTimer;const report=v=>{try{onProcess(v)}catch{}},finish=error=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);if(error){output.fill(0);reject(Error(error))}else resolve(output)};
 const timer=setTimeout(()=>{failed=true;child.kill();cleanupTimer=setTimeout(()=>{child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();report({pid:child.pid,closed:false});finish('windows_helper_exit_unconfirmed')},2000)},10000);
 child.once('spawn',()=>report({pid:child.pid,closed:false,started:true}));
 child.stdout.on('data',b=>{if(output.length+b.length>2*1024*1024){failed=true;child.kill()}else output=Buffer.concat([output,b])});child.stderr.on('data',b=>{errors+=b.length;if(errors>4096){failed=true;child.kill()}});child.on('error',()=>{failed=true});child.stdin.on('error',()=>{});child.stdin.end(input);
 child.on('close',code=>{report({pid:child.pid,closed:true,exit:code});finish(failed||code!==0||errors?'windows_helper_failed':null)});
})}
export function createWindowsProtection({authorized=false,run=runWindowsHelper}={}){
 const need=()=>{if(authorized!==true)fail('windows_protection_not_authorized')};
 const crypt=async(operation,data,entropy)=>{need();if(!Buffer.isBuffer(data)||!Buffer.isBuffer(entropy)||data.length>1024*1024||entropy.length>4096)fail('windows_protection_input_invalid');let input,output;try{input=Buffer.from(JSON.stringify({operation,data:data.toString('base64'),entropy:entropy.toString('base64')}));output=await run(HELPER_SOURCE,input);if(!Buffer.isBuffer(output)||!/^[A-Za-z0-9+/]+={0,2}$/.test(output.toString('ascii')))fail('windows_protection_response_invalid');const result=Buffer.from(output.toString('ascii'),'base64');if(!result.length||result.length>1024*1024)fail('windows_protection_response_invalid');return result}finally{input?.fill(0);output?.fill(0)}};
 return{scope:'CurrentUser',mode:'dpapi-current-user',protect:(d,e)=>crypt('protect',d,e),unprotect:(d,e)=>crypt('unprotect',d,e),async currentSid(){need();const b=await run(SID_SOURCE,Buffer.alloc(0));try{const sid=b.toString('ascii');if(!/^S-1-5-(?:\d+-)*\d+$/.test(sid))fail('windows_principal_unavailable');return sid}finally{b.fill(0)}}};
}
