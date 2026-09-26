import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Directory = { name:string; path:string };
type Listing = { path?:string; parent?:string; entries:Directory[]; truncated?:boolean };

export default function DirectoryPicker({initialPath,onSelect,onClose}:{initialPath:string;onSelect:(path:string)=>void;onClose:()=>void}) {
  const [listing,setListing]=useState<Listing>();const [query,setQuery]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [newName,setNewName]=useState('');const [creating,setCreating]=useState(false);const [createError,setCreateError]=useState('');
  const input=useRef<HTMLInputElement>(null);const request=useRef<AbortController|undefined>(undefined);const creatingRef=useRef(false);
  const load=async(path:string)=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setError('');setQuery('');setNewName('');setCreateError('');
    try {
      const response=await fetch(`/api/directories${path?`?path=${encodeURIComponent(path)}`:''}`,{signal:controller.signal,cache:'no-store'});
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Connection lost or Access sign-in required. Reload this page.');
      const data=await response.json();if(!response.ok)throw Error(data.error??'Cannot open this folder');
      if(!controller.signal.aborted){setListing(data);requestAnimationFrame(()=>{if(document.activeElement===document.body)input.current?.focus()});}
    }catch(cause){if(!controller.signal.aborted)setError((cause as Error).message);}finally{if(!controller.signal.aborted)setBusy(false)}
  };
  const create=async()=>{
    if(!listing?.path||!newName||creatingRef.current)return;
    creatingRef.current=true;setCreating(true);setCreateError('');
    try{
      const response=await fetch('/api/directories/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({parent:listing.path,name:newName})});
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Connection lost or Access sign-in required. Reload this page.');
      const data=await response.json();if(!response.ok)throw Error(data.error??'Could not create folder');
      await load(data.path);
    }catch(cause){setCreateError((cause as Error).message)}finally{creatingRef.current=false;setCreating(false)}
  };
  useEffect(()=>{
    const main=document.querySelector('main');main?.setAttribute('inert','');document.body.classList.add('picker-active');
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!creatingRef.current){event.preventDefault();onClose()}};
    document.addEventListener('keydown',escape);
    void load(initialPath);requestAnimationFrame(()=>input.current?.focus());
    return()=>{document.removeEventListener('keydown',escape);request.current?.abort();main?.removeAttribute('inert');document.body.classList.remove('picker-active')};
  },[]);
  const parts=listing?.path?.replaceAll('/','\\').match(/^([A-Za-z]:\\)(.*)$/);
  const crumbs:Directory[]=parts?[{name:parts[1].slice(0,2),path:parts[1]},...parts[2].split('\\').filter(Boolean).map((name,index,segments)=>({name,path:parts[1]+segments.slice(0,index+1).join('\\')}))]:[];
  const filtered=listing?.entries.filter(entry=>entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))??[];
  const handleKeys=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    if(event.key!=='Tab')return;
    const focusable=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
    if(!focusable.length)return;
    if(event.shiftKey&&document.activeElement===focusable[0]){event.preventDefault();focusable.at(-1)?.focus();}
    if(!event.shiftKey&&document.activeElement===focusable.at(-1)){event.preventDefault();focusable[0].focus();}
  };
  return createPortal(<div className="picker-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!creatingRef.current)onClose()}}>
    <div role="dialog" aria-modal="true" aria-label="Browse local folders" className="picker-dialog" onKeyDown={handleKeys}>
      <div className="picker-head"><div><span className="eyebrow">LOCAL FILESYSTEM</span><h2>Choose a folder</h2><p>Browse folders on the computer running Pi. Files are never shown.</p></div><button className="icon-button" aria-label="Close folder browser" disabled={creating} onClick={onClose}>✕</button></div>
      <nav className="picker-breadcrumbs" aria-label="Folder path"><button onClick={()=>void load('')}>Locations</button>{crumbs.map(crumb=><React.Fragment key={crumb.path}><span aria-hidden="true">/</span><button onClick={()=>void load(crumb.path)}>{crumb.name}</button></React.Fragment>)}</nav>
      <div className="picker-controls"><button onClick={()=>void load(listing?.parent??'')} disabled={busy||creating||!listing?.path} aria-label="Parent folder">↑ Up</button><input ref={input} aria-label="Filter folders" placeholder="Filter folders in this location" value={query} onChange={event=>setQuery(event.target.value)}/></div>
      {listing?.path&&<form className="picker-create" onSubmit={event=>{event.preventDefault();void create()}}><input aria-label="New folder name" placeholder="New folder name" value={newName} disabled={busy||creating} onChange={event=>setNewName(event.target.value)}/><button type="submit" disabled={busy||creating||!newName}>Create folder</button></form>}
      {createError&&<p className="picker-create-error" role="alert">{createError}</p>}
      <div className="picker-list" aria-label="Folders" aria-busy={busy}>{busy?<p className="picker-state">Opening folders…</p>:error?<div className="picker-state" role="alert">{error} <button onClick={()=>void load(listing?.path??initialPath)}>Try again</button></div>:filtered.length?filtered.map(entry=><button key={entry.path} className="folder-row" disabled={creating} onClick={()=>void load(entry.path)}><span className="folder-icon" aria-hidden="true">▣</span><span>{entry.name}</span><span className="folder-chevron" aria-hidden="true">›</span></button>):<p className="picker-state">{query?'No matching folders here.':'No subfolders here.'}</p>}</div>
      {listing?.truncated&&<p className="picker-hint">Showing a limited number of folders. Enter an absolute path manually if needed.</p>}
      <footer className="picker-footer"><span title={listing?.path}>{listing?.path??'Choose a location'}</span><button className="button-primary" disabled={!listing?.path||busy||creating} onClick={()=>listing?.path&&onSelect(listing.path)}>Use this folder</button></footer>
    </div>
  </div>,document.body);
}
