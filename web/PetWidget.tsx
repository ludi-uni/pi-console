import React, { useEffect, useRef, useState } from 'react';
import type { ConsolePreferences } from './preferences.ts';
import type { Snapshot } from '../shared/types.ts';

type PetState='idle'|'running'|'waiting'|'review'|'failed'|'completed';
const rows:Record<PetState,number>={idle:0,running:7,waiting:6,review:8,failed:5,completed:4};
const counts=[6,8,8,4,5,8,6,6,6,8,8];
type Movement='idle'|'walk-right'|'walk-left';
type Motion=PetState|Exclude<Movement,'idle'>;
const motionRows:Record<Motion,number>={...rows,'walk-right':1,'walk-left':2};
const idleFrameMs=[2100,150,500,2100,150,500];
const motionMs:Record<Exclude<Motion,'idle'|'walk-right'|'walk-left'>,number>={running:145,waiting:280,review:250,failed:200,completed:165};
export function petFrameMs(motion:Motion,frame:number,dragging=false){
  if(motion==='idle')return idleFrameMs[frame%idleFrameMs.length];
  if(motion==='walk-right'||motion==='walk-left')return dragging?155:320;
  return motionMs[motion];
}
type ListedPet={id:string;displayName:string;source:string};
export function selectPet(pets:ListedPet[],id:string,source:string){
  return (id&&source?pets.find(p=>p.id===id&&p.source===source):undefined)
    ||(id?pets.find(p=>p.id===id):undefined)
    ||pets.find(p=>p.id==='fio')||pets[0];
}
const positionKey='pi-console:pet-position:v1';
export function clampPet(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number){return {
  x:Math.max(4,Math.min(viewportWidth-width-4,x)),
  y:Math.max(4,Math.min(viewportHeight-height-4,y))
}}

export default function PetWidget({preferences,snapshot,view}:{preferences:ConsolePreferences;snapshot?:Snapshot;view:string}){
  const canvas=useRef<HTMLCanvasElement>(null);const host=useRef<HTMLDivElement>(null);const hit=useRef<HTMLDivElement>(null);
  const locationRef=useRef({x:0,y:0});const dragRef=useRef<{id:number;dx:number;dy:number}|null>(null);
  const movementRef=useRef<Movement>('idle');
  const [pet,setPet]=useState<{id:string;name:string;sheet:string;version:number}|null>(null);
  const [petRefresh,setPetRefresh]=useState(0);
  useEffect(()=>{const refresh=()=>setPetRefresh(n=>n+1);window.addEventListener('pi-console:pets-refreshed',refresh);return()=>window.removeEventListener('pi-console:pets-refreshed',refresh)},[]);
  const [reaction,setReaction]=useState<'failed'|'completed'|null>(null);
  const lastRun=useRef<string|undefined>(undefined);
  useEffect(()=>{let cancelled=false;setPet(null);
    fetch('/api/pets').then(r=>{if(!r.ok)throw Error('pets unavailable');return r.json()}).then(async data=>{
      const pets:ListedPet[]=Array.isArray(data.pets)?data.pets:[];
      const picked=selectPet(pets,preferences.petId,preferences.petSource);if(!picked)return;
      const query=`pet=${encodeURIComponent(picked.id)}&source=${encodeURIComponent(picked.source)}`;
      const response=await fetch(`/api/pet/file?${query}&file=pet.json`);if(!response.ok)throw Error('pet unavailable');
      const manifest=await response.json();const sheet=typeof manifest.spritesheetPath==='string'?manifest.spritesheetPath:'spritesheet.webp';
      if(!cancelled)setPet({id:picked.id,name:picked.displayName,sheet:`/api/pet/file?${query}&file=${encodeURIComponent(sheet)}`,version:manifest.spriteVersionNumber===2?2:1});
    }).catch(()=>{});return()=>{cancelled=true};
  },[preferences.petId,preferences.petSource,petRefresh]);
  const lastEvent=snapshot?.events.slice(-32).reverse().find(e=>e.type==='RunCompleted'||e.type==='RunFailed');
  useEffect(()=>{lastRun.current=undefined;setReaction(null)},[snapshot?.session.id]);
  useEffect(()=>{if(!lastEvent){if(snapshot)lastRun.current??='empty';return}if(lastRun.current===lastEvent.eventId)return;
    if(!lastRun.current){lastRun.current=lastEvent.eventId;return}
    lastRun.current=lastEvent.eventId;
    setReaction(lastEvent.type==='RunFailed'?'failed':'completed');
    const timer=setTimeout(()=>setReaction(null),3500);return()=>clearTimeout(timer);
  },[lastEvent?.eventId]);
  const state:PetState=snapshot?.execution.decisionCount?'review':snapshot?.execution.nodes.some(n=>n.status==='waiting'||n.status==='blocked')?'waiting':snapshot?.activeRunId||snapshot?.execution.nodes.some(n=>n.status==='running')?'running':reaction??'idle';
  const stateRef=useRef<PetState>(state);stateRef.current=state;
  useEffect(()=>{
    const el=canvas.current;if(!el||!pet)return;
    const ctx=el.getContext('2d');if(!ctx)return;
    const image=new Image();let raf=0;let active=true;let frame=0;let last=0;let loaded=false;let previous:Motion|null=null;let hitFrame='';
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    const draw=(now:number)=>{if(!active||!loaded)return;
      const motion:Motion=movementRef.current==='idle'?stateRef.current:movementRef.current;
      if(previous!==motion){frame=0;last=now;previous=motion}
      const row=motionRows[motion],count=counts[row]??8;
      if(reduced.matches){frame=0}else if(now-last>=petFrameMs(motion,frame,!!dragRef.current)){
        // Finish transient actions on their landing/rest pose, rather than looping
        // or cutting a jump midway when the reaction timer expires.
        frame=motion==='completed'||motion==='failed'?Math.min(frame+1,count-1):(frame+1)%count;last=now;
      }
      const rowCount=pet.version===2?11:9;const cellW=image.naturalWidth/8,cellH=image.naturalHeight/rowCount;
      ctx.clearRect(0,0,el.width,el.height);ctx.imageSmoothingEnabled=false;
      ctx.drawImage(image,frame*cellW,row*cellH,cellW,cellH,0,0,el.width,el.height);
      const key=`${row}:${frame}`;
      if(hit.current&&key!==hitFrame){
        const {data}=ctx.getImageData(0,0,el.width,el.height),left:string[]=[],right:string[]=[];
        for(let y=0;y<el.height;y+=4){let min=el.width,max=-1;const end=Math.min(y+4,el.height);
          for(let rowY=y;rowY<end;rowY++)for(let x=0;x<el.width;x++)if(data[(rowY*el.width+x)*4+3]>12){min=Math.min(min,x);max=Math.max(max,x)}
          if(max<0)continue;
          const x1=`${Math.max(0,min-1)/el.width*100}%`,x2=`${Math.min(el.width,max+2)/el.width*100}%`;
          for(const edge of [y,end]){left.push(`${x1} ${edge/el.height*100}%`);right.push(`${x2} ${edge/el.height*100}%`)}
        }
        hit.current.style.clipPath=left.length?`polygon(${[...left,...right.reverse()].join(',')})`:'inset(100%)';hitFrame=key;
      }
      const hostEl=host.current;if(hostEl){hostEl.dataset.motion=motion;hostEl.dataset.frame=String(frame)}
      raf=requestAnimationFrame(draw);
    };
    image.onload=()=>{if(!active)return;const n=pet.version===2?11:9;if(image.naturalWidth<8||image.naturalHeight<n||image.naturalWidth>4096||image.naturalHeight>4096||image.naturalWidth%8||image.naturalHeight%n){setPet(null);return}el.width=image.naturalWidth/8;el.height=image.naturalHeight/n;el.style.setProperty('--pet-aspect-ratio',String(el.width/el.height));loaded=true;raf=requestAnimationFrame(draw)};
    image.onerror=()=>{if(active)setPet(null)};
    image.src=pet.sheet;
    return()=>{active=false;cancelAnimationFrame(raf);image.onload=null;image.onerror=null;image.src=''};
  },[pet]);
  useEffect(()=>{
    const el=host.current,handle=hit.current;if(!el||!handle||!pet)return;
    const size=()=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height});
    const viewport=()=>({width:window.visualViewport?.width??window.innerWidth,height:window.visualViewport?.height??window.innerHeight});
    const usableHeight=()=>{const nav=document.querySelector('.mobile-nav');return viewport().height-(nav&&getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().height:0)};
    const safeAutomaticY=(y:number)=>{const composer=document.querySelector('.view-chat .composer-dock');const top=composer?.getBoundingClientRect().top;const h=size().height;return top&&top>0?Math.min(y,Math.max(Math.min(56,top-h-4),top-h-8)):y};
    const place=(x:number,y:number)=>{const a=size(),v=viewport();const next=clampPet(x,y,a.width,a.height,v.width,usableHeight());locationRef.current=next;el.style.transform=`translate3d(${next.x}px,${next.y}px,0)`};
    const v=viewport(),a=size();let saved:{x:number;y:number;side:string}|null=null;
    try{const value=JSON.parse(localStorage.getItem(positionKey)??'null');if(value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.x<=1&&value.y>=0&&value.y<=1&&value.side===preferences.petPosition)saved=value}catch{}
    place(saved?saved.x*Math.max(0,v.width-a.width-8)+4:preferences.petPosition==='left'?12:v.width-a.width-12,saved?saved.y*Math.max(0,v.height-a.height-8)+4:safeAutomaticY(window.matchMedia('(max-width:900px)').matches?v.height*.36:v.height-a.height-80));
    let raf=0,last=0;let vx=13,vy=9;let pauseUntil=0;let movingUntil=0;let nextMoveAt=performance.now()+1300;let anchor=saved?{...locationRef.current}:null;
    const tick=(now:number)=>{const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;
      if(!dragRef.current&&stateRef.current==='idle'&&!document.hidden&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&now>pauseUntil&&(now<movingUntil||now>=nextMoveAt)){
        if(now>=movingUntil){movingUntil=now+3400;nextMoveAt=movingUntil+4800}
        const v=viewport(),a=size(),mobile=window.matchMedia('(max-width:900px)').matches;
        const safeTop=56;let safeBottom=usableHeight()-a.height-(mobile?215:75);
        const composer=document.querySelector('.view-chat .composer-dock');const composerTop=composer?.getBoundingClientRect().top;
        if(composerTop&&composerTop>0)safeBottom=Math.min(safeBottom,composerTop-a.height-8);
        // In cramped viewports the composer nearly reaches the header; keeping the
        // pet above it matters more than the 56px top clearance.
        const floor=composerTop&&composerTop>0?Math.min(safeTop,composerTop-a.height-4):safeTop;
        safeBottom=Math.max(floor,safeBottom);
        const minX=anchor?Math.max(4,anchor.x-44):4,maxX=anchor?Math.min(v.width-a.width-4,anchor.x+44):Math.max(4,v.width-a.width-4);
        const minY=anchor?Math.max(4,anchor.y-32):safeTop,maxY=anchor?Math.min(usableHeight()-a.height-4,anchor.y+32):safeBottom;
        let x=locationRef.current.x+vx*dt,y=locationRef.current.y+vy*dt;
        if(x<=minX||x>=maxX){vx=-vx;x=Math.max(minX,Math.min(maxX,x))}
        if(y<=minY||y>=maxY){vy=-vy;y=Math.max(minY,Math.min(maxY,y))}
        const before=locationRef.current;
        if(Math.abs(x-before.x)>0.001)movementRef.current=x>before.x?'walk-right':'walk-left';
        else if(Math.abs(y-before.y)>0.001&&movementRef.current==='idle')movementRef.current=vx>=0?'walk-right':'walk-left';
        place(x,y);
      }else if(!dragRef.current)movementRef.current='idle';
      raf=requestAnimationFrame(tick)
    };
    const resize=()=>{if(!dragRef.current)place(locationRef.current.x,anchor?locationRef.current.y:safeAutomaticY(locationRef.current.y))};
    const composer=document.querySelector('.view-chat .composer-dock');const observer=new ResizeObserver(resize);observer.observe(el);if(composer)observer.observe(composer);
    window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
    raf=requestAnimationFrame(tick);
    const down=(event:PointerEvent)=>{if(event.pointerType==='mouse'&&event.button!==0)return;event.preventDefault();const rect=el.getBoundingClientRect();dragRef.current={id:event.pointerId,dx:event.clientX-rect.left,dy:event.clientY-rect.top};movementRef.current='idle';handle.setPointerCapture(event.pointerId);el.classList.add('dragging')};
    const move=(event:PointerEvent)=>{if(dragRef.current?.id!==event.pointerId)return;event.preventDefault();const before=locationRef.current;place(event.clientX-dragRef.current.dx,event.clientY-dragRef.current.dy);const dx=locationRef.current.x-before.x,dy=locationRef.current.y-before.y;if(Math.abs(dx)>.5)movementRef.current=dx>0?'walk-right':'walk-left';else if(Math.abs(dy)>.5&&movementRef.current==='idle')movementRef.current=preferences.petPosition==='left'?'walk-right':'walk-left'};
    const end=(event:PointerEvent)=>{if(dragRef.current?.id!==event.pointerId)return;dragRef.current=null;movementRef.current='idle';el.classList.remove('dragging');anchor={...locationRef.current};pauseUntil=performance.now()+15000;
      const v=viewport(),a=size();try{localStorage.setItem(positionKey,JSON.stringify({x:Math.max(0,Math.min(1,(anchor.x-4)/Math.max(1,v.width-a.width-8))),y:Math.max(0,Math.min(1,(anchor.y-4)/Math.max(1,v.height-a.height-8))),side:preferences.petPosition}))}catch{}
      if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId)
    };
    handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
    return()=>{cancelAnimationFrame(raf);observer?.disconnect();window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);dragRef.current=null;movementRef.current='idle'};
  },[pet,preferences.petPosition,preferences.petScale,view]);
  if(!pet)return null;
  return <div ref={host} className="pet-widget" role="img" aria-label={`${pet.name} companion · ${state}`} title="Drag to move" ><canvas ref={canvas} width={192} height={208} style={{'--pet-width':`${96*preferences.petScale}px`} as React.CSSProperties}/><div ref={hit} className="pet-hit" aria-hidden="true" style={{clipPath:'inset(100%)'}}/></div>;
}
