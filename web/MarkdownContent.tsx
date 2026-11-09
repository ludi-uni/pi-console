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

type LocalReference={path:string;line?:number;section?:string;unresolved?:true};
// A host-absolute path is passed through verbatim; only a relative reference
// is joined to the directory of the markdown file being previewed. The result
// is still only a display label — the server enforces real containment and
// rejects a path that escapes or resolves outside the workspace.
const hostAbsolute=(path:string)=>/^[A-Za-z]:[\\/]/i.test(path)||/^(?:%[a-z_][a-z\d_]*%|\$env:[a-z_][a-z\d_]*|\$\{env:[a-z_][a-z\d_]*\}|~)[\\/]/i.test(path)||/^[/\\]{1,2}/.test(path);
function joinRelative(base:string|undefined,value:string):string {
  const parent=base&&/[/\\]/.test(base)?base.slice(0,Math.max(base.lastIndexOf('/'),base.lastIndexOf('\\'))):undefined;
  if(!parent||hostAbsolute(value))return value;
  const forward=base!.includes('/');
  const sep=forward?'/':'\\';
  const stack=parent.split(/[/\\]+/).filter(Boolean),parts=value.split(/[/\\]+/);
  for(const part of parts){if(part==='..'){if(!stack.length)return value;stack.pop()}else if(part&&part!=='.')stack.push(part)}
  return stack.join(sep);
}
const githubFragment=/^L([1-9]\d*)(?:-L[1-9]\d*)?$/;
// Stable, source-derived heading anchors for `#section` navigation inside the
// preview. Slug rules intentionally match common markdown renderers: lowercase,
// spaces to '-', most punctuation dropped, uniqueness by '-n' suffix.
function slugify(value:string,used:Set<string>):string {
  let slug=value.trim().toLowerCase().replace(/<[^>]*>/g,'').replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g,'').replace(/[\s_-]+/g,'-').replace(/^-+|-+$/g,'');
  if(!slug)slug='section';
  let id=slug,n=1;while(used.has(id))id=`${slug}-${n++}`;used.add(id);return id;
}
function sectionSlug(value:string):string {
  return value.trim().toLowerCase().replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g,'').replace(/[\s_-]+/g,'-').replace(/^-+|-+$/g,'');
}
// URL-style escapes inside the fragment (non-ascii anchors) are decoded the
// same way the link text is, without ever accepting a literal '%' token.
const decodeEscapes=(value:string)=>value.replace(/(?:%[a-f\d]{2})+/gi,token=>{try{return decodeURIComponent(token)}catch{return token}});
export function localLink(value:string,basePath?:string):LocalReference|undefined {
  let decoded=value;
  if(value.startsWith('workspace-file:')){
    try{decoded=decodeURIComponent(value.slice('workspace-file:'.length))}catch{return undefined}
  }else{
    // Markdown normalizes a literal closing '%' to '%25'. Decode valid URL
    // escapes without rejecting a literal Windows token such as '%TEMP%'.
    decoded=decodeEscapes(value);
  }
  // A `#fragment` suffix is a section target inside the referenced document.
  // It is split BEFORE the path checks so `a.md#section` is never treated as a
  // URL to fetch; a bare `#section` targets the document being previewed.
  let section:string|undefined;
  const hash=decoded.search(/[#?]/);
  if(hash>=0){
    const tail=decoded.slice(hash);
    if(decoded[hash]==='?')return undefined;
    const body=decoded.slice(0,hash);
    if(tail.startsWith('#')&&body===''){
      const raw=decodeEscapes(tail.slice(1));
      const line=raw.match(githubFragment);
      // A bare `#L12`/`#section` targets the rendered document itself. With a
      // previewed file it maps onto that file; in chat (no basePath) it is a
      // local scroll inside this message, never a file open on an empty path.
      if(line)return{path:basePath??'',line:Number(line[1])};
      if(!basePath)return{path:'',section:sectionSlug(raw)||'section'};
      if(!workspaceFileFormat(`.${basePath.split('.').at(-1)?.toLowerCase()}`))return undefined;
      return{path:basePath,section:sectionSlug(raw)||'section'};
    }
    if(!/#[^\s#?]+$/.test(tail))return undefined;
    const raw=decodeEscapes(tail.slice(1));
    const line=raw.match(githubFragment);
    if(line){const r=workspaceReference(`${body}#L${line[1]}`);if(!r)return undefined;const abs=hostAbsolute(r.path);return{...r,path:basePath&&!abs?joinRelative(basePath,r.path):r.path}}
    section=sectionSlug(raw)||'section';
    decoded=body;
  }
  const reference=workspaceReference(decoded);
  if(!reference){
    // `file:2` for a media file (a line suffix that only text formats support)
    // is never a link target — render it as plain label text so it can never
    // become an empty-href navigation.
    const media=decoded.match(/(.+\.([a-z0-9]+)):[1-9]\d*(?::\d+)?$/i);
    if(media&&workspaceMediaType(`.${media[2].toLowerCase()}`))return{path:media[1],unresolved:true};
    if(section===undefined)return undefined;
    return{path:decoded,section,unresolved:true};
  }
  const path=hostAbsolute(reference.path)||!basePath?reference.path:joinRelative(basePath,reference.path);
  return{...reference,path,...(section?{section}:{})};
}
function remarkWorkspacePaths() {
  return (root:Root) => {
    // Track the ancestor chain: text inside link/code/image contexts is never
    // re-linked (that would nest interactive elements), and link interiors are
    // tagged on `data` so the code renderer can keep them as plain label text.
    // `linkReference` nodes keep their link children on `children`, so they are
    // tracked as link ancestors here but skipped by the re-link walk below.
    const tag=(node:TreeNode,insideLink:boolean):void=>{
      // hProperties reaches the hast element as `data-in-link`, which the code
      // component can read to keep link labels non-interactive.
      for(const child of node.children??[]){if(insideLink)((child as {data?:{hProperties?:Record<string,string>}}).data??={}).hProperties={...(child as {data?:{hProperties?:Record<string,string>}}).data?.hProperties,'data-in-link':'1'};tag(child,insideLink||child.type==='link'||child.type==='linkReference'||child.type==='image'||child.type==='imageReference')}
    };
    tag(root as unknown as TreeNode,false);
    const walk=(node:TreeNode,insideLink=false):void=>{
      if(!node.children||['linkReference','imageReference','image','code','inlineCode'].includes(node.type))return;
      if(node.type==='link'||node.type==='linkReference')insideLink=true;
      node.children=node.children.flatMap(child=>{
        if(insideLink||child.type!=='text'||!child.value)return [child];
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
      for(const child of node.children)walk(child,insideLink);
    };
    walk(root as unknown as TreeNode);
  };
}
export default function MarkdownContent({text,onOpenFile,onOpenSection,onCopyCode,basePath}:{text:string;basePath?:string;onOpenFile?:(path:string,line?:number,section?:string)=>void;onOpenSection?:(target:string)=>void;onCopyCode?:(text:string)=>void}) {
  // The root scopes every generated heading id and fragment jump: the same
  // slug can appear in another chat message, so a document-wide getElementById
  // could scroll a different message's heading.
  const rootRef=React.useRef<HTMLDivElement>(null);
  const usedIds=new Set<string>();
  // ReactMarkdown's `h1`/`h2`/... components all share this renderer: it assigns
  // the deterministic slug ids that `#section` links scroll to.
  const heading=(Tag:'h1'|'h2'|'h3'|'h4'|'h5'|'h6')=>({children}:{children?:React.ReactNode})=>{
    const plain=(node:React.ReactNode):string=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(plain).join(''):React.isValidElement<{children?:React.ReactNode}>(node)?plain(node.props.children):'';
    return <Tag id={slugify(plain(children),usedIds)}>{children}</Tag>;
  };
  // A same-document `#section` jump goes to the provided section handler
  // (file preview) or scrolls inside this root — never a navigation and never
  // a document-wide lookup that could hit another message's identical slug.
  const jump=(section:string)=>{if(onOpenSection){onOpenSection(section);return}const target=rootRef.current?.querySelector<HTMLElement>(`#${CSS.escape(section)}`);target?.scrollIntoView({block:'start'})};
  const fileButton=(reference:LocalReference,children:React.ReactNode)=>{
    if(reference.unresolved||!reference.path&&!reference.section)return <>{children}</>;
    // A bare `#section`/`#L12` without a file context is local-only: it scrolls
    // inside this message and must never reach onOpenFile with an empty path.
    const local=!reference.path;
    const sameFile=!local&&reference.path===basePath;
    const title=local?`Jump to section ${reference.section??reference.line}`:`Open ${reference.path}${reference.line?`:${reference.line}`:''}${reference.section?`#${reference.section}`:''} in workspace`;
    return <button type="button" className="file-link" onClick={()=>{if(reference.section&&(local||sameFile)){jump(reference.section);return}if(local)return;onOpenFile?.(reference.path,reference.line,reference.section)}} title={title}>{children}</button>;
  };
  return <div className="markdown-content" ref={rootRef} onClickCapture={event=>{if(event.target instanceof Element)event.target.closest<HTMLButtonElement>('button.file-link')?.focus()}}><ReactMarkdown remarkPlugins={[remarkGfm,remarkWorkspacePaths]} urlTransform={url=>localLink(url,basePath)?url:defaultUrlTransform(url)} components={{
    a:({href,children,...props})=>{
      const reference=href&&localLink(href,basePath);
      if(reference)return fileButton(reference,children);
      // An empty href or an internal workspace-file target that failed
      // resolution is never a navigation — it renders as plain text.
      if(!href||href.startsWith('workspace-file:'))return <>{children}</>;
      // Inside an explicit markdown link the children may contain code that was
      // NOT re-linked (the remark walk skips link nodes), so nested buttons are
      // impossible here by construction; plain links render unchanged. The
      // react-markdown `node` prop is component-internal and never forwarded.
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
    h1:heading('h1'),h2:heading('h2'),h3:heading('h3'),h4:heading('h4'),h5:heading('h5'),h6:heading('h6'),
    pre:({children})=>{const code=React.isValidElement<{children?:React.ReactNode;className?:string}>(children)?children:undefined;const text=String(code?.props.children??'').replace(/\n$/,'');const language=code?.props.className?.replace(/^language-/, '')||'code';return <div className="code-block"><div className="code-head"><span>{language}</span>{onCopyCode&&<button aria-label="Copy code" onClick={()=>onCopyCode(text)}>Copy code</button>}</div><pre>{children}</pre></div>},
    // The remark walk marks link interiors via `data-in-link`: an inline code
    // inside an explicit link is label text — re-linking it would nest a
    // button inside the link's file button.
    code:({children,className,node}:{children?:React.ReactNode;className?:string;node?:unknown})=>{const content=String(children).trim();const insideLink=!!(node&&typeof node==='object'&&'data-in-link'in((node as {properties?:Record<string,string>}).properties??{}));const reference=!className&&!insideLink&&localLink(content,basePath);return reference&&!reference.unresolved&&reference.path?<code><button type="button" className="file-link" onClick={()=>onOpenFile?.(reference.path,reference.line,reference.section)} title={`Open ${reference.path}${reference.line?`:${reference.line}`:''}${reference.section?`#${reference.section}`:''} in workspace`}>{children}</button></code>:<code className={className}>{children}</code>},
    img:({alt,src,node})=>{const insideLink=!!node?.properties?.['data-in-link'];const reference=src&&localLink(src,basePath);return !insideLink&&reference&&!reference.unresolved&&workspaceMediaType(`.${reference.path.split('.').at(-1)}`)?.format==='image'?<button type="button" className="file-link" onClick={()=>onOpenFile?.(reference.path)}>Preview image: {alt||reference.path}</button>:<span className="markdown-image">[Image: {alt||'not displayed'}]</span>}
  }}>{text}</ReactMarkdown></div>;
}
