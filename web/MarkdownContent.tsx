import React from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

type TreeNode = {type:string;value?:string;children?:TreeNode[];url?:string};
const pathPattern=/(?:[A-Za-z]:[\\/]|(?:\.{1,2}|[\w.-]+)[\\/])[\w.()\\/ -]+?\.(?:markdown|md|txt)(?![\w])|[\w.()\\/-]+\.(?:markdown|md|txt)(?![\w])/gi;
export function workspacePath(value:string):string|undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\\\\)/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return undefined;
  if (/[?#]/.test(value)) return undefined;
  return /\.(?:txt|md|markdown)$/i.test(value) ? value : undefined;
}
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
function localLink(value:string):string|undefined {
  if(value.startsWith('workspace-file:')){
    try{return workspacePath(decodeURIComponent(value.slice('workspace-file:'.length)))}catch{return undefined}
  }
  return workspacePath(value);
}
export default function MarkdownContent({text,onOpenFile,onCopyCode}:{text:string;onOpenFile?:(path:string)=>void;onCopyCode?:(text:string)=>void}) {
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm,remarkWorkspacePaths]} urlTransform={url=>localLink(url)?url:defaultUrlTransform(url)} components={{
    a:({href,children,...props})=>{const path=href&&localLink(href);return path?<button type="button" className="file-link" onClick={()=>onOpenFile?.(path)} title={`Open ${path} in workspace`}>{children}</button>:<a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>},
    pre:({children})=>{const code=React.isValidElement<{children?:React.ReactNode;className?:string}>(children)?children:undefined;const text=String(code?.props.children??'').replace(/\n$/,'');const language=code?.props.className?.replace(/^language-/, '')||'code';return <div className="code-block"><div className="code-head"><span>{language}</span>{onCopyCode&&<button aria-label="Copy code" onClick={()=>onCopyCode(text)}>Copy code</button>}</div><pre>{children}</pre></div>},
    code:({children,className,...props})=>{const content=String(children).trim();const path=!className&&workspacePath(content);return path?<code {...props}><button type="button" className="file-link" onClick={()=>onOpenFile?.(path)} title={`Open ${path} in workspace`}>{children}</button></code>:<code {...props} className={className}>{children}</code>},
    img:({alt})=><span className="markdown-image">[Image: {alt||'not displayed'}]</span>
  }}>{text}</ReactMarkdown></div>;
}
