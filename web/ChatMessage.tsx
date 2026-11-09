import React, { memo, useState } from 'react';
import type { ChatMessage as Message } from '../shared/types.ts';
import MarkdownContent from './MarkdownContent.tsx';
export async function copyText(value:string) {await navigator.clipboard.writeText(value);}
function ChatItem({message,activityLabel,onOpenFile,showProgress=true,waitingLabel='Waiting for Pi output…'}:{message:Message;activityLabel?:string;onOpenFile?:(path:string,line?:number,section?:string)=>void;showProgress?:boolean;waitingLabel?:string}) {
  const [copied,setCopied]=useState('');
  const waiting = message.role==='assistant'&&!message.complete&&!message.text.trim()&&!message.thinking?.trim()&&!message.tools?.length;
  const copyOutput = (message.text.trim()?message.text:'') || message.tools?.filter(tool=>tool.output!==undefined).map(tool=>`${tool.name}\n${tool.output}`).join('\n\n') || message.thinking?.trim() || '';
  const copy=async(value:string,label:string)=>{try{await copyText(value);setCopied(`${label} copied`);setTimeout(()=>setCopied(''),2000);}catch{setCopied('Copy failed — check clipboard permission');}};
  return <article className="message" data-role={message.role} data-message-id={message.id} tabIndex={-1}>
    <div className="message-bubble" aria-busy={!message.complete}><div className="message-head"><strong>{message.role==='assistant'?'Pi':'You'}</strong></div>
      {message.role==='assistant'?<MarkdownContent text={message.text} onOpenFile={onOpenFile} onCopyCode={text=>void copy(text,'Code')}/>:<>{!!message.text&&<p className="message-text">{message.text}</p>}{!!message.attachments?.length&&<ul className="message-attachments" aria-label="Attachments">{message.attachments.map((item,index)=><li key={`${item.name}-${index}`} className="message-attachment"><span className="message-attachment-kind" aria-hidden="true">{item.kind==='image'?'🖼':'📄'}</span><span className="message-attachment-name" title={item.name}>{item.name}</span><span className="message-attachment-meta">{item.kind}{item.mimeType?` · ${item.mimeType}`:''}{typeof item.bytes==='number'?` · ${item.bytes} bytes`:''}</span>{item.kind==='text'&&item.preview!==undefined&&<details className="message-attachment-body"><summary>Show attached text</summary><pre>{item.preview}{item.truncated?'\n… (truncated preview)':''}</pre></details>}</li>)}</ul>}</>}
      {message.role==='assistant'&&!!message.thinking?.trim()&&<details className="message-thinking"><summary>Thinking · {message.complete?'show':'in progress'}</summary><pre>{message.thinking}</pre></details>}
      {message.role==='assistant'&&!!message.tools?.length&&<div className="message-tools" aria-label="Tool calls"><strong>Tools · {message.tools.length}</strong>{message.tools.map((tool,index)=><details key={`${tool.id}:${index}`} open={!message.text.trim()&&tool.output!==undefined}><summary>{tool.command!==undefined?'Command':'Tool'} · {tool.name}{tool.status?` · ${tool.status}`:''}</summary>{tool.command!==undefined?<><strong>Input</strong><pre>{tool.command}{tool.truncated?'\n… (first 4000 characters shown)':''}</pre></>:tool.input?<><strong>Input</strong><pre>{tool.input}</pre></>:null}{tool.output!==undefined?<><strong>{tool.status==='failed'?'Error output':'Output'}</strong><pre>{tool.output.trim()?tool.output:'No text output was provided by Pi.'}{tool.outputTruncated?'\n… (first 16000 characters shown)':''}</pre></>:<p>{tool.status==='running'?'Waiting for tool output…':'Tool output is not available.'}</p>}</details>)}</div>}
      {waiting&&<span role="status" className="message-activity">{waitingLabel}</span>}
      {!waiting&&message.role==='assistant'&&!message.text&&(message.complete||showProgress)&&<span role="status" className="message-activity">{activityLabel??(message.complete?message.thinking||message.tools?.length?'No text reply · thinking and tools above':'No text reply · inspect Activity':'Pi is working…')}</span>}
      {showProgress&&!message.complete&&!!message.text&&<span role="status">Streaming…</span>}
    </div>
    {message.role==='assistant'&&!waiting&&<div className="message-footer"><button aria-label="Copy all" disabled={!copyOutput} onClick={()=>void copy(copyOutput,'Output')}>Copy all</button>{copied&&<span role="status" className="copy-feedback">{copied}</span>}</div>}
  </article>;
}
// JSON snapshots recreate message/tool/attachment objects even when their
// display content is unchanged. Compare flat display records, not just object
// identity, so a streaming sibling or snapshot refresh does not parse every
// historical Markdown block again. Function props still participate: a new
// workspace's file handler must never be hidden by memoization.
const sameFields=(left:object,right:object)=>{
  if(left===right)return true;
  const before=left as Record<string,unknown>,after=right as Record<string,unknown>,keys=Object.keys(before);
  return keys.length===Object.keys(after).length&&keys.every(key=>Object.hasOwn(after,key)&&Object.is(before[key],after[key]));
};
const sameRecords=(left:object[]|undefined,right:object[]|undefined):boolean=>left===right||!!left&&!!right&&left.length===right.length&&left.every((item,index)=>sameFields(item,right[index]));
export function sameChatItemProps(previous:Parameters<typeof ChatItem>[0],next:Parameters<typeof ChatItem>[0]):boolean{
  const {message:before,...beforeProps}=previous,{message:after,...afterProps}=next;
  if(!sameFields(beforeProps,afterProps))return false;
  if(before===after)return true;
  const {tools:beforeTools,attachments:beforeAttachments,...beforeContent}=before;
  const {tools:afterTools,attachments:afterAttachments,...afterContent}=after;
  return sameFields(beforeContent,afterContent)&&sameRecords(beforeTools,afterTools)&&sameRecords(beforeAttachments,afterAttachments);
}
export default memo(ChatItem,sameChatItemProps);
