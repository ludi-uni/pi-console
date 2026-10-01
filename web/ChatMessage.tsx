import React, { memo, useState } from 'react';
import type { ChatMessage as Message } from '../shared/types.ts';
import MarkdownContent from './MarkdownContent.tsx';
export async function copyText(value:string) {await navigator.clipboard.writeText(value);}
function ChatItem({message,activityLabel,onOpenFile}:{message:Message;activityLabel?:string;onOpenFile?:(path:string,line?:number)=>void}) {
  const [copied,setCopied]=useState('');
  const copy=async(value:string,label:string)=>{try{await copyText(value);setCopied(`${label} copied`);setTimeout(()=>setCopied(''),2000);}catch{setCopied('Copy failed — check clipboard permission');}};
  return <article className="message" data-role={message.role} data-message-id={message.id} tabIndex={-1}>
    <div className="message-bubble"><div className="message-head"><strong>{message.role==='assistant'?'Pi':'You'}</strong></div>
      {message.role==='assistant'?<MarkdownContent text={message.text} onOpenFile={onOpenFile} onCopyCode={text=>void copy(text,'Code')}/>:<>{!!message.text&&<p className="message-text">{message.text}</p>}{!!message.attachments?.length&&<ul className="message-attachments" aria-label="Attachments">{message.attachments.map((item,index)=><li key={`${item.name}-${index}`} className="message-attachment"><span className="message-attachment-kind" aria-hidden="true">{item.kind==='image'?'🖼':'📄'}</span><span className="message-attachment-name" title={item.name}>{item.name}</span><span className="message-attachment-meta">{item.kind}{item.mimeType?` · ${item.mimeType}`:''}{typeof item.bytes==='number'?` · ${item.bytes} bytes`:''}</span>{item.kind==='text'&&item.preview!==undefined&&<details className="message-attachment-body"><summary>Show attached text</summary><pre>{item.preview}{item.truncated?'\n… (truncated preview)':''}</pre></details>}</li>)}</ul>}</>}
      {message.role==='assistant'&&!!message.thinking&&<details className="message-thinking"><summary>Thinking · {message.complete?'show':'in progress'}</summary><pre>{message.thinking}</pre></details>}
      {message.role==='assistant'&&!!message.tools?.length&&<div className="message-tools" aria-label="Tool calls"><strong>Tools · {message.tools.length}</strong>{message.tools.map((tool,index)=><details key={`${tool.id}:${index}`}><summary>{tool.command!==undefined?'Command':'Tool'} · {tool.name}</summary>{tool.command!==undefined?<pre>{tool.command}{tool.truncated?'\n… (first 4000 characters shown)':''}</pre>:<p>Command text was not provided by Pi.</p>}</details>)}</div>}
      {message.role==='assistant'&&!message.text&&<span role="status" className="message-activity">{activityLabel??(message.complete?message.thinking||message.tools?.length?'No text reply · thinking and tools above':'No text reply · inspect Activity':'Pi is working…')}</span>}
      {!message.complete&&!!message.text&&<span role="status">Streaming…</span>}
    </div>
    {message.role==='assistant'&&<div className="message-footer"><button aria-label="Copy all" disabled={!message.text} onClick={()=>void copy(message.text,'Output')}>Copy all</button>{copied&&<span role="status" className="copy-feedback">{copied}</span>}</div>}
  </article>;
}
export default memo(ChatItem);
