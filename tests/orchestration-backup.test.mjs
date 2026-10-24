import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {backupOrchestrationStore,verifyRestore} from '../package/orchestration-backup.mjs';

const schema=`
  CREATE TABLE runs(id TEXT PRIMARY KEY,request TEXT,status TEXT,created_at TEXT,updated_at TEXT,repo_root TEXT);
  CREATE TABLE tasks(run_id TEXT,id TEXT,status TEXT,updated_at TEXT,payload TEXT);
  CREATE TABLE decisions(run_id TEXT,id TEXT,task_id TEXT,status TEXT,created_at TEXT,answered_at TEXT,reason TEXT);
  CREATE TABLE trace(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,at TEXT,type TEXT,payload TEXT);
  CREATE TABLE decision_memory(id INTEGER PRIMARY KEY,task_id TEXT,note TEXT);
  CREATE TABLE custom_data(key TEXT,value TEXT);
`;
const seed=db=>{
  db.exec(`INSERT INTO runs VALUES('run-1','do it','completed','2025-01-01T00:00:00Z','2025-01-01T01:00:00Z','C:/repo')`);
  db.exec(`INSERT INTO tasks VALUES('run-1','t1','completed','2025-01-01T01:00:00Z','{"title":"t"}')`);
  db.exec(`INSERT INTO decisions VALUES('run-1','d1','t1','answered','2025-01-01T00:30:00Z','2025-01-01T00:45:00Z','ok')`);
  db.exec(`INSERT INTO trace(run_id,at,type,payload) VALUES('run-1','2025-01-01T00:10:00Z','invocation-start','{"invocationId":"i1","taskId":"t1","runId":"run-1"}')`);
  db.exec(`INSERT INTO decision_memory(task_id,note) VALUES('t1','remembered fact')`);
  db.exec(`INSERT INTO custom_data(key,value) VALUES('k','v')`);
};
const fixture=async()=>{
  const root=await mkdtemp(join(tmpdir(),'orch-backup-test-'));
  await mkdir(join(root,'source'));
  const dbPath=join(root,'source','state.db');
  const db=new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(schema);
  seed(db);
  return {root,dbPath,db};
};
const tables=path=>{const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name)}finally{db.close()}};

test('backup captures a consistent snapshot while the source stays open, including non-core user tables and sqlite_sequence',async()=>{
  const {root,dbPath,db}=await fixture();
  try{
    db.exec('BEGIN');
    db.exec(`INSERT INTO custom_data(key,value) VALUES('uncommitted','must-not-appear')`);
    const out=join(root,'bundle');
    const result=await backupOrchestrationStore({source:dbPath,output:out});
    db.exec('ROLLBACK');
    assert.equal(result.status,'backed-up');
    assert.equal(result.bundle,out);
    const names=tables(join(out,'state.db'));
    for(const table of ['runs','tasks','decisions','trace','decision_memory','custom_data','sqlite_sequence'])
      assert.ok(names.includes(table),`missing table ${table}`);
    assert.equal(result.database.tables.custom_data,1);
    assert.equal(result.database.tables.runs,1);
    assert.match(result.database.sha256,/^[a-f0-9]{64}$/);
    const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
    assert.equal(manifest.version,1);
    assert.equal(manifest.kind,'orchestration-db-backup');
    assert.equal(manifest.database.integrityCheck,'ok');
    assert.equal(manifest.auxiliary.length,0);
    // Source must be untouched and still writable by its live connection.
    db.exec(`INSERT INTO custom_data(key,value) VALUES('after','ok')`);
    const check=new DatabaseSync(dbPath,{readOnly:true});
    assert.equal(check.prepare('SELECT count(*) n FROM custom_data').get().n,2);
    check.close();
  }finally{db.close();await rm(root,{recursive:true,force:true})}
});

test('backup copies only validated .json files from the explicit kit clients dir and history dir',async()=>{
  const {root,dbPath,db}=await fixture();
  try{
    const kit=join(root,'kit'),history=join(root,'history');
    const clients=join(kit,'.orchestration','activity','clients');
    await mkdir(clients,{recursive:true});
    await mkdir(history,{recursive:true});
    await writeFile(join(clients,'pi-web-s1.json'),'{}');
    await writeFile(join(clients,'pi-web-s1.runs.json'),'[]');
    await writeFile(join(clients,'notes.txt'),'nope');
    await writeFile(join(clients,'.env'),'SECRET=1');
    await writeFile(join(clients,'credentials.json'),'{"token":"never-copy"}');
    await writeFile(join(root,'kit-secret.json'),'{"token":1}');
    await mkdir(join(history,'kit-abc'),{recursive:true});
    await writeFile(join(history,'kit-abc','pi-web-s1.journal.json'),'{}');
    const out=join(root,'bundle');
    const result=await backupOrchestrationStore({source:dbPath,output:out,kitRoot:kit,historyDir:history});
    assert.equal(result.auxiliary,3);
    const all=[];const walk=async d=>{for(const e of await readdir(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())await walk(p);else all.push(p)}};await walk(out);
    assert.ok(!all.some(p=>p.includes('secret')||p.includes('.env')||p.endsWith('notes.txt')||p.endsWith('credentials.json')),'unrelated or sensitive files must not be copied');
    const entries=await readdir(join(out,'auxiliary','kit-clients'));
    assert.deepEqual(entries.sort(),['pi-web-s1.json','pi-web-s1.runs.json']);
    assert.deepEqual(await readdir(join(out,'auxiliary','history','kit-abc')),['pi-web-s1.journal.json']);
  }finally{db.close();await rm(root,{recursive:true,force:true})}
});

test('backup refuses missing source, existing output, output inside kit/history, and non-JSON auxiliary escapes',async()=>{
  const {root,dbPath,db}=await fixture();
  try{
    await assert.rejects(backupOrchestrationStore({source:join(root,'nope.db'),output:join(root,'b1')}),/does not exist/);
    const existing=join(root,'existing');await mkdir(existing);
    await assert.rejects(backupOrchestrationStore({source:dbPath,output:existing}),/already exists/);
    const kit=join(root,'kit');await mkdir(kit,{recursive:true});
    await assert.rejects(backupOrchestrationStore({source:dbPath,output:join(kit,'bundle'),kitRoot:kit}),/outside the replaceable kit/);
    await assert.rejects(backupOrchestrationStore({source:dbPath,output:join(root,'source','bundle-nested')}),/outside the source database directory/);
    const history=join(root,'hist');await mkdir(history,{recursive:true});
    await assert.rejects(backupOrchestrationStore({source:dbPath,output:join(history,'bundle'),historyDir:history}),/outside the history mirror/);
    await assert.rejects(backupOrchestrationStore({source:dbPath,output:join(root,'bundle'),kitRoot:join(root,'missing-kit')}),/does not exist/);
    // A symlink inside the clients dir is refused rather than followed.
    const clients=join(kit,'.orchestration','activity','clients');
    await mkdir(clients,{recursive:true});
    let linked=false;
    try{await writeFile(join(root,'outside.json'),'{}');await symlink(join(root,'outside.json'),join(clients,'link.json'),'file');linked=true}
    catch{/* Creating symlinks requires privileges on Windows; skip this case when unavailable. */}
    if(linked)await assert.rejects(backupOrchestrationStore({source:dbPath,output:join(root,'b2'),kitRoot:kit}),/symlink/);
    assert.equal(await readdir(root).then(n=>n.filter(x=>x.startsWith('b'))).then(a=>a.length),0);
  }finally{db.close();await rm(root,{recursive:true,force:true})}
});

test('backup refuses a source without the required core tables and a corrupt source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orch-backup-test-'));
  try{
    await mkdir(join(root,'source'));
    const incomplete=join(root,'source','incomplete.db');
    const a=new DatabaseSync(incomplete);a.exec('CREATE TABLE runs(id TEXT)');a.close();
    await assert.rejects(backupOrchestrationStore({source:incomplete,output:join(root,'b1')}),/missing required orchestration tables/);
    const corrupt=join(root,'source','corrupt.db');
    await writeFile(corrupt,'not a sqlite database');
    await assert.rejects(backupOrchestrationStore({source:corrupt,output:join(root,'b2')}));
    assert.equal(await stat(join(root,'b1')).then(()=>true,()=>false),false);
    assert.equal(await stat(join(root,'b2')).then(()=>true,()=>false),false);
  }finally{await rm(root,{recursive:true,force:true})}
});

test('verifyRestore verifies and restores into a new directory with matching table counts',async()=>{
  const {root,dbPath,db}=await fixture();
  try{
    const bundle=join(root,'bundle'),restored=join(root,'restored');
    await backupOrchestrationStore({source:dbPath,output:bundle,kitRoot:undefined,historyDir:undefined});
    const result=await verifyRestore({bundle,output:restored});
    assert.equal(result.status,'verified');
    assert.equal(result.tables.custom_data,1);
    const copy=new DatabaseSync(join(restored,'state.db'),{readOnly:true});
    assert.equal(copy.prepare('SELECT note FROM decision_memory').get().note,'remembered fact');
    assert.equal(copy.prepare('SELECT count(*) n FROM trace').get().n,1);
    copy.close();
    await assert.rejects(verifyRestore({bundle,output:restored}),/already exists/);
  }finally{db.close();await rm(root,{recursive:true,force:true})}
});

test('verifyRestore refuses tampered bundles and leaves no partial output',async()=>{
  const {root,dbPath,db}=await fixture();
  try{
    const bundle=join(root,'bundle');
    await backupOrchestrationStore({source:dbPath,output:bundle});
    const dbFile=join(bundle,'state.db');
    const orig=await readFile(dbFile);
    await writeFile(dbFile,Buffer.concat([orig,Buffer.from([0])]));
    await assert.rejects(verifyRestore({bundle,output:join(root,'tampered-db')}),/hash mismatch|size or type mismatch/);
    await writeFile(dbFile,orig);
    const manifestPath=join(bundle,'manifest.json');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    manifest.database.tables.runs=99;
    await writeFile(manifestPath,JSON.stringify(manifest,null,2));
    await assert.rejects(verifyRestore({bundle,output:join(root,'tampered-manifest')}),/row count mismatch/);
    manifest.database.tables.runs=1;
    const invalidBytes={...manifest,database:{...manifest.database,bytes:1.5}};
    await writeFile(manifestPath,JSON.stringify(invalidBytes));
    await assert.rejects(verifyRestore({bundle,output:join(root,'invalid-bytes')}),/invalid backup manifest/);
    const entry={file:'auxiliary/history/pi-web-s1.json',sha256:'0'.repeat(64),bytes:0};
    await writeFile(manifestPath,JSON.stringify({...manifest,auxiliary:[entry,entry]}));
    await assert.rejects(verifyRestore({bundle,output:join(root,'duplicate-paths')}),/duplicate auxiliary/);
    await writeFile(manifestPath,JSON.stringify({...manifest,auxiliary:[{...entry,file:'auxiliary/history/..\\\\escape.json'}]}));
    await assert.rejects(verifyRestore({bundle,output:join(root,'traversal')}),/invalid backup manifest/);
    await writeFile(manifestPath,JSON.stringify(manifest));
    // Now break the manifest structurally: a missing database hash must be refused.
    const fresh=JSON.parse(await readFile(manifestPath,'utf8'));
    fresh.database.tables.runs=1;
    delete fresh.database.sha256;
    await writeFile(manifestPath,JSON.stringify(fresh,null,2));
    await assert.rejects(verifyRestore({bundle,output:join(root,'invalid-manifest')}),/invalid backup manifest/);
    for(const name of ['tampered-db','tampered-manifest','invalid-manifest','invalid-bytes','duplicate-paths','traversal'])
      assert.equal(await stat(join(root,name)).then(()=>true,()=>false),false,`${name} must not be created`);
  }finally{db.close();await rm(root,{recursive:true,force:true})}
});

test('verifyRestore refuses output inside the bundle and a missing bundle',async()=>{
  const {root,dbPath,db}=await fixture();
  try{
    const bundle=join(root,'bundle');
    await backupOrchestrationStore({source:dbPath,output:bundle});
    await assert.rejects(verifyRestore({bundle,output:join(bundle,'inside')}),/outside the backup bundle/);
    await assert.rejects(verifyRestore({bundle:join(root,'no-such'),output:join(root,'x')}),/does not exist/);
    await assert.rejects(verifyRestore({bundle:join(bundle,'manifest.json'),output:join(root,'x')}),/not a directory/);
  }finally{db.close();await rm(root,{recursive:true,force:true})}
});
