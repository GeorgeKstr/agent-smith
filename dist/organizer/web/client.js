export const clientJs = `(function(){
var $=function(id){return document.getElementById(id);};
var S={
  view:'overview',loading:false,error:null,
  status:null,agents:[],projects:[],buckets:[],tasks:[],
  selAgent:null,selTask:null,timeline:null,
  chats:{selAgent:null,sessions:[],selSession:null,messages:[]},
  importPreview:null,tplPreview:null,tplFilename:null,confirmCb:null
};
var refreshTimer=null,textAreaFocused=false;

function esc(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ago(ts){if(!ts)return'never';var s=Math.round((Date.now()-ts)/1000);if(s<5)return'now';if(s<60)return s+'s ago';if(s<3600)return Math.round(s/60)+'m ago';return Math.round(s/3600)+'h ago';}
function dotC(s){if(s==='offline'||s==='error')return'dot-off';if(s==='busy'||s==='indexing')return'dot-busy';return'dot-on';}
function st(s){return'<span class="tag tag-'+s.replace(/_/g,'-')+'">'+s+'</span>';}
function bd(t){var o=[];o.push('<span class=badge>IT'+t.currentIteration+'/'+t.maxIterations+'</span>');if(t.autoApprove)o.push('<span class="badge badge-on">AUTO</span>');if(t.autoApply)o.push('<span class="badge badge-on">APPLY</span>');if(t.autoApprove&&t.autoApply)o=['<span class=badge>IT'+t.currentIteration+'/'+t.maxIterations+'</span>','<span class="badge badge-on">AUTO-APPLY</span>'];return o.join(' ');}
function short(id){return id?String(id).slice(0,12):'';}
function sel(c){return c?' selected':'';}

/* ─── Markdown (safe) ─── */
function md(t){if(!t)return'';
  return esc(t).replace(/\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g,'<pre class=diff-pre>$2</pre>')
    .replace(/\`([^\`]+)\`/g,'<code style="background:var(--panel2);padding:1px 4px;border-radius:3px;font-size:10px">$1</code>')
    .replace(/^\\* (.+)$/gm,function(_,c){return'<span style="color:var(--bright)">•</span> '+c;})
    .replace(/^\\- (.+)$/gm,function(_,c){return'<span style="color:var(--bright)">—</span> '+c;})
    .replace(/\\n/g,'<br>');
}

/* ─── API wrapper ─── */
async function api(path,opts){
  opts=opts||{};
  var res=await fetch(path,{method:opts.method||'GET',headers:opts.body&&typeof opts.body!=='string'?{'Content-Type':'application/json'}:opts.headers||{},body:opts.body&&typeof opts.body!=='string'?JSON.stringify(opts.body):opts.body});
  var text=await res.text(),data=null;
  try{data=text?JSON.parse(text):null;}catch(e){data={ok:false,error:text};}
  if(!res.ok||(data&&data.ok===false)){throw new Error(data?data.error||('HTTP '+res.status):'HTTP '+res.status);}
  return data;
}

/* ─── Data fetch ─── */
async function fetchAll(silent){
  if(!silent)S.loading=true;
  try{
    var st=await api('/api/organizer/status');S.status=st;
    var a=await api('/api/agents');S.agents=a.agents||[];
    var t=await api('/api/tasks');S.tasks=t.tasks||[];
    S.error=null;
  }catch(e){S.error=e.message;if(!silent)showError(e.message);}
  S.loading=false;
  if(!silent)render();
}

/* ─── Show error inline ─── */
function showError(msg){
  var el=$('content');
  if(!S.error)return;
  if(S.view==='tasks'&&S.selTask){} /* let detail handle its own errors */
}

/* ─── Set view ─── */
function setView(v){
  S.view=v;S.error=null;
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.toggle('active',b.dataset.nav===v);});
  if(v==='tasks'&&S.selTask){S.selTask=null;S.timeline=null;}
  if(v==='agents'&&S.selAgent){S.selAgent=null;}
  if(v==='agents'&&S.chats.selAgent){S.chats={selAgent:null,sessions:[],selSession:null,messages:[]};}
  render();
}

/* ─── Main render ─── */
function render(){
  updateStats();
  var ct=$('content'),dt=$('details'),sb=$('sidebar'),bn=$('bottomnav');
  dt.innerHTML='';dt.style.display='none';

  if(S.loading&&!S.tasks.length){ct.innerHTML='<div class=loading>Loading…</div>';return;}
  if(S.error&&S.view==='overview'){ct.innerHTML='<div class=error-msg>'+esc(S.error)+'<br><br>Check that the organizer server is running.</div>';return;}

  switch(S.view){
    case 'overview':renderOverview(ct);break;
    case 'agents':renderAgents(ct);break;
    case 'tasks':renderTasks(ct);break;
    case 'reviews':renderReviews(ct);break;
    case 'activity':renderActivity(ct);break;
    case 'import':renderImport(ct);break;
    case 'templates':renderTemplates(ct);break;
    case 'settings':renderSettings(ct);break;
  }

  if(S.view==='tasks'&&S.selTask){dt.style.display='block';renderTaskDetail(dt);}
  if(S.view==='agents'&&S.selAgent){
    if(S.chats.selAgent&&S.chats.selAgent===S.selAgent){
      dt.style.display='block';renderChatDetail(dt);
    }else{
      renderAgentDetail(dt);
    }
  }
}

function updateStats(){
  var online=(S.status&&S.status.agents&&S.status.agents.online)||0;
  var review=(S.status&&S.status.tasks&&S.status.tasks.needs_review)||0;
  $('tb-stats').textContent=online+' online · '+(S.tasks.length||0)+' tasks · '+review+' needs review';
}

/* ── Overview ── */
function renderOverview(el){
  var sc=S.status&&S.status.agents||{},tc=S.status&&S.status.tasks||{};
  var h='';
  h+='<div class=stats-grid>'+
    '<div class=stat-card onclick="setView(\\'agents\\')"><div class=stat-num>'+(sc.online||0)+'/'+S.agents.length+'</div><div class=stat-label>Agents Online</div></div>'+
    '<div class=stat-card onclick="filterTasks(\\'running\\')"><div class=stat-num>'+(tc.running||0)+'</div><div class=stat-label>Running</div></div>'+
    '<div class="stat-card warn" onclick="setView(\\'reviews\\')"><div class=stat-num>'+(tc.needs_review||0)+'</div><div class=stat-label>Needs Review</div></div>'+
    '<div class="stat-card danger" onclick="filterTasks(\\'failed\\')"><div class=stat-num>'+(tc.failed||0)+'</div><div class=stat-label>Failed</div></div>'+
    '<div class=stat-card onclick="filterTasks(\\'completed\\')"><div class=stat-num>'+(tc.completed||0)+'</div><div class=stat-label>Completed</div></div>'+
  '</div>';

  /* Model usage */
  var mm={};
  S.tasks.forEach(function(t){
    if(t.implementModel){mm[t.implementModel]=mm[t.implementModel]||{i:0,r:0};mm[t.implementModel].i++;}
    if(t.reviewModel){mm[t.reviewModel]=mm[t.reviewModel]||{i:0,r:0};mm[t.reviewModel].r++;}
  });
  var mks=Object.keys(mm);if(mks.length){
    h+='<div class=panel><div class=panel-title>Top Models</div><div class=model-used>';
    mks.sort(function(a,b){return((mm[b].i+mm[b].r)-(mm[a].i+mm[a].r));}).slice(0,8).forEach(function(m){
      h+='<div class=model-chip>'+esc(m)+' <span class=mc-n>'+((mm[m].i+mm[m].r)||0)+'</span></div>';
    });
    h+='</div></div>';
  }

  /* Recent tasks */
  var recent=S.tasks.slice().sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0);}).slice(0,10);
  h+='<div class=panel><div class=panel-title>Recent Tasks</div>';
  if(!recent.length)h+='<div class=empty>No tasks yet</div>';
  else recent.forEach(function(t){
    h+='<div class=card onclick="openTask(\\''+t.id+'\\')"><div class=c-title>'+esc(t.title)+'</div><div class=c-meta>'+st(t.status)+' '+bd(t)+'</div>'+(t.assignedAgentId?'<div class=c-sub>Agent: '+esc(short(t.assignedAgentId))+'</div>':'')+'</div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

function filterTasks(sts){setView('tasks');setTimeout(function(){S.selStatus=sts;},50);}

/* ── Agents ── */
function renderAgents(el){
  if(!S.agents.length){el.innerHTML='<div class=empty>No agents registered.<br>Workers auto-register via heartbeat.</div>';return;}
  var h='';
  S.agents.forEach(function(a){
    var selCls=S.selAgent===a.id?' selected':'';
    h+='<div class="card'+selCls+'" onclick="selectAgent(\\''+a.id+'\\')">'+
      '<div class=btns style="margin-bottom:4px">'+
        '<button class="btn btn-sm btn-accent" style="min-height:28px;font-size:9px" onclick="event.stopPropagation();selectAgent(\\''+a.id+'\\');openAgentTasks(\\''+a.id+'\\')">Tasks</button>'+
        '<button class="btn btn-sm" style="min-height:28px;font-size:9px" onclick="event.stopPropagation();selectAgent(\\''+a.id+'\\');openAgentChat(\\''+a.id+'\\')">Chat</button>'+
      '</div>'+
      '<div class=c-title><span class="dot '+dotC(a.status)+'"></span> '+esc(a.name||short(a.id))+'</div>'+
      '<div class=c-meta>'+esc(a.status)+' · '+esc(a.project_name||a.hostname||'')+'</div>'+
      '<div class=c-sub>'+esc(a.api_base_url||'')+' · '+ago(a.last_heartbeat_at)+'</div>'+
    '</div>';
  });
  el.innerHTML=h;
}

function selectAgent(id){S.selAgent=id;S.chats={selAgent:null,sessions:[],selSession:null,messages:[]};render();}

function openAgentTasks(aid){S.selAgent=aid;S.chats={selAgent:null,sessions:[],selSession:null,messages:[]};render();}

function openAgentChat(aid){
  S.selAgent=aid;S.chats.selAgent=aid;S.chats.sessions=[];S.chats.selSession=null;S.chats.messages=[];
  render();loadChatSessions(aid);
}

function renderAgentDetail(el){
  if(!S.selAgent){el.innerHTML='';return;}
  var a=S.agents.find(function(x){return x.id===S.selAgent;});
  if(!a){el.innerHTML='<div class=empty>Agent not found</div>';return;}
  var models=[];if(a.models)for(var k in a.models)if(a.models[k])models.push(k+': '+a.models[k]);
  var caps=Array.isArray(a.capabilities)?a.capabilities.join(', '):'';
  var ix=a.index||{};
  var h='<div class=panel><div class=panel-title>'+esc(a.name||short(a.id))+'</div>'+
    '<div class=dl-row>'+st(a.status)+'</div>'+
    '<div class=dl-row><span class=dl-label>Project</span><span class=dl-value>'+esc(a.project_name)+'</span></div>'+
    '<div class=dl-row><span class=dl-label>Host</span><span class=dl-value>'+esc(a.hostname)+'</span></div>'+
    '<div class=dl-row><span class=dl-label>API</span><span class=dl-value>'+esc(a.api_base_url||'—')+'</span></div>'+
    '<div class=dl-row><span class=dl-label>Seen</span><span class=dl-value>'+ago(a.last_heartbeat_at)+'</span></div>';
  if(caps)h+='<div class=dl-row><span class=dl-label>Capabilities</span><span class=dl-value>'+esc(caps)+'</span></div>';
  if(models.length)h+='<div class=dl-row><span class=dl-label>Models</span><span class=dl-value>'+esc(models.join(', '))+'</span></div>';
  if(ix&&ix.files)h+='<div class=dl-row><span class=dl-label>Index</span><span class=dl-value>'+ix.files+' files, '+ix.symbols+' symbols, '+(Math.round((ix.freshness||1)*100))+'% fresh</span></div>';
  h+='</div>';
  el.innerHTML=h;
}

/* ── Tasks ── */
function renderTasks(el){
  var filter=S.selStatus||null;
  var items=S.tasks;if(filter)items=items.filter(function(t){return t.status===filter;});

  var h='<div class=panel><div class=panel-title>Tasks ('+items.length+')</div>';
  h+='<div class=filter-bar>'+
    '<button class="btn btn-sm" onclick="S.selStatus=null;render()">All</button>'+
    '<button class="btn btn-sm" onclick="S.selStatus=\\'queued\\';render()">Queued</button>'+
    '<button class="btn btn-sm" onclick="S.selStatus=\\'running\\';render()">Running</button>'+
    '<button class="btn btn-sm" onclick="S.selStatus=\\'needs_review\\';render()">Review</button>'+
    '<button class="btn btn-sm" onclick="S.selStatus=\\'completed\\';render()">Done</button>'+
    '<button class="btn btn-sm" onclick="S.selStatus=\\'failed\\';render()">Failed</button>'+
  '</div>';

  if(!items.length){h+='<div class=empty>No tasks match</div>';}else{
    var groups={};items.forEach(function(t){groups[t.status]=groups[t.status]||[];groups[t.status].push(t);});
    var order=['running','iterating','reviewing','needs_review','auto_approved','assigned','queued','completed','failed','skipped','cancelled'];
    order.forEach(function(grp){
      var arr=groups[grp];if(!arr||!arr.length)return;
      h+='<div class=gh>'+grp.replace(/_/g,' ')+' ('+arr.length+')</div>';
      arr.forEach(function(t){
        h+='<div class="card'+(S.selTask===t.id?' selected':'')+'" onclick="openTask(\\''+t.id+'\\')">'+
          '<div class=c-title>'+esc(t.title)+'</div><div class=c-meta>'+st(t.status)+' '+bd(t)+'</div>'+
          (t.assignedAgentId?'<div class=c-sub>Agent: '+esc(short(t.assignedAgentId))+'</div>':'')+'</div>';
      });
    });
  }
  h+='</div>';
  el.innerHTML=h;
}

function openTask(tid){S.selTask=tid;S.timeline=null;setView('tasks');loadTimeline(tid);}

async function loadTimeline(tid){
  var dt=$('content');if(S.view!=='tasks')return;
  try{
    var r=await api('/api/tasks/'+tid+'/timeline');S.timeline=r.timeline||r;
    S.error=null;
  }catch(e){S.error=e.message;S.timeline=null;}
  render();
}

/* ── Task Detail ── */
function renderTaskDetail(el){
  if(!S.selTask){el.innerHTML='';return;}
  if(S.error){el.innerHTML='<div class=error-msg>'+esc(S.error)+'</div>';return;}
  if(!S.timeline||!S.timeline.task){el.innerHTML='<div class=loading>Loading…</div>';return;}
  var t=S.timeline.task,its=S.timeline.iterations||[],evs=S.timeline.events||[];
  var h='<div class=task-top-bar>'+renderTaskActions(t)+'</div>';
  h+='<div class=panel><div class=panel-title>'+esc(t.title)+'</div>'+
    '<div class=dl-row><span class=dl-label>Status</span><span class=dl-value>'+st(t.status)+'</span></div>'+
    '<div class=dl-row><span class=dl-label>Agent</span><span class=dl-value>'+esc(t.assignedAgentId||'—')+'</span></div>'+
    '<div class=dl-row><span class=dl-label>Model</span><span class=dl-value>'+(t.implementModel||'?')+' → '+(t.reviewModel||'?')+'</span></div>'+
    '<div class=dl-row><span class=dl-label>Iteration</span><span class=dl-value>'+t.currentIteration+'/'+t.maxIterations+'</span></div>'+
  '</div>';

  h+=collap('prompt','Prompt','<div class=dl-value style="max-height:200px">'+md(t.prompt)+'</div>');
  if(its.length){
    var ih='';
    its.forEach(function(d){
      ih+='<div class=itc><div class=itc-hdr>#'+d.iteration.iterationIndex+' '+st(d.iteration.status)+' '+(d.iteration.implementModel?'<span class=badge>'+esc(d.iteration.implementModel)+'</span>':'')+'</div>';
      if(d.implementationSummary)ih+='<div class=itc-sum>'+md(d.implementationSummary)+'</div>';
      if(Array.isArray(d.changedFiles)&&d.changedFiles.length){
        ih+='<div class=itc-files>';d.changedFiles.forEach(function(f){ih+='<span class=itc-file>'+(typeof f==='string'?esc(f):'+'+f.additions+' -'+f.deletions+' '+esc(f.path))+'</span>';});ih+='</div>';
      }
      if(Array.isArray(d.checkResults)&&d.checkResults.length){
        ih+='<div class=itc-checks>';d.checkResults.forEach(function(c){ih+='<span class="itc-ck '+(c.ok?'pass':'fail')+'">'+(c.ok?'✓':'✗')+' '+esc(c.name)+'</span>';});ih+='</div>';
      }
      if(d.diffPreview)ih+='<button class=diff-btn onclick="var t=this.nextElementSibling;t.style.display=t.style.display===\\'none\\'?\\'block\\':\\'none\\'">▶ Show diff</button><pre class=diff-pre style=display:none>'+esc(d.diffPreview)+'</pre>';
      if(d.reviewDecision)ih+='<div class=itc-rev><span class="itc-dec '+d.reviewDecision+'">'+d.reviewDecision+'</span> '+md(d.reviewFeedback||'')+'</div>';
      if(d.reviewNextPrompt)ih+='<div class=itc-next>Next: '+md(d.reviewNextPrompt)+'</div>';
      ih+='</div>';
    });
    h+=collap('iterations','Iterations ('+its.length+')',ih);
  }
  if(evs.length){
    var eh='';evs.slice(-30).forEach(function(e){eh+='<div class=ev><span class=ev-time>'+new Date(e.createdAt).toISOString().slice(11,19)+'</span>'+esc(e.eventType)+': '+esc(e.message.slice(0,200))+'</div>';});
    h+=collap('events','Events ('+evs.length+')',eh);
  }
  el.innerHTML=h;
}

function collap(id,label,html){
  return'<div class=c-header onclick="var b=$i(\\'sec-'+id+'\\');if(b)b.style.display=b.style.display===\\'none\\'?\\'block\\':\\'none\\'"><span>'+esc(label)+'</span><span>▼</span></div><div class=c-body id=sec-'+id+'>'+html+'</div>';
}

function renderTaskActions(t){
  var h='<div class=btns>'+
    '<button class="btn btn-accent btn-sm" onclick="doAct(\\'/api/tasks/'+t.id+'/dispatch\\')">▶ Dispatch</button>'+
    '<button class="btn btn-accent btn-sm" onclick="doAct(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">✓ Approve</button>'+
    '<button class="btn btn-sm" onclick="cf(\\'Restart task?\\',function(){doAct(\\'/api/tasks/'+t.id+'/restart\\')})">↺ Restart</button>'+
    '<button class="btn btn-sm" onclick="cf(\\'Skip task?\\',function(){doAct(\\'/api/tasks/'+t.id+'/skip\\')})">⏭ Skip</button>'+
    '<button class="btn btn-sm" onclick="editTaskPolicy(\\''+t.id+'\\')">✎ Policy</button>'+
  '</div>';
  if(t.autoApply)h+='<div class=wrn>Auto Apply ON: worker files will be modified after approval.</div>';
  if(!t.autoApprove&&!t.autoApply)h+='<div class=wrn>Manual approval required.</div>';
  h+='<div id=edit-policy-'+t.id+' style=display:none class=form></div>';
  return h;
}

function editTaskPolicy(tid){
  var el=$('edit-policy-'+tid);if(!el)return;
  el.style.display=el.style.display==='none'?'block':'none';
  if(el.style.display==='none')return;
  var t=S.tasks.find(function(x){return x.id===tid;})||(S.timeline&&S.timeline.task);
  if(!t)return;
  el.innerHTML=
    '<label>Implement Model <input id=ep-impl value="'+esc(t.implementModel||'')+'"></label>'+
    '<label>Review Model <input id=ep-review value="'+esc(t.reviewModel||'')+'"></label>'+
    '<label>Max Iterations <input id=ep-max type=number value="'+t.maxIterations+'" min=1 max=20 style=width:80px></label>'+
    '<label><input type=checkbox id=ep-autoapr '+(t.autoApprove?'checked':'')+'> Auto Approve</label>'+
    '<label><input type=checkbox id=ep-autoapl '+(t.autoApply?'checked':'')+'> Auto Apply</label>'+
    '<label>Checks <input id=ep-checks value="'+esc(t.checksJson||'')+'"></label>'+
    '<button class=btn onclick="saveEdit(\\''+tid+'\\')">Save</button>';
}

async function saveEdit(tid){
  try{
    await api('/api/tasks/'+tid,{method:'PATCH',body:{
      implementModel:($('ep-impl')&&$('ep-impl').value)||null,
      reviewModel:($('ep-review')&&$('ep-review').value)||null,
      maxIterations:parseInt($('ep-max')?$('ep-max').value:'1')||1,
      autoApprove:$('ep-autoapr')?$('ep-autoapr').checked:false,
      autoApply:$('ep-autoapl')?$('ep-autoapl').checked:false,
      checksJson:$('ep-checks')?$('ep-checks').value:null
    }});
    await fetchAll(true);loadTimeline(tid);
  }catch(e){alert(e.message);}
}

async function doAct(path,body){
  try{await api(path,{method:'POST',body:body});await fetchAll(true);if(S.selTask)loadTimeline(S.selTask);}
  catch(e){alert(e.message);}
}

/* ── Reviews ── */
function renderReviews(el){
  var items=S.tasks.filter(function(t){return t.status==='needs_review'||t.status==='auto_approved';});
  if(!items.length){el.innerHTML='<div class=empty>No tasks need review</div>';return;}
  var h='<div class=panel><div class=panel-title>Needs Review ('+items.length+')</div>';
  items.forEach(function(t){
    h+='<div class=card onclick="openTask(\\''+t.id+'\\')">'+
      '<div class=c-title>'+esc(t.title)+'</div><div class=c-meta>'+bd(t)+'</div>'+
      '<div class=btns style=margin-top:4px>'+
        '<button class="btn btn-accent btn-sm" onclick="event.stopPropagation();doAct(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">Approve</button>'+
        '<button class="btn btn-sm" onclick="event.stopPropagation();cf(\\'Restart?\\',function(){doAct(\\'/api/tasks/'+t.id+'/restart\\')})">Restart</button>'+
        '<button class="btn btn-sm" onclick="event.stopPropagation();cf(\\'Skip?\\',function(){doAct(\\'/api/tasks/'+t.id+'/skip\\')})">Skip</button>'+
      '</div></div>';
  });
  h+='</div>';el.innerHTML=h;
}

/* ── Activity ── */
function renderActivity(el){
  var all=[];S.tasks.forEach(function(t){if(t.updatedAt)all.push({type:'task',id:t.id,msg:t.status+' '+esc(t.title),at:t.updatedAt});});
  all.sort(function(a,b){return b.at-a.at;});
  var h='<div class=panel><div class=panel-title>Recent Activity</div>';
  if(!all.length)h+='<div class=empty>No activity yet</div>';
  else all.slice(0,50).forEach(function(e){h+='<div class=ev><span class=ev-time>'+new Date(e.at).toISOString().slice(11,19)+'</span>['+e.type+'] '+e.msg+'</div>';});
  h+='</div>';el.innerHTML=h;
}

/* ── Import ── */
async function renderImport(el){
  var projects=await api('/api/projects').catch(function(){return{projects:[]};});
  var agents=S.agents;
  var h='<div class=panel><div class=panel-title>Import Tasks</div>'+
    '<div class=form>'+
      '<label>Format <select id=imp-fmt><option value=auto>Auto</option><option value=markdown>Markdown</option><option value=json>JSON</option><option value=csv>CSV</option><option value=plain>Plain</option></select></label>'+
      '<label>Paste tasks <textarea id=imp-text rows=6 placeholder="Paste task descriptions..."></textarea></label>'+
      '<label>Project <select id=imp-proj>'+
        projects.projects.map(function(p){return'<option value="'+p.id+'">'+esc(p.name)+'</option>';}).join('')+
      '</select></label>'+
      '<label>Bucket <input id=imp-bucket></label>'+
      '<label>Agent <select id=imp-agent><option value="">Auto</option>'+
        agents.map(function(a){return'<option value="'+a.id+'">'+esc(a.name||short(a.id))+'</option>';}).join('')+
      '</select></label>'+
      '<label>Implement Model <input id=imp-impl></label>'+
      '<label>Review Model <input id=imp-review></label>'+
      '<label>Max Iterations <input id=imp-maxit type=number value=1 min=1 max=20 style=width:80px></label>'+
      '<label><input type=checkbox id=imp-autoapr> Auto Approve</label>'+
      '<label><input type=checkbox id=imp-autoapl> Auto Apply</label>'+
      '<label>Checks <input id=imp-checks placeholder=typecheck,test></label>'+
      '<div class=btns style=margin-top:6px>'+
        '<button class=btn onclick=doImportPreview()>Preview</button>'+
        '<button class="btn btn-accent" onclick=cf("Import tasks into project?",doImport)>Import</button>'+
      '</div>'+
    '</div>'+
  '</div>';
  h+='<div id=imp-preview></div>';
  el.innerHTML=h;
}

async function doImportPreview(){
  try{
    var fmt=$('imp-fmt').value,text=$('imp-text').value;
    var r=await api('/api/tasks/import-preview',{method:'POST',body:{text:text,format:fmt}});
    S.importPreview=r.preview||r;
    renderImportPreview();
  }catch(e){alert(e.message);}
}

function renderImportPreview(){
  var el=$('imp-preview');if(!el||!S.importPreview)return;
  var p=S.importPreview;
  var h='<div class=panel><div class=panel-title>Preview: '+((p.tasks||[]).length)+' tasks</div>';
  if(p.warnings&&p.warnings.length){p.warnings.forEach(function(w){h+='<div class=wrn>'+esc(w)+'</div>';});}
  if(p.tasks)h+='<div class=c-meta style=margin-bottom:4px>'+p.tasks.length+' tasks found; '+(p.duplicates||0)+' duplicates will be skipped.</div>';
  el.innerHTML=h;
}

async function doImport(){
  try{
    var fmt=$('imp-fmt').value,text=$('imp-text').value;
    var cks=$('imp-checks').value.trim();if(cks)cks=cks.split(/,/).map(function(x){return x.trim();});
    var r=await api('/api/tasks/import',{method:'POST',body:{
      text:text,format:fmt,
      defaults:{
        projectId:$('imp-proj').value,
        bucketId:$('imp-bucket').value||undefined,
        assignedAgentId:$('imp-agent').value||undefined,
        implementModel:$('imp-impl').value||undefined,
        reviewModel:$('imp-review').value||undefined,
        maxIterations:parseInt($('imp-maxit').value)||1,
        autoApprove:$('imp-autoapr').checked,
        autoApply:$('imp-autoapl').checked,
        checks:cks&&cks.length?cks:undefined
      },
      options:{createMissingBuckets:true,skipDuplicates:true}
    }});
    alert('Imported: '+(r.result?r.result.created||r.result.imported||'ok':'ok'));
    await fetchAll(true);
    $('imp-preview').innerHTML='';
  }catch(e){alert(e.message);}
}

/* ── Templates ── */
async function renderTemplates(el){
  var templates=[];
  try{var r=await api('/api/task-flow-templates');templates=r.templates||[];}
  catch(e){el.innerHTML='<div class=error-msg>Templates unavailable: '+esc(e.message)+'</div>';return;}

  if(!templates.length){el.innerHTML='<div class=empty>No templates available</div>';return;}

  var h='<div class=panel><div class=panel-title>Task Flow Templates</div>'+
    '<div class=form>'+
      '<label>Template <select id=tpl-sel>'+
        '<option value="">Select…</option>'+templates.map(function(t){return'<option value="'+t.id+'">'+esc(t.title)+'</option>';}).join('')+
      '</select></label>'+
      '<label>Format <select id=tpl-fmt><option value=markdown>Markdown</option><option value=json>JSON</option><option value=csv>CSV</option><option value=plain>Plain</option></select></label>'+
      '<label>Agent <input id=tpl-agent></label>'+
      '<label>Implement Model <input id=tpl-impl></label>'+
      '<label>Review Model <input id=tpl-review></label>'+
      '<label>Max Iterations <input id=tpl-maxit type=number value=1 min=1 max=20 style=width:80px></label>'+
      '<label><input type=checkbox id=tpl-autoapr> Auto Approve</label>'+
      '<label>Checks <input id=tpl-checks placeholder=typecheck,test></label>'+
      '<div class=btns style=margin-top:6px>'+
        '<button class=btn onclick=doRenderTpl()>Render</button>'+
        '<button class=btn id=tpl-copy-btn onclick=copyTpl() style=display:none>Copy</button>'+
        '<button class=btn id=tpl-dl-btn onclick=downloadTpl() style=display:none>Download</button>'+
      '</div>'+
    '</div>'+
  '</div><pre id=tpl-out class=diff-pre style=display:none></pre>';
  el.innerHTML=h;
}

async function doRenderTpl(){
  try{
    var c=$('tpl-checks').value.trim();if(c)c=c.split(/,/).map(function(x){return x.trim();});
    var r=await api('/api/task-flow-templates/render',{method:'POST',body:{
      templateId:$('tpl-sel').value,
      format:$('tpl-fmt').value,
      options:{
        assignedAgentId:$('tpl-agent').value||undefined,
        implementModel:$('tpl-impl').value||undefined,
        reviewModel:$('tpl-review').value||undefined,
        maxIterations:parseInt($('tpl-maxit').value)||undefined,
        autoApprove:$('tpl-autoapr').checked||undefined,
        checks:c&&c.length?c:undefined
      }
    }});
    S.tplPreview=r.content;S.tplFilename=r.filename;
    var out=$('tpl-out');out.textContent=r.content;out.style.display='block';
    $('tpl-copy-btn').style.display='inline-flex';$('tpl-dl-btn').style.display='inline-flex';
  }catch(e){alert(e.message);}
}
function copyTpl(){if(S.tplPreview){navigator.clipboard.writeText(S.tplPreview).then(function(){alert('Copied!');});}}
function downloadTpl(){if(S.tplPreview){var b=new Blob([S.tplPreview],{type:'text/plain'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=S.tplFilename||'task-flow.md';a.click();}}

/* ── Settings ── */
function renderSettings(el){
  var h='<div class=panel><div class=panel-title>Settings</div>'+
    '<div class=dl-row><span class=dl-label>Organizer URL</span><span class=dl-value>'+esc(location.origin)+'</span></div>'+
    '<div class=dl-row><span class=dl-label>Agents</span><span class=dl-value>'+S.agents.length+' registered, '+(S.status&&S.status.agents&&S.status.agents.online||0)+' online</span></div>'+
    '<div class=dl-row><span class=dl-label>Tasks</span><span class=dl-value>'+S.tasks.length+' total</span></div>'+
    '<div class=dl-row><span class=dl-label>Polling</span><span class=dl-value>Every 3 seconds</span></div>'+
    '<div class=dl-row><span class=dl-label>Dashboard URL</span><span class=dl-value>'+location.href+'</span></div>'+
    '<div class=dl-row><span class=dl-label>Detailed settings</span><span class=dl-value>Not implemented — use smith config or edit config files</span></div>'+
  '</div>';
  el.innerHTML=h;
}

/* ── Agent Chat ── */
async function loadChatSessions(aid){
  try{
    var r=await api('/api/agents/'+aid+'/chats');
    S.chats.sessions=r.sessions||[];
  }catch(e){S.chats.sessions=[];}
  render();
}

async function selectChatSession(sid){
  S.chats.selSession=sid;
  if(!sid){S.chats.messages=[];render();return;}
  try{
    var a=S.agents.find(function(x){return x.id===S.chats.selAgent;});
    if(!a)return;
    var r=await api('/api/agents/'+a.id+'/chats/'+sid);
    S.chats.messages=r.messages||[];
  }catch(e){S.chats.messages=[];showChatError('Could not load messages');}
  render();
}

function showChatError(msg){
  S.chats.messages=[{role:'system',content:'Error: '+msg,ts:Date.now()}];render();
}

async function sendChatMsg(){
  var a=S.agents.find(function(x){return x.id===S.chats.selAgent;});
  if(!a||!S.chats.selSession)return;
  var inp=$('chat-msg');if(!inp)return;
  var prompt=inp.value.trim();if(!prompt)return;
  inp.disabled=true;
  try{
    var body={prompt:prompt};
    var ak=$('chat-action');if(ak&&ak.value)body.actionKind=ak.value;
    var mk=$('chat-model');if(mk&&mk.value)body.model=mk.value;
    await api('/api/agents/'+a.id+'/chats/'+S.chats.selSession,{method:'POST',body:body});
    inp.value='';
    selectChatSession(S.chats.selSession);
  }catch(e){showChatError(e.message);}
  inp.disabled=false;
}

async function createChatSession(){
  try{
    var a=S.agents.find(function(x){return x.id===S.chats.selAgent;});
    if(!a)return;
    var r=await api('/api/agents/'+a.id+'/chats',{method:'POST',body:{}});
    if(r.session)S.chats.selSession=r.session.id;
    await loadChatSessions(a.id);
    if(S.chats.selSession)selectChatSession(S.chats.selSession);
  }catch(e){alert(e.message);}
}

function renderChatDetail(el){
  if(!S.chats.selAgent){el.innerHTML='';return;}
  var a=S.agents.find(function(x){return x.id===S.chats.selAgent;});
  if(!a){el.innerHTML='<div class=empty>Agent not found</div>';return;}

  var sessions=S.chats.sessions||[],hasSessions=sessions.length>0;
  var h='<div class=panel><div class=panel-title>Chat: '+esc(a.name||short(a.id))+'</div>';

  /* Sessions */
  h+='<div class=chat-tb>'+
    '<select id=chat-sessions onchange="selectChatSession(this.value)">'+
      '<option value="">Select session…</option>'+
      sessions.map(function(s){return'<option value="'+s.id+'"'+(S.chats.selSession===s.id?' selected':'')+'>'+esc(s.title||short(s.id))+'</option>';}).join('')+
    '</select>'+
    '<button class="btn btn-sm" onclick=createChatSession()>+ New</button>'+
  '</div>';

  if(S.chats.selSession){
    /* Messages */
    h+='<div class=panel><div style="max-height:300px;overflow-y:auto;padding:4px 0">';
    var msgs=S.chats.messages||[];
    if(!msgs.length)h+='<div class=empty>No messages yet</div>';
    else msgs.forEach(function(m){
      var own=m.role==='user';
      h+='<div class="cmsg'+(own?' user':'')+'"><div class=cmeta>'+esc(m.role||'?')+' · '+(m.ts?new Date(m.ts).toISOString().slice(11,19):'')+'</div><div class=cbub>'+md(m.content||'')+'</div></div>';
    });
    h+='</div></div>';

    /* Input */
    h+='<div class=chat-inp>'+
      '<textarea id=chat-msg placeholder="Type a message…" onkeydown="if(event.key===\\'Enter\\'&&!event.shiftKey){event.preventDefault();sendChatMsg();}" rows=2></textarea>'+
      '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">'+
        '<select id=chat-action style="width:100%;min-height:28px;font-size:9px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px;font-family:var(--font)"><option value="">ask/patch</option><option value=ask>ask</option><option value=patch>patch</option><option value=retrieve>retrieve</option><option value=context>context</option></select>'+
        '<select id=chat-model style="width:100%;min-height:28px;font-size:9px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px;font-family:var(--font)"><option value="">model</option></select>'+
        '<button class="btn btn-accent btn-sm" onclick=sendChatMsg() style=min-height:28px>Send</button>'+
      '</div>'+
    '</div>';
  }else{
    h+='<div class=empty style=margin-top:12px>Select or create a chat session</div>';
  }
  h+='</div>';
  el.innerHTML=h;
}

/* ── Confirm ── */
function cf(msg,cb){S.confirmCb=cb;$('confirm-text').textContent=msg;$('confirm-overlay').style.display='flex';}
function confirmYes(){if(S.confirmCb)try{S.confirmCb();}catch(e){}finally{S.confirmCb=null;$('confirm-overlay').style.display='none';}}
function confirmNo(){S.confirmCb=null;$('confirm-overlay').style.display='none';}

/* ── Init ── */
window.$i=function(id){return document.getElementById(id);};
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('.nav-btn').forEach(function(b){
    b.addEventListener('click',function(){setView(this.dataset.nav);});
  });
  $('refresh-btn').addEventListener('click',function(){this.classList.add('spin');setTimeout(function(){this.classList.remove('spin');}.bind(this),600);fetchAll();});
  document.addEventListener('focusin',function(e){if(e.target.tagName==='TEXTAREA'||(e.target.tagName==='INPUT'&&e.target.type==='text'))textAreaFocused=true;});
  document.addEventListener('focusout',function(e){if(e.target.tagName==='TEXTAREA'||(e.target.tagName==='INPUT'&&e.target.type==='text'))textAreaFocused=false;});
  fetchAll();
  refreshTimer=setInterval(function(){if(!textAreaFocused)fetchAll(true);},3000);
});

/* Global exports */
window.setView=setView;window.selectAgent=selectAgent;window.openAgentTasks=openAgentTasks;
window.openAgentChat=openAgentChat;window.openTask=openTask;window.selectChatSession=selectChatSession;
window.sendChatMsg=sendChatMsg;window.createChatSession=createChatSession;
window.doAct=doAct;window.editTaskPolicy=editTaskPolicy;window.saveEdit=saveEdit;
window.cf=cf;window.confirmYes=confirmYes;window.confirmNo=confirmNo;
window.doImportPreview=doImportPreview;window.doImport=doImport;
window.doRenderTpl=doRenderTpl;window.copyTpl=copyTpl;window.downloadTpl=downloadTpl;
window.filterTasks=filterTasks;window.md=md;
})();
`;
