import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capIdSet, chatPageSize, chatWindow, chatWindowSize, draftEvictable, draftEvictionCandidates, earlierChatCount, checkedHistoryPage, type ComposerDraftLike, type DraftProtectionSets} from '../web/chat-retention.ts';
import type {ChatMessage} from '../shared/types.ts';

const message=(id:string):ChatMessage=>({id,role:'assistant',text:`text ${id}`,complete:true});
const messages=(count:number,prefix='m'):ChatMessage[]=>Array.from({length:count},(_,i)=>message(`${prefix}-${i}`));
const protection=(overrides:Partial<DraftProtectionSets>={}):DraftProtectionSets=>({dirty:new Set(),conflicted:new Set(),failed:new Set(),unreadable:new Set(),inFlight:new Set(),revisions:new Map(),...overrides});

test('chat window mounts a bounded sliding slice of the supplied chat',()=>{
 const chat=messages(600);
 // Live tail: the newest windowSize messages are mounted.
 const tail=chatWindow(chat,undefined);
 assert.equal(tail.messages.length,chatWindowSize);
 assert.equal(tail.messages[0].id,`m-${600-chatWindowSize}`);
 assert.equal(tail.hiddenCount,600-chatWindowSize);
 // Sliding back one page reveals older messages and drops the newest page
 // from the DOM — they stay in the snapshot and return when the window
 // follows the tail again.
 const back=chatWindow(chat,600-chatPageSize);
 assert.equal(back.messages.length,chatWindowSize);
 assert.equal(back.hiddenCount,600-chatPageSize-chatWindowSize);
 assert.equal(back.messages.at(-1)!.id,`m-${600-chatPageSize-1}`);
 // Fully back mounts the oldest page.
 const oldest=chatWindow(chat,chatWindowSize);
 assert.equal(oldest.hiddenCount,0);
 assert.equal(oldest.messages[0].id,'m-0');
 assert.equal(oldest.messages.length,chatWindowSize);
});

test('short chats are never windowed',()=>{
 const chat=messages(5);
 for(const view of [chatWindow(chat,undefined),chatWindow(chat,5),chatWindow(chat,999)]){
  assert.equal(view.hiddenCount,0);
  assert.equal(view.messages.length,5);
 }
});

test('server truncation counts come only from explicit fields',()=>{
 assert.equal(earlierChatCount(undefined),0);
 assert.equal(earlierChatCount({}),0);
 assert.equal(earlierChatCount({chatTruncated:false,chatEarlierCount:40}),0);
 assert.equal(earlierChatCount({chatTruncated:true}),0);
 assert.equal(earlierChatCount({chatTruncated:true,chatEarlierCount:37.9}),37);
});

test('history pages use append-stable absolute cursors and reject inconsistent responses',()=>{
 const page=checkedHistoryPage(240,{messages:messages(120),earlier:120});
 assert.equal(page.end,240);
 assert.equal(page.messages.length,120);
 const older=checkedHistoryPage(page.earlier,{messages:messages(120,'older'),earlier:0});
 assert.equal(older.end,120);
 assert.equal(older.earlier,0);
 assert.throws(()=>checkedHistoryPage(240,{messages:messages(120),earlier:130}),/History changed/);
 assert.throws(()=>checkedHistoryPage(240,{messages:[],earlier:240}),/History changed/);
 assert.throws(()=>checkedHistoryPage(240,{messages:messages(240),earlier:0}),/History changed/);
});

test('clean persisted drafts are evictable; every unsaved state is protected',()=>{
 const draft:ComposerDraftLike={text:'unsent text',files:[{name:'a.txt'}]};
 // Persisted at a known revision: RAM copy may be dropped, IndexedDB reloads it.
 assert.equal(draftEvictable('s',draft,protection({revisions:new Map([['s',3]])})),true);
 // Unknown revision means persistence was never confirmed — never evict.
 assert.equal(draftEvictable('s',draft,protection()),false);
 const base={revisions:new Map([['s',3]])};
 assert.equal(draftEvictable('s',draft,protection({...base,dirty:new Set(['s'])})),false,'dirty');
 assert.equal(draftEvictable('s',draft,protection({...base,conflicted:new Set(['s'])})),false,'conflicted');
 assert.equal(draftEvictable('s',draft,protection({...base,failed:new Set(['s'])})),false,'failed save');
 assert.equal(draftEvictable('s',draft,protection({...base,unreadable:new Set(['s'])})),false,'unreadable store');
 assert.equal(draftEvictable('s',draft,protection({...base,inFlight:new Set(['s'])})),false,'write in flight');
 assert.equal(draftEvictable('s',{text:'x',files:[],submission:{requestId:'r'}},protection(base)),false,'pending submission');
});

test('eviction picks least recently used clean scopes and never the active one',()=>{
 const drafts:Record<string,ComposerDraftLike>={a:{text:'a',files:[]},b:{text:'b',files:[]},c:{text:'c',files:[]},active:{text:'keep',files:[]}};
 const lru=['a','b','c','active'];
 const prot=protection({revisions:new Map([['a',1],['b',2],['c',3],['active',1]]),dirty:new Set(['b'])});
 // 'b' is dirty and 'active' is selected: only 'a' then 'c' may leave memory.
 assert.deepEqual(draftEvictionCandidates(lru,drafts,prot,'active',2),['a','c']);
 assert.deepEqual(draftEvictionCandidates(lru,drafts,prot,'active',1),['a']);
 // When 'a' is the selected scope instead, 'b' stays protected and the
  // remaining clean scopes are victims in LRU order.
 assert.deepEqual(draftEvictionCandidates(lru,drafts,prot,'a',5),['c','active']);
});

test('completion id set is capped while keeping the newest entries',()=>{
 const ids=new Set(Array.from({length:10},(_,i)=>`c-${i}`));
 const capped=capIdSet(ids,4);
 assert.equal(capped.size,4);
 assert.deepEqual([...capped],['c-6','c-7','c-8','c-9']);
 assert.equal(capIdSet(new Set(['x']),4).has('x'),true);
});
