export const clientJs = `var D={agents:[],tasks:[],status:{agents:{},tasks:{}}},S=null,tab='chat',selSession=null,confirmCb=null;
const $=function(id){return document.getElementById(id);};
function dotCls(s){return s==='offline'||s==='error'?'dot-offline':(s==='busy'||s==='indexing'?'dot-busy':(s==='idle'?'dot-idle':'dot-online'));}
function st(s){return'<span class="tag tag-'+s.replace(/_/g,'-')+'">'+s+'</span>';}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function bd(t){var o=[];o.push('<span class=badge>IT'+t.currentIteration+'/'+t.maxIterations+'</span>');if(t.autoApprove)o.push('<span class="badge badge-on">AUTO</span>');if(t.autoApply)o.push('<span class="badge badge-on">APPLY</span>');return o.join(' ');}
function ago(ts){if(!ts)return'never';var s=Math.round((Date.now()-ts)/1000);if(s<5)return'now';if(s<60)return s+'s ago';if(s<3600)return Math.round(s/60)+'m ago';return Math.round(s/3600)+'h ago';}

async function api(m,p,b){var r=await fetch(p,{method:m,headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):null});return await r.json();}

async function fetchAll(){
  var s=await(await fetch('/api/organizer/status')).json();if(s.ok)D.status=s;
  var a=await(await fetch('/api/agents')).json();if(a.ok)D.agents=a.agents;
  var t=await(await fetch('/api/tasks')).json();if(t.ok)D.tasks=t.tasks;
  updateStats();renderAgentList();
  if(S)renderAgentDetail();
}
function updateStats(){
  $('stat-agents').textContent=D.agents.length||0;
  $('stat-online').textContent=(D.status.agents&&D.status.agents.online)||0;
  $('stat-tasks').textContent=(D.status.tasks&&D.status.tasks.total)||0;
  $('stat-review').textContent=(D.status.tasks&&D.status.tasks.needs_review)||0;
  $('ap-status').textContent=(D.agents.length||0)+' agents · '+(D.status.agents&&D.status.agents.online||0)+' online · '+(D.status.tasks&&D.status.tasks.running||0)+' running';
}

function renderAgentList(){
  var el=$('agent-list');
  if(!D.agents.length){el.innerHTML='<div class=empty style="font-size:10px">No agents connected.<br>Workers auto-register via smith api or /api</div>';return;}
  var h='';
  D.agents.forEach(function(a){
    var sel=S&&S.id===a.id,cls=sel?' selected':'';
    var agentTasks=D.tasks.filter(function(t){return t.assignedAgentId===a.id;});
    var activeTasks=agentTasks.filter(function(t){return t.status==='running'||t.status==='iterating'||t.status==='reviewing'||t.status==='assigned'||t.status==='needs_review';});
    var taskLabel=activeTasks.length>0?(activeTasks.length+' active task'+(activeTasks.length>1?'s':'')):'';
    var taskDisplay=activeTasks.length>0?(function(){var rt=activeTasks.find(function(t){return t.status==='running';})||activeTasks[0];return rt.title.slice(0,30);})():'';
    var ix=null;try{if(a.index)ix=typeof a.index==='string'?JSON.parse(a.index):a.index;}catch(e){}
    h+='<div class="agent-item'+cls+'" onclick="selectAgent(\\''+a.id+'\\')">'+
      '<div class=ai-top><span class="status-dot '+dotCls(a.status)+'"></span><span class=ai-name>'+esc(a.name||a.id.slice(0,8))+'</span></div>'+
      '<div class=ai-status>'+esc(a.status)+(a.current_task_id?' · working':'')+'</div>'+
      (taskDisplay?'<div class=ai-task style=color:'+(activeTasks.find(function(t){return t.status==='running';})?'var(--warn)':'var(--fg-dim)')+'>'+esc(taskDisplay)+'</div>':'')+
      (ix&&ix.files?'<div class=ai-meta>idx:'+ix.files+'f/'+ix.symbols+'s '+ago(a.last_heartbeat_at)+'</div>':'<div class=ai-meta>'+ago(a.last_heartbeat_at)+'</div>')+
    '</div>';
  });
  el.innerHTML=h;
}

function selectAgent(id){
  S={type:'agent',id:id,tab:'chat'};
  tab='chat';selSession=null;
  document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('active',b.dataset.tab===tab);});
  renderAgentList();renderAgentDetail();
}
function selectTab(t){
  tab=t;
  document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('active',b.dataset.tab===t);});
  renderAgentDetail();
}

function renderAgentDetail(){
  var ct=$('detail-content');
  var tb=$('detail-tabs');
  if(!S){tb.style.display='none';renderOverview(ct);return;}
  tb.style.display='flex';
  var a=D.agents.find(function(x){return x.id===S.id;});
  if(!a){ct.innerHTML='<div class=empty>Agent not found. It may have gone offline.</div>';return;}
  if(tab==='chat')renderChatTab(ct,a);
  else if(tab==='tasks')renderTasksTab(ct,a);
  else if(tab==='reviews')renderReviewsTab(ct,a);
  else if(tab==='status')renderStatusTab(ct,a);
}

/* ── Overview (no agent selected) ── */
function renderOverview(el){
  var s=D.status,c=s.agents||{},tc=s.tasks||{};
  var h='<div class=panel><div class=panel-title>Dashboard Overview</div>';
  h+='<div class=stats-grid>';
  h+='<div class=stat-card onclick=selectFirstAgent()><div class=stat-num>'+(c.online||0)+'/'+D.agents.length+'</div><div class=stat-label>Agents Online (click)</div></div>';
  h+='<div class=stat-card onclick="showAllTasks(\\'running\\')"><div class=stat-num>'+(tc.running||0)+'</div><div class=stat-label>Running (click)</div></div>';
  h+='<div class="stat-card warn" onclick="showAllTasks(\\'needs_review\\')"><div class=stat-num>'+(tc.needs_review||0)+'</div><div class=stat-label>Needs Review (click)</div></div>';
  h+='<div class="stat-card danger" onclick="showAllTasks(\\'failed\\')"><div class=stat-num>'+(tc.failed||0)+'</div><div class=stat-label>Failed (click)</div></div>';
  h+='<div class=stat-card onclick="showAllTasks(\\'completed\\')"><div class=stat-num>'+(tc.completed||0)+'</div><div class=stat-label>Completed (click)</div></div>';
  h+='<div class=stat-card onclick="showAllTasks(\\'queued\\')"><div class=stat-num>'+(tc.queued||0)+'</div><div class=stat-label>Queued (click)</div></div>';
  h+='</div>';

  h+='<div class=panel><div class=panel-title>All Tasks ('+D.tasks.length+')</div>';
  if(!D.tasks.length)h+='<div class=empty>No tasks yet</div>';
  else {
    h+='<div class=btn-row style=margin-bottom:6px>'+
      '<button class="btn btn-sm" onclick="showAllTasks(\\'all\\')">All</button>'+
      '<button class="btn btn-sm" onclick="showAllTasks(\\'running\\')">Running</button>'+
      '<button class="btn btn-sm" onclick="showAllTasks(\\'needs_review\\')">Needs Review</button>'+
      '<button class="btn btn-sm" onclick="showAllTasks(\\'queued\\')">Queued</button>'+
    '</div>';
    D.tasks.slice(0,25).forEach(function(t){
      var a=D.agents.find(function(x){return x.id===t.assignedAgentId;});
      h+='<div class=card onclick="selectTaskOverview(\\''+t.id+'\\')">'+
        '<div class=name>'+esc(t.title)+'</div><div class=meta>'+st(t.status)+' '+bd(t)+'</div>'+
        (a?'<div class=sub>Agent: '+esc(a.name)+'</div>':'')+'</div>';
    });
  }
  h+='</div></div>';
  el.innerHTML=h;
}

function selectFirstAgent(){if(D.agents.length)selectAgent(D.agents[0].id);}
function selectTaskOverview(tid){S={type:'task',id:tid};renderTaskDetailModal($('detail-content'));}
function showAllTasks(filter){
  S=null;
  var el=$('detail-content'),tb=$('detail-tabs');tb.style.display='none';
  var items=D.tasks;
  if(filter&&filter!=='all')items=items.filter(function(t){return t.status===filter;});
  var h='<div class=panel><div class=panel-title>Tasks: '+filter+' ('+items.length+')</div>';
  if(!items.length)h+='<div class=empty>No tasks match</div>';
  else items.forEach(function(t){
    var a=D.agents.find(function(x){return x.id===t.assignedAgentId;});
    h+='<div class=card onclick="selectTaskOverview(\\''+t.id+'\\')">'+
      '<div class=name>'+esc(t.title)+'</div><div class=meta>'+st(t.status)+' '+bd(t)+'</div>'+
      (a?'<div class=sub>Agent: '+esc(a.name)+'</div>':'')+'</div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

/* ── Chat Tab ── */
function renderChatTab(el,a){
  el.innerHTML='<div class=chat-container id=chat-container>'+
    '<div class=chat-toolbar>'+
      '<select id=chat-session-picker onchange="pickChatSession(this.value)"><option value="">Loading sessions…</option></select>'+
      '<button class="btn btn-sm" onclick=showSessionsModal()>+ New</button>'+
    '</div>'+
    '<div class=chat-messages id=chat-messages><div class=empty style="margin-top:20px">Select or create a chat session to begin</div></div>'+
    '<div class=chat-input-row>'+
      '<input id=chat-input placeholder="Type a message…" onkeydown="if(event.key===\\'Enter\\')sendChatMessage()">'+
      '<button class=btn id=chat-send-btn onclick=sendChatMessage()>Send</button>'+
    '</div>'+
  '</div>';
  loadChatSessions(a);
}

async function loadChatSessions(a){
  var r=await(await fetch('/api/agents/'+a.id+'/chats')).json();
  var picker=$('chat-session-picker');
  if(!r.ok||!r.sessions||!r.sessions.length){
    picker.innerHTML='<option value="">No sessions</option>';
    return;
  }
  var h='<option value="">Select session…</option>';
  r.sessions.forEach(function(s){
    h+='<option value="'+esc(s.id)+'">'+esc(s.title||s.id.slice(0,12))+'</option>';
  });
  picker.innerHTML=h;
  if(selSession){picker.value=selSession;loadChatMessages(a,selSession);}
}

function pickChatSession(sid){
  selSession=sid;if(!sid)return;
  var a=D.agents.find(function(x){return x.id===S.id;});
  if(a)loadChatMessages(a,sid);
}

function showSessionsModal(){
  var a=D.agents.find(function(x){return x.id===S.id;});
  if(!a)return;
  api('GET','/api/agents/'+a.id+'/chats').then(function(r){
    var list=$('sessions-list');
    if(!r.ok||!r.sessions){list.innerHTML='<div class=empty>Could not load sessions</div>';return;}
    var h='';
    r.sessions.forEach(function(s){
      h+='<div class="session-item'+(selSession===s.id?' selected':'')+'" onclick="pickChatFromModal(\\''+s.id+'\\')">'+esc(s.title||s.id.slice(0,16))+'</div>';
    });
    if(!r.sessions.length)h='<div class=empty>No sessions</div>';
    list.innerHTML=h;
  });
  $('chat-sessions-overlay').style.display='flex';
}
function pickChatFromModal(sid){
  selSession=sid;
  var picker=$('chat-session-picker');if(picker)picker.value=sid;
  $('chat-sessions-overlay').style.display='none';
  var a=D.agents.find(function(x){return x.id===S.id;});
  if(a)loadChatMessages(a,sid);
}
function closeSessions(){$('chat-sessions-overlay').style.display='none';}
async function createChatSession(){
  var a=D.agents.find(function(x){return x.id===S.id;});
  if(!a)return;
  var title=prompt('Session name (optional):');
  var r=await api('POST','/api/agents/'+a.id+'/chats',title?{title:title}:{});
  if(r.ok&&r.session){
    selSession=r.session.id;
    var picker=$('chat-session-picker');if(picker)picker.value=selSession;
    $('chat-sessions-overlay').style.display='none';
    loadChatSessions(a);
    if(a)loadChatMessages(a,selSession);
  }else alert('Failed: '+(r.error||'unknown'));
}
async function loadChatMessages(a,sid){
  var msgs=$('chat-messages');if(!msgs)return;
  msgs.innerHTML='<div class=empty>Loading…</div>';
  var r=await(await fetch('/api/agents/'+a.id+'/chats/'+sid)).json();
  if(!r.ok){msgs.innerHTML='<div class=empty>Error: '+esc(r.error||'unknown')+'</div>';return;}
  if(!r.messages||!r.messages.length){msgs.innerHTML='<div class=empty>No messages yet. Send a prompt!</div>';return;}
  var h='';
  r.messages.forEach(function(m){
    var role=m.role||'unknown';
    var cls=role==='user'?' user':'';
    h+='<div class="chat-msg'+cls+'"><div class=chat-meta>'+esc(m.role||'?')+' · '+(m.ts?new Date(m.ts).toISOString().slice(11,19):'')+'</div><div class=chat-bubble>'+esc(m.content||'')+'</div></div>';
  });
  msgs.innerHTML=h;
  msgs.scrollTop=msgs.scrollHeight;
}
async function sendChatMessage(){
  var a=D.agents.find(function(x){return x.id===S.id;});
  if(!a||!selSession)return;
  var inp=$('chat-input');if(!inp)return;
  var prompt=inp.value.trim();if(!prompt)return;
  var msgs=$('chat-messages');
  msgs.innerHTML+='<div class="chat-msg user"><div class=chat-meta>user · sending…</div><div class=chat-bubble>'+esc(prompt)+'</div></div>';
  msgs.scrollTop=msgs.scrollHeight;
  inp.value='';inp.disabled=true;$('chat-send-btn').disabled=true;

  var r=await api('POST','/api/agents/'+a.id+'/chats/'+selSession,{prompt:prompt});
  inp.disabled=false;$('chat-send-btn').disabled=false;
  if(r.ok){loadChatMessages(a,selSession);}
  else{alert('Error: '+(r.error||'unknown'));loadChatMessages(a,selSession);}
}

/* ── Tasks Tab ── */
function renderTasksTab(el,a){
  var agentTasks=D.tasks.filter(function(t){return t.assignedAgentId===a.id;});
  var grouped={running:[],iterating:[],reviewing:[],needs_review:[],auto_approved:[],assigned:[],queued:[],completed:[],failed:[],skipped:[],cancelled:[]};
  agentTasks.forEach(function(t){if(grouped[t.status])grouped[t.status].push(t);});

  var h='<div class=panel><div class=panel-title>Tasks for '+esc(a.name)+' ('+agentTasks.length+')</div>';
  h+='<div class=btn-row>'+
    '<button class="btn btn-accent btn-sm" onclick="dispatchNextForAgent(\\''+a.id+'\\')">▶ Dispatch Next</button>'+
    '<button class="btn btn-sm" onclick="showCreateTaskForm()">+ New Task</button>'+
    '<button class="btn btn-sm" onclick="loadAgentTasksFilter(\\''+a.id+'\\')">↻ Refresh</button>'+
  '</div>';
  h+='<div id=task-create-form style=display:none class=edit-form>'+
    '<label>Title <input id=tf-title></label>'+
    '<label>Prompt <textarea id=tf-prompt></textarea></label>'+
    '<label>Mode <select id=tf-mode><option value=patch>Patch</option><option value=ask>Ask</option><option value=retrieve>Retrieve</option></select></label>'+
    '<label>Max Iterations <input id=tf-maxit type=number value=1 min=1 max=20 style=width:80px></label>'+
    '<label>Priority <input id=tf-prio type=number value=5 min=0 max=10 style=width:80px></label>'+
    '<label><input type=checkbox id=tf-autoapr> Auto Approve</label>'+
    '<label>Checks <input id=tf-checks placeholder=typecheck,test></label>'+
    '<button class=btn onclick=createAndAssignTask(\\''+a.id+'\\')>Create & Assign</button>'+
    '<button class=btn onclick="$(\'task-create-form\').style.display=\'none\'">Cancel</button>'+
  '</div>';

  var order=['running','iterating','reviewing','needs_review','auto_approved','assigned','queued','completed','failed','skipped','cancelled'];
  order.forEach(function(grp){
    var items=grouped[grp];if(!items||!items.length)return;
    h+='<div class=group-header>'+grp.replace(/_/g,' ')+' ('+items.length+')</div>';
    items.forEach(function(t){
      h+='<div class=card onclick="renderTaskDetailFn(\\''+t.id+'\\')">'+
        '<div class=name>'+esc(t.title)+'</div><div class=meta>'+st(t.status)+' '+bd(t)+'</div>'+
        '<div class=btn-row style=margin-top:4px>'+
        '<button class="btn btn-sm btn-accent" onclick="event.stopPropagation();act(\\'/api/tasks/'+t.id+'/dispatch\\')">Dispatch</button>'+
        (t.status==='needs_review'?'<button class="btn btn-sm btn-accent" onclick="event.stopPropagation();act(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">Approve</button>':'')+
        '<button class=btn onclick="event.stopPropagation();cf(\\'Restart?\\',function(){act(\\'/api/tasks/'+t.id+'/restart\\')})">↺</button>'+
        '<button class=btn onclick="event.stopPropagation();cf(\\'Skip?\\',function(){act(\\'/api/tasks/'+t.id+'/skip\\')})">⏭</button>'+
        '</div></div>';
    });
  });
  h+='</div>';
  el.innerHTML=h;
}

async function loadAgentTasksFilter(aid){
  var a=D.agents.find(function(x){return x.id===aid;});
  if(a)renderTasksTab($('detail-content'),a);
}

function showCreateTaskForm(){$('task-create-form').style.display='block';}
async function createAndAssignTask(aid){
  var title=$('tf-title').value.trim(),prompt=$('tf-prompt').value.trim();
  if(!title||!prompt){alert('Title and prompt required');return;}
  var r=await api('POST','/api/tasks',{
    projectId:'default',title:title,prompt:prompt,
    mode:$('tf-mode').value,
    maxIterations:parseInt($('tf-maxit').value)||1,
    priority:parseInt($('tf-prio').value)||5,
    autoApprove:$('tf-autoapr').checked,
    checks:$('tf-checks').value.trim()?$('tf-checks').value.split(/,/).map(function(x){return x.trim();}):undefined
  });
  if(r.ok&&r.task){await api('POST','/api/tasks/'+r.task.id+'/assign',{agentId:aid});await fetchAll();}
  else alert('Error: '+(r.error||'unknown'));
}

async function dispatchNextForAgent(aid){
  var r=await api('POST','/api/tasks/dispatch-next',{agentId:aid});
  if(!r.ok)alert(r.error||'Failed');
  await fetchAll();
}

function renderTaskDetailFn(tid){
  var el=$('detail-content');
  el.innerHTML='<div class=empty>Loading…</div>';
  api('GET','/api/tasks/'+tid+'/timeline').then(function(r){
    if(!r.ok||!r.timeline){el.innerHTML='<div class=empty>Could not load task</div>';return;}
    renderTaskDetail(el,r.timeline);
  });
}

function renderTaskDetail(el,tl){
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
  el.innerHTML=h;
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
  h+='</div>';
  h+='<div class=btn-row>';
  var allAgents=D.agents;
  if(allAgents.length&&allAgents.length!==1){
    h+='<div class=assign-form><select id=asgn-'+t.id+'>';
    allAgents.forEach(function(ag){h+='<option value="'+esc(ag.id)+'"'+(t.assignedAgentId===ag.id?' selected':'')+'>'+esc(ag.name)+' ('+esc(ag.status)+')</option>';});
    h+='</select><button class="btn btn-sm btn-accent" onclick="assignTask(\\''+t.id+'\\')">Assign</button></div>';
  }
  h+='</div></div>';
  return h;
}

async function assignTask(tid){
  var sel=$('asgn-'+tid);if(!sel)return;
  var aid=sel.value;
  var r=await api('POST','/api/tasks/'+tid+'/assign',{agentId:aid});
  if(r.ok)await fetchAll();
  else alert(r.error||'Failed');
}

/* ── Reviews Tab ── */
function renderReviewsTab(el,a){
  var items=D.tasks.filter(function(t){return t.assignedAgentId===a.id&&(t.status==='needs_review'||t.status==='auto_approved');});
  if(!items.length){el.innerHTML='<div class=empty>No tasks need review for this agent</div>';return;}
  var h='<div class=panel><div class=panel-title>Reviews for '+esc(a.name)+' ('+items.length+')</div>';
  items.forEach(function(t){
    h+='<div class=card onclick="renderTaskDetailFn(\\''+t.id+'\\')">'+
      '<div class=name>'+esc(t.title)+'</div><div class=meta>'+st(t.status)+' '+bd(t)+'</div>'+
      '<div class=btn-row style=margin-top:4px>'+
      '<button class="btn btn-accent btn-sm" onclick="event.stopPropagation();act(\\'/api/tasks/'+t.id+'/approve\\',{apply:'+!!t.autoApply+'})">Approve</button>'+
      '<button class="btn btn-sm" onclick="event.stopPropagation();cf(\\'Restart?\\',function(){act(\\'/api/tasks/'+t.id+'/restart\\')})">Restart</button>'+
      '<button class="btn btn-sm" onclick="event.stopPropagation();cf(\\'Skip?\\',function(){act(\\'/api/tasks/'+t.id+'/skip\\')})">Skip</button>'+
      '</div></div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

/* ── Status Tab ── */
function renderStatusTab(el,a){
  var models=[];if(a.models)for(var k in a.models)if(a.models[k])models.push(k+': '+a.models[k]);
  var caps=Array.isArray(a.capabilities)?a.capabilities.join(', '):'';
  var ix=a.index||{};
  var h='<div class=panel><div class=panel-title>'+esc(a.name)+'</div>'+
    '<div class=detail-row><span class=detail-label>ID</span><span class=detail-value style=font-size:9px>'+esc(a.id)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Status</span><span class=detail-value>'+st(a.status)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Host</span><span class=detail-value>'+esc(a.hostname)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Project</span><span class=detail-value>'+esc(a.project_name)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Root</span><span class=detail-value>'+esc(a.project_root||'—')+'</span></div>'+
    '<div class=detail-row><span class=detail-label>API URL</span><span class=detail-value>'+esc(a.api_base_url||'—')+'</span></div>'+
    '<div class=detail-row><span class=detail-label>API Enabled</span><span class=detail-value>'+(a.api_enabled?'Yes':'No')+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Last Seen</span><span class=detail-value>'+ago(a.last_heartbeat_at)+'</span></div>'+
    '<div class=detail-row><span class=detail-label>Capabilities</span><span class=detail-value>'+esc(caps||'—')+'</span></div>';
  if(models.length)h+='<div class=detail-row><span class=detail-label>Models</span><span class=detail-value>'+esc(models.join(', '))+'</span></div>';
  if(ix.files)h+='<div class=detail-row><span class=detail-label>Index</span><span class=detail-value>'+ix.files+' files, '+ix.symbols+' symbols, '+ix.dirty+' dirty ('+Math.round((ix.freshness||1)*100)+'% fresh)</span></div>';
  if(a.current_task_id){
    var ct=D.tasks.find(function(t){return t.id===a.current_task_id;});
    h+='<div class=detail-row><span class=detail-label>Current Task</span><span class=detail-value>'+(ct?esc(ct.title)+' ('+ct.status+')':a.current_task_id)+'</span></div>';
  }
  h+='</div>';
  el.innerHTML=h;
}

/* ── Task Detail Modal ── */
function renderTaskDetailModal(el){
  if(!S||S.type!=='task')return;
  el.innerHTML='<div class=empty>Loading…</div>';
  api('GET','/api/tasks/'+S.id+'/timeline').then(function(r){
    if(!r.ok||!r.timeline){el.innerHTML='<div class=empty>Could not load task</div>';return;}
    renderTaskDetail(el,r.timeline);
  });
}

/* ── Actions ── */
async function act(path,body){await api('POST',path,body);await fetchAll();}
async function ptch(id,body){await api('PATCH','/api/tasks/'+id,body);await fetchAll();}

function cf(msg,cb){$('confirm-text').textContent=msg;$('confirm-overlay').style.display='flex';confirmCb=cb;}
function confirmYes(){if(confirmCb)confirmCb();$('confirm-overlay').style.display='none';confirmCb=null;}
function confirmNo(){$('confirm-overlay').style.display='none';confirmCb=null;}

/* ── Init ── */
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('.tab-btn').forEach(function(b){
    b.addEventListener('click',function(){selectTab(this.dataset.tab);});
  });
  $('refresh-btn').addEventListener('click',function(){this.classList.add('spinning');setTimeout(function(){this.classList.remove('spinning');}.bind(this),600);});
  fetchAll();setInterval(fetchAll,3000);
});
`
