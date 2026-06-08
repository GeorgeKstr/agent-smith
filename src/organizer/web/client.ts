export const clientJs = `(function(){
var S={
  view:'overview',loading:false,error:null,toast:null,
  status:null,agents:[],projects:[],buckets:[],tasks:[],events:[],
  filters:{projectId:'',bucketId:'',agentId:'',status:'',search:''},
  selAgent:null,selTask:null,timeline:null,
  chat:{agentId:null,sessions:[],sessionId:null,messages:[],questions:[],input:'',actionKind:'ask',model:''},
  imp:{format:'auto',text:'',defaults:{},preview:null,result:null},
  tpl:{templates:[],templateId:'',format:'markdown',options:{},preview:null,filename:''},
  confirmCb:null,taFocused:false
};

/* ── Utilities ── */
function esc(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ago(ts){if(!ts)return'never';var s=Math.round((Date.now()-ts)/1000);if(s<5)return'now';if(s<60)return s+'s';if(s<3600)return Math.round(s/60)+'m';return Math.round(s/3600)+'h';}
function dotC(s){if(s==='offline'||s==='error')return'dot-off';if(s==='busy'||s==='indexing')return'dot-busy';return'dot-on';}
function st(s){return'<span class="tag tag-'+s.replace(/_/g,'-')+'">'+s+'</span>';}
function short(id){return id?String(id).slice(0,10):'?';}
function $1(id){return document.getElementById(id);}

function taskBadges(t){
  var o=[];o.push('<span class=badge>'+t.status.replace(/_/g,' ')+'</span>');
  o.push('<span class=badge>IT'+t.currentIteration+'/'+t.maxIterations+'</span>');
  if(t.autoApprove)o.push('<span class="badge badge-on">AUTO</span>');
  if(t.autoApply)o.push('<span class="badge badge-on">APPLY</span>');
  if(t.currentIteration>=t.maxIterations&&(t.status==='needs_review'||t.status==='iterating'))o.push('<span class="badge badge-warn">MAX</span>');
  return o.join(' ');
}

/* ── Markdown (safe, no backticks) ── */
function md(t){if(!t)return'';
  return esc(t)
    .replace(/\\{3}(\\w*)\\n?([\\s\\S]*?)\\}{3}/g,'<pre class=diff-block>$2</pre>')
    .replace(/\\{([^\\}]+)\\\}/g,'<code style="background:var(--panel2);padding:1px 4px;border-radius:3px;font-size:10px">$1</code>')
    .replace(/^\\* (.+)$/gm,'• $1')
    .replace(/^\\- (.+)$/gm,'\\u2014 $1')
    .replace(/^\\d+\\. (.+)$/gm,'$1')
    .replace(/\\n/g,'<br>');
}

/* ── API wrapper ── */
async function api(path,opt){
  opt=opt||{};var m=opt.method||'GET';
  var body=opt.body;if(body!=null&&typeof body!=='string')body=JSON.stringify(body);
  var res=await fetch(path,{method:m,headers:body!=null?{'Content-Type':'application/json'}:opt.headers||{},body:body});
  var text=await res.text(),data;
  try{data=text?JSON.parse(text):{};}catch(e){data={ok:false,error:text||'Invalid response'};}
  if(!res.ok||data.ok===false){throw new Error(data.error||('HTTP '+res.status));}
  return data;
}

/* ── Toast ── */
function toast(msg,type){
  S.toast={msg:msg,type:type||'info'};var el=$1('toast');if(!el)return;
  el.textContent=msg;el.className='visible'+(type==='error'?' error':'');
  clearTimeout(el._tid);el._tid=setTimeout(function(){el.className='';},3000);
}

/* ── Data loading ── */
async function refreshAll(silent){
  if(!silent){S.loading=true;renderShell();}
  try{
    S.status=(await api('/api/organizer/status').catch(function(){return null;}))||S.status;
    S.agents=(await api('/api/agents').catch(function(){return{agents:[]};})).agents||[];
    S.tasks=(await api('/api/tasks').catch(function(){return{tasks:[]};})).tasks||[];
    S.projects=(await api('/api/projects').catch(function(){return{projects:[]};})).projects||[];
    S.buckets=(await api('/api/buckets').catch(function(){return{buckets:[]};})).buckets||[];
    S.error=null;
  }catch(e){S.error=e.message;}
  S.loading=false;
  if(S.selTask)refreshTimeline();
  render();
}

async function refreshTimeline(){
  if(!S.selTask)return;
  try{S.timeline=(await api('/api/tasks/'+S.selTask+'/timeline')).timeline;}
  catch(e){S.timeline=null;}
}

async function openTaskDetail(tid){
  S.selTask=tid;S.timeline=null;
  try{S.timeline=(await api('/api/tasks/'+tid+'/timeline')).timeline;}
  catch(e){S.timeline=null;toast(e.message,'error');}
  render();
}

/* ── Navigation ── */
function setView(v){
  S.view=v;S.selTask=null;S.timeline=null;S.error=null;
  if(v!=='chat')S.chat={agentId:null,sessions:[],sessionId:null,messages:[],questions:[],input:'',actionKind:'ask',model:''};
  render();
}

function filterTasksBy(filter){S.filters.status=filter;setView('tasks');}

/* ── Shell render ── */
function renderShell(){
  var tb=$1('topbar');
  var online=(S.status&&S.status.agents&&S.status.agents.online)||0;
  var review=(S.status&&S.status.tasks&&S.status.tasks.needs_review)||0;
  var failed=(S.status&&S.status.tasks&&S.status.tasks.failed)||0;
  var run=(S.status&&S.status.tasks&&S.status.tasks.running)||0;

  tb.innerHTML='<span class=tb-title>Agent Smith Organizer</span>'+
    '<span class=tb-stats>'+online+' online \\u00b7 '+run+' run \\u00b7 '+review+' review \\u00b7 '+failed+' failed</span>'+
    '<button class=tb-btn onclick=refreshAll() title=Refresh>\\u21bb</button>';

  /* Sidebar */
  var sb=$1('sidebar');if(!sb)return;
  var items=['Overview','Agents','Tasks','Reviews','Activity','Import','Templates','Chat','Settings'];
  var icons=['\\u25eb','\\u25c9','\\u2261','\\u2713','\\u2630','\\u21e9','\\u2699','\\u2709','\\u229b'];
  sb.innerHTML=items.map(function(v,i){
    var act=S.view===v.toLowerCase()?' active':'';
    return'<button class="nbtn'+act+'" data-nav="'+v.toLowerCase()+'"><span class=ic>'+icons[i]+'</span>'+v+'</button>';
  }).join('');

  /* Bottom nav */
  var bn=$1('bottomnav');
  var main=['Overview','Agents','Tasks','Reviews','More'];
  var mic=['\\u25eb','\\u25c9','\\u2261','\\u2713','\\u2630'];
  bn.innerHTML=main.map(function(v){
    var act=S.view===v.toLowerCase()?' active':'';
    return'<button class="nbtn'+act+'" data-nav="'+v.toLowerCase()+'"><span class=ic>'+mic[main.indexOf(v)]+'</span>'+v+'</button>';
  }).join('');
}

/* ── Main render ── */
function render(){
  renderShell();
  var ct=$1('content'),dt=$1('detail');
  if(!ct)return;

  /* Bind nav buttons */
  document.querySelectorAll('.nbtn[data-nav]').forEach(function(b){
    b.onclick=function(){var n=this.dataset.nav;if(n==='more'){renderMore(ct);return;}setView(n);};
  });

  /* Toast element */
  if(!$1('toast')){var tel=document.createElement('div');tel.id='toast';document.body.appendChild(tel);}

  if(S.loading&&!S.tasks.length){ct.innerHTML='<div class=loading>Loading...</div>';dt&&(dt.innerHTML='');return;}
  if(S.error&&S.view==='overview'){ct.innerHTML='<div class=err-msg>'+esc(S.error)+'</div>';dt&&(dt.innerHTML='');return;}

  /* Render main view */
  if(S.view==='more'){renderMore(ct);dt&&(dt.innerHTML='');return;}
  ct.innerHTML='';
  switch(S.view){
    case 'overview':renderOverview(ct);break;
    case 'agents':renderAgents(ct);break;
    case 'tasks':renderTasks(ct);break;
    case 'reviews':renderReviews(ct);break;
    case 'activity':renderActivity(ct);break;
    case 'import':renderImport(ct);break;
    case 'templates':renderTemplates(ct);break;
    case 'chat':renderChat(ct);break;
    case 'settings':renderSettings(ct);break;
  }

  /* Detail pane for task detail or agent info */
  if(dt){
    if(S.selTask&&(S.view==='tasks'||S.view==='reviews'||S.view==='activity')){
      dt.style.display='block';renderTaskDetailPane(dt);
    }else if(S.selAgent&&S.view==='agents'){dt.style.display='block';renderAgentInfoPane(dt);}
    else{dt.style.display='';dt.innerHTML='';}
  }

  /* Toast visibility */
  if(S.toast){var tel=$1('toast');tel.textContent=S.toast.msg;tel.className='visible'+(S.toast.type==='error'?' error':'');}
}

/* ── More screen (mobile) ── */
function renderMore(el){
  el.innerHTML='<div id=more-screen>'+
    '<div class=mcard onclick=setView("activity")><span class=mic>\\u2630</span><span class=ml>Activity</span><span class=ms>Event log</span></div>'+
    '<div class=mcard onclick=setView("import")><span class=mic>\\u21e9</span><span class=ml>Import Tasks</span><span class=ms>Batch import</span></div>'+
    '<div class=mcard onclick=setView("templates")><span class=mic>\\u2699</span><span class=ml>Templates</span><span class=ms>Task flows</span></div>'+
    '<div class=mcard onclick=setView("chat")><span class=mic>\\u2709</span><span class=ml>Agent Chat</span><span class=ms>Remote chat</span></div>'+
    '<div class=mcard onclick=setView("settings")><span class=mic>\\u229b</span><span class=ml>Settings</span><span class=ms>Config</span></div>'+
  '</div>';
  var dt=$1('detail');if(dt)dt.innerHTML='';
}

/* ── Overview ── */
function renderOverview(el){
  var sc=S.status&&S.status.agents||{},tc=S.status&&S.status.tasks||{};
  var h='<div class=sect><div class=sect-title>Dashboard</div>'+
    '<div class=grid4>'+
      '<div class=scard onclick="setView(\\'agents\\')"><div class=n>'+(sc.online||0)+'/'+S.agents.length+'</div><div class=l>Agents Online</div></div>'+
      '<div class=scard onclick="filterTasksBy(\\'running\\')"><div class=n>'+(tc.running||0)+'</div><div class=l>Running</div></div>'+
      '<div class="scard warn" onclick="setView(\\'reviews\\')"><div class=n>'+(tc.needs_review||0)+'</div><div class=l>Needs Review</div></div>'+
      '<div class="scard danger" onclick="filterTasksBy(\\'failed\\')"><div class=n>'+(tc.failed||0)+'</div><div class=l>Failed</div></div>'+
      '<div class=scard onclick="filterTasksBy(\\'completed\\')"><div class=n>'+(tc.completed||0)+'</div><div class=l>Completed</div></div>'+
      '<div class=scard onclick="filterTasksBy(\\'queued\\')"><div class=n>'+(tc.queued||0)+'</div><div class=l>Queued</div></div>'+
      '<div class=scard onclick="filterTasksBy(\\'assigned\\')"><div class=n>'+(tc.assigned||0)+'</div><div class=l>Assigned</div></div>'+
      '<div class=scard><div class=n>'+(tc.skipped||0)+'</div><div class=l>Skipped</div></div>'+
    '</div></div>';

  /* Model usage */
  var mm={},taskList=S.tasks||[];
  taskList.forEach(function(t){
    if(t.implementModel){mm[t.implementModel]=mm[t.implementModel]||{i:0,r:0};mm[t.implementModel].i++;}
    if(t.reviewModel){mm[t.reviewModel]=mm[t.reviewModel]||{i:0,r:0};mm[t.reviewModel].r++;}
  });
  var mks=Object.keys(mm);if(mks.length){
    mks.sort(function(a,b){return((mm[b].i+mm[b].r)-(mm[a].i+mm[a].r));});
    h+='<div class=sect><div class=sect-title>Model Usage</div><div class=models>';
    mks.slice(0,10).forEach(function(m){
      var u=mm[m];h+='<div class=mchip>'+esc(m.slice(0,30))+' <span class=mn>impl '+u.i+'</span>'+' <span class=mn>rev '+u.r+'</span></div>';
    });
    h+='</div></div>';
  }

  /* Recent tasks */
  var recent=taskList.slice().sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0);}).slice(0,10);
  h+='<div class=sect><div class=sect-title>Recent Tasks</div>';
  if(!recent.length)h+='<div class=empty>No tasks yet</div>';
  else recent.forEach(function(t){
    var a=S.agents.find(function(x){return x.id===t.assignedAgentId;});
    h+='<div class=card onclick="openTaskDetail(\\''+t.id+'\\')"><div class=ctitle>'+esc(t.title)+'</div><div class=cmeta>'+st(t.status)+' '+taskBadges(t)+'</div>'+(a?'<div class=csub>Agent: '+esc(a.name||short(a.id))+'</div>':'')+'</div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

/* ── Agents ── */
function renderAgents(el){
  if(!S.agents.length){el.innerHTML='<div class=empty>No agents registered.<br>Workers auto-register via heartbeat.</div>';return;}
  var h='<div class=sect><div class=sect-title>Agents ('+S.agents.length+')</div>';
  S.agents.forEach(function(a){
    var sel=S.selAgent===a.id?' selected':'';
    var models=[];if(a.models)for(var k in a.models)if(a.models[k])models.push(k+': '+a.models[k]);
    var ix=a.index||{},caps=Array.isArray(a.capabilities)?a.capabilities.length:0;
    var agentTasks=S.tasks.filter(function(t){return t.assignedAgentId===a.id;});
    var taskCounts={total:agentTasks.length,running:0,review:0};
    agentTasks.forEach(function(t){if(t.status==='running'||t.status==='iterating'||t.status==='reviewing')taskCounts.running++;if(t.status==='needs_review'||t.status==='auto_approved')taskCounts.review++;});

    h+='<div class="card'+sel+'" onclick="S.selAgent=arguments[0]?null:\\''+a.id+'\\';openTaskDetail(null);render()">'+
      '<div class=ctitle style=display:flex;align-items:center;gap:6px><span class="dot '+dotC(a.status)+'"></span>'+esc(a.name||short(a.id))+'</div>'+
      '<div class=cmeta>'+esc(a.status)+' \\u00b7 '+esc(a.project_name||a.hostname||'')+' \\u00b7 '+ago(a.last_heartbeat_at)+'</div>'+
      '<div class=csub>'+esc(a.api_base_url||'')+(models.length?' \\u00b7 '+models.length+' models':'')+(caps?' \\u00b7 '+caps+' capabilities':'')+'</div>';
    if(ix&&ix.files)h+='<div class=csub>idx: '+ix.files+'f '+ix.symbols+'s '+(Math.round((ix.freshness||1)*100))+'% fresh '+(ix.dirty?'('+ix.dirty+' dirty)':'')+'</div>';
    if(taskCounts.total)h+='<div class=csub>Tasks: '+taskCounts.total+' total, '+taskCounts.running+' active, '+taskCounts.review+' needs review</div>';
    h+='<div class=btns style=margin-top:4px>'+
      '<button class="btn btn-sm" onclick="event.stopPropagation();S.filters.agentId=\\''+a.id+'\\';setView(\\'tasks\\')">Tasks</button>'+
      '<button class="btn btn-sm" onclick="event.stopPropagation();openAgentChat(\\''+a.id+'\\')">Chat</button>'+
    '</div></div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

/* ── Agent info pane ── */
function renderAgentInfoPane(el){
  if(!S.selAgent){el.innerHTML='';return;}
  var a=S.agents.find(function(x){return x.id===S.selAgent;});
  if(!a){el.innerHTML='';return;}
  var models=[];if(a.models)for(var k in a.models)if(a.models[k])models.push(k+': '+a.models[k]);
  var caps=Array.isArray(a.capabilities)?a.capabilities.join(', '):'';
  var ix=a.index||{};
  el.innerHTML='<div class=sect><div class=sect-title>'+esc(a.name||short(a.id))+'</div>'+
    '<div class=dr><span class=drl>Status</span>'+st(a.status)+'</div>'+
    '<div class=dr><span class=drl>ID</span><span class=drv>'+esc(a.id)+'</span></div>'+
    '<div class=dr><span class=drl>Host</span><span class=drv>'+esc(a.hostname)+'</span></div>'+
    '<div class=dr><span class=drl>Project</span><span class=drv>'+esc(a.project_name)+'</span></div>'+
    '<div class=dr><span class=drl>API</span><span class=drv>'+esc(a.api_base_url||'\\u2014')+'</span></div>'+
    '<div class=dr><span class=drl>Seen</span><span class=drv>'+ago(a.last_heartbeat_at)+'</span></div>'+
    (caps?'<div class=dr><span class=drl>Capabilities</span><span class=drv>'+esc(caps)+'</span></div>':'')+
    (models.length?'<div class=dr><span class=drl>Models</span><span class=drv>'+esc(models.join(', '))+'</span></div>':'')+
    (ix&&ix.files?'<div class=dr><span class=drl>Index</span><span class=drv>'+ix.files+' files, '+ix.symbols+' symbols, '+(Math.round((ix.freshness||1)*100))+'% fresh</span></div>':'')+
  '</div>';
}

/* ── Tasks ── */
function renderTasks(el){
  var filter=S.filters||{};
  var items=S.tasks;
  if(filter.agentId)items=items.filter(function(t){return t.assignedAgentId===filter.agentId;});
  if(filter.status)items=items.filter(function(t){return t.status===filter.status;});
  if(filter.search){var s=filter.search.toLowerCase();items=items.filter(function(t){return t.title&&t.title.toLowerCase().indexOf(s)!==-1;});}

  var h='<div class=sect><div class=sect-title>Tasks ('+items.length+')</div>';

  /* Filters */
  h+='<div class=fbar>'+
    '<input id=filter-search placeholder="Search..." style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-family:var(--font);font-size:10px;min-height:28px;flex:1;min-width:120px" value="'+esc(filter.search||'')+'" oninput="S.filters.search=this.value;render()">'+
    '<select id=filter-agent onchange="S.filters.agentId=this.value;render()" style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px;font-family:var(--font);font-size:10px;min-height:28px"><option value="">All agents</option>'+S.agents.map(function(a){var sel=S.filters.agentId===a.id?' selected':'';return'<option value="'+a.id+'"'+sel+'>'+esc(a.name||short(a.id))+'</option>';}).join('')+'</select>'+
  '</div>';
  h+='<div class=fbar>'+
    '<button class="btn btn-sm" onclick="S.filters.status=\\'\\';render()">All</button>'+
    '<button class="btn btn-sm" onclick="S.filters.status=\\'queued\\';render()">Queued</button>'+
    '<button class="btn btn-sm" onclick="S.filters.status=\\'running\\';render()">Running</button>'+
    '<button class="btn btn-sm" onclick="S.filters.status=\\'needs_review\\';render()">Review</button>'+
    '<button class="btn btn-sm" onclick="S.filters.status=\\'completed\\';render()">Done</button>'+
    '<button class="btn btn-sm" onclick="S.filters.status=\\'failed\\';render()">Failed</button>'+
  '</div>';

  /* New task form toggle */
  h+='<div class=btns>'+
    '<button class="btn btn-accent btn-sm" onclick="var f=$1(\\'new-task-form\\');f.style.display=f.style.display===\\'none\\'?\\'block\\':\\'none\\'">+ New Task</button>'+
    '<button class="btn btn-sm" onclick="setView(\\'import\\')">Import Tasks</button>'+
    '<button class="btn btn-sm" onclick="setView(\\'templates\\')">Templates</button>'+
  '</div>';

  /* New task form */
  h+='<div id=new-task-form style=display:none class=form>'+
    '<label>Title <input id=nt-title></label>'+
    '<label>Prompt <textarea id=nt-prompt rows=3></textarea></label>'+
    '<div class=form-row>'+
      '<div><label>Mode <select id=nt-mode><option value=patch>Patch</option><option value=ask>Ask</option><option value=retrieve>Retrieve</option></select></label></div>'+
      '<div><label>Priority <input id=nt-prio type=number value=5 min=0 max=10></label></div>'+
    '</div>'+
    '<div class=form-row>'+
      '<div><label>Implement Model <input id=nt-impl></label></div>'+
      '<div><label>Review Model <input id=nt-review></label></div>'+
    '</div>'+
    '<div class=form-row>'+
      '<div><label>Max Iterations <input id=nt-maxit type=number value=1 min=1 max=20></label></div>'+
      '<div><label>Agent <select id=nt-agent><option value="">None</option>'+S.agents.map(function(a){return'<option value="'+a.id+'">'+esc(a.name||short(a.id))+'</option>';}).join('')+'</select></label></div>'+
    '</div>'+
    '<label><input type=checkbox id=nt-autoapr> Auto Approve</label>'+
    '<label><input type=checkbox id=nt-autoapl> Auto Apply</label>'+
    '<label>Checks <input id=nt-checks placeholder=typecheck,test></label>'+
    '<div class=btns style=margin-top:6px>'+
      '<button class="btn btn-accent btn-sm" onclick=createNewTask()>Create Task</button>'+
      '<button class="btn btn-sm" onclick="$1(\\'new-task-form\\').style.display=\\'none\\'">Cancel</button>'+
    '</div>'+
  '</div>';

  if(!items.length){h+='<div class=empty>No tasks match the current filters</div>';}
  else{
    var groups={};items.forEach(function(t){groups[t.status]=groups[t.status]||[];groups[t.status].push(t);});
    var order=['running','iterating','reviewing','needs_review','auto_approved','assigned','queued','completed','failed','skipped','cancelled'];
    order.forEach(function(grp){
      var arr=groups[grp];if(!arr||!arr.length)return;
      h+='<div class=gh>'+grp.replace(/_/g,' ')+' ('+arr.length+')</div>';
      arr.forEach(function(t){
        var a=S.agents.find(function(x){return x.id===t.assignedAgentId;});
        h+='<div class="card'+(S.selTask===t.id?' selected':'')+'" onclick="openTaskDetail(\\''+t.id+'\\')">'+
          '<div class=ctitle>'+esc(t.title)+'</div><div class=cmeta>'+st(t.status)+' '+taskBadges(t)+'</div>'+
          (a?'<div class=csub>Agent: '+esc(a.name||short(a.id))+'</div>':'')+
        '</div>';
      });
    });
  }
  h+='</div>';
  el.innerHTML=h;
}

async function createNewTask(){
  try{
    var cks=$1('nt-checks').value.trim();cks=cks?cks.split(/,/).map(function(x){return x.trim();}):undefined;
    var body={title:$1('nt-title').value.trim(),prompt:$1('nt-prompt').value.trim(),
      mode:$1('nt-mode').value,priority:parseInt($1('nt-prio').value)||5,
      maxIterations:parseInt($1('nt-maxit').value)||1,
      autoApprove:$1('nt-autoapr').checked,autoApply:$1('nt-autoapl').checked,
      checks:cks,projectId:S.projects[0]?S.projects[0].id:'default'};
    var r=await api('/api/tasks',{method:'POST',body:body});
    if(r.task){
      var aid=$1('nt-agent').value;if(aid)await api('/api/tasks/'+r.task.id+'/assign',{method:'POST',body:{agentId:aid}});
      toast('Task created','info');$1('new-task-form').style.display='none';refreshAll(true);
    }
  }catch(e){toast(e.message,'error');}
}

/* ── Task detail pane ── */
function renderTaskDetailPane(el){
  if(!S.selTask){el.innerHTML='';return;}
  if(!S.timeline||!S.timeline.task){el.innerHTML='<div class=loading>Loading timeline...</div>';return;}
  var t=S.timeline.task,its=S.timeline.iterations||[],evs=S.timeline.events||[];
  var a=S.agents.find(function(x){return x.id===t.assignedAgentId;});

  /* Actions */
  var h='<div class=tdh>'+
    '<div class=m-back onclick="S.selTask=null;render()">\\u2190 Back to tasks</div>'+
    '<div class=btns>'+
      '<button class="btn btn-accent btn-sm" onclick="doTaskAction(\\'/api/tasks/'+t.id+'/dispatch\\')">\\u25b6 Dispatch</button>'+
      '<button class="btn btn-accent btn-sm" onclick="confirmThen(\\'Approve task: '+esc(t.title).slice(0,40)+'?\\',function(){doTaskAction(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})})">\\u2713 Approve</button>'+
      '<button class="btn btn-sm" onclick="confirmThen(\\'Restart task?\\',function(){doTaskAction(\\'/api/tasks/'+t.id+'/restart\\')})">\\u21ba Restart</button>'+
      '<button class="btn btn-sm" onclick="confirmThen(\\'Skip task?\\',function(){doTaskAction(\\'/api/tasks/'+t.id+'/skip\\')})">\\u23ed Skip</button>'+
    '</div>'+
    (a?'<div class=btns><button class="btn btn-sm" onclick="S.filters.agentId=\\''+a.id+'\\';setView(\\'chat\\');openAgentChat(\\''+a.id+'\\')">\\u2709 Chat with '+esc(a.name||short(a.id))+'</button></div>':'')+
  '</div>';

  /* Info */
  h+='<div class=sect><div class=sect-title>'+esc(t.title)+'</div>'+
    '<div class=dr><span class=drl>Status</span>'+st(t.status)+' '+taskBadges(t)+'</div>'+
    '<div class=dr><span class=drl>Agent</span><span class=drv>'+esc(t.assignedAgentId||'\\u2014')+'</span></div>'+
    '<div class=dr><span class=drl>Model</span><span class=drv>'+(t.implementModel||'?')+' \\u2192 '+(t.reviewModel||'?')+'</span></div>'+
    '<div class=dr><span class=drl>Iteration</span><span class=drv>'+t.currentIteration+'/'+t.maxIterations+'</span></div>'+
  '</div>';

  /* Prompt */
  h+=collap('prompt','Prompt','<div class=drv style=max-height:200px>'+md(t.prompt)+'</div>');

  /* Policy */
  h+='<div class=col-h onclick="var b=$1(\\'sec-policy\\');if(b)b.style.display=b.style.display===\\'none\\'?\\'block\\':\\'none\\'"><span>Policy</span><span>\\u25bc</span></div>';
  h+='<div class=col-b id=sec-policy style=display:none><div class=form>'+
    '<div class=form-row><div><label>Implement Model <input id=ep-impl value="'+esc(t.implementModel||'')+'"></label></div><div><label>Review Model <input id=ep-review value="'+esc(t.reviewModel||'')+'"></label></div></div>'+
    '<div class=form-row><div><label>Max Iterations <input id=ep-max type=number value="'+t.maxIterations+'" min=1 max=20></label></div><div><label>Checks <input id=ep-checks value="'+esc(t.checksJson||'')+'"></label></div></div>'+
    '<label><input type=checkbox id=ep-autoapr '+(t.autoApprove?'checked':'')+'> Auto Approve</label>'+
    '<label><input type=checkbox id=ep-autoapl '+(t.autoApply?'checked':'')+'> Auto Apply</label>'+
    '<button class="btn btn-sm btn-accent" onclick=savePolicy("'+t.id+'")>Save Policy</button>'+
  '</div></div>';

  /* Iterations */
  if(its.length){
    var ih='';
    its.forEach(function(d){
      ih+='<div class=itc><div class=itc-hdr># '+d.iteration.iterationIndex+' '+st(d.iteration.status)+' '+(d.iteration.implementModel?'<span class=badge>'+esc(d.iteration.implementModel)+'</span>':'')+'</div>';
      if(d.implementationSummary)ih+='<div class=itc-sum>'+md(d.implementationSummary)+'</div>';
      if(Array.isArray(d.changedFiles)&&d.changedFiles.length){
        ih+='<div class=itc-files>';d.changedFiles.forEach(function(f){ih+='<span class=itc-file>'+(typeof f==='string'?esc(f):'+'+f.additions+' -'+f.deletions+' '+esc(f.path))+'</span>';});ih+='</div>';
      }
      if(Array.isArray(d.checkResults)&&d.checkResults.length){
        ih+='<div class=itc-checks>';d.checkResults.forEach(function(c){ih+='<span class="itc-ck '+(c.ok?'pass':'fail')+'">'+(c.ok?'\\u2713':'\\u2717')+' '+esc(c.name)+'</span>';});ih+='</div>';
      }
      if(d.diffPreview)ih+='<button class=diff-btn onclick="var t=this.nextElementSibling;t.style.display=t.style.display===\\'none\\'?\\'block\\':\\'none\\'">\\u25b6 Show diff</button><pre class=diff-block style=display:none>'+esc(d.diffPreview)+'</pre>';
      if(d.reviewDecision)ih+='<div class=itc-rev><span class="itc-dec '+d.reviewDecision+'">'+d.reviewDecision+'</span> '+md(d.reviewFeedback||'')+'</div>';
      if(d.reviewNextPrompt)ih+='<div class=itc-next>Next: '+md(d.reviewNextPrompt)+'</div>';
      ih+='</div>';
    });
    h+=collap('iterations','Iterations ('+its.length+')',ih);
  }

  /* Events */
  if(evs.length){
    var eh='';evs.slice(-30).forEach(function(e){eh+='<div class=ev><span class=ev-time>'+new Date(e.createdAt).toISOString().slice(11,19)+'</span>'+esc(e.eventType)+': '+esc(e.message.slice(0,200))+'</div>';});
    h+=collap('events','Events ('+evs.length+')',eh);
  }
  el.innerHTML=h;
}

function collap(id,label,html){
  return'<div class=col-h onclick="var b=$1(\\'sec-'+id+'\\');if(b)b.style.display=b.style.display===\\'none\\'?\\'block\\':\\'none\\'"><span>'+esc(label)+'</span><span>\\u25bc</span></div><div class=col-b id=sec-'+id+'>'+html+'</div>';
}

async function doTaskAction(path,body){
  try{await api(path,{method:'POST',body:body});toast('Action completed','info');refreshAll(true);}
  catch(e){toast(e.message,'error');}
}

async function savePolicy(tid){
  try{
    await api('/api/tasks/'+tid,{method:'PATCH',body:{
      implementModel:$1('ep-impl').value||null,reviewModel:$1('ep-review').value||null,
      maxIterations:parseInt($1('ep-max').value)||1,autoApprove:$1('ep-autoapr').checked,
      autoApply:$1('ep-autoapl').checked,checksJson:$1('ep-checks').value||null
    }});
    toast('Policy saved','info');refreshAll(true);
  }catch(e){toast(e.message,'error');}
}

/* ── Reviews ── */
function renderReviews(el){
  var items=S.tasks.filter(function(t){return t.status==='needs_review'||t.status==='auto_approved';});
  if(!items.length){el.innerHTML='<div class=sect><div class=sect-title>Reviews</div><div class=empty>No tasks need review</div></div>';return;}

  /* Group by review decision */
  var groups={auto:[],maxed:[],pending:[],other:[]};
  items.forEach(function(t){
    if(t.status==='auto_approved')groups.auto.push(t);
    else if(t.currentIteration>=t.maxIterations)groups.maxed.push(t);
    else if(t.status==='needs_review')groups.pending.push(t);
    else groups.other.push(t);
  });

  var h='<div class=sect><div class=sect-title>Reviews ('+items.length+')</div>';
  [{key:'auto',label:'Auto-Approved'},{key:'maxed',label:'Max Iterations Reached'},{key:'pending',label:'Needs Review'},{key:'other',label:'Other'}].forEach(function(g){
    var arr=groups[g.key];if(!arr||!arr.length)return;
    h+='<div class=gh>'+g.label+' ('+arr.length+')</div>';
    arr.forEach(function(t){
      var a=S.agents.find(function(x){return x.id===t.assignedAgentId;});
      h+='<div class=card onclick="openTaskDetail(\\''+t.id+'\\')">'+
        '<div class=ctitle>'+esc(t.title)+'</div><div class=cmeta>'+taskBadges(t)+'</div>'+
        (a?'<div class=csub>Agent: '+esc(a.name||short(a.id))+'</div>':'')+
        '<div class=btns style=margin-top:4px>'+
          '<button class="btn btn-accent btn-sm" onclick="event.stopPropagation();confirmThen(\\'Approve task?\\',function(){doTaskAction(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})})">Approve</button>'+
          '<button class="btn btn-sm" onclick="event.stopPropagation();confirmThen(\\'Restart?\\',function(){doTaskAction(\\'/api/tasks/'+t.id+'/restart\\')})">Restart</button>'+
          '<button class="btn btn-sm" onclick="event.stopPropagation();confirmThen(\\'Skip?\\',function(){doTaskAction(\\'/api/tasks/'+t.id+'/skip\\')})">Skip</button>'+
        '</div></div>';
    });
  });
  h+='</div>';
  el.innerHTML=h;
}

/* ── Activity ── */
function renderActivity(el){
  var all=[];S.tasks.forEach(function(t){if(t.updatedAt)all.push({type:'task',id:t.id,msg:st(t.status)+' '+esc(t.title),at:t.updatedAt,status:t.status});});
  all.sort(function(a,b){return b.at-a.at;});
  var h='<div class=sect><div class=sect-title>Activity ('+all.length+')</div>';
  if(!all.length)h+='<div class=empty>No activity yet</div>';
  else h+='<div class=fbar><button class="btn btn-sm" onclick="renderActivity($1(\\'content\\'))">All</button><button class="btn btn-sm" onclick="S._actFilter=\\'needs_review\\';renderActivity($1(\\'content\\'))">Reviews</button><button class="btn btn-sm" onclick="S._actFilter=\\'failed\\';renderActivity($1(\\'content\\'))">Errors</button></div>';
  var filter=S._actFilter||'all';
  all=all.filter(function(e){return filter==='all'||e.status===filter;});
  all.slice(0,50).forEach(function(e){
    h+='<div class="card ev" onclick="openTaskDetail(\\''+e.id+'\\')"><span class=ev-time>'+new Date(e.at).toISOString().slice(11,19)+'</span>'+e.msg+'</div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

/* ── Import ── */
async function renderImport(el){
  var projects=S.projects||[];
  var h='<div class=sect><div class=sect-title>Import Tasks</div>'+
    '<div class=form>'+
      '<label>Format <select id=imp-fmt><option value=auto>Auto</option><option value=markdown>Markdown</option><option value=json>JSON</option><option value=csv>CSV</option><option value=plain>Plain</option></select></label>'+
      '<label>Paste tasks <textarea id=imp-text rows=6 placeholder="Paste task descriptions..."></textarea></label>'+
      '<label>Project <select id=imp-proj>'+projects.map(function(p){return'<option value="'+p.id+'">'+esc(p.name)+'</option>';}).join('')+'</select></label>'+
      '<label>Bucket <input id=imp-bucket></label>'+
      '<label>Agent <select id=imp-agent><option value="">Auto</option>'+S.agents.map(function(a){return'<option value="'+a.id+'">'+esc(a.name||short(a.id))+'</option>';}).join('')+'</select></label>'+
      '<label>Implement Model <input id=imp-impl></label>'+
      '<label>Review Model <input id=imp-review></label>'+
      '<label>Max Iterations <input id=imp-maxit type=number value=1 min=1 max=20 style=width:80px></label>'+
      '<label><input type=checkbox id=imp-autoapr> Auto Approve</label>'+
      '<label><input type=checkbox id=imp-autoapl> Auto Apply</label>'+
      '<label>Checks <input id=imp-checks placeholder=typecheck,test></label>'+
      '<div class=btns style=margin-top:6px>'+
        '<button class=btn onclick=doImportPreview()>Preview</button>'+
        '<button class="btn btn-accent" onclick=confirmThen("Import tasks?",doImport)>Import</button>'+
        '<button class=btn onclick="$1(\\'imp-text\\').value=\\'\\'">Clear</button>'+
      '</div>'+
    '</div>'+
  '</div><div id=imp-preview></div>';
  el.innerHTML=h;
}

async function doImportPreview(){
  try{
    var fmt=$1('imp-fmt').value,text=$1('imp-text').value;
    S.imp.preview=(await api('/api/tasks/import-preview',{method:'POST',body:{text:text,format:fmt}})).preview;
    renderImportPreview();
  }catch(e){toast(e.message,'error');}
}

function renderImportPreview(){
  var el=$1('imp-preview');if(!el||!S.imp.preview)return;
  var p=S.imp.preview;
  var h='<div class=sect><div class=sect-title>Preview: '+((p.tasks||[]).length)+' tasks</div>';
  if(p.warnings&&p.warnings.length)p.warnings.forEach(function(w){h+='<div class=warn-msg>'+esc(w)+'</div>';});
  if(p.tasks)h+='<div class=cmeta style=margin-bottom:4px>'+p.tasks.length+' tasks, '+(p.duplicates||0)+' duplicates</div>';
  el.innerHTML=h;
}

async function doImport(){
  try{
    var fmt=$1('imp-fmt').value,text=$1('imp-text').value;
    var cks=$1('imp-checks').value.trim();if(cks)cks=cks.split(/,/).map(function(x){return x.trim();});
    var r=await api('/api/tasks/import',{method:'POST',body:{
      text:text,format:fmt,defaults:{
        projectId:$1('imp-proj').value,bucketId:$1('imp-bucket').value||undefined,
        assignedAgentId:$1('imp-agent').value||undefined,
        implementModel:$1('imp-impl').value||undefined,reviewModel:$1('imp-review').value||undefined,
        maxIterations:parseInt($1('imp-maxit').value)||1,
        autoApprove:$1('imp-autoapr').checked,autoApply:$1('imp-autoapl').checked,
        checks:cks&&cks.length?cks:undefined
      },options:{createMissingBuckets:true,skipDuplicates:true}
    }});
    toast('Import done','info');$1('imp-text').value='';$1('imp-preview').innerHTML='';
    refreshAll(true);
  }catch(e){toast(e.message,'error');}
}

/* ── Templates ── */
async function renderTemplates(el){
  var templates=[];
  try{templates=(await api('/api/task-flow-templates')).templates||[];}
  catch(e){el.innerHTML='<div class=err-msg>Templates unavailable: '+esc(e.message)+'</div>';return;}

  if(!templates.length){el.innerHTML='<div class=empty>No templates available</div>';return;}

  var h='<div class=sect><div class=sect-title>Templates</div>'+
    '<div class=form>'+
      '<label>Template <select id=tpl-sel>'+templates.map(function(t){return'<option value="'+t.id+'">'+esc(t.title)+'</option>';}).join('')+'</select></label>'+
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
        '<button class=btn id=tpl-use-btn onclick=useTplInImport() style=display:none>Use in Import</button>'+
      '</div>'+
    '</div>'+
  '</div><pre id=tpl-out class=diff-block style=display:none></pre>';
  el.innerHTML=h;
}

async function doRenderTpl(){
  try{
    var c=$1('tpl-checks').value.trim();if(c)c=c.split(/,/).map(function(x){return x.trim();});
    var r=await api('/api/task-flow-templates/render',{method:'POST',body:{
      templateId:$1('tpl-sel').value,format:$1('tpl-fmt').value,
      options:{assignedAgentId:$1('tpl-agent').value||undefined,implementModel:$1('tpl-impl').value||undefined,reviewModel:$1('tpl-review').value||undefined,maxIterations:parseInt($1('tpl-maxit').value)||undefined,autoApprove:$1('tpl-autoapr').checked||undefined,checks:c&&c.length?c:undefined}
    }});
    S.tpl.preview=r.content;S.tpl.filename=r.filename;S.tpl.format=r.format||$1('tpl-fmt').value;
    var out=$1('tpl-out');out.textContent=r.content;out.style.display='block';
    $1('tpl-copy-btn').style.display='inline-flex';$1('tpl-dl-btn').style.display='inline-flex';$1('tpl-use-btn').style.display='inline-flex';
  }catch(e){toast(e.message,'error');}
}
function copyTpl(){navigator.clipboard.writeText(S.tpl.preview).then(function(){toast('Copied','info');});}
function downloadTpl(){var b=new Blob([S.tpl.preview],{type:'text/plain'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=S.tpl.filename||'task-flow.md';a.click();}
function useTplInImport(){setView('import');setTimeout(function(){$1('imp-text').value=S.tpl.preview;$1('imp-fmt').value=S.tpl.format||'markdown';},100);}

/* ── Settings ── */
function renderSettings(el){
  el.innerHTML='<div class=sect><div class=sect-title>Settings</div>'+
    '<div class=dr><span class=drl>Organizer URL</span><span class=drv><button class="btn btn-sm" onclick="navigator.clipboard.writeText(location.href).then(function(){toast(\\'Copied\\',\\'info\\')})">Copy</button> '+esc(location.origin)+'</span></div>'+
    '<div class=dr><span class=drl>Dashboard URL</span><span class=drv>'+esc(location.href)+'</span></div>'+
    '<div class=dr><span class=drl>Agents</span><span class=drv>'+S.agents.length+' registered, '+(S.status&&S.status.agents&&S.status.agents.online||0)+' online</span></div>'+
    '<div class=dr><span class=drl>Tasks</span><span class=drv>'+S.tasks.length+' total</span></div>'+
    '<div class=dr><span class=drl>Polling</span><span class=drv>Every 3 seconds</span></div>'+
    '<div class=dr><span class=drl>Detailed settings</span><span class=drv>Use smith config or edit config files</span></div>'+
  '</div>';
}

/* ── Chat ── */
function openAgentChat(aid){
  S.view='chat';S.chat.agentId=aid;S.chat.sessions=[];S.chat.sessionId=null;S.chat.messages=[];S.chat.questions=[];
  render();loadChatSessions(aid);
}

async function loadChatSessions(aid){
  try{S.chat.sessions=(await api('/api/agents/'+aid+'/chats')).sessions||[];}
  catch(e){S.chat.sessions=[];}
  render();
}

function renderChat(el){
  var a=S.agents.find(function(x){return x.id===S.chat.agentId;});
  if(!S.chat.agentId||!a){el.innerHTML='<div class=sect><div class=sect-title>Agent Chat</div><div class=empty>Select an agent from the Agents view, or pick below:</div><select onchange="if(this.value)openAgentChat(this.value)" style="background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:8px;font-family:var(--font);font-size:10px;width:100%;margin-top:8px"><option value="">Choose agent...</option>'+S.agents.map(function(ag){return'<option value="'+ag.id+'">'+esc(ag.name||short(ag.id))+' ('+esc(ag.status)+')</option>';}).join('')+'</select></div>';return;}

  var sessions=S.chat.sessions||[];
  var h='<div class=sect><div class=sect-title>Chat: '+esc(a.name||short(a.id))+'</div>';

  /* Agent selector + session selector */
  h+='<div class=chat-tb>'+
    '<select onchange="if(this.value)openAgentChat(this.value)" style="max-width:160px"><option value="">'+esc(a.name||short(a.id))+'</option>'+S.agents.filter(function(x){return x.id!==S.chat.agentId;}).map(function(ag){return'<option value="'+ag.id+'">'+esc(ag.name||short(ag.id))+'</option>';}).join('')+'</select>'+
    '<select id=chat-sessions onchange="selectChatSession(this.value)"><option value="">Select session...</option>'+sessions.map(function(s){return'<option value="'+s.id+'"'+(S.chat.sessionId===s.id?' selected':'')+'>'+esc(s.title||short(s.id))+'</option>';}).join('')+'</select>'+
    '<button class="btn btn-sm" onclick=createChatSession()>+ New</button>'+
  '</div>';

  if(S.chat.sessionId){
    /* Messages */
    h+='<div class=chat-msgs>';
    var msgs=S.chat.messages||[];
    if(!msgs.length)h+='<div class=empty>No messages yet</div>';
    else msgs.forEach(function(m){
      var own=m.role==='user';
      h+='<div class="cmsg'+(own?' user':'')+'"><div class=cmeta>'+esc(m.role||'?')+' \\u00b7 '+(m.ts?new Date(m.ts).toISOString().slice(11,19):'')+'</div><div class=cbub>'+md(m.content||'')+'</div></div>';
    });
    h+='</div>';

    /* Models for dropdown */
    var modelOpts='';if(a.models)for(var k in a.models)if(a.models[k])modelOpts+='<option value="'+esc(a.models[k])+'">'+esc(k)+': '+esc(a.models[k].slice(0,20))+'</option>';

    /* Input */
    h+='<div class=chat-inp>'+
      '<textarea id=chat-msg placeholder="Type a message..." onkeydown="if(event.key===\\'Enter\\'&&!event.shiftKey){event.preventDefault();sendChatMsg()}" rows=2>'+esc(S.chat.input)+'</textarea>'+
      '<div class=chat-row>'+
        '<select id=chat-action><option value=ask>ask</option><option value=patch>patch</option><option value=retrieve>retrieve</option><option value=context>context</option></select>'+
        '<select id=chat-model><option value="">model</option>'+modelOpts+'</select>'+
        '<button class="btn btn-accent btn-sm" onclick=sendChatMsg()>Send</button>'+
      '</div>'+
    '</div>';
  }else{
    h+='<div class=empty style=margin-top:12px>Select or create a chat session</div>';
  }
  h+='</div>';
  el.innerHTML=h;
}

async function selectChatSession(sid){
  S.chat.sessionId=sid;
  if(!sid){S.chat.messages=[];render();return;}
  try{
    var a=S.agents.find(function(x){return x.id===S.chat.agentId;});
    if(!a)return;
    S.chat.messages=(await api('/api/agents/'+a.id+'/chats/'+sid)).messages||[];
  }catch(e){S.chat.messages=[];toast('Could not load messages: '+e.message,'error');}
  render();
}

async function createChatSession(){
  try{
    var a=S.agents.find(function(x){return x.id===S.chat.agentId;});
    if(!a)return;
    var r=await api('/api/agents/'+a.id+'/chats',{method:'POST',body:{}});
    if(r.session)S.chat.sessionId=r.session.id;
    await loadChatSessions(a.id);
    if(S.chat.sessionId)selectChatSession(S.chat.sessionId);
  }catch(e){toast(e.message,'error');}
}

async function sendChatMsg(){
  var a=S.agents.find(function(x){return x.id===S.chat.agentId;});
  if(!a||!S.chat.sessionId)return;
  var inp=$1('chat-msg');if(!inp)return;
  var prompt=inp.value.trim();if(!prompt)return;
  inp.disabled=true;
  try{
    var body={prompt:prompt};
    var ak=$1('chat-action');if(ak&&ak.value)body.actionKind=ak.value;
    var mk=$1('chat-model');if(mk&&mk.value)body.model=mk.value;
    await api('/api/agents/'+a.id+'/chats/'+S.chat.sessionId,{method:'POST',body:body});
    inp.value='';S.chat.input='';
    selectChatSession(S.chat.sessionId);
  }catch(e){toast(e.message,'error');}
  inp.disabled=false;
}

/* ── Confirm ── */
function confirmThen(msg,cb){
  S.confirmCb=cb;var el=$1('modal-root');
  el.innerHTML='<div class=modal onclick="if(event.target===this)closeConfirm()"><div class="modal-box warn"><p>'+esc(msg)+'</p><div class=btns><button class="btn btn-danger" onclick=runConfirm()>Confirm</button><button class=btn onclick=closeConfirm()>Cancel</button></div></div></div>';
}
function runConfirm(){if(S.confirmCb)try{S.confirmCb();S.confirmCb();}catch(e){toast(e.message,'error');}S.confirmCb=null;$1('modal-root').innerHTML='';}
function closeConfirm(){S.confirmCb=null;$1('modal-root').innerHTML='';}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded',function(){
  $1('refresh-btn')&&$1('refresh-btn').addEventListener('click',function(){this.classList.add('spin');setTimeout(function(){this.classList.remove('spin');}.bind(this),600);refreshAll();});
  document.addEventListener('focusin',function(e){if(e.target.tagName==='TEXTAREA'||(e.target.tagName==='INPUT'&&e.target.type==='text'))S.taFocused=true;});
  document.addEventListener('focusout',function(e){if(e.target.tagName==='TEXTAREA'||(e.target.tagName==='INPUT'&&e.target.type==='text'))S.taFocused=false;});
  refreshAll();
  setInterval(function(){if(!S.taFocused)refreshAll(true);},3000);
});

/* ── Exports ── */
window.$1=$1;window.setView=setView;window.filterTasksBy=filterTasksBy;
window.openTaskDetail=openTaskDetail;window.openAgentChat=openAgentChat;
window.selectChatSession=selectChatSession;window.createChatSession=createChatSession;
window.sendChatMsg=sendChatMsg;window.doTaskAction=doTaskAction;window.savePolicy=savePolicy;
window.createNewTask=createNewTask;window.doImportPreview=doImportPreview;window.doImport=doImport;
window.doRenderTpl=doRenderTpl;window.copyTpl=copyTpl;window.downloadTpl=downloadTpl;
window.useTplInImport=useTplInImport;window.confirmThen=confirmThen;window.runConfirm=runConfirm;
window.closeConfirm=closeConfirm;window.render=render;window.refreshAll=refreshAll;
})();
`
