export const clientJs = `(function(){
'use strict';

/* ════════════════════════════════════════════
   STATE
════════════════════════════════════════════ */
var S = {
  agents:[], tasks:[], projects:[], status:null,
  agentId:null, tab:'tasks',
  chat:{sessions:[], sid:null, msgs:[], qtns:[], sending:false},
  exp:{},       // {taskId: true}  — expanded task cards
  tl:{},        // {taskId: obj}   — cached timelines; undefined=not loaded, null=failed
  tlQ:{},       // {taskId: true}  — loading in-flight
  ingestOpen:false,
  newOpen:false,
  filter:{q:'', status:''},
  ing:{format:'auto', text:'', implModel:'', revModel:'', maxIter:3, autoapr:false, autoapl:false, preview:null},
  typing:false,
  confirmCb:null
};

/* ════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════ */
function esc(s){
  if(s===null||s===undefined)return'';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function ago(ts){
  if(!ts)return'?';
  var s=Math.round((Date.now()-ts)/1000);
  if(s<5)return'now';if(s<60)return s+'s';if(s<3600)return Math.round(s/60)+'m';
  return Math.round(s/3600)+'h';
}
function dotC(s){
  if(s==='offline'||s==='error')return'dot-off';
  if(s==='busy'||s==='indexing')return'dot-busy';
  return'dot-on';
}
function stag(s){
  return'<span class="stag stag-'+s.replace(/_/g,'-')+'">'+s.replace(/_/g,' ')+'</span>';
}
function ibadge(t){
  var b='<span class=badge>'+t.currentIteration+'/'+t.maxIterations+'</span>';
  if(t.autoApprove)b+='<span class="badge badge-auto">AUTO</span>';
  if(t.autoApply)b+='<span class="badge badge-apply">APPLY</span>';
  if(t.currentIteration>=t.maxIterations&&(t.status==='needs_review'||t.status==='iterating'))b+='<span class="badge badge-max">MAX</span>';
  return b;
}
function md(s){
  if(!s)return'';
  return esc(s)
    .replace(/\\*\\*([^*\\n]{1,120})\\*\\*/g,'<b>$1</b>')
    .replace(/\\*([^*\\n]{1,80})\\*/g,'<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm,'<strong>$1</strong>')
    .replace(/^[-\\*] (.+)$/gm,'\\u2022 $1')
    .replace(/\\n/g,'<br>');
}
function $e(id){return document.getElementById(id);}
function short(id){return id?String(id).slice(0,10):'?';}

/* ════════════════════════════════════════════
   API
════════════════════════════════════════════ */
async function api(path,opt){
  opt=opt||{};
  var body=opt.body;
  if(body!=null&&typeof body!=='string')body=JSON.stringify(body);
  var res=await fetch(path,{method:opt.method||'GET',headers:body!=null?{'Content-Type':'application/json'}:{},body:body||undefined});
  var text=await res.text(),data;
  try{data=text?JSON.parse(text):{};}catch(e){data={ok:false,error:text||'Bad response'};}
  if(!res.ok||data.ok===false)throw new Error(data.error||'HTTP '+res.status);
  return data;
}

/* ════════════════════════════════════════════
   TOAST / CONFIRM
════════════════════════════════════════════ */
function toast(msg,isErr){
  var el=$e('toast');if(!el)return;
  clearTimeout(el._t);
  el.textContent=msg;el.className='toast show'+(isErr?' err':'');
  el._t=setTimeout(function(){el.className='toast';},3000);
}
function ask(msg,cb){
  S.confirmCb=cb;
  var el=$e('modal-root');if(!el)return;
  el.innerHTML='<div class=modal onclick="if(event.target===this)noConfirm()">'
    +'<div class=modal-box><p class=modal-msg>'+esc(msg)+'</p>'
    +'<div class=modal-btns>'
    +'<button class="btn btn-danger" onclick=yesConfirm()>Confirm</button>'
    +'<button class=btn onclick=noConfirm()>Cancel</button>'
    +'</div></div></div>';
}
function yesConfirm(){var c=S.confirmCb;S.confirmCb=null;if($e('modal-root'))$e('modal-root').innerHTML='';if(c)c();}
function noConfirm(){S.confirmCb=null;if($e('modal-root'))$e('modal-root').innerHTML='';}

/* ════════════════════════════════════════════
   DATA LOADING
════════════════════════════════════════════ */
async function refresh(silent){
  try{
    S.status=(await api('/api/organizer/status').catch(function(){return null;}))||S.status;
    S.agents=(await api('/api/agents').catch(function(){return{agents:[]};})).agents||[];
    S.tasks=(await api('/api/tasks').catch(function(){return{tasks:[]};})).tasks||[];
    S.projects=(await api('/api/projects').catch(function(){return{projects:[]};})).projects||[];
  }catch(e){}
  if(silent)renderShell();else render();
}

async function loadTimeline(id){
  if(S.tlQ[id])return;
  S.tlQ[id]=true;
  try{S.tl[id]=(await api('/api/tasks/'+id+'/timeline')).timeline||null;}
  catch(e){S.tl[id]=null;}
  delete S.tlQ[id];
  renderTasksPanelOnly();
}

async function loadChatSessions(aid){
  try{S.chat.sessions=(await api('/api/agents/'+aid+'/chats')).sessions||[];}
  catch(e){S.chat.sessions=[];}
  renderMainPanelOnly();
}

async function loadMessages(sid){
  var aid=S.agentId;if(!aid||!sid)return;
  try{
    var r=await api('/api/agents/'+aid+'/chats/'+sid);
    S.chat.msgs=r.messages||[];S.chat.qtns=r.openQuestions||[];
  }catch(e){S.chat.msgs=[];S.chat.qtns=[];}
  renderMainPanelOnly();
}

async function ensureProject(){
  if(S.projects&&S.projects.length>0)return S.projects[0].id;
  try{
    var r=await api('/api/projects',{method:'POST',body:{name:'Default'}});
    if(r.project){S.projects.push(r.project);return r.project.id;}
  }catch(e){}
  return'default';
}

/* ════════════════════════════════════════════
   SHELL RENDER
════════════════════════════════════════════ */
function renderShell(){
  var tb=$e('topbar');if(!tb)return;
  var sc=(S.status&&S.status.agents)||{};
  var tc=(S.status&&S.status.tasks)||{};
  var online=sc.online||0,run=tc.running||0,rev=tc.needs_review||0,fail=tc.failed||0;
  tb.innerHTML=
    '<div class=tb-left style="display:flex;align-items:center;gap:8px;overflow:hidden;flex:1">'
    +'<span class=tb-title>Agent Smith</span>'
    +'<span class=tb-stat>'+S.agents.length+' agents</span>'
    +(online?'<span class="tb-stat dot-on">'+online+' online</span>':'')
    +(run?'<span class="tb-stat run">'+run+' running</span>':'')
    +(rev?'<span class="tb-stat rev">'+rev+' review</span>':'')
    +(fail?'<span class="tb-stat fail">'+fail+' failed</span>':'')
    +'</div>'
    +'<button class=tb-refresh id=refresh-btn onclick=doRefresh() title=Refresh>&#8635;</button>';
}

function render(){
  renderShell();
  renderAgentPanel();
  renderMainPanelOnly();
}

/* ════════════════════════════════════════════
   AGENT PANEL
════════════════════════════════════════════ */
function renderAgentPanel(){
  var el=$e('agent-panel');if(!el)return;
  var h='<div class=ap-header><span class=ap-title>Agents</span><span class=ap-count>'+S.agents.length+'</span></div>';
  if(!S.agents.length){h+='<div class=ap-empty>No agents connected.<br>Workers register via heartbeat.</div>';el.innerHTML=h;return;}
  S.agents.forEach(function(a){
    var sel=S.agentId===a.id?' selected':'';
    var tasks=S.tasks.filter(function(t){return t.assignedAgentId===a.id;});
    var active=tasks.filter(function(t){return t.status==='running'||t.status==='iterating'||t.status==='reviewing';}).length;
    var review=tasks.filter(function(t){return t.status==='needs_review'||t.status==='auto_approved';}).length;
    var ix=a.index||{};
    h+='<div class="agent-item'+sel+'" onclick="selectAgent(\\''+a.id+'\\')">'+
      '<div class=ai-row1><span class="dot '+dotC(a.status)+'"></span><span class=ai-name>'+esc(a.name||short(a.id))+'</span></div>'+
      '<div class=ai-row2>'+esc(a.project_name||a.hostname||'\\u2014')+'</div>'+
      (tasks.length?'<div class=ai-row3>'+(active?'<span class=at-active>'+active+' active</span> ':'')+(review?'<span class=at-review>'+review+' review</span> ':'')+tasks.length+' tasks</div>':'')+
      '<div class=ai-row4>'+ago(a.last_heartbeat_at)+' ago'+(ix.files?' \\u00b7 '+ix.files+'f ':'')+' \\u00b7 '+esc(a.status)+'</div>'+
    '</div>';
  });
  el.innerHTML=h;
}

/* ════════════════════════════════════════════
   MAIN PANEL
════════════════════════════════════════════ */
function renderMainPanelOnly(){
  var el=$e('main-panel');if(!el)return;
  if(!S.agentId){
    el.innerHTML='<div class=no-agent-msg><div class=na-inner>'
      +'<div class=na-icon>&#9679;</div>'
      +'<div class=na-title>Agent Smith Organizer</div>'
      +'<div class=na-sub>Select an agent from the left panel to manage their tasks and chat</div>'
      +(S.agents.length===0?'<div class=na-empty>No agents connected. Workers register via heartbeat.</div>':'')
      +'</div></div>';
    return;
  }
  var a=S.agents.find(function(x){return x.id===S.agentId;});
  if(!a){el.innerHTML='<div class=no-agent-msg><div class=na-sub>Agent not found or went offline</div></div>';return;}
  var tasks=S.tasks.filter(function(t){return t.assignedAgentId===a.id;});
  var reviewCt=tasks.filter(function(t){return t.status==='needs_review'||t.status==='auto_approved';}).length;

  var h='<div class=tab-bar>'
    +'<button class=m-back-btn onclick=backToAgents()>&#9664; Agents</button>'
    +'<button class="tab-btn'+(S.tab==='tasks'?' active':'')+'" onclick="setTab(\\'tasks\\')">Tasks ('+tasks.length+')'+(reviewCt?'<span class=tab-badge>'+reviewCt+'</span>':'')+'</button>'
    +'<button class="tab-btn'+(S.tab==='chat'?' active':'')+'" onclick="setTab(\\'chat\\')">Chat</button>'
    +'<div class=tab-agent-name><span class="dot '+dotC(a.status)+'"></span> '+esc(a.name||short(a.id))+' <span class=tab-agent-sub>'+esc(a.project_name||'')+'</span></div>'
    +'</div>';
  h+='<div class=tab-content id=tab-content></div>';
  el.innerHTML=h;

  var tc=$e('tab-content');if(!tc)return;
  if(S.tab==='tasks')renderTasksTab(tc,a);
  else renderChatTab(tc,a);
}

/* ════════════════════════════════════════════
   TASKS TAB
════════════════════════════════════════════ */
function renderTasksTab(el,a){
  var allTasks=S.tasks.filter(function(t){return t.assignedAgentId===a.id;});
  var tasks=allTasks;
  if(S.filter.status)tasks=tasks.filter(function(t){return t.status===S.filter.status;});
  if(S.filter.q){var q=S.filter.q.toLowerCase();tasks=tasks.filter(function(t){return t.title&&t.title.toLowerCase().indexOf(q)!==-1;});}

  var h='';

  /* Action bar */
  h+='<div class=action-bar>'
    +'<button class="btn btn-accent btn-sm" onclick=doDispatchNext()>&#9654; Dispatch Next</button>'
    +'<button class="btn btn-sm'+(S.ingestOpen?' active':'')+'" onclick=toggleIngest()>&#8659; Ingest Flow</button>'
    +'<button class="btn btn-sm'+(S.newOpen?' active':'')+'" onclick=toggleNew()>+ New Task</button>'
    +'</div>';

  /* Ingest panel */
  if(S.ingestOpen)h+=renderIngestPanel(a);
  /* New task panel */
  if(S.newOpen)h+=renderNewPanel(a);

  /* Filters */
  h+='<div class=filter-bar>'
    +'<input id=fq class=filter-input placeholder="Search tasks..." value="'+esc(S.filter.q||'')+'" oninput="S.filter.q=this.value;refreshTasks()">'
    +'<select id=fs class=filter-sel onchange="S.filter.status=this.value;refreshTasks()">'
    +'<option value="">All</option>'
    +['queued','assigned','running','reviewing','iterating','needs_review','auto_approved','completed','failed','skipped'].map(function(s){
      return'<option value="'+s+'"'+(S.filter.status===s?' selected':'')+'>'+s.replace(/_/g,' ')+'</option>';
    }).join('')
    +'</select>'
    +'</div>';

  /* Task list */
  if(!tasks.length){
    h+='<div class=empty>'+(allTasks.length?'No tasks match filters.':'No tasks assigned. Use &#8659; Ingest Flow to add tasks.')+'</div>';
  }else{
    var groups={},order=['running','reviewing','iterating','needs_review','auto_approved','assigned','queued','completed','failed','skipped','cancelled'];
    tasks.forEach(function(t){groups[t.status]=groups[t.status]||[];groups[t.status].push(t);});
    order.forEach(function(grp){
      var arr=groups[grp];if(!arr||!arr.length)return;
      h+='<div class=task-group>'
        +'<div class=group-hdr>'+grp.replace(/_/g,' ')+' <span class=gh-ct>'+arr.length+'</span></div>';
      arr.forEach(function(t){h+=renderTaskCard(t);});
      h+='</div>';
    });
  }
  el.innerHTML=h;
}

function renderTaskCard(t){
  var exp=!!S.exp[t.id];
  var h='<div class="tcard'+(exp?' exp':'')+'" id="tc-'+t.id+'">';

  /* Header row — click to expand */
  h+='<div class=tc-head onclick="toggleExpand(\\''+t.id+'\\')">'+
    stag(t.status)+ibadge(t)+
    '<span class=tc-title>'+esc(t.title)+'</span>'+
    '<span class=tc-chevron>'+(exp?'&#9650;':'&#9660;')+'</span>'+
    '</div>';

  /* Quick action row */
  h+='<div class=tc-actions>'+
    '<button class="btn btn-sm btn-accent" onclick="event.stopPropagation();doDispatch(\\''+t.id+'\\')">&#9654; Dispatch</button>'+
    (t.status==='needs_review'?'<button class="btn btn-sm btn-accept" onclick="event.stopPropagation();ask(\\'Approve this task?\\',function(){doApprove(\\''+t.id+'\\',false)})">&#10003; Approve</button>':'')+
    '<button class="btn btn-sm" onclick="event.stopPropagation();ask(\\'Restart task?\\',function(){doRestart(\\''+t.id+'\\')})">&#8635;</button>'+
    '<button class="btn btn-sm" onclick="event.stopPropagation();ask(\\'Skip task?\\',function(){doSkip(\\''+t.id+'\\')})">&#9197;</button>'+
    '</div>';

  /* Expanded timeline */
  if(exp){
    h+='<div class=tc-exp>';
    if(S.tl[t.id]===undefined){
      h+='<div class=loading>Loading timeline...</div>';
    }else if(S.tl[t.id]===null){
      h+='<div class=err-msg>Timeline unavailable</div>';
    }else{
      h+=renderTimeline(t,S.tl[t.id]);
    }
    h+='</div>';
  }
  h+='</div>';
  return h;
}

function renderTimeline(t,tl){
  var task=tl.task||t,its=tl.iterations||[],evs=tl.events||[];
  var h='';

  /* Info row */
  h+='<div class=tl-info>'+
    '<span class=tli-row><b>Impl:</b> '+esc(task.implementModel||'?')+' &#8594; <b>Rev:</b> '+esc(task.reviewModel||'?')+'</span>'+
    (task.autoApprove?'<span class=tli-row style=color:var(--accent)>AUTO-APPROVE</span>':'')+
    (task.autoApply?'<span class=tli-row style=color:var(--warn)>AUTO-APPLY</span>':'')+
    '</div>';

  /* Prompt */
  h+='<div class=tl-sect>'
    +'<div class=tl-sect-title>Prompt</div>'
    +'<div class=tl-prompt>'+esc(task.prompt||'')+'</div>'
    +'</div>';

  /* Policy edit */
  h+='<div class=tl-sect>'
    +'<div class=tl-sect-title>Policy <button class="btn btn-sm" onclick="var p=$e(\\'pol-'+t.id+'\\');p.style.display=p.style.display===\\'none\\'?\\'block\\':\\'none\\'">Edit</button></div>'
    +'<div id="pol-'+t.id+'" style=display:none class=policy-form>'
    +'<div class=pf-row>'
    +'<label>Implement Model<input id="ep-impl-'+t.id+'" value="'+esc(task.implementModel||'')+'"></label>'
    +'<label>Review Model<input id="ep-rev-'+t.id+'" value="'+esc(task.reviewModel||'')+'"></label>'
    +'</div>'
    +'<div class=pf-row>'
    +'<label>Max Iterations<input id="ep-max-'+t.id+'" type=number value="'+task.maxIterations+'" min=1 max=20 style=width:70px></label>'
    +'<label><input type=checkbox id="ep-apr-'+t.id+'"'+(task.autoApprove?' checked':'')+'>Auto Approve</label>'
    +'<label><input type=checkbox id="ep-apl-'+t.id+'"'+(task.autoApply?' checked':'')+'>Auto Apply</label>'
    +'</div>'
    +'<button class="btn btn-accent btn-sm" onclick="savePolicy(\\''+t.id+'\\')">Save Policy</button>'
    +'</div>'
    +'</div>';

  /* Iterations */
  if(its.length){
    h+='<div class=tl-sect><div class=tl-sect-title>Iterations ('+its.length+')</div>';
    its.forEach(function(d){
      var it=d.iteration;
      h+='<div class=iter-card>'
        +'<div class=ic-hdr>#'+it.iterationIndex+' '+stag(it.status)+(it.implementModel?'<span class=badge>'+esc(it.implementModel)+'</span>':'')+'</div>';
      if(d.implementationSummary)h+='<div class=ic-sum>'+md(d.implementationSummary.slice(0,500))+'</div>';
      if(Array.isArray(d.changedFiles)&&d.changedFiles.length){
        h+='<div class=ic-files>';
        d.changedFiles.forEach(function(f){h+='<span class=ic-file>'+(typeof f==='string'?esc(f):'+'+f.additions+' -'+f.deletions+' '+esc(f.path))+'</span>';});
        h+='</div>';
      }
      if(Array.isArray(d.checkResults)&&d.checkResults.length){
        h+='<div class=ic-checks>';
        d.checkResults.forEach(function(c){h+='<span class="ic-ck '+(c.ok?'pass':'fail')+'">'+(c.ok?'&#10003;':'&#10007;')+' '+esc(c.name)+'</span>';});
        h+='</div>';
      }
      if(d.diffPreview){
        var diffId='df-'+t.id+'-'+it.iterationIndex;
        h+='<button class=diff-btn onclick="var p=$e(\\''+diffId+'\\');p.style.display=p.style.display===\\'none\\'?\\'block\\':\\'none\\'">&#9654; Show diff</button>'
          +'<pre class=diff-block id="'+diffId+'" style=display:none>'+esc(d.diffPreview)+'</pre>';
      }
      if(d.reviewDecision)h+='<div class=ic-rev><span class="ic-dec '+d.reviewDecision+'">'+d.reviewDecision+'</span> '+md(d.reviewFeedback||'')+'</div>';
      if(d.reviewNextPrompt)h+='<div class=ic-next>&#10132; '+md(d.reviewNextPrompt.slice(0,400))+'</div>';
      h+='</div>';
    });
    h+='</div>';
  }

  /* Events (last 15) */
  if(evs.length){
    h+='<div class=tl-sect><div class=tl-sect-title>Events ('+evs.length+')</div>';
    evs.slice(-15).forEach(function(e){
      h+='<div class=ev-row><span class=ev-t>'+new Date(e.createdAt).toISOString().slice(11,19)+'</span>'+esc(e.eventType)+': '+esc((e.message||'').slice(0,200))+'</div>';
    });
    h+='</div>';
  }

  /* Bottom action bar */
  h+='<div class=tl-actions>'+
    '<button class="btn btn-sm btn-accent" onclick="doDispatch(\\''+t.id+'\\')">&#9654; Dispatch</button>'+
    (t.status==='needs_review'?'<button class="btn btn-sm btn-accept" onclick="ask(\\'Approve?\\',function(){doApprove(\\''+t.id+'\\',false)})">&#10003; Approve</button>':'')+
    '<button class="btn btn-sm" onclick="ask(\\'Restart task?\\',function(){doRestart(\\''+t.id+'\\')})">&#8635; Restart</button>'+
    '<button class="btn btn-sm" onclick="ask(\\'Skip task?\\',function(){doSkip(\\''+t.id+'\\')})">&#9197; Skip</button>'+
    '</div>';

  return h;
}

/* partial re-renders to avoid disrupting focused inputs */
function refreshTasks(){
  var tc=$e('tab-content');
  var a=S.agents.find(function(x){return x.id===S.agentId;});
  if(!tc||!a||S.tab!=='tasks')return;
  renderTasksTab(tc,a);
}
function renderTasksPanelOnly(){
  var tc=$e('tab-content');
  var a=S.agents.find(function(x){return x.id===S.agentId;});
  if(!tc||!a||S.tab!=='tasks')return;
  renderTasksTab(tc,a);
}

/* ════════════════════════════════════════════
   INGEST PANEL
════════════════════════════════════════════ */
function renderIngestPanel(a){
  var d=S.ing;
  var h='<div class=ingest-panel>'
    +'<div class=ip-title>&#8659; Ingest Task Flow</div>'
    +'<div class=ip-body>'
    +'<div class=ip-row>'
    +'<label>Format<select id=ing-fmt onchange="S.ing.format=this.value">'
    +['auto','markdown','json','csv','plain'].map(function(f){return'<option value='+f+(d.format===f?' selected':'')+'>'+f+'</option>';}).join('')
    +'</select></label>'
    +'<label>Max Iterations<input id=ing-maxit type=number value="'+d.maxIter+'" min=1 max=20 style=width:60px oninput="S.ing.maxIter=parseInt(this.value)||1"></label>'
    +'</div>'
    +'<div class=ip-row>'
    +'<label>Implement Model<input id=ing-impl value="'+esc(d.implModel)+'" oninput="S.ing.implModel=this.value"></label>'
    +'<label>Review Model<input id=ing-rev value="'+esc(d.revModel)+'" oninput="S.ing.revModel=this.value"></label>'
    +'</div>'
    +'<div class=ip-row>'
    +'<label><input type=checkbox id=ing-apr'+(d.autoapr?' checked':'')+' onchange="S.ing.autoapr=this.checked"> Auto Approve</label>'
    +'<label><input type=checkbox id=ing-apl'+(d.autoapl?' checked':'')+' onchange="S.ing.autoapl=this.checked"> Auto Apply</label>'
    +'</div>'
    +'<textarea id=ing-text class=ingest-ta placeholder="Paste task flow here... Accepts markdown headings, JSON array [{title,prompt}], CSV, or plain text" oninput="S.ing.text=this.value">'+esc(d.text)+'</textarea>'
    +'<div class=ip-btns>'
    +'<button class=btn onclick=previewIngest()>Preview</button>'
    +'<button class="btn btn-accent" onclick=runIngest()>&#10003; Import Tasks</button>'
    +'<button class=btn onclick=clearIngest()>Clear</button>'
    +'<button class=btn onclick="S.ingestOpen=false;refreshTasks()">&#10005;</button>'
    +'</div>';
  if(d.preview){
    var p=d.preview;
    h+='<div class=ip-preview>Parsed: '+(p.tasks?p.tasks.length:0)+' tasks'+(p.duplicates?' ('+p.duplicates+' dupes skipped)':'');
    if(p.warnings&&p.warnings.length)p.warnings.forEach(function(w){h+='<div class=warn-row>&#9888; '+esc(w)+'</div>';});
    h+='</div>';
  }
  h+='</div></div>';
  return h;
}

async function previewIngest(){
  var text=getIngestText();
  if(!text.trim()){toast('Paste some tasks first',true);return;}
  S.ing.text=text;
  try{
    var r=await api('/api/tasks/import-preview',{method:'POST',body:{text:text,format:S.ing.format}});
    S.ing.preview=r.preview||r;
    toast('Parsed '+(S.ing.preview.tasks?S.ing.preview.tasks.length:0)+' tasks','');
  }catch(e){toast('Preview failed: '+e.message,true);}
  refreshTasks();
}

async function runIngest(){
  var text=getIngestText();
  if(!text.trim()){toast('Nothing to import',true);return;}
  S.ing.text=text;
  try{
    var pid=await ensureProject();
    var r=await api('/api/tasks/import',{method:'POST',body:{
      text:text,format:S.ing.format,
      defaults:{
        projectId:pid,assignedAgentId:S.agentId||undefined,
        implementModel:S.ing.implModel||undefined,reviewModel:S.ing.revModel||undefined,
        maxIterations:S.ing.maxIter||1,autoApprove:S.ing.autoapr,autoApply:S.ing.autoapl
      },
      options:{createMissingBuckets:true,skipDuplicates:true}
    }});
    var ct=r.result?(r.result.created||r.result.imported||'?'):'?';
    toast('Imported '+ct+' tasks','');
    S.ing={format:'auto',text:'',implModel:'',revModel:'',maxIter:3,autoapr:false,autoapl:false,preview:null};
    S.ingestOpen=false;
    refresh(false);
  }catch(e){toast('Import failed: '+e.message,true);}
}

function getIngestText(){
  var el=$e('ing-text');return el?el.value:(S.ing.text||'');}

function clearIngest(){
  S.ing.text='';S.ing.preview=null;
  var el=$e('ing-text');if(el)el.value='';
  refreshTasks();
}

/* ════════════════════════════════════════════
   NEW TASK PANEL
════════════════════════════════════════════ */
function renderNewPanel(a){
  return'<div class=new-task-panel>'
    +'<div class=ntp-title>+ New Task</div>'
    +'<label>Title<input id=nt-title class=nt-input placeholder="Task title..."></label>'
    +'<label>Prompt<textarea id=nt-prompt class=nt-ta rows=4 placeholder="Describe what needs to be done..."></textarea></label>'
    +'<div class=nt-row>'
    +'<label>Mode<select id=nt-mode><option value=patch>Patch</option><option value=ask>Ask</option><option value=retrieve>Retrieve</option></select></label>'
    +'<label>Max Iters<input id=nt-maxit type=number value=3 min=1 max=20 style=width:60px></label>'
    +'</div>'
    +'<div class=nt-row>'
    +'<label>Impl Model<input id=nt-impl></label>'
    +'<label>Rev Model<input id=nt-rev></label>'
    +'</div>'
    +'<div class=nt-row>'
    +'<label><input type=checkbox id=nt-apr> Auto Approve</label>'
    +'<label><input type=checkbox id=nt-apl> Auto Apply</label>'
    +'</div>'
    +'<div class=ip-btns>'
    +'<button class="btn btn-accent btn-sm" onclick=createTask()>Create Task</button>'
    +'<button class="btn btn-sm" onclick="S.newOpen=false;refreshTasks()">Cancel</button>'
    +'</div>'
    +'</div>';
}

async function createTask(){
  var title=($e('nt-title')||{}).value||'';
  var prompt=($e('nt-prompt')||{}).value||'';
  if(!title.trim()||!prompt.trim()){toast('Title and prompt required',true);return;}
  try{
    var pid=await ensureProject();
    var r=await api('/api/tasks',{method:'POST',body:{
      projectId:pid,title:title.trim(),prompt:prompt.trim(),
      mode:($e('nt-mode')||{}).value||'patch',
      maxIterations:parseInt(($e('nt-maxit')||{}).value)||3,
      autoApprove:($e('nt-apr')||{}).checked||false,
      autoApply:($e('nt-apl')||{}).checked||false,
      implementModel:($e('nt-impl')||{}).value||undefined,
      reviewModel:($e('nt-rev')||{}).value||undefined
    }});
    if(r.task&&S.agentId){
      await api('/api/tasks/'+r.task.id+'/assign',{method:'POST',body:{agentId:S.agentId}});
    }
    toast('Task created','');S.newOpen=false;refresh(false);
  }catch(e){toast(e.message,true);}
}

/* ════════════════════════════════════════════
   TASK ACTIONS
════════════════════════════════════════════ */
async function doDispatch(id){
  try{await api('/api/tasks/'+id+'/dispatch',{method:'POST',body:{}});toast('Dispatched','');refresh(true);}
  catch(e){toast(e.message,true);}
}
async function doApprove(id,apply){
  try{await api('/api/tasks/'+id+'/approve',{method:'POST',body:{apply:apply||false}});toast('Approved','');refresh(true);}
  catch(e){toast(e.message,true);}
}
async function doRestart(id){
  try{await api('/api/tasks/'+id+'/restart',{method:'POST',body:{}});toast('Restarted','');refresh(true);}
  catch(e){toast(e.message,true);}
}
async function doSkip(id){
  try{await api('/api/tasks/'+id+'/skip',{method:'POST',body:{}});toast('Skipped','');refresh(true);}
  catch(e){toast(e.message,true);}
}
async function doDispatchNext(){
  if(!S.agentId)return;
  try{await api('/api/tasks/dispatch-next',{method:'POST',body:{agentId:S.agentId}});toast('Dispatched next task','');refresh(true);}
  catch(e){toast(e.message,true);}
}
async function savePolicy(id){
  var impl=($e('ep-impl-'+id)||{}).value||null;
  var rev=($e('ep-rev-'+id)||{}).value||null;
  var maxit=parseInt(($e('ep-max-'+id)||{}).value)||1;
  var apr=!!($e('ep-apr-'+id)||{}).checked;
  var apl=!!($e('ep-apl-'+id)||{}).checked;
  try{
    await api('/api/tasks/'+id,{method:'PATCH',body:{implementModel:impl,reviewModel:rev,maxIterations:maxit,autoApprove:apr,autoApply:apl}});
    toast('Policy saved','');delete S.tl[id];refresh(true);
  }catch(e){toast(e.message,true);}
}

/* ════════════════════════════════════════════
   CHAT TAB
════════════════════════════════════════════ */
function renderChatTab(el,a){
  var modelOpts='<option value="">default</option>';
  if(a.models)for(var k in a.models)if(a.models[k])modelOpts+='<option value="'+esc(a.models[k])+'">'+esc(k)+': '+esc(a.models[k].slice(0,24))+'</option>';

  var h='<div class=chat-outer>'
    +'<div class=chat-tb>'
    +'<select id=chat-sess class=ct-sel onchange="pickSession(this.value)">'
    +'<option value="">Select session...</option>'
    +S.chat.sessions.map(function(s){return'<option value="'+s.id+'"'+(S.chat.sid===s.id?' selected':'')+'>'+esc(s.title||short(s.id))+'</option>';}).join('')
    +'</select>'
    +'<button class="btn btn-sm" onclick=newSession()>+ New</button>'
    +'</div>';

  h+='<div class=chat-msgs id=chat-msgs>';
  if(!S.chat.sid){
    h+='<div class=chat-empty>Select or create a session to start chatting</div>';
  }else if(!S.chat.msgs.length){
    h+='<div class=chat-empty>No messages yet. Type below to start.</div>';
  }else{
    S.chat.msgs.forEach(function(m){
      var own=m.role==='user';
      h+='<div class="cmsg'+(own?' user':'')+'"><div class=cm-meta>'+esc(m.role||'?')+' \\u00b7 '+(m.ts?new Date(m.ts).toISOString().slice(11,19):'')+'</div><div class=cm-bub>'+md(m.content||'')+'</div></div>';
    });
  }
  h+='</div>';

  /* Open questions */
  if(S.chat.qtns&&S.chat.qtns.length){
    h+='<div class=chat-qtns><div class=cq-title>Open Questions ('+S.chat.qtns.length+')</div>';
    S.chat.qtns.forEach(function(q){
      h+='<div class=cq-item><div class=cq-text>'+esc(q.question||q.text||'')+'</div>'
        +'<div class=cq-act><input id="qa-'+q.id+'" class=cq-input type=text placeholder="Answer...">'
        +'<button class="btn btn-sm btn-accent" onclick="answerQ(\\''+q.id+'\\')">Answer</button></div></div>';
    });
    h+='</div>';
  }

  h+='<div class=chat-input-area>'
    +'<div class=cia-tb>'
    +'<select id=chat-action><option value=ask>ask</option><option value=patch>patch</option><option value=retrieve>retrieve</option><option value=context>context</option></select>'
    +'<select id=chat-model>'+modelOpts+'</select>'
    +'</div>'
    +'<div class=cia-row>'
    +'<textarea id=chat-msg class=chat-textarea placeholder="Message... (Ctrl+Enter to send)" rows=2 onkeydown="if(event.ctrlKey&&event.key===\\'Enter\\'){event.preventDefault();sendMsg();}"></textarea>'
    +'<button class="btn btn-accent cia-send" id=send-btn onclick=sendMsg()>'+(S.chat.sending?'...':'Send')+'</button>'
    +'</div></div>';

  h+='</div>';
  el.innerHTML=h;
  /* scroll to bottom */
  setTimeout(function(){var m=$e('chat-msgs');if(m)m.scrollTop=m.scrollHeight;},30);
}

/* ════════════════════════════════════════════
   CHAT ACTIONS
════════════════════════════════════════════ */
async function pickSession(sid){
  S.chat.sid=sid||null;S.chat.msgs=[];S.chat.qtns=[];
  if(sid){await loadMessages(sid);}else{renderMainPanelOnly();}
}
async function newSession(){
  if(!S.agentId)return;
  try{
    var r=await api('/api/agents/'+S.agentId+'/chats',{method:'POST',body:{}});
    if(r.session){
      S.chat.sid=r.session.id;
      await loadChatSessions(S.agentId);
      await loadMessages(r.session.id);
    }
  }catch(e){toast(e.message,true);}
}
async function sendMsg(){
  if(!S.agentId||!S.chat.sid)return;
  var inp=$e('chat-msg');if(!inp)return;
  var prompt=inp.value.trim();if(!prompt)return;
  var btn=$e('send-btn');
  S.chat.sending=true;inp.disabled=true;if(btn){btn.disabled=true;btn.textContent='...';}
  try{
    var body={prompt:prompt};
    var ak=$e('chat-action');if(ak&&ak.value)body.actionKind=ak.value;
    var mk=$e('chat-model');if(mk&&mk.value)body.model=mk.value;
    await api('/api/agents/'+S.agentId+'/chats/'+S.chat.sid,{method:'POST',body:body});
    inp.value='';
    await loadMessages(S.chat.sid);
  }catch(e){toast(e.message,true);}
  S.chat.sending=false;
  if(inp)inp.disabled=false;
  if(btn){btn.disabled=false;btn.textContent='Send';}
}
async function answerQ(qid){
  var inp=$e('qa-'+qid);var answer=inp?inp.value.trim():'';if(!answer){toast('Enter an answer',true);return;}
  try{
    await api('/api/agents/'+S.agentId+'/questions/'+qid,{method:'POST',body:{answer:answer}});
    toast('Answered','');await loadMessages(S.chat.sid);
  }catch(e){toast(e.message,true);}
}

/* ════════════════════════════════════════════
   NAV / TOGGLES
════════════════════════════════════════════ */
function selectAgent(id){
  S.agentId=id;S.tab='tasks';
  S.chat={sessions:[],sid:null,msgs:[],qtns:[],sending:false};
  S.filter={q:'',status:''};S.exp={};S.ingestOpen=false;S.newOpen=false;
  /* Show main panel on mobile */
  var layout=$e('layout');if(layout&&window.innerWidth<768)layout.classList.add('show-main');
  render();
}
function backToAgents(){
  var layout=$e('layout');if(layout)layout.classList.remove('show-main');
  S.agentId=null;render();
}
function setTab(t){
  S.tab=t;
  if(t==='chat'&&S.agentId&&!S.chat.sessions.length){
    renderMainPanelOnly();loadChatSessions(S.agentId);
  }else renderMainPanelOnly();
}
function toggleExpand(id){
  S.exp[id]=!S.exp[id];
  if(S.exp[id]&&S.tl[id]===undefined&&!S.tlQ[id])loadTimeline(id);
  else renderTasksPanelOnly();
}
function toggleIngest(){S.ingestOpen=!S.ingestOpen;S.newOpen=false;refreshTasks();}
function toggleNew(){S.newOpen=!S.newOpen;S.ingestOpen=false;refreshTasks();}
function doRefresh(){refresh(false);}

/* ════════════════════════════════════════════
   BOOT
════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded',function(){
  document.addEventListener('focusin',function(e){if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT')S.typing=true;});
  document.addEventListener('focusout',function(e){if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT')S.typing=false;});
  refresh(false);
  setInterval(function(){if(!S.typing&&!S.chat.sending)refresh(true);},3000);
});

/* ════════════════════════════════════════════
   EXPORTS
════════════════════════════════════════════ */
window.$e=$e;window.S=S;
window.selectAgent=selectAgent;window.backToAgents=backToAgents;window.setTab=setTab;
window.toggleExpand=toggleExpand;window.toggleIngest=toggleIngest;window.toggleNew=toggleNew;
window.doDispatch=doDispatch;window.doApprove=doApprove;window.doRestart=doRestart;window.doSkip=doSkip;
window.doDispatchNext=doDispatchNext;window.savePolicy=savePolicy;window.createTask=createTask;
window.previewIngest=previewIngest;window.runIngest=runIngest;window.clearIngest=clearIngest;
window.pickSession=pickSession;window.newSession=newSession;window.sendMsg=sendMsg;window.answerQ=answerQ;
window.ask=ask;window.yesConfirm=yesConfirm;window.noConfirm=noConfirm;
window.doRefresh=doRefresh;window.render=render;window.refresh=refresh;
window.refreshTasks=refreshTasks;window.renderTasksPanelOnly=renderTasksPanelOnly;window.renderMainPanelOnly=renderMainPanelOnly;
})();
`
