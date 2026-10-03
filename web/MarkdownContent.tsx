import React from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import { workspaceFileFormat, workspaceMediaType, workspaceTextExtensions, workspaceMediaTypes } from '../shared/workspace-files.ts';

type TreeNode = {type:string;value?:string;children?:TreeNode[];url?:string};
const extensions=[...workspaceTextExtensions,...Object.keys(workspaceMediaTypes)].map(value=>value.slice(1)).sort((a,b)=>b.length-a.length).join('|');
const lineSuffix=String.raw`(?::[1-9]\d*(?::\d+)?|#L[1-9]\d*)?`;
const windowsAlias=String.raw`(?:%[a-z_][a-z\d_]*%|\$env:[a-z_][a-z\d_]*|\$\{env:[a-z_][a-z\d_]*\}|~)[\\/]`;
const pathPattern=new RegExp(String.raw`(?:${windowsAlias}|[A-Za-z]:[\\/]|(?:\.{1,2}|[\w.-]+)[\\/])[\w.()\\/ %$:{}~-]+?\.(?:${extensions})${lineSuffix}(?![\w])|[\w.()\\/-]+\.(?:${extensions})${lineSuffix}(?![\w])`,'gi');
export function workspaceReference(value:string):{path:string;line?:number}|undefined {
  const match=value.match(/(?::([1-9]\d*)(?::\d+)?|#L([1-9]\d*))$/i);
  const line=match?Number(match[1]??match[2]):undefined;
  if(line!==undefined&&!Number.isSafeInteger(line))return undefined;
  const path=match?value.slice(0,-match[0].length):value;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\\\\)/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return undefined;
  if (/[?#]/.test(path)) return undefined;
  const extension=path.match(/\.([a-z0-9]+)$/i)?.[1];
  return extension&&(workspaceFileFormat(`.${extension}`)||!line&&workspaceMediaType(`.${extension}`))?{path,...(line?{line}:{})}:undefined;
}
export function workspacePath(value:string):string|undefined {return workspaceReference(value)?.path}
function remarkWorkspacePaths() {
  return (root:Root) => {
    const walk=(node:TreeNode):void=>{
      if(!node.children||['link','linkReference','image','code','inlineCode'].includes(node.type))return;
      node.children=node.children.flatMap(child=>{
        if(child.type!=='text'||!child.value)return [child];
        const parts:TreeNode[]=[];let start=0;
        for(const match of child.value.matchAll(pathPattern)){
          const index=match.index??0;
          if(index>start)parts.push({type:'text',value:child.value.slice(start,index)});
          parts.push({type:'link',url:`workspace-file:${encodeURIComponent(match[0])}`,children:[{type:'text',value:match[0]}]});
          start=index+match[0].length;
        }
        if(start<child.value.length)parts.push({type:'text',value:child.value.slice(start)});
        return parts.length?parts:[child];
      });
      for(const child of node.children)walk(child);
    };
    walk(root as unknown as TreeNode);
  };
}
function localLink(value:string):{path:string;line?:number}|undefined {
  if(value.startsWith('workspace-file:')){
    try{return workspaceReference(decodeURIComponent(value.slice('workspace-file:'.length)))}catch{return undefined}
  }
  // Markdown normalizes a literal closing '%' to '%25'. Decode valid URL
  // escapes without rejecting a literal Windows token such as '%TEMP%'.
  const decoded=value.replace(/(?:%[a-f\d]{2})+/gi,token=>{try{return decodeURIComponent(token)}catch{return token}});
  return workspaceReference(decoded);
}
export default function MarkdownContent({text,onOpenFile,onCopyCode}:{text:string;onOpenFile?:(path:string,line?:number)=>void;onCopyCode?:(text:string)=>void}) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm,remarkWorkspacePaths]} urlTransform={url=>localLink(url)?url:defaultUrlTransform(url)} components={{
    a:({href,children,...props})=>{const reference=href&&localLink(href);return reference?<button type="button" className="file-link" onClick={()=>onOpenFile?.(reference.path,reference.line)} title={`Open ${reference.path}${reference.line?`:${reference.line}`:''} in workspace`}>{children}</button>:<a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>},
    pre:({children})=>{const code=React.isValidElement<{children?:React.ReactNode;className?:string}>(children)?children:undefined;const text=String(code?.props.children??'').replace(/\n$/,'');const language=code?.props.className?.replace(/^language-/, '')||'code';return <div className="code-block"><div className="code-head"><span>{language}</span>{onCopyCode&&<button aria-label="Copy code" onClick={()=>onCopyCode(text)}>Copy code</button>}</div><pre>{children}</pre></div>},
    code:({children,className,...props})=>{const content=String(children).trim();const reference=!className&&workspaceReference(content);return reference?<code {...props}><button type="button" className="file-link" onClick={()=>onOpenFile?.(reference.path,reference.line)} title={`Open ${reference.path}${reference.line?`:${reference.line}`:''} in workspace`}>{children}</button></code>:<code {...props} className={className}>{children}</code>},
    img:({alt,src})=>{const reference=src&&localLink(src);return reference&&workspaceMediaType(`.${reference.path.split('.').at(-1)}`)?.format==='image'?<button type="button" className="file-link" onClick={()=>onOpenFile?.(reference.path)}>Preview image: {alt||reference.path}</button>:<span className="markdown-image">[Image: {alt||'not displayed'}]</span>}
  }}>{text}</ReactMarkdown></div>;
}
