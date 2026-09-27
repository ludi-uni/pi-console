import React, { memo, useState } from 'react';
import type { ChatMessage as Message } from '../shared/types.ts';
export function splitCode(text:string): {type:'text'|'code';text:string;language?:string}[] {
  const parts:{type:'text'|'code';text:string;language?:string}[]=[];
  const fence=/```([^\n`]*)\n([\s\S]*?)```/g;let position=0;let match:RegExpExecArray|null;
  while((match=fence.exec(text))!==null){if(match.index>position)parts.push({type:'text',text:text.slice(position,match.index)});parts.push({type:'code',language:match[1].trim().slice(0,40),text:match[2].replace(/\n$/,'')});position=fence.lastIndex;}
  if(position<text.length)parts.push({type:'text',text:text.slice(position)});
  return parts;
}
export async function copyText(value:string) {await navigator.clipboard.writeText(value);}
function ChatItem({message,activityLabel}:{message:Message;activityLabel?:string}) {
  const [copied,setCopied]=useState('');
  const copy=async(value:string,label:string)=>{try{await copyText(value);setCopied(`${label} copied`);setTimeout(()=>setCopied(''),2000);}catch{setCopied('Copy failed — check clipboard permission');}};
  return <article className="message" data-role={message.role} data-message-id={message.id} tabIndex={-1}>
    <div className="message-bubble"><div className="message-head"><strong>{message.role==='assistant'?'Pi':'You'}</strong></div>
      {message.role==='assistant'?splitCode(message.text).map((part,index)=>part.type==='code'?<div className="code-block" key={index}><div className="code-head"><span>{part.language||'code'}</span><button aria-label="Copy code" onClick={()=>void copy(part.text,'Code')}>Copy code</button></div><pre><code>{part.text}</code></pre></div>:<p className="message-text" key={index}>{part.text}</p>):<p className="message-text">{message.text}</p>}
      {message.role==='assistant'&&!!message.thinking&&<details className="message-thinking"><summary>Thinking · {message.complete?'show':'in progress'}</summary><pre>{message.thinking}</pre></details>}
      {message.role==='assistant'&&!!message.tools?.length&&<div className="message-tools" aria-label="Tool calls"><strong>Tools · {message.tools.length}</strong>{message.tools.map((tool,index)=><details key={`${tool.id}:${index}`}><summary>{tool.command!==undefined?'Command':'Tool'} · {tool.name}</summary>{tool.command!==undefined?<pre>{tool.command}{tool.truncated?'\n… (first 4000 characters shown)':''}</pre>:<p>Command text was not provided by Pi.</p>}</details>)}</div>}
      {message.role==='assistant'&&!message.text&&<span role="status" className="message-activity">{activityLabel??(message.complete?message.thinking||message.tools?.length?'No text reply · thinking and tools above':'No text reply · inspect Activity':'Pi is working…')}</span>}
      {!message.complete&&!!message.text&&<span role="status">Streaming…</span>}
    </div>
    {message.role==='assistant'&&<div className="message-footer"><button aria-label="Copy all" disabled={!message.text} onClick={()=>void copy(message.text,'Output')}>Copy all</button>{copied&&<span role="status" className="copy-feedback">{copied}</span>}</div>}
  </article>;
}
export default memo(ChatItem);
