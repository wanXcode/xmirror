#!/usr/bin/env node
// Explicit history seed. Default is read-only preview, never an unbounded backfill.
require('dotenv').config({quiet:true});
const path=require('node:path');
const sqlite3=require('sqlite3');
const {createSeoStore}=require('../lib/seo-store');
const {createModerator}=require('../lib/moderation');
const {createReviewService}=require('../lib/moderation-review');
const {createSeoAI,settings,configured}=require('../lib/seo-ai');
const {sourceMetadata}=require('../lib/seo-title');
const apply=process.argv.includes('--apply');
const dataDir=process.env.DATA_DIR||path.join(__dirname,'../data');
const db=new sqlite3.Database(process.env.SQLITE_PATH||path.join(dataDir,'db.sqlite'),apply?sqlite3.OPEN_READWRITE:sqlite3.OPEN_READONLY);
db.configure('busyTimeout',10000);
const moderator=createModerator({rulesPath:path.join(__dirname,'../config/moderation-rules.json'),logPath:null});
const reviewService=createReviewService({moderator,dataDir,logPath:null});
const store=createSeoStore(db,{dataDir,moderator,reviewService});
let ai;
async function main(){
  const config=settings();
  if(process.argv.includes('--resume')){
    if(!apply||!configured(config)||config.priceValidUntil<=Date.now())throw new Error('Resume requires --apply and valid model/price configuration');
    ai=createSeoAI({store,dataDir,config});await ai.migrate();await ai.resume();console.log(JSON.stringify(await ai.summary()));return;
  }
  const ids=(process.argv.find(s=>s.startsWith('--ids='))||'').slice(6).split(',').filter(Boolean).map(Number);
  if(!ids.length||ids.length>20||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw new Error('Provide 1–20 unique IDs with --ids=1,2; no automatic history expansion');
  if(apply&&(!configured(config)||config.priceValidUntil<=Date.now()))throw new Error('Configure model, verified prices and enable AI before applying');
  if(apply){await store.migrate();ai=createSeoAI({store,dataDir,config});await ai.migrate();}
  for(const id of ids){
    const post=await store.get('SELECT * FROM posts WHERE id=?',[id]);
    const eligible=post&&post.seo_status==='index'&&!post.seo_blocked&&(await store.assess(post)).status==='index';
    const needsAI=eligible&&sourceMetadata(post).needsAI;
    if(apply&&needsAI){
      await store.run("UPDATE posts SET seo_ai_enabled=1 WHERE id=? AND content IS ? AND seo_status='index' AND seo_blocked=0",[id,post.content]);
      await ai.enqueue({...post,seo_ai_enabled:1});
    }
    console.log(JSON.stringify({id,eligible:Boolean(eligible),needsAI:Boolean(needsAI),mode:apply?'queued':'preview'}));
  }
  if(ai)console.log(JSON.stringify(await ai.summary()));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(ai)await ai.close();db.close();});
