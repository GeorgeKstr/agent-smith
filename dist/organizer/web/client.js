export const clientJs = `var sel=null,data={agents:[],tasks:[],status:{agents:{},tasks:{}}},activeTab='overview',expandedDiff={},showEdit=false,confirmCb=null,_tlCache=null,templateData={show:false,selected:'',format:'markdown',opts:{},preview:''};
const $=id=>document.getElementById(id);

async function api(method,path,body){
  var r=await fetch(path,{method:method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):null});
  return await r.json();
}

async function fetchAll(){
  var s=await(await fetch('/api/organizer/status')).json();if(s.ok)data.status=s;
  var a=await(await fetch('/api/agents')).json();if(a.ok)data.agents=a.agents;
  var t=await(await fetch('/api/tasks')).json();if(t.ok)data.tasks=t.tasks;
  renderAll();
}

function dotClass(s){return s==='offline'||s==='error'?'dot-offline':(s==='busy'||s==='indexing'||s==='running'||s==='reviewing'||s==='iterating'?'dot-busy':'dot-online');}
function st(s){return'<span class="tag tag-'+s.replace(/_/g,'-')+'">'+s+'</span>';}
function h(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function confirm(msg,cb){$('confirm-text').textContent=msg;$('confirm-overlay').style.display='flex';confirmCb=cb;}
function confirmYes(){if(confirmCb)confirmCb();$('confirm-overlay').style.display='none';confirmCb=null;}
function confirmNo(){$('confirm-overlay').style.display='none';confirmCb=null;}

function setTab(tab){activeTab=tab;renderAll();document.querySelectorAll('#bottom-nav button').forEach(function(b){b.classList.toggle('active',b.dataset.tab===tab);});}

function renderAll(){
  $('api-url').textContent=location.origin;
  $('agent-count').textContent=data.agents.length;
  $('task-count').textContent=data.tasks.length;
  if(typeof renderTab==='function')renderTab();
  if(sel&&sel.type==='task')loadDetail(sel.id);
}

function renderTab(){
  var left=$('left'),center=$('center'),right=$('right');
  left.innerHTML='';center.innerHTML='';right.innerHTML='';
  if(activeTab==='overview')renderOverview(center);
  else if(activeTab==='agents'){renderAgents(left);renderAgentDetail(right);}
  else if(activeTab==='tasks'){renderTasks(center);if(sel&&sel.type==='task')loadDetail(sel.id);}
  else if(activeTab==='reviews')renderReviews(center);
  else if(activeTab==='templates'){center.innerHTML='';loadTemplates();}
  else if(activeTab==='activity'){renderEvents(left);if(sel&&sel.type==='task')loadDetail(sel.id);}
}

function renderOverview(el){
  var s=data.status,c=s.agents||{},tc=s.tasks||{};
  var html='<div class=stats-grid>'+
    '<div class="stat-card"><div class=stat-num>'+(c.online||0)+'/'+data.agents.length+'</div><div class=stat-label>Agents Online</div></div>'+
    '<div class="stat-card"><div class=stat-num>'+(tc.running||0)+'</div><div class=stat-label>Running</div></div>'+
    '<div class="stat-card warn"><div class=stat-num>'+(tc.needs_review||0)+'</div><div class=stat-label>Needs Review</div></div>'+
    '<div class="stat-card"><div class=stat-num>'+(tc.failed||0)+'</div><div class=stat-label>Failed</div></div>'+
    '<div class="stat-card good"><div class=stat-num>'+(tc.completed||0)+'</div><div class=stat-label>Completed</div></div>'+
  '</div>';
  html+='<div class=panel><h3>Recent Tasks</h3>';
  data.tasks.slice(0,10).forEach(function(t){
    html+='<div class=card onclick="sel={type:\\'task\\',id:\\''+t.id+'\\'};renderAll()">'+
      '<div class=name>'+h(t.title)+'</div><div class=meta>'+st(t.status)+' '+badgeRow(t)+'</div></div>';
  });
  html+='</div>';
  el.innerHTML=html;
}

function renderAgentDetail(el){
  if(sel&&sel.type==='agent'){
    var a=data.agents.find(function(x){return x.id===sel.id;});
    if(a)el.innerHTML='<div class=panel><h3>'+h(a.name)+'</h3><div class=detail-row>'+h(a.status)+' · '+h(a.project_name)+'</div><div class=detail-row>'+h(a.api_base_url)+'</div></div>';
    else el.innerHTML='';
  }
}

function badgeRow(t){
  var b=[];b.push('<span class=badge>ITER '+t.currentIteration+'/'+t.maxIterations+'</span>');
  if(t.implementModel||t.reviewModel)b.push('<span class=badge>'+(t.implementModel||'?')+'→'+(t.reviewModel||'?')+'</span>');
  if(t.autoApprove)b.push('<span class="badge badge-on">AUTO</span>');
  if(t.autoApply)b.push('<span class="badge badge-on">APPLY</span>');
  if(t.currentIteration>=t.maxIterations&&(t.status==='needs_review'||t.status==='iterating'))b.push('<span class="badge badge-warn">MAX</span>');
  return b.join(' ');
}

function renderAgents(el){
  if(!data.agents.length){el.innerHTML='<div class=empty>No agents</div>';return;}
  var html='';
  data.agents.forEach(function(a){
    var c=sel&&sel.type==='agent'&&sel.id===a.id?' selected':'';
    html+='<div class="card agent-card'+c+'" onclick="sel={type:\\'agent\\',id:\\''+a.id+'\\'};renderAll()">'+
      '<div class=name><span class="status-dot '+dotClass(a.status)+'"></span>'+h(a.name)+'</div>'+
      '<div class=meta>'+h(a.project_name)+' · '+h(a.status)+'</div>'+
    '</div>';
  });
  el.innerHTML=html;
}

function renderTasks(el){
  var groups={queued:[],assigned:[],running:[],reviewing:[],iterating:[],needs_review:[],auto_approved:[],completed:[],failed:[],skipped:[],cancelled:[]},html='';
  data.tasks.forEach(function(t){if(groups[t.status])groups[t.status].push(t);});
  Object.entries(groups).forEach(function(e){
    var items=e[1];if(!items.length)return;
    html+='<div class=group-header>'+e[0].toUpperCase()+' ('+items.length+')</div>';
    items.forEach(function(t){
      var c=sel&&sel.type==='task'&&sel.id===t.id?' selected':'';
      html+='<div class="card'+c+'" onclick="sel={type:\\'task\\',id:\\''+t.id+'\\'};renderAll()">'+
        '<div class=name>'+h(t.title)+'</div><div class=meta>'+st(t.status)+' '+badgeRow(t)+'</div>'+
        (t.assignedAgentId?'<div class=meta>→ '+h(t.assignedAgentId)+'</div>':'')+'</div>';
    });
  });
  el.innerHTML=html||'<div class=empty>No tasks</div>';
}

function renderReviews(el){
  var items=[];data.tasks.forEach(function(t){if(t.status==='needs_review'||t.status==='auto_approved')items.push(t);});
  if(!items.length){el.innerHTML='<div class=empty>No tasks need review</div>';return;}
  var html='<div class=panel><h3>Needs Review ('+items.length+')</h3>';
  items.forEach(function(t){
    html+='<div class="card'+((sel&&sel.type==='task'&&sel.id===t.id)?' selected':'')+'" onclick="sel={type:\\'task\\',id:\\''+t.id+'\\'};renderAll()">'+
      '<div class=name>'+h(t.title)+'</div><div class=meta>'+badgeRow(t)+'</div>'+
      '<div class=btn-row style=margin-top:4px>'+
      '<button onclick="event.stopPropagation();doAction(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">Approve</button>'+
      '<button onclick="event.stopPropagation();confirm(\\'Restart task: '+h(t.title)+'?\\',function(){doAction(\\'/api/tasks/'+t.id+'/restart\\')})">Restart</button>'+
      '<button onclick="event.stopPropagation();confirm(\\'Skip task: '+h(t.title)+'?\\',function(){doAction(\\'/api/tasks/'+t.id+'/skip\\')})">Skip</button>'+
      '</div></div>';
  });
  el.innerHTML=html+'</div>';
}

function selectAgent(id){sel={type:'agent',id};fetchAll();}
function selectTask(id){sel={type:'task',id};fetchAll();}

async function doAction(path,body){await api('POST',path,body);fetchAll();}
async function doPatch(id,body){await api('PATCH','/api/tasks/'+id,body);fetchAll();}

function toggleSection(id){var b=$('sec-'+id);if(!b)return;b.style.display=b.style.display==='none'?'block':'none';}

function renderControls(t){
  var html='<div class=panel><h3>Actions</h3><div class=btn-row>';
  html+='<button onclick="doAction(\\'/api/tasks/'+t.id+'/dispatch\\')">▶ Dispatch</button>';
  html+='<button onclick="doAction(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">✓ Approve</button>';
  html+='<button onclick="confirm(\\'Restart task: '+h(t.title)+'?\\',function(){doAction(\\'/api/tasks/'+t.id+'/restart\\')})">↺ Restart</button>';
  html+='<button onclick="confirm(\\'Skip task: '+h(t.title)+'?\\',function(){doAction(\\'/api/tasks/'+t.id+'/skip\\')})">⏭ Skip</button>';
  html+='<button onclick="doPatch(\\''+t.id+'\\',{status:\\'failed\\'})">✗ Fail</button>';
  html+='</div>';
  if(t.autoApply)html+='<div class=warn>Auto Apply will modify worker files after reviewer approval.</div>';
  if(!t.autoApprove)html+='<div class=warn>Manual approval required after iterations.</div>';
  html+='<div class=btn-row style=margin-top:4px>';
  html+='<button class=btn-sm onclick="doPatch(\\''+t.id+'\\',{autoApprove:'+!t.autoApprove+'})">Auto Approve: '+(t.autoApprove?'ON':'OFF')+'</button>';
  html+='<button class=btn-sm onclick="confirm(\\'Enable Auto Apply for '+h(t.title)+'?\\',function(){doPatch(\\''+t.id+'\\',{autoApply:'+!t.autoApply+'})})">Auto Apply: '+(t.autoApply?'ON':'OFF')+'</button>';
  html+='<button class=btn-sm onclick="showEdit=!showEdit;renderDetail(window._tl)">✎ Edit</button>';
  html+='</div>';
  if(showEdit){
    html+='<div class=edit-form><label>Implement <input id=ef-impl value="'+h(t.implementModel||'')+'" size=20></label>'+
      '<label>Review <input id=ef-review value="'+h(t.reviewModel||'')+'" size=20></label>'+
      '<label>Max Iter <input id=ef-max type=number value="'+t.maxIterations+'" min=1 max=10 style=width:60px></label>'+
      '<label>Checks <input id=ef-checks value="'+h(t.checksJson||'')+'" size=20></label>'+
      '<label><input type=checkbox id=ef-reqchecks '+(t.requireChecks?'checked':'')+'> Require</label>'+
      '<button onclick="saveEdit(\\''+t.id+'\\')">Save</button></div>';
  }
  html+='</div>';
  return html;
}

async function saveEdit(id){
  var impl=$('ef-impl').value.trim()||null,review=$('ef-review').value.trim()||null,max=parseInt($('ef-max').value)||1;
  var checks=$('ef-checks').value.trim()||null,req=$('ef-reqchecks').checked;
  await doPatch(id,{implementModel:impl,reviewModel:review,maxIterations:max,checksJson:checks,requireChecks:req});
  showEdit=false;fetchAll();
}

function cs(id,tag,label,htmlFrag){
  return'<div class=collapsible-header onclick="toggleSection(\\''+id+'\\')"><span>'+tag+' '+label+'</span><span>▼</span></div><div class=collapsible-body id=sec-'+id+' style=display:block>'+htmlFrag+'</div>';
}

function renderDetail(tl){
  if(!tl||!tl.task)return;
  var t=tl.task,its=tl.iterations||[],events=tl.events||[];
  window._tl=tl;cachedIters=its;
  var html=renderControls(t);
  html+='<div class=panel><h3>'+h(t.title)+'</h3>'+
    '<div class=detail-row><span class=detail-label>Status</span>'+st(t.status)+'</div>'+
    '<div class=detail-row><span class=detail-label>Agent</span>'+h(t.assignedAgentId||'—')+'</div>'+
    '<div class=detail-row><span class=detail-label>Model</span>'+h(t.implementModel||'?')+' → '+h(t.reviewModel||'?')+'</div>'+
    '<div class=detail-row><span class=detail-label>Iteration</span>'+t.currentIteration+'/'+t.maxIterations+'</div></div>';
  html+=cs('prompt','📋','Prompt','<div class=detail-value>'+h(t.prompt)+'</div>');
  if(its.length){
    var iterHtml='';
    its.forEach(function(d){
      iterHtml+='<div class=iter-card><div class=iter-header>#'+d.iteration.iterationIndex+' '+st(d.iteration.status)+' '+(d.iteration.implementModel?'<span class=badge>'+h(d.iteration.implementModel)+'</span>':'')+'</div>';
      if(d.implementationSummary)iterHtml+='<div class=iter-summary>'+h(d.implementationSummary.slice(0,400))+'</div>';
      if(Array.isArray(d.changedFiles)&&d.changedFiles.length){
        iterHtml+='<div class=iter-files>';d.changedFiles.forEach(function(f){iterHtml+='<span class=iter-file>'+(typeof f==='string'?h(f):'+'+f.additions+' -'+f.deletions+' '+h(f.path))+'</span>';});iterHtml+='</div>';
      }
      if(Array.isArray(d.checkResults)&&d.checkResults.length){
        iterHtml+='<div class=iter-checks>';d.checkResults.forEach(function(c){iterHtml+='<span class="iter-check '+(c.ok?'pass':'fail')+'">'+(c.ok?'✓':'✗')+' '+h(c.name)+'</span>';});iterHtml+='</div>';
      }
      if(d.diffPreview)iterHtml+='<button class=diff-toggle onclick="var t=this.nextElementSibling;t.style.display=t.style.display===\\'none\\'?\\'block\\':\\'none\\'">▶ Show diff</button><pre class=diff-preview style=display:none>'+h(d.diffPreview)+'</pre>';
      if(d.reviewDecision)iterHtml+='<div class=iter-review><span class="iter-dec '+d.reviewDecision+'">'+d.reviewDecision+'</span> '+h(d.reviewFeedback||'')+'</div>';
      if(d.reviewNextPrompt)iterHtml+='<div class=iter-next>Next: '+h(d.reviewNextPrompt.slice(0,300))+'</div>';
      iterHtml+='</div>';
    });
    html+=cs('iterations','🔄','Iterations ('+its.length+')',iterHtml);
  }
  if(events.length){
    var evHtml='';events.slice(-30).forEach(function(e){evHtml+='<div class=event-row>'+new Date(e.createdAt).toISOString().slice(11,19)+' '+h(e.eventType)+': '+h(e.message.slice(0,200))+'</div>';});
    html+=cs('events','📜','Events ('+events.length+')',evHtml);
  }
  $('right').innerHTML=html;
}

async function loadDetail(id){
  var r=await(await fetch('/api/tasks/'+id+'/timeline')).json();
  if(r.timeline)renderDetail(r.timeline);
}
function renderEvents(el){
  var all=[];data.tasks.forEach(function(t){if(t.updatedAt)all.push({type:'task',id:t.id,msg:t.status+' '+h(t.title),at:t.updatedAt});});
  all.sort(function(a,b){return b.at-a.at;});
  el.innerHTML='<div class=panel><h3>Activity</h3>'+all.slice(0,30).map(function(e){return'<div class=event-row>'+new Date(e.at).toISOString().slice(11,19)+' ['+e.type+'] '+e.msg+'</div>';}).join('')+'</div>';
}

async function loadTemplates(){var r=await(await fetch('/api/task-flow-templates')).json();if(r.ok){var s='<div class=panel><h3>Templates</h3><select id=tpl-select onchange="selectTemplate(this.value)"><option value="">Select…</option>';r.templates.forEach(function(t){s+='<option value='+t.id+'>'+h(t.title)+'</option>';});s+='</select>';s+='<select id=tpl-fmt onchange="templateData.format=this.value"><option value=markdown>Markdown</option><option value=json>JSON</option><option value=csv>CSV</option><option value=plain>Plain</option></select>';s+='<button onclick=toggleTemplateOpts()>Options</button><div id=tpl-opts style=display:none>'+'<label>Agent <input id=tpl-agent size=20></label>'+'<label>Implement <input id=tpl-impl size=20></label>'+'<label>Review <input id=tpl-review size=20></label>'+'<label>Max Iter <input id=tpl-maxit type=number value=1 min=1 max=10 style=width:60px></label>'+'<label>Auto Approve <input type=checkbox id=tpl-autoapr></label>'+'<label>Auto Apply <input type=checkbox id=tpl-autoapl onchange="if(this.checked)alert(\\'Auto Apply can modify worker files after reviewer approval.\\')"></label>'+'<label>Checks <input id=tpl-checks size=20 placeholder=typecheck,test></label>'+'</div>';s+='<button onclick=renderTemplate()>Preview</button><pre id=tpl-preview style=display:none;background:#0a0a0a;border:1px solid #333;color:#0f0;font-size:10px;padding:6px;max-height:300px;overflow:auto;white-space:pre></pre>';s+='<div id=tpl-actions style=display:none><button onclick=copyTemplate()>Copy</button><button onclick=downloadTemplate()>Download</button></div></div>';document.getElementById('right').innerHTML=s+(document.getElementById('right').innerHTML);}}
function selectTemplate(id){templateData.selected=id;}
function toggleTemplateOpts(){var e=document.getElementById('tpl-opts');e.style.display=e.style.display==='none'?'block':'none';}
async function renderTemplate(){
  var id=document.getElementById('tpl-select').value;
  if(!id)return alert('Select a template');
  var opts={};
  var v=function(e){return e?e.value.trim()||undefined:undefined;};
  opts.assignedAgentId=v(document.getElementById('tpl-agent'));
  opts.implementModel=v(document.getElementById('tpl-impl'));
  opts.reviewModel=v(document.getElementById('tpl-review'));
  opts.maxIterations=parseInt(document.getElementById('tpl-maxit').value)||undefined;
  opts.autoApprove=document.getElementById('tpl-autoapr').checked||undefined;
  opts.autoApply=document.getElementById('tpl-autoapl').checked||undefined;
  var c=v(document.getElementById('tpl-checks'));if(c)opts.checks=c.split(/,/).map(function(x){return x.trim();}).filter(Boolean);
  var body={templateId:id,format:document.getElementById('tpl-fmt').value,options:opts};
  var r=await(await fetch('/api/task-flow-templates/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  if(r.ok){var e=document.getElementById('tpl-preview');e.textContent=r.content;e.style.display='block';document.getElementById('tpl-actions').style.display='block';templateData.preview=r.content;templateData.filename=r.filename;}
  else alert(r.error);
}
function copyTemplate(){navigator.clipboard.writeText(templateData.preview).then(function(){alert('Copied!');});}
function downloadTemplate(){var b=new Blob([templateData.preview],{type:'text/plain'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=templateData.filename||'agent-smith-task-flow.md';a.click();}

fetchAll();setInterval(fetchAll,2000);
`;
