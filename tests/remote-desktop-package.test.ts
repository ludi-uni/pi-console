import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PiProcess,piExecutable} from '../server/adapters/pi/process.ts';
test('real SDK registers the packaged remote tools before any model request',async()=>{
 const cli=piExecutable(),oldCommand=process.env.PI_CONSOLE_PI_COMMAND;
 const dir=await mkdtemp(join(tmpdir(),'pi-remote-package-')),previous=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=dir;process.env.PI_CONSOLE_PI_COMMAND=cli;
 await writeFile(join(dir,'settings.json'),JSON.stringify({packages:[],skills:[],extensions:['-builtin:mcp','-builtin:codemode','-builtin:tool_search'],defaultProjectTrust:'never'}));
 let calls=0;const worker=new PiProcess(dir,undefined,join(dir,'sessions'),false,async()=>{calls++;return{ok:false,error:'fixture_no_rpc',outcome:'KNOWN'}});
 try{await worker.start();const state=(await worker.call('get_state')).data;assert.deepEqual([...state.remoteDesktopTools].sort(),['remote_caivi_click','remote_caivi_drag','remote_caivi_input','remote_file_send','remote_gui_inspect','remote_gui_screenshot']);assert.equal(calls,0);}
 finally{await worker.close();if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;if(oldCommand===undefined)delete process.env.PI_CONSOLE_PI_COMMAND;else process.env.PI_CONSOLE_PI_COMMAND=oldCommand;if(resolve(dir).startsWith(resolve(tmpdir())+'\\pi-remote-package-'))await rm(dir,{recursive:true,force:true,maxRetries:3});}
});
