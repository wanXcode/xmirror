const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createModerator } = require('../lib/moderation');
const { createReviewService, groupLogs } = require('../lib/moderation-review');
const rulesPath = path.join(__dirname,'../config/moderation-rules.json');
function setup(t) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'review-test-'));
  t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const service=createReviewService({moderator:createModerator({rulesPath,logPath:null}),dataDir,logPath:path.join(dataDir,'log')});
  return {service,dataDir,records:()=>fs.readdirSync(path.join(dataDir,'moderation-reviews')).filter(x=>x.endsWith('.json')).map(x=>service.read(x.slice(0,-5)))};
}
const payload={url:'https://x.com/i/status/42',authorName:'Author',content:'<p>调教 AI 模型</p>'};
test('pending persists; manual decisions survive restart and bind to content',async t=>{
  const ctx=setup(t);
  await assert.rejects(ctx.service.assess(payload),{code:'CONTENT_MODERATION_PENDING'});
  const record=ctx.records()[0];assert.match(record.reason,/人工复核/);
  ctx.service.decide(record.id,'allow','核对正文是AI教程');
  const restarted=createReviewService({moderator:createModerator({rulesPath,logPath:null}),dataDir:ctx.dataDir});
  assert.equal((await restarted.assess(payload)).action,'allow');
  await assert.rejects(restarted.assess({...payload,content:'调教 新的内容'}),{code:'CONTENT_MODERATION_PENDING'});
  assert.equal(restarted.read('../../x'),null);
});
test('repeated submissions do not duplicate records or override human decisions',async t=>{
  const ctx=setup(t);
  await Promise.all(Array.from({length:4},()=>assert.rejects(ctx.service.assess(payload),{code:'CONTENT_MODERATION_PENDING'})));
  assert.equal(ctx.records().length,1);
  const id=ctx.records()[0].id;ctx.service.decide(id,'reject','人工检查不通过');
  await assert.rejects(ctx.service.assess(payload,{retry:true}),{code:'CONTENT_MODERATION_REJECTED'});
  assert.equal(ctx.service.read(id).source,'manual');
  ctx.service.decide(id,'reset','撤销决定');
  await assert.rejects(ctx.service.assess(payload),{code:'CONTENT_MODERATION_PENDING'});
});
test('canonical text fingerprint ignores local image paths but not changed text',async t=>{
  const ctx=setup(t);
  await assert.rejects(ctx.service.assess(payload));const id=ctx.records()[0].id;
  ctx.service.decide(id,'allow','已审正文');
  assert.equal((await ctx.service.assess({...payload,content:payload.content+'<img src="/images/local.jpg">'})).action,'allow');
});
test('group logs use numeric post identity, latest decision and ignore later URL prechecks',()=>{
 const rows=[
 {ts:'1',url:'https://x.com/a/status/42?s=1',action:'reject',stage:'content'},
 {ts:'2',url:'https://x.com/i/status/42/photo/1',action:'allow',stage:'manual'},
 {ts:'3',url:'https://x.com/i/status/42',action:'allow',stage:'precheck'}];
 assert.equal(groupLogs(rows).length,1);assert.equal(groupLogs(rows)[0].ts,'2');
 assert.equal(groupLogs(rows,{action:'reject'}).length,0);
});

test('changed link destination invalidates a manual approval', async t => {
  const ctx = setup(t);
  const first = {...payload, content: payload.content + '<a href="https://example.com/a">链接</a>'};
  await assert.rejects(ctx.service.assess(first));
  ctx.service.decide(ctx.records()[0].id, 'allow', '已核对正文和链接');
  await assert.rejects(ctx.service.assess({...first, content: first.content.replace('/a"', '/b"')}), {code:'CONTENT_MODERATION_PENDING'});
});
