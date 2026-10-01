const $ = id => document.getElementById(id);
const tokenInput = $('token');
try { tokenInput.value = localStorage.getItem('xmirror_admin_token') || ''; } catch {}
let currentLogs = [], seoPage = 1, reportPage = 1, session = 0, reviewRequest = 0;
const requests = { seo:0, reports:0, logs:0 };
const busy = new Set();
let flashTimer;
const seoNames = {index:'允许收录',review:'等待检查',noindex:'暂不推荐'};
const moderationNames = {allow:'允许发布',reject:'拒绝发布',review:'等待复核',unknown:'等待审核'};
const titleNames = {ai:'AI 生成',original:'原文标题',extracted:'自动提取'};
const kindNames = {copyright:'版权问题',privacy:'隐私问题',other:'其他申请'};
const reasonNames = {repeated_content:'重复正文较多',repetitive_special_format:'特殊格式存在重复',moderation_unknown:'等待有效审核',moderation_reject:'内容审核拒绝',admin_block:'管理员限制收录',duplicate:'重复存档',short_text:'正文较短',empty_text:'正文为空',incomplete_metadata:'作者或时间缺失',essential_media_pending:'媒体尚未就绪',manual_index:'人工推荐',manual_noindex:'人工撤回',insufficient_quality_signals:'有效信息不足',automatic_indexing_paused:'自动推荐已暂停',substantial_text:'正文充足',informative_text:'有一定正文',source_heading:'原文标题',preserved_media:'已保存媒体',complete_metadata:'来源信息完整',readable_structure:'有段落结构',invalid_source_or_short_code:'来源或短码无效'};
function node(tag, cls, text) { const el=document.createElement(tag); if(cls)el.className=cls; if(text!==undefined)el.textContent=String(text); return el; }
function button(text, fn, cls='secondary') {const el=node('button',cls,text);el.type='button';el.onclick=fn;return el;}
function badge(text,tone='neutral'){return node('span','badge '+tone,text);}
function dateText(value){if(!value)return '时间未知';const raw=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)?value.replace(' ','T')+'Z':value;const date=new Date(raw);return Number.isNaN(date.getTime())?String(value):date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function link(text,url,cls=''){const el=node('a',cls,text);try{const target=new URL(url,location.origin);if(!['http:','https:'].includes(target.protocol))return node('span',cls,text);el.href=target.href;}catch{return node('span',cls,text);}el.target='_blank';el.rel='noopener noreferrer';return el;}
function archiveLink(text,code,cls='record-title'){return /^[A-Za-z0-9]{6}$/.test(code||'')?link(text,'/'+code,cls):node('span',cls,text);}
function getToken(){return tokenInput.value.trim();}
function setFlash(msg,isError=false){clearTimeout(flashTimer);const el=$('flash');el.textContent=msg||'';el.className='notice'+(isError?' error':'');el.hidden=!msg;if(msg&&!isError)flashTimer=setTimeout(()=>{el.hidden=true;},7000);}
function connection(text,tone='neutral'){$('connectionState').textContent=text;$('connectionState').className='badge '+tone;}
function empty(root,message,retry){const el=node('div','empty-state',message);if(retry)el.append(button('重新加载',retry));root.replaceChildren(el);}
function pagination(prefix,page,more){$(prefix+'Prev').disabled=page<=1;$(prefix+'Next').disabled=!more;$(prefix+'Page').textContent='第 '+page+' 页';}
function startLoading(prefix,root){root.setAttribute('aria-busy','true');empty(root,'正在加载…');if(prefix){$(prefix+'Prev').disabled=true;$(prefix+'Next').disabled=true;}}
function facts(items){const dl=node('dl','facts');for(const [label,value] of items){const item=node('div','fact');item.append(node('dt','',label),node('dd','',value));dl.append(item);}return dl;}
function meta(items){const el=node('div','record-meta');for(const value of items.filter(Boolean))el.append(node('span','',value));return el;}
function safeReasons(value){try{const list=JSON.parse(value||'[]');return Array.isArray(list)?list.map(r=>reasonNames[r]||String(r)).join(' · '):'暂无评估说明';}catch{return '评估说明暂不可用';}}

async function api(url,options={}){
  const identity=session,token=getToken();if(!token)throw new Error('请先输入管理凭证并连接后台。');
  const res=await fetch(url,{...options,headers:{...(options.headers||{}),'Content-Type':'application/json','x-admin-token':token}});
  const data=await res.json().catch(()=>({error:'服务器返回了无法识别的响应，请重试。'}));
  if(identity!==session||token!==getToken())throw Object.assign(new Error('连接已变更'),{stale:true});
  if(!res.ok){if(res.status===403||res.status===401){connection('凭证无效','negative');$('connectionPanel').open=true;}throw new Error(data.error||'请求失败，请重试。');}
  return data;
}
function saveTokenAndReload(){try{localStorage.setItem('xmirror_admin_token',getToken());}catch{}return refreshAll();}
function resetView(){currentLogs=[];reviewRequest++;
  for(const id of ['seoRows','reportRows','logsBody']){empty($(id),'连接后台后查看记录。');$(id).removeAttribute('aria-busy');}
  $('seoSummary').replaceChildren();$('seoPending').textContent='';$('aiBudget').hidden=true;$('aiBudgetDetails').replaceChildren();$('reportSummary').textContent='尚未加载';$('enabledState').textContent='尚未加载';$('enabledState').className='badge neutral';$('updatedAt').textContent='连接后显示最近更新时间。';$('detailBox').value='';$('logDetails').hidden=true;$('reviewText').textContent='';$('reviewReason').textContent='';$('reviewLink').removeAttribute('href');$('reviewNote').value='';$('reviewPanel').close();$('connectionPanel').open=true;
  $('enableModeration').disabled=true;$('disableModeration').disabled=true;pagination('seo',seoPage,false);pagination('report',reportPage,false);}
function clearToken(){session++;tokenInput.value='';try{localStorage.removeItem('xmirror_admin_token');}catch{}seoPage=reportPage=1;resetView();$('refreshAllButton').disabled=false;connection('未连接');setFlash('已清空凭证并断开连接。');}
function toggleTokenVisibility(){tokenInput.type=tokenInput.type==='password'?'text':'password';$('showTokenButton').textContent=tokenInput.type==='password'?'显示凭证':'隐藏凭证';}
async function copyToken(){try{await navigator.clipboard.writeText(getToken());setFlash('凭证已复制');}catch{setFlash('复制失败，请手动选择并复制。',true);}}
async function mutate(root,fn){const key=root.dataset.key||root.id;if(busy.has(key))return;busy.add(key);const controls=[...root.querySelectorAll('button,select')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);root.setAttribute('aria-busy','true');try{await fn();}catch(e){if(!e.stale){if(root===$('reviewPanel')&&root.open){$('reviewError').textContent=e.message;$('reviewError').hidden=false;}else setFlash(e.message,true);}}finally{busy.delete(key);controls.forEach(([el,disabled])=>el.disabled=disabled);root.removeAttribute('aria-busy');}}

function renderBudget(ai){$('aiBudget').hidden=!ai;if(!ai)return;const pricing=ai.pricing||{};const verified=pricing.status==='verified';$('aiState').textContent=ai.enabled&&!ai.paused&&verified?'AI 标题 · 免费模型已核验':'AI 标题 · 原文兜底';$('aiBudgetSummary').textContent=`模型：${pricing.model||'等待核价'} · ${verified?'已确认免费':'等待价格核验'}`;const root=$('aiBudgetDetails');root.replaceChildren();const check=node('p','muted',`价格状态：${pricing.status||'未知'} · 最近核验：${pricing.checkedAt?dateText(pricing.checkedAt):'尚未核验'}`);const source=pricing.source?link('查看服务商价格页',pricing.source):null;if(source)check.append(' · ',source);root.append(check);for(const [label,data] of [['今日',ai.day],['本月',ai.month]]){const item=node('div');item.append(node('p','muted',label+' · '+data.calls+' 次请求'),node('strong','',`免费调用 ${data.freeCalls||0} 次 · 预留 ¥${Number(data.reservedCny||0).toFixed(4)}`));root.append(item);}}
function renderSeo(post){
  const row=node('article','record');row.dataset.key='post-'+post.id;row.dataset.postId=post.id;
  const head=node('div','record-heading'),copy=node('div'),heading=node('h3');heading.append(archiveLink(post.title||'未命名存档',post.short_code));copy.append(heading,meta([post.author||'作者未知','存档 #'+post.id,post.short_code]));
  head.append(copy,badge(post.seo_blocked?'已限制收录':seoNames[post.seo_status]||'尚未评估',post.seo_blocked?'negative':post.seo_status==='index'?'positive':post.seo_status==='review'?'warning':'neutral'));
  row.append(head,facts([['内容审核',moderationNames[post.seo_moderation]||'尚未评估'],['标题来源',titleNames[post.titleSource]||'自动提取']]));
  row.append(node('p','reason-line',safeReasons(post.seo_reason)||'尚无评估说明'));
  if(post.seo_error)row.append(node('p','reason-line error','评估暂未完成，可重新应用当前策略重试。'));
  if(post.titleJob?.error)row.append(node('p','reason-line','标题已自动使用原文兜底，不影响阅读。'));
  const footer=node('div','record-footer'),policy=node('div','policy-controls');const label=node('label','','收录策略'),select=node('select');select.id='policy-'+post.id;label.htmlFor=select.id;
  for(const [value,text] of [['auto','自动评估'],['index','人工推荐'],['noindex','暂不推荐']]){const option=node('option','',text);option.value=value;select.append(option);}select.value=post.seo_override||'auto';select.disabled=!!post.seo_blocked;
  const apply=button('应用',()=>mutate(row,async()=>{await api('/api/admin/seo/'+post.id,{method:'POST',body:JSON.stringify({override:select.value==='auto'?null:select.value})});await loadSeo();setFlash('收录策略已更新');}),post.seo_blocked?'secondary':'');apply.disabled=!!post.seo_blocked;policy.append(label,select,apply);
  const more=node('details','more-actions');more.append(node('summary','','限制与删除'));const zone=node('div','danger-zone');zone.append(node('p','muted',post.seo_blocked?'解除限制后将恢复自动评估。':'限制收录会保留页面；删除会移除存档与媒体。'));
  zone.append(button(post.seo_blocked?'解除收录限制':'限制搜索收录',()=>mutate(row,async()=>{await api('/api/admin/seo/'+post.id,{method:'POST',body:JSON.stringify({override:null,blocked:!post.seo_blocked})});await loadSeo();setFlash(post.seo_blocked?'收录限制已解除，已重新评估':'已限制搜索收录');}),'secondary'));
  zone.append(button('删除存档',()=>deleteArchive(post.id,null,row),'danger'));more.append(zone);footer.append(policy,more);row.append(footer);return row;
}
async function loadSeo(){const seq=++requests.seo,root=$('seoRows'),page=seoPage;startLoading('seo',root);try{const data=await api('/api/admin/seo?status='+$('seoFilter').value+'&page='+page);if(seq!==requests.seo)return false;
  if(!data.posts.length&&page>1){seoPage=page-1;return loadSeo();}
  const summary=$('seoSummary');summary.replaceChildren();for(const status of ['index','review','noindex']){const stat=node('div','stat');stat.append(node('span','',seoNames[status]),node('strong','',data.summary.find(s=>s.status===status)?.count||0));summary.append(stat);}
  $('seoPending').textContent=`尚未评估 ${data.pending.unchecked||0} · 评估失败 ${data.pending.failed||0}`;renderBudget(data.ai);pagination('seo',page,data.hasMore);root.replaceChildren(...data.posts.map(renderSeo));if(!data.posts.length)empty(root,'这个筛选条件下没有存档。');return true;
 }catch(e){if(!e.stale&&seq===requests.seo)empty(root,e.message,loadSeo);return false;}finally{if(seq===requests.seo)root.removeAttribute('aria-busy');}}

function renderReport(report){
 const row=node('article','record');row.dataset.key='report-'+report.id;row.dataset.reportId=report.id;const closed=report.status==='closed';
 const head=node('div','record-heading'),copy=node('div'),heading=node('h3');heading.append(report.post_exists?archiveLink(report.title||'查看相关存档',report.short_code):node('span','','相关存档已删除'));copy.append(heading,meta(['申请 #'+report.id,kindNames[report.kind]||'其他申请',dateText(report.created_at)]));head.append(copy,badge(closed?'已结案':'待处理',closed?'neutral':'warning'));row.append(head);
 row.append(meta(['对应存档 '+report.short_code,report.author?'作者 '+report.author:'']));
 const text=String(report.reason||''),excerpt=node('p','report-reason',text.length>240?text.slice(0,240)+'…':text);row.append(excerpt);
 if(text.length>240){const details=node('details','full-reason'),summary=node('summary','','展开完整申请说明');details.append(summary,node('p','report-reason',text));details.addEventListener('toggle',()=>{excerpt.hidden=details.open;summary.textContent=details.open?'收起完整申请说明':'展开完整申请说明';});row.append(details);}
 const contact=node('p','contact-line','联系方式');contact.append(node('span','',report.contact||'未提供'));row.append(contact);
 if(closed){row.append(node('p','reason-line','结案时间：'+dateText(report.resolved_at)));return row;}
 const footer=node('div','record-footer');footer.append(button('标记已处理',()=>closeReport(report,row,'close')));
 if(report.post_exists){const more=node('details','more-actions');more.append(node('summary','','处理相关存档'));const zone=node('div','danger-zone');zone.append(node('p','muted','限制收录保留页面；删除后公开链接将返回 404。'),button('限制收录并结案',()=>closeReport(report,row,'block')),button('删除存档并结案',()=>deleteArchive(report.post_id,report.id,row),'danger'));more.append(zone);footer.append(more);}
 row.append(footer);return row;
}
async function closeReport(report,row,action){return mutate(row,async()=>{await api('/api/admin/reports/'+report.id,{method:'POST',body:JSON.stringify({action})});await Promise.all([loadReports(),loadSeo()]);setFlash(action==='block'?'已限制搜索收录，申请已结案':'申请已结案，存档保持原状');});}
async function deleteArchive(id,reportId,row){if(!confirm(`确定删除存档 #${id}？公开链接将返回 404，媒体文件也会移除。`))return;return mutate(row,async()=>{await api('/api/delete',{method:'POST',body:JSON.stringify({id,reference:reportId?String(reportId):undefined})});if(reportId){try{await api('/api/admin/reports/'+reportId,{method:'POST',body:JSON.stringify({action:'close'})});}catch(e){if(e.stale)throw e;await Promise.all([loadSeo(),loadReports()]);throw new Error('存档已删除，但申请尚未结案。请在申请卡片上重新标记已处理。');}}await Promise.all([loadSeo(),loadReports()]);setFlash(reportId?'存档已删除，申请已结案':'存档已删除');});}
async function loadReports(){const seq=++requests.reports,root=$('reportRows'),page=reportPage;startLoading('report',root);try{const data=await api('/api/admin/reports?status='+$('reportFilter').value+'&page='+page);if(seq!==requests.reports)return false;
 if(!data.reports.length&&page>1){reportPage=page-1;return loadReports();}pagination('report',page,data.hasMore);$('reportSummary').textContent=`待处理 ${data.summary?.open||0} · 已结案 ${data.summary?.closed||0}`;root.replaceChildren(...data.reports.map(renderReport));if(!data.reports.length)empty(root,$('reportFilter').value==='open'?'暂无待处理申请。':'暂无已结案申请。');return true;
 }catch(e){if(!e.stale&&seq===requests.reports)empty(root,e.message,loadReports);return false;}finally{if(seq===requests.reports)root.removeAttribute('aria-busy');}}

async function loadSettings(){const data=await api('/api/admin/moderation/settings');const enabled=!!data.settings.enabled;$('enabledState').textContent=enabled?'审核已开启':'审核已关闭';$('enabledState').className='badge '+(enabled?'positive':'warning');$('updatedAt').textContent='最近更新：'+dateText(data.settings.updated_at);$('enableModeration').disabled=enabled;$('disableModeration').disabled=!enabled;return true;}
async function toggleModeration(enabled){await mutate($('settings'),async()=>{await api('/api/admin/moderation/settings',{method:'POST',body:JSON.stringify({enabled})});setFlash('审核开关已更新');});if(getToken())try{await loadSettings();}catch(e){if(!e.stale)setFlash(e.message,true);}}
function showDetails(index){if(!currentLogs[index])return;$('detailBox').value=JSON.stringify(currentLogs[index],null,2);$('logDetails').hidden=false;$('logDetails').open=true;$('logDetails').scrollIntoView({block:'center'});}
function renderLog(log,index){const row=node('article','record');row.dataset.key='log-'+index;const head=node('div','record-heading'),copy=node('div');copy.append(node('h3','',log.authorHandle||log.handle?'@'+(log.authorHandle||log.handle):'未知作者'),meta([dateText(log.ts),({precheck:'来源检查',content:'内容审核',manual:'人工决定',decision:'已有决定'})[log.stage]||log.stage,'规则 '+(log.ruleVersion||'未知')]));head.append(copy,badge(moderationNames[log.action]||log.action,log.action==='allow'?'positive':log.action==='reject'?'negative':'warning'));row.append(head);
 if(log.url)row.append(link(log.url,log.url,'log-source'));const matched=node('div');for(const item of log.matched||[])matched.append(node('span','pill',String(item.value||item.label||item.type)+(item.score?' · '+item.score+' 分':'')));row.append(matched);
 if(log.evidence||log.reason)row.append(node('p','log-evidence',log.evidence||log.reason));const actions=node('div','actions log-actions');if(log.reviewId)actions.append(button('查看正文并复核',()=>reviewLog(index),''));actions.append(button('重新审核',()=>recheckLog(index,row)),button('日志详情',()=>showDetails(index),'text-button'));row.append(actions);return row;}
async function loadLogs(){const seq=++requests.logs,root=$('logsBody');startLoading(null,root);try{const qs=new URLSearchParams({limit:$('limit').value});if($('actionFilter').value)qs.set('action',$('actionFilter').value);const data=await api('/api/admin/moderation/logs?'+qs);if(seq!==requests.logs)return false;currentLogs=data.logs||[];$('logDetails').hidden=true;$('detailBox').value='';root.replaceChildren(...currentLogs.map(renderLog));if(!currentLogs.length)empty(root,'这个筛选条件下没有审核记录。');return true;
 }catch(e){if(!e.stale&&seq===requests.logs)empty(root,e.message,loadLogs);return false;}finally{if(seq===requests.logs)root.removeAttribute('aria-busy');}}
async function recheckLog(index,row){const log=currentLogs[index];if(!log)return;return mutate(row,async()=>{await api('/api/admin/moderation/recheck',{method:'POST',body:JSON.stringify({url:log.url})});await loadLogs();setFlash('重新审核完成，不会自动创建存档。');});}
async function reviewLog(index){const seq=++reviewRequest,log=currentLogs[index];if(!log)return;try{const {record}=await api('/api/admin/moderation/reviews/'+log.reviewId);if(seq!==reviewRequest)return;$('reviewText').textContent=record.payload.content;$('reviewReason').textContent=record.reason||'请核对正文和来源，此决定只适用于当前正文版本。';const source=link('查看原文和媒体 ↗',record.payload.url);$('reviewLink').replaceWith(Object.assign(source,{id:'reviewLink'}));$('reviewNote').value='';$('reviewNote').setCustomValidity('');$('reviewError').hidden=true;$('reviewPanel').dataset.id=record.id;$('reviewPanel').dataset.key='review-'+record.id;if(!$('reviewPanel').open)$('reviewPanel').showModal();}catch(e){if(!e.stale)setFlash(e.message,true);}}
async function decideReview(action){if(!$('reviewNote').value.trim()){$('reviewNote').setCustomValidity('请填写审核理由');$('reviewNote').reportValidity();return;}$('reviewNote').setCustomValidity('');return mutate($('reviewPanel'),async()=>{const result=await api('/api/admin/moderation/reviews/'+$('reviewPanel').dataset.id,{method:'POST',body:JSON.stringify({action,note:$('reviewNote').value})});$('reviewPanel').close();await Promise.all([loadLogs(),loadSeo()]);setFlash(result.pending?'决定已保存，搜索状态将自动重试同步。':'审核决定已保存，已有存档的搜索状态已同步。');});}
$('reviewNote').addEventListener('input',()=>$('reviewNote').setCustomValidity(''));
async function refreshAll(){const identity=++session;resetView();setFlash('');if(!getToken()){connection('未连接');$('connectionPanel').open=true;setFlash('输入管理凭证后连接后台。');return;}$('refreshAllButton').disabled=true;connection('连接中');try{await loadSettings();const results=await Promise.all([loadLogs(),loadSeo(),loadReports()]);if(identity!==session)return;const complete=results.every(Boolean);connection(complete?'已连接':'已连接 · 部分加载失败',complete?'positive':'warning');$('connectionPanel').open=false;if(!complete)setFlash('部分数据未加载，请在对应区域重试。',true);}catch(e){if(!e.stale){connection('连接失败','negative');setFlash(e.message,true);}}finally{if(identity===session)$('refreshAllButton').disabled=false;}}
if(getToken())refreshAll();
