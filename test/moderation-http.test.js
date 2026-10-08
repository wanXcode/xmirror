const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
test('admin review HTTP authorization, persistent decision and grouped log', {timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-http-'));
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const id='a'.repeat(64);fs.mkdirSync(path.join(dir,'moderation-reviews'));
 fs.writeFileSync(path.join(dir,'moderation-reviews',id+'.json'),JSON.stringify({id,payload:{url:'https://x.com/i/status/42',content:'<p>AI 调教</p>'},ruleVersion:6,action:'review',matched:[],source:'rules'}));
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,SQLITE_PATH:path.join(dir,'db.sqlite'),ARCHIVES_DIR:path.join(dir,'archives'),MODERATION_ADMIN_TOKEN:'review-test',SILICONFLOW_API_KEY:''},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{} await new Promise(r=>setTimeout(r,50));}
 const url=base+'/api/admin/moderation/reviews/'+id;
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(base+'/api/admin/moderation/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://x.com/i/status/42'})})).status,401);
 const headers={'x-admin-token':'review-test','Content-Type':'application/json'};
 const record=await fetch(url,{headers});assert.equal(record.headers.get('cache-control'),'no-store');assert.equal((await record.json()).record.action,'review');
 const write=body=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await write({action:'allow',note:''})).status,400);
 assert.equal((await write({action:'allow',note:'正文为AI教程'})).status,200);
 assert.equal((await(await fetch(url,{headers})).json()).record.source,'manual');
 const logs=await(await fetch(base+'/api/admin/moderation/logs',{headers})).json();assert.equal(logs.logs[0].action,'allow');assert.equal(logs.logs[0].reviewId,id);
 assert.equal((await write({action:'reset',note:'重新评估'})).status,200);
 assert.equal((await(await fetch(url,{headers})).json()).record.action,'review');
});

test('cached archives obey current rules and manual rejection without refetching', {timeout:20000}, async t => {
 const sqlite3 = require('sqlite3');
 const {createModerator} = require('../lib/moderation');
 const {createReviewService} = require('../lib/moderation-review');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cached-review-http-'));
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dir,SQLITE_PATH:path.join(dir,'db.sqlite'),ARCHIVES_DIR:path.join(dir,'archives'),SILICONFLOW_API_KEY:'',SEO_AUTO_INDEX:'false'},stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,50));}
 assert.ok(ready);
 const db=new sqlite3.Database(path.join(dir,'db.sqlite'));
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
 // The health endpoint precedes startup migrations; wait for their final column.
 for(let i=0;i<100;i++){try{await run('SELECT seo_revision FROM posts LIMIT 1');break;}catch{await new Promise(r=>setTimeout(r,50));}}
 const fixtures=[['71','被操射了','Syn071'],['72','调教 AI 模型','Syn072'],['73','普通软件操作教程','Syn073'],['74','普通软件操作教程','Syn074']];
 for(const [id,content,code] of fixtures) await run('INSERT INTO posts(url,author,author_handle,content,images,short_code,html_file) VALUES(?,?,?,?,?,?,?)',[`https://x.com/i/status/${id}`,'Author','example',content,'[]',code,`post_${id}.html`]);
 await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));
 const service=createReviewService({moderator:createModerator({rulesPath:path.join(__dirname,'../config/moderation-rules.json'),logPath:null}),dataDir:dir});
 const payload={url:'https://x.com/i/status/74',authorName:'Author',authorHandle:'example',content:'普通软件操作教程'};
 const resolved=service.resolve(payload);
 fs.writeFileSync(path.join(dir,'moderation-reviews',resolved.id+'.json'),JSON.stringify({id:resolved.id,payload,ruleVersion:resolved.ruleVersion,action:'reject',source:'manual',matched:[],reason:'Synthetic manual rejection'}));
 fs.writeFileSync(path.join(dir,'moderation-blocked-sources.json'), JSON.stringify(['75']));
 for(const [id,expected] of [['75',422],['71',422],['72',409],['73',200],['74',422]]) {
   const r=await fetch(base+'/api/archive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:`https://x.com/example/status/${id}`})});
   assert.equal(r.status,expected,`cached post ${id}`);
   const body=await r.json();
   if(expected===200) assert.equal(body.cached,true);
   else assert.equal(body.code,expected===422?'CONTENT_MODERATION_REJECTED':'CONTENT_MODERATION_PENDING');
 }
});
