import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameChatItemProps} from '../web/ChatMessage.tsx';
import type {ChatMessage} from '../shared/types.ts';

const message=():ChatMessage=>({id:'m',role:'assistant',text:'## Finished\n\n**Result**',thinking:'Thought',complete:true,tools:[{id:'tool',name:'read',input:'input',command:'command',truncated:false,output:'result',outputTruncated:false,status:'completed'}],attachments:[{name:'note.txt',kind:'text',mimeType:'text/plain',preview:'preview',truncated:false,bytes:7}]});
const props=(value=message())=>({message:value,showProgress:false,waitingLabel:'Waiting',activityLabel:'Active',onOpenFile:openFile});
const openFile=()=>{};

test('unchanged messages from a new JSON snapshot can skip historical rendering',()=>{
 const before=props(),after=props(JSON.parse(JSON.stringify(before.message)));
 assert.equal(sameChatItemProps(before,after),true);
 assert.equal(sameChatItemProps(before,{...before}),true);
});
test('all displayed scalar message changes invalidate memoization',()=>{
 const changes:Partial<ChatMessage>[]=[{id:'other'},{role:'user'},{text:'Fresh text'},{thinking:'Fresh thought'},{complete:false}];
 for(const change of changes){const before=props();assert.equal(sameChatItemProps(before,props({...message(),...change})),false,JSON.stringify(change));}
});
test('all displayed tool changes, insertion, deletion and reordering invalidate memoization',()=>{
 for(const key of ['id','name','input','command','truncated','output','outputTruncated','status'] as const){
  const before=props(),after=props();const tool=after.message.tools![0];
  Object.assign(tool,{[key]:typeof tool[key]==='boolean'?true:key==='status'?'failed':'Changed'});
  assert.equal(sameChatItemProps(before,after),false,key);
 }
 const before=props(),after=props();after.message.tools=[];assert.equal(sameChatItemProps(before,after),false);
 const a=props();a.message.tools!.push({...a.message.tools![0],id:'second'});
 const b=props(JSON.parse(JSON.stringify(a.message)));b.message.tools!.reverse();assert.equal(sameChatItemProps(a,b),false);
});
test('attachment metadata and text previews are never hidden by memoization',()=>{
 for(const key of ['name','kind','mimeType','preview','truncated','bytes'] as const){
  const before=props(),after=props();Object.assign(after.message.attachments![0],{[key]:key==='truncated'?true:key==='bytes'?10:key==='kind'?'image':'Changed'});
  assert.equal(sameChatItemProps(before,after),false,key);
 }
 const before=props(),after=props();delete after.message.attachments;assert.equal(sameChatItemProps(before,after),false);
});
test('workspace file handlers, language/status labels and rendering flags remain live',()=>{
 const before=props();
 for(const update of [{onOpenFile:()=>{}},{waitingLabel:'終了'},{activityLabel:'Done'},{showProgress:true}])assert.equal(sameChatItemProps(before,{...before,...update}),false);
});
