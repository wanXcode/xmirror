const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const seo = require('../lib/seo');
const title = require('../lib/seo-title');
const { createSeoStore } = require('../lib/seo-store');
const { createReviewService } = require('../lib/moderation-review');
const { createModerator } = require('../lib/moderation');
const { createSeoAI, settings, configured } = require('../lib/seo-ai');
const { prepareContent } = require('../lib/seo-content');
const { parseHTML } = require('linkedom');

const body = '<p>Docker container network troubleshooting. Check the DNS resolver configuration first. Inspect the bridge network and routing table next. Test connectivity from inside the container. Compare the host firewall configuration with the container settings. Read the application logs to identify connection errors.</p>';
const sample = { id:1,content:body,url:'https://x.com/i/status/42',short_code:'Ab1234',author:'Author',author_handle:'author',tweet_time:'2026-09-28T00:00:00Z',images:'[]',seo_override:'index',seo_quality_version:'3',seo_ai_enabled:1 };
const output = {title:'Docker container network troubleshooting',description:'Check the DNS resolver configuration first.',keywords:['Docker','network'],evidence:['Check the DNS resolver configuration first.']};
const goodResponse = () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:300,completion_tokens:100}})});
const cfg = {...settings({}),enabled:true,model:'test-model',apiKey:'test-key',inputPrice:1,outputPrice:2,priceValidUntil:Date.parse('2099-01-01')};

async function setup(t, moderator) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'seo-quality-'));
  const db=new sqlite3.Database(':memory:');
  const store=createSeoStore(db,{dataDir:dir,moderator:moderator||{moderateArchivedContent:()=>({action:'allow'})}});
  await store.run('CREATE TABLE posts(id INTEGER PRIMARY KEY,url TEXT,short_code TEXT,content TEXT,images TEXT,video TEXT,video_status TEXT,author TEXT,author_handle TEXT,tweet_time TEXT)');
  await store.migrate();
  async function insert(post=sample) {
    const keys=Object.keys(post);await store.run(`INSERT INTO posts(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(post));
    await store.refresh(post.id);return store.get('SELECT * FROM posts WHERE id=?',[post.id]);
  }
  const workers=[];
  async function worker(options={}) {const ai=createSeoAI({store,dataDir:dir,config:cfg,fetchImpl:goodResponse,...options});await ai.migrate();workers.push(ai);return ai;}
  t.after(async()=>{for(const ai of workers)await ai.close();await new Promise(r=>db.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  return {store,dir,insert,worker,db};
}

test('v3 rejects meaningless repetition but leaves legacy cohorts and legitimate text alone',()=>{
  const opts={moderation:'allow',config:seo.qualityRules};
  const post={...sample,seo_override:null};
  for(const content of ['word '.repeat(160),'内容内容'.repeat(80),'<p>'+('相同的内容反复出现。'.repeat(40))+'</p>']) {
    assert.equal(seo.evaluate({...post,content},opts).status,'review');
    assert.equal(seo.evaluate({...post,content},{moderation:'allow'}).status,'index');
  }
  const content='<p>'+Array.from({length:180},(_,i)=>`distinct${i}`).join(' ')+'</p>';
  assert.equal(seo.evaluate({...post,content},opts).status,'index');
  const fake={...post,content,seo_title:'Pretend heading',seo_title_hash:title.fingerprint({...post,content})};
  assert.equal(seo.evaluate(fake,opts).score,seo.evaluate({...post,content},opts).score);
});

test('SEO shares manual review decisions and invalidates text/links while ignoring image localization',async t=>{
  const {store,dir,db}=await setup(t);
  const moderator=createModerator({rulesPath:path.join(__dirname,'../config/moderation-rules.json'),logPath:null});
  const review=createReviewService({moderator,dataDir:dir,logPath:null});
  const integrated=createSeoStore(db,{dataDir:dir,moderator,reviewService:review});
  const payload={url:sample.url,authorName:sample.author,authorHandle:sample.author_handle,content:'<p>调教 AI 模型。</p><a href="https://example.com/a">教程说明</a>'};
  await assert.rejects(review.assess(payload),{code:'CONTENT_MODERATION_PENDING'});
  const id=review.resolve(payload).id;
  const content=payload.content+'<img src="/images/local.png">';
  const p={...sample,content};
  const keys=Object.keys(p);await store.run(`INSERT INTO posts(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,Object.values(p));
  assert.equal((await integrated.refresh(1)).status,'review');
  const filesBefore=fs.readdirSync(path.join(dir,'moderation-reviews'));
  await integrated.assess(p);assert.deepEqual(fs.readdirSync(path.join(dir,'moderation-reviews')),filesBefore,'read-only SEO resolution');
  assert.equal((await integrated.decideReview(id,'allow','技术教程')).pending,0);
  assert.equal((await store.get('SELECT * FROM posts WHERE id=1')).seo_status,'index');
  assert.equal((await integrated.assess({...p,content:content.replace('/a"','/b"')})).status,'review');
  assert.equal((await integrated.assess({...p,content:content+'新的正文'})).status,'review');
  await integrated.decideReview(id,'reject','撤回允许');
  assert.equal((await store.get('SELECT * FROM posts WHERE id=1')).seo_status,'noindex');
  assert.equal((await integrated.sitemapRows()).length,0);
});

test('titles preserve source and generated H1 without changing original body or quality hash',()=>{
  assert.equal(title.sourceMetadata({content:'<p>Intro text.</p><h2>Details</h2>'}).needsAI,true);
  assert.equal(title.sourceMetadata({content:'<h1>Docker networking guide</h1><p>Text</p>'}).needsAI,false);
  const post={...sample,content:'<h1>Original heading</h1><p>Source text</p>'};
  const generated={...post,seo_title:'A new faithful heading',seo_title_hash:title.fingerprint(post)};
  const rendered=prepareContent(generated,'/tmp');
  const doc=parseHTML(`<html><body>${rendered.headingHtml}${rendered.html}</body></html>`).document;
  assert.equal(doc.querySelectorAll('h1').length,1);
  assert.equal(doc.querySelector('h2').textContent,'Original heading');
  assert.equal(seo.contentHash(post),seo.contentHash(generated));
  assert.notEqual(title.metadata({...generated,content:post.content+'Changed'}).title,generated.seo_title);
  assert.ok(title.validateGenerated(output,title.text(body)));
  for(const value of [{...output,title:'Docker guide 2027'},{...output,title:'<script>x</script>'},{...output,title:'Ultimate Docker guide'},
    {...output,keywords:['unrelated']},{...output,evidence:['Invented evidence sentence.']}]) assert.equal(title.validateGenerated(value,title.text(body)),null);
  assert.equal(title.validateGenerated({...output,title:'Docker supports network access'},'Docker does not support network access.'),null);
});

test('AI generation is cached, shared across page surfaces, and never charges on enqueue or reread',async t=>{
  const ctx=await setup(t);const post=await ctx.insert();let calls=0;
  const ai=await ctx.worker({fetchImpl:async()=>{calls++;return goodResponse();}});
  assert.equal(await ai.enqueue(post),true);await ai.enqueue(post);
  assert.equal((await ai.summary()).day.calls,0);
  await ai.tick();await ai.tick();
  const saved=await ctx.store.get('SELECT * FROM posts WHERE id=1');
  assert.equal(title.metadata(saved).title,output.title);assert.equal(calls,1);
  assert.equal((await ai.jobFor(1)).status,'completed');
  assert.equal((await ai.summary()).day.calls,1);
  assert.equal((await ai.summary()).day.reservedCny,(8192+512*2)/1e6,'reservation kept conservatively');
  await ai.enqueue(saved);await ai.tick();assert.equal(calls,1);
});

test('budget is reserved atomically across workers and survives restart',async t=>{
  const ctx=await setup(t);const p1=await ctx.insert();const p2=await ctx.insert({...sample,id:2,url:'https://x.com/i/status/43',short_code:'Cd5678',content:body+' Extra context.'});
  let calls=0;const options={config:{...cfg,daily:0.01},fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,15));return goodResponse();}};
  const a=await ctx.worker(options),b=await ctx.worker(options);
  await a.enqueue(p1);await b.enqueue(p2);await Promise.all([a.tick(),b.tick()]);await b.tick();
  assert.equal(calls,1);assert.equal((await a.summary()).day.calls,1);
  const restarted=await ctx.worker(options);await restarted.tick();assert.equal(calls,1);
});

test('unknown billing remains reserved; at most two calls, then automatic fallback',async t=>{
  const ctx=await setup(t);const p=await ctx.insert();let calls=0,time=new Date('2026-09-28T00:00:00Z');
  const ai=await ctx.worker({now:()=>time,fetchImpl:async()=>{calls++;throw new Error('network');}});
  await ai.enqueue(p);await ai.tick();assert.equal((await ai.summary()).day.calls,1);
  await ai.tick();assert.equal(calls,1);
  time=new Date(time.getTime()+61000);await ai.tick();await ai.tick();
  assert.equal(calls,2);assert.equal((await ai.jobFor(1)).status,'fallback');
  assert.equal(title.metadata(await ctx.store.get('SELECT * FROM posts WHERE id=1')).source,'extracted');
});

test('missing prices and long input do not make paid requests; translation has priority',async t=>{
  const ctx=await setup(t);const p=await ctx.insert();let calls=0;
  const opts={fetchImpl:async()=>{calls++;return goodResponse();}};
  assert.equal(Boolean(configured({...cfg,inputPrice:NaN})),false);
  const disabled=await ctx.worker({...opts,config:{...cfg,inputPrice:NaN}});await disabled.enqueue(p);await disabled.tick();
  const busy=await ctx.worker({...opts,isBusy:()=>true});await busy.tick();assert.equal(calls,0);
  const long=await ctx.insert({...sample,id:2,url:'https://x.com/i/status/43',content:body.repeat(80),short_code:'Cd5678'});
  await ctx.store.run("UPDATE posts SET seo_status='noindex' WHERE id=1");
  const ai=await ctx.worker(opts);await ai.enqueue(long);await ai.tick();await ai.tick();
  assert.equal(calls,0);assert.equal((await ai.jobFor(2)).error,'input_limit');
});

test('source edits or rejection during AI response cannot publish stale generated titles',async t=>{
  const ctx=await setup(t);const p=await ctx.insert();
  const ai=await ctx.worker({fetchImpl:async()=>{await ctx.store.run("UPDATE posts SET content=content||' changed',seo_status='review' WHERE id=1");return goodResponse();}});
  await ai.enqueue(p);await ai.tick();
  assert.equal((await ctx.store.get('SELECT * FROM posts WHERE id=1')).seo_title,null);
  assert.equal((await ai.jobFor(1)).status,'stale');
});

test('history retains its cohort on daily sweeps while explicit v3 detects repetition',async t=>{
  const ctx=await setup(t);const p=await ctx.insert({...sample,seo_override:null,seo_quality_version:'2',content:'word '.repeat(160)});
  assert.equal(p.seo_status,'index');
  await ctx.store.run("UPDATE posts SET seo_next_check='2000-01-01' WHERE id=1");await ctx.store.sweep();
  assert.equal((await ctx.store.get('SELECT * FROM posts WHERE id=1')).seo_status,'index');
  assert.equal((await ctx.store.assess(p,{qualityVersion:'3'})).status,'review');
  assert.equal((await ctx.store.get('SELECT * FROM posts WHERE id=1')).seo_status,'index','preview does not mutate');
});

test('monthly budget persists across days and expired prices disable requests',async t=>{
  const ctx=await setup(t);let time=new Date('2026-09-28T00:00:00Z'),calls=0;
  const a=await ctx.insert();const b=await ctx.insert({...sample,id:2,url:'https://x.com/i/status/43',short_code:'Cd5678',content:body+' Extra context.'});
  const ai=await ctx.worker({config:{...cfg,monthly:0.01},now:()=>time,fetchImpl:async()=>{calls++;return goodResponse();}});
  await ai.enqueue(a);await ai.enqueue(b);await ai.tick();time=new Date('2026-09-29T00:00:00Z');await ai.tick();
  assert.equal(calls,1);assert.equal((await ai.summary()).month.calls,1);
  const expired=await ctx.worker({config:{...cfg,priceValidUntil:Date.parse('2020-01-01')},fetchImpl:async()=>{calls++;return goodResponse();}});
  await expired.tick();assert.equal(calls,1);assert.equal((await expired.summary()).enabled,false);
});

test('auth failures pause all jobs without clearing prior reservations',async t=>{
  const ctx=await setup(t);const p=await ctx.insert();let calls=0;
  const ai=await ctx.worker({fetchImpl:async()=>{calls++;return {ok:false,status:403,headers:new Headers()};}});
  await ai.enqueue(p);await ai.tick();await ai.tick();
  assert.equal(calls,1);assert.equal((await ai.summary()).paused,true);assert.equal((await ai.summary()).day.calls,1);
});

test('rollout rollback retains later edits and newer moderation decisions',async t=>{
  const ctx=await setup(t);const p=await ctx.insert({...sample,seo_quality_version:'2',seo_override:null,content:'word '.repeat(160)});
  const rollout=require('../lib/seo-rollout');await rollout.migrate(ctx.store);
  const first=await rollout.apply(ctx.store,p.id,'3');assert.equal(first.status,'review');
  const restored=await rollout.rollback(ctx.store,first.rolloutId);assert.equal(restored.status,'index');
  const second=await rollout.apply(ctx.store,p.id,'3');
  await ctx.store.override(1,null,true);
  await assert.rejects(rollout.rollback(ctx.store,second.rolloutId),/changed/);
  assert.equal((await ctx.store.get('SELECT * FROM posts WHERE id=1')).seo_blocked,1);
});

test('direct content repairs immediately remove stale eligibility; generated title writes do not',async t=>{
  const ctx=await setup(t);await ctx.insert();
  await ctx.store.run("UPDATE posts SET seo_title='A generated title' WHERE id=1");
  assert.equal((await ctx.store.sitemapRows()).length,1);
  await ctx.store.run("UPDATE posts SET content=content||' New context' WHERE id=1");
  assert.equal((await ctx.store.sitemapRows()).length,0);
  assert.equal((await ctx.store.get('SELECT * FROM posts WHERE id=1')).seo_next_check,null);
});
