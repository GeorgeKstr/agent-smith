export const clientJs = `var S=null,D={agents:[],tasks:[],status:{agents:{},tasks:{}},timeline:null},nav='overview',showEdit=false,confirmCb=null,tpl={show:false,selected:'',format:'markdown',opts:{},preview:''};
const $=function(id){return document.getElementById(id);};
function dot(s){return s==='offline'||s==='error'?'dot-offline':(s==='busy'||s==='indexing'?'dot-busy':(s==='idle'?'dot-idle':'dot-online'));}
function st(s){return'<span class="tag tag-'+s.replace(/_/g,'-')+'">'+s+'</span>';}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function bd(t){var o=[];o.push('<span class=badge>IT'+t.currentIteration+'/'+t.maxIterations+'</span>');if(t.autoApprove)o.push('<span class="badge badge-on">AUTO</span>');if(t.autoApply)o.push('<span class="badge badge-on">APPLY</span>');if(t.currentIteration>=t.maxIterations&&(t.status==='needs_review'||t.status==='iterating'))o.push('<span class="badge badge-warn">MAX</span>');return o.join(' ');}

async function api(m,p,b){var r=await fetch(p,{method:m,headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):null});return await r.json();}

async function fetchAll(){
  var s=await(await fetch('/api/organizer/status')).json();if(s.ok)D.status=s;
  var a=await(await fetch('/api/agents')).json();if(a.ok)D.agents=a.agents;
  var t=await(await fetch('/api/tasks')).json();if(t.ok)D.tasks=t.tasks;
  updateStats();renderNav();
  if(S&&S.type==='task'){var tl=await(await fetch('/api/tasks/'+S.id+'/timeline')).json();if(tl.timeline)D.timeline=tl.timeline;renderDetail();}
}

function updateStats(){
  $('stat-online').textContent=(D.status.agents&&D.status.agents.online)||0;
  $('stat-review').textContent=(D.status.tasks&&D.status.tasks.needs_review)||0;
  $('tb-tasks').textContent=(D.status.tasks&&D.status.tasks.total?D.status.tasks.total+' tasks':'');

  var rc=(D.status.tasks&&D.status.tasks.needs_review)||0;
  var b=$('bn-review-count');
  if(b){b.textContent=rc;b.style.display=rc>0?'inline':'none';}
}

function setNav(n){
  nav=n;
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.toggle('active',b.dataset.nav===n);});
  renderNav();
}

function renderNav(){
  var ct=$('content'),dt=$('details');
  ct.innerHTML='';dt.innerHTML='';
  if(nav==='overview')renderOverview(ct);
  else if(nav==='agents'){renderAgents(ct);if(S&&S.type==='agent')renderAgentDetail(dt);else dt.innerHTML='<div id=detail-empty>Select an agent to view details</div>';}
  else if(nav==='tasks'){renderTasks(ct);if(S&&S.type==='task')renderDetail();else dt.innerHTML='<div id=detail-empty>Select a task to view details</div>';}
  else if(nav==='reviews')renderReviews(ct);
  else if(nav==='activity')renderActivity(ct);
  else if(nav==='settings')renderSettings(ct);
}

function renderOverview(el){
  var s=D.status,c=s.agents||{},tc=s.tasks||{};
  var h='<div class=stats-grid>'+
    '<div class=stat-card><div class=stat-num>'+(c.online||0)+'/'+D.agents.length+'</div><div class=stat-label>Agents Online</div></div>'+
    '<div class=stat-card><div class=stat-num>'+(tc.running||0)+'</div><div class=stat-label>Running</div></div>'+
    '<div class="stat-card warn"><div class=stat-num>'+(tc.needs_review||0)+'</div><div class=stat-label>Needs Review</div></div>'+
    '<div class="stat-card danger"><div class=stat-num>'+(tc.failed||0)+'</div><div class=stat-label>Failed</div></div>'+
    '<div class=stat-card><div class=stat-num>'+(tc.completed||0)+'</div><div class=stat-label>Completed</div></div>'+
  '</div>';
  h+='<div class=panel><div class=panel-title>Recent Tasks</div>';
  if(!D.tasks.length)h+='<div class=empty>No tasks yet</div>';
  else D.tasks.slice(0,12).forEach(function(t){
    h+='<div class=card onclick="selectTask(\\''+t.id+'\\')">'+
      '<div class=name>'+esc(t.title)+'</div><div class=meta>'+st(t.status)+' '+bd(t)+'</div>'+
      (t.assignedAgentId?'<div class=sub>Agent: '+esc(t.assignedAgentId)+'</div>':'')+'</div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

function renderAgents(el){
  if(!D.agents.length){el.innerHTML='<div class=empty>No agents registered</div>';return;}
  var h='';
  var byStatus={online:[],busy:[],offline:[]};
  D.agents.forEach(function(a){
    if(a.status==='offline')byStatus.offline.push(a);
    else if(a.status==='busy'||a.status==='indexing')byStatus.busy.push(a);
    else byStatus.online.push(a);
  });
  function alist(arr,label){
    if(!arr.length)return'';
    var s='<div class=group-header>'+label+' ('+arr.length+')</div>';
    arr.forEach(function(a){
      var c=S&&S.type==='agent'&&S.id===a.id?' selected':'';
      s+='<div class="card agent-card'+c+'" onclick="selectAgent(\\''+a.id+'\\')">'+
        '<div class=name><span class="status-dot '+dot(a.status)+'"></span>'+esc(a.name)+'</div>'+
        '<div class=meta>'+esc(a.project_name)+' · '+esc(a.status)+'</div>'+
        '<div class=sub>'+esc(a.api_base_url)+'</div>'+
      '</div>';
    });
    return s;
  }
  h+=alist(byStatus.online,'Online');
  h+=alist(byStatus.busy,'Busy');
  h+=alist(byStatus.offline,'Offline');
  el.innerHTML=h||'<div class=empty>No agents registered</div>';
}

function renderAgentDetail(el){
  if(!S||S.type!=='agent'){el.innerHTML='<div id=detail-empty>Select an agent to view details</div>';return;}
  var a=D.agents.find(function(x){return x.id===S.id;});
  if(!a){el.innerHTML='';return;}
  var models=[];if(a.models)for(var k in a.models)if(a.models[k])models.push(k+': '+a.models[k]);
  var caps=Array.isArray(a.capabilities)?a.capabilities.join(', '):'';
  var ix=a.index||{};
  var h='<div class=panel><div class=panel-title>'+esc(a.name)+'</div>'+
    '<div class=detail-row><span class=detail-label>Status</span><span class=detail-value>'+st(a.status)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Project</span><span class=detail-value>'+esc(a.project_name)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Host</span><span class=detail-value>'+esc(a.hostname)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>API</span><span class=detail-value>'+esc(a.api_base_url||'—')+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Capabilities</span><span class=detail-value>'+esc(caps||'—')+'</span></div>';
  if(models.length)h+='<div class=detail-row><span class=detail-label>Models</span><span class=detail-value>'+esc(models.join(', '))+'</span></div>';
  if(ix.files)h+='<div class=detail-row><span class=detail-label>Index</span><span class=detail-value>'+ix.files+' files, '+ix.symbols+' symbols, '+ix.dirty+' dirty'+(ix.freshness!=null?' ('+Math.round(ix.freshness*100)+'% fresh)':'')+'</span></div>';
  h+='</div>';
  el.innerHTML=h;
}

function selectAgent(id){S={type:'agent',id:id};setNav('agents');}
function selectTask(id){S={type:'task',id:id};renderNav();renderDetail();}

async function renderDetail(){
  var dt=$('details');if(!S||S.type!=='task')return;
  var id=S.id;
  var tl=D.timeline;
  if(!tl||!tl.task){dt.innerHTML='<div class=empty>Loading…</div>';return;}
  var t=tl.task,its=tl.iterations||[],evs=tl.events||[];
  var h=renderTaskActions(t);
  h+='<div class=panel><div class=panel-title>'+esc(t.title)+'</div>'+
    '<div class=detail-row><span class=detail-label>Status</span>'+st(t.status)+'</div>'+
    '<div class=detail-row><span class=detail-label>Agent</span><span class=detail-value>'+esc(t.assignedAgentId||'—')+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Model</span><span class=detail-value>'+(t.implementModel||'?')+' → '+(t.reviewModel||'?')+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Iteration</span><span class=detail-value>'+t.currentIteration+'/'+t.maxIterations+'</span></div>'+
  '</div>';
  h+=collap('prompt','Prompt','<div class=detail-value>'+esc(t.prompt)+'</div>');
  if(its.length){
    var ih='';
    its.forEach(function(d){
      ih+='<div class=iter-card><div class=iter-header>#'+d.iteration.iterationIndex+' '+st(d.iteration.status)+' '+(d.iteration.implementModel?'<span class=badge>'+esc(d.iteration.implementModel)+'</span>':'')+'</div>';
      if(d.implementationSummary)ih+='<div class=iter-summary>'+esc(d.implementationSummary.slice(0,400))+'</div>';
      if(Array.isArray(d.changedFiles)&&d.changedFiles.length){
        ih+='<div class=iter-files>';d.changedFiles.forEach(function(f){ih+='<span class=iter-file>'+(typeof f==='string'?esc(f):'+'+f.additions+' -'+f.deletions+' '+esc(f.path))+'</span>';});ih+='</div>';
      }
      if(Array.isArray(d.checkResults)&&d.checkResults.length){
        ih+='<div class=iter-checks>';d.checkResults.forEach(function(c){ih+='<span class="iter-check '+(c.ok?'pass':'fail')+'">'+(c.ok?'✓':'✗')+' '+esc(c.name)+'</span>';});ih+='</div>';
      }
      if(d.diffPreview)ih+='<button class=diff-toggle onclick="var t=this.nextElementSibling;t.style.display=t.style.display===\\'none\\'?\\'block\\':\\'none\\'">▶ Show diff</button><pre class=diff-preview style=display:none>'+esc(d.diffPreview)+'</pre>';
      if(d.reviewDecision)ih+='<div class=iter-review><span class="iter-dec '+d.reviewDecision+'">'+d.reviewDecision+'</span> '+esc(d.reviewFeedback||'')+'</div>';
      if(d.reviewNextPrompt)ih+='<div class=iter-next>Next: '+esc(d.reviewNextPrompt.slice(0,300))+'</div>';
      ih+='</div>';
    });
    h+=collap('iterations','Iterations ('+its.length+')',ih);
  }
  if(evs.length){
    var eh='';evs.slice(-30).forEach(function(e){eh+='<div class=event-row><span class=event-time>'+new Date(e.createdAt).toISOString().slice(11,19)+'</span>'+esc(e.eventType)+': '+esc(e.message.slice(0,200))+'</div>';});
    h+=collap('events','Events ('+evs.length+')',eh);
  }
  dt.innerHTML=h;
}

function collap(id,label,html){
  return'<div class=collapsible-header onclick="var b=document.getElementById(\\'sec-'+id+'\\');if(b)b.style.display=b.style.display===\\'none\\'?\\'block\\':\\'none\\'"><span>'+esc(label)+'</span><span>▼</span></div><div class=collapsible-body id=sec-'+id+'>'+html+'</div>';
}

function renderTaskActions(t){
  var h='<div class=panel><div class=btn-row>';
  h+='<button class=btn onclick="act(\\'/api/tasks/'+t.id+'/dispatch\\')">▶ Dispatch</button>';
  h+='<button class="btn btn-accent" onclick="act(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">✓ Approve</button>';
  h+='<button class=btn onclick="cf(\\'Restart task: '+esc(t.title)+'?\\',function(){act(\\'/api/tasks/'+t.id+'/restart\\')})">↺ Restart</button>';
  h+='<button class=btn onclick="cf(\\'Skip task: '+esc(t.title)+'?\\',function(){act(\\'/api/tasks/'+t.id+'/skip\\')})">⏭ Skip</button>';
  h+='<button class="btn btn-danger" onclick="ptch(\\''+t.id+'\\',{status:\\'failed\\'})">✗ Fail</button>';
  h+='</div>';
  if(t.autoApply)h+='<div class=warn-banner>Auto Apply: files will be modified on worker after approval.</div>';
  if(!t.autoApprove)h+='<div class=warn-banner>Manual approval required after iterations.</div>';
  h+='<div class=btn-row>';
  h+='<button class="btn btn-sm" onclick="ptch(\\''+t.id+'\\',{autoApprove:'+!t.autoApprove+'})">Auto: '+(t.autoApprove?'ON':'OFF')+'</button>';
  h+='<button class="btn btn-sm" onclick="cf(\\'Toggle Auto Apply for '+esc(t.title)+'?\\',function(){ptch(\\''+t.id+'\\',{autoApply:'+!t.autoApply+'})})">Apply: '+(t.autoApply?'ON':'OFF')+'</button>';
  h+='<button class="btn btn-sm" onclick="showEdit=!showEdit;renderDetail()">✎ Edit</button>';
  h+='</div>';
  if(showEdit){
    h+='<div class=edit-form><label>Implement Model <input id=ef-impl value="'+esc(t.implementModel||'')+'"></label>'+
      '<label>Review Model <input id=ef-review value="'+esc(t.reviewModel||'')+'"></label>'+
      '<label>Max Iterations <input id=ef-max type=number value="'+t.maxIterations+'" min=1 max=10 style=width:80px></label>'+
      '<label>Checks <input id=ef-checks value="'+esc(t.checksJson||'')+'"></label>'+
      '<label><input type=checkbox id=ef-reqchecks '+(t.requireChecks?'checked':'')+'> Require Checks</label>'+
      '<button class=btn onclick="saveEdit(\\''+t.id+'\\')">Save</button></div>';
  }
  h+='</div>';
  return h;
}

async function saveEdit(id){
  var impl=$('ef-impl').value.trim()||null,review=$('ef-review').value.trim()||null,max=parseInt($('ef-max').value)||1;
  var checks=$('ef-checks').value.trim()||null,req=$('ef-reqchecks').checked;
  await ptch(id,{implementModel:impl,reviewModel:review,maxIterations:max,checksJson:checks,requireChecks:req});
  showEdit=false;S={type:'task',id:id};await fetchAll();
}

function renderTasks(el){
  var groups={queued:[],assigned:[],running:[],reviewing:[],iterating:[],needs_review:[],auto_approved:[],completed:[],failed:[],skipped:[],cancelled:[]},h='';
  D.tasks.forEach(function(t){if(groups[t.status])groups[t.status].push(t);});
  Object.entries(groups).forEach(function(e){
    var items=e[1];if(!items.length)return;
    h+='<div class=group-header>'+e[0].replace(/_/g,' ')+' ('+items.length+')</div>';
    items.forEach(function(t){
      var c=S&&S.type==='task'&&S.id===t.id?' selected':'';
      h+='<div class="card'+c+'" onclick="selectTask(\\''+t.id+'\\')">'+
        '<div class=name>'+esc(t.title)+'</div><div class=meta>'+st(t.status)+' '+bd(t)+'</div>'+
        (t.assignedAgentId?'<div class=sub>Agent: '+esc(t.assignedAgentId)+'</div>':'')+'</div>';
    });
  });
  el.innerHTML=h||'<div class=empty>No tasks</div>';
}

function renderReviews(el){
  var items=[];D.tasks.forEach(function(t){if(t.status==='needs_review'||t.status==='auto_approved')items.push(t);});
  if(!items.length){el.innerHTML='<div class=empty>No tasks need review</div>';return;}
  var h='<div class=panel><div class=panel-title>Needs Review ('+items.length+')</div>';
  items.forEach(function(t){
    h+='<div class="card'+((S&&S.type==='task'&&S.id===t.id)?' selected':'')+'" onclick="selectTask(\\''+t.id+'\\')">'+
      '<div class=name>'+esc(t.title)+'</div><div class=meta>'+bd(t)+'</div>'+
      '<div class=btn-row style=margin-top:4px>'+
      '<button class="btn btn-accent btn-sm" onclick="event.stopPropagation();act(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">Approve</button>'+
      '<button class=btn onclick="event.stopPropagation();cf(\\'Restart: '+esc(t.title)+'?\\',function(){act(\\'/api/tasks/'+t.id+'/restart\\')})">Restart</button>'+
      '<button class=btn onclick="event.stopPropagation();cf(\\'Skip: '+esc(t.title)+'?\\',function(){act(\\'/api/tasks/'+t.id+'/skip\\')})">Skip</button>'+
      '</div></div>';
  });
  h+='</div>';el.innerHTML=h;
}

function renderActivity(el){
  var all=[];D.tasks.forEach(function(t){if(t.updatedAt)all.push({type:'task',id:t.id,msg:t.status+' '+esc(t.title),at:t.updatedAt});});
  all.sort(function(a,b){return b.at-a.at;});
  var h='<div class=panel><div class=panel-title>Recent Activity</div>';
  if(!all.length)h+='<div class=empty>No activity yet</div>';
  else all.slice(0,40).forEach(function(e){h+='<div class=event-row><span class=event-time>'+new Date(e.at).toISOString().slice(11,19)+'</span>['+e.type+'] '+e.msg+'</div>';});
  h+='</div>';el.innerHTML=h;
}

async function renderSettings(el){
  var h='<div class=panel><div class=panel-title>Settings</div>';
  h+='<div class=settings-section><h3>Organizer</h3><div class=detail-row><span class=detail-label>URL</span><span class=detail-value>'+esc(location.origin)+'</span></div></div>';
  h+='<div class=settings-section><h3>Templates</h3>';
  var r=await(await fetch('/api/task-flow-templates')).json();
  if(r.ok&&r.templates){
    h+='<select id=tpl-select onchange="tpl.selected=this.value" style="background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font);font-size:11px;width:100%;margin-bottom:6px"><option value="">Select a template…</option>';
    r.templates.forEach(function(t){h+='<option value='+t.id+'>'+esc(t.title)+'</option>';});
    h+='</select>';
    h+='<select id=tpl-fmt onchange="tpl.format=this.value" style="background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font);font-size:11px;width:100%;margin-bottom:6px"><option value=markdown>Markdown</option><option value=json>JSON</option><option value=csv>CSV</option><option value=plain>Plain</option></select>';
    h+='<button class=btn onclick="var e=$(\'tpl-opts\');e.style.display=e.style.display===\'none\'?\'block\':\'none\'">Options</button>';
    h+='<div id=tpl-opts style=display:none;margin-top:6px>'+
      '<div class=edit-form><label>Agent ID <input id=tpl-agent></label>'+
      '<label>Implement Model <input id=tpl-impl></label>'+
      '<label>Review Model <input id=tpl-review></label>'+
      '<label>Max Iterations <input id=tpl-maxit type=number min=1 max=10 value=1 style=width:80px></label>'+
      '<label><input type=checkbox id=tpl-autoapr> Auto Approve</label>'+
      '<label><input type=checkbox id=tpl-autoapl onchange="if(this.checked)alert(\\'Auto Apply modifies worker files after approval.\\')"> Auto Apply</label>'+
      '<label>Checks <input id=tpl-checks placeholder=typecheck,test></label></div></div>';
    h+='<div class=btn-row style=margin-top:6px><button class="btn btn-accent" onclick=renderTpl()>Preview</button></div>';
    h+='<pre id=tpl-preview style=display:none;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--fg);font-size:9px;padding:8px;max-height:300px;overflow:auto;white-space:pre;font-family:var(--font);line-height:1.3></pre>';
    h+='<div id=tpl-actions class=btn-row style=display:none;margin-top:6px><button class=btn onclick=copyTpl()>Copy</button><button class=btn onclick=downloadTpl()>Download</button></div>';
  }
  h+='</div></div>';
  el.innerHTML=h;
}

async function renderTpl(){
  var id=$('tpl-select').value;if(!id)return alert('Select a template');
  var opts={};
  var v=function(e){return e?e.value.trim()||undefined:undefined;};
  opts.assignedAgentId=v($('tpl-agent'));
  opts.implementModel=v($('tpl-impl'));
  opts.reviewModel=v($('tpl-review'));
  opts.maxIterations=parseInt($('tpl-maxit').value)||undefined;
  opts.autoApprove=$('tpl-autoapr').checked||undefined;
  opts.autoApply=$('tpl-autoapl').checked||undefined;
  var c=v($('tpl-checks'));if(c)opts.checks=c.split(/,/).map(function(x){return x.trim();}).filter(Boolean);
  var body={templateId:id,format:$('tpl-fmt').value,options:opts};
  var r=await(await fetch('/api/task-flow-templates/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  if(r.ok){var e=$('tpl-preview');e.textContent=r.content;e.style.display='block';$('tpl-actions').style.display='flex';tpl.preview=r.content;tpl.filename=r.filename;}
  else alert(r.error);
}
function copyTpl(){navigator.clipboard.writeText(tpl.preview).then(function(){alert('Copied!');});}
function downloadTpl(){var b=new Blob([tpl.preview],{type:'text/plain'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=tpl.filename||'agent-smith-task-flow.md';a.click();}

async function act(path,body){await api('POST',path,body);await fetchAll();}
async function ptch(id,body){await api('PATCH','/api/tasks/'+id,body);await fetchAll();}

function cf(msg,cb){$('confirm-text').textContent=msg;$('confirm-overlay').style.display='flex';confirmCb=cb;}
function confirmYes(){if(confirmCb)confirmCb();$('confirm-overlay').style.display='none';confirmCb=null;}
function confirmNo(){$('confirm-overlay').style.display='none';confirmCb=null;}

document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('.nav-btn').forEach(function(b){
    b.addEventListener('click',function(){setNav(this.dataset.nav);});
  });
  $('refresh-btn').addEventListener('click',function(){this.classList.add('spinning');setTimeout(function(){this.classList.remove('spinning');}.bind(this),600);});
  fetchAll();setInterval(fetchAll,2000);
  setNav('overview');
});

document.addEventListener('click',function(e){if(e.target.closest('.nav-btn')||e.target.closest('.card')||e.target.closest('button'))return;});
`;
