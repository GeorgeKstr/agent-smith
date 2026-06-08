export const clientJs = `(function(){
'use strict';

/* ── Init from server-provided data ── */
var B=document.body;if(!B)return;
var apiBase=B.dataset.apiBase||'/api';
var hasSidebar=B.dataset.hasSidebar==='true';
var agentBase=apiBase; /* defaults to same; set to /api/agents/{id} when agent selected in organizer */
window.__apiBase=apiBase;
window.__setAgentApiBase=function(b){agentBase=b;};
window.__setSidebar=function(v){hasSidebar=!!v;if(hasSidebar){var s=$e('sidebar');if(s)s.style.display='flex';renderSidebar();}};

/* ── State ── */
var S={
  agents:[],tasks:[],projects:[],status:null,
  agentId:null,tab:'chat',
  chat:{sessions:[],sid:null,msgs:[],qtns:[],sending:false,allModels:[]},
  exp:{},tl:{},tlQ:{},
  ingestOpen:false,newOpen:false,
  filter:{q:'',status:''},
  ing:{format:'auto',text:'',implModel:'',revModel:'',maxIter:3,autoapr:false,autoapl:false,preview:null},
  currentFile:null,fileContent:null,fileEditing:false,treeFilter:'',fileSummary:null,fileMimeType:null,fileIsImage:false,
  dashData:null,
  typing:false,confirmCb:null
};

function esc(s){if(s===null||s===undefined)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ago(ts){if(!ts)return'?';var s=Math.round((Date.now()-ts)/1000);if(s<5)return'now';if(s<60)return s+'s';if(s<3600)return Math.round(s/60)+'m';return Math.round(s/3600)+'h';}
function dotC(s){if(s==='offline'||s==='error')return'dot-off';if(s==='busy'||s==='indexing')return'dot-busy';return'dot-on';}
function stag(s){return'<span class="stag stag-'+s.replace(/_/g,'-')+'">'+s.replace(/_/g,' ')+'</span>';}
function ibadge(t){var b='<span class=badge>'+t.currentIteration+'/'+t.maxIterations+'</span>';if(t.autoApprove)b+='<span class="badge badge-auto">AUTO</span>';if(t.autoApply)b+='<span class="badge badge-apply">APPLY</span>';return b;}
function $e(id){return document.getElementById(id);}
function short(id){return id?String(id).slice(0,10):'?';}
function md(s){if(!s)return'';s=esc(s);s=s.replace(/\`\`\`([\\w]*)\\n?([\\s\\S]*?)\`\`\`/gm,'<pre>$2</pre>');s=s.replace(/\`([^\`\\n]{1,200})\`/g,'<code>$1</code>');s=s.replace(/\\*\\*([^*\\n]{1,200})\\*\\*/g,'<b>$1</b>');s=s.replace(/\\*([^*\\n]{1,200})\\*/g,'<em>$1</em>');s=s.replace(/^[-\\*] (.+)$/gm,'\\u2022 $1');s=s.replace(/\\n/g,'<br>');return s;}

/* ── API ── */
async function api(path,opt){
  return rawApi(apiBase+path,opt);
}
async function aapi(path,opt){
  return rawApi(agentBase+path,opt);
}
async function rawApi(url,opt){
  opt=opt||{};var body=opt.body;if(body!=null&&typeof body!=='string')body=JSON.stringify(body);
  var res=await fetch(url,{method:opt.method||'GET',headers:body!=null?{'Content-Type':'application/json'}:{},body:body||undefined});
  var txt=await res.text(),data;
  try{data=txt?JSON.parse(txt):{};}catch(e){data={ok:false,error:'Bad response'};}
  if(!res.ok||data.ok===false)throw new Error(data.error||'HTTP '+res.status);
  return data;
}

function toast(msg,isErr){var el=$e('toast');if(!el)return;clearTimeout(el._t);el.textContent=msg;el.className=(isErr?'toast err show':'toast show');el._t=setTimeout(function(){el.className='toast';},3000);}
function ask(msg,cb){S.confirmCb=cb;var el=$e('modal-root');if(!el)return;el.innerHTML='<div class=modal onclick="if(event.target===this)noConfirm()"><div class=modal-box><p class=modal-msg>'+esc(msg)+'</p><div class=modal-btns><button class="btn btn-danger" onclick=yesConfirm()>Confirm</button><button class=btn onclick=noConfirm()>Cancel</button></div></div></div>';}
function yesConfirm(){var c=S.confirmCb;S.confirmCb=null;$e('modal-root').innerHTML='';if(c)try{c();}catch(e){toast(e.message,true);}}
function noConfirm(){S.confirmCb=null;$e('modal-root').innerHTML='';}

/* ── Data ── */
async function refresh(silent){
  try{
    if(hasSidebar){
      S.status=(await api('/organizer/status').catch(function(){return null;}))||S.status;
      S.agents=(await api('/agents').catch(function(){return{agents:[]};})).agents||[];
      S.tasks=(await api('/tasks').catch(function(){return{tasks:[]};})).tasks||[];
      S.projects=(await api('/projects').catch(function(){return{projects:[]};})).projects||[];
    }else{
      S.tasks=(await aapi('/tasks').catch(function(){return{tasks:[]};})).tasks||[];
    }
  }catch(e){}
  if(S.agentId&&S.tab==='overview'&&!S.dashData)loadDashboard();
  if(!silent)render();else renderShell();
}

async function loadTimeline(id){if(S.tlQ[id])return;S.tlQ[id]=true;try{S.tl[id]=(await aapi('/tasks/'+id+'/timeline').catch(function(){return null;})).timeline;}catch(e){S.tl[id]=null;}delete S.tlQ[id];renderTasksOnly();}
async function loadSessions(){try{S.chat.sessions=(await aapi('/chat/sessions').catch(function(){return{sessions:[]};})).sessions||[];}catch(e){S.chat.sessions=[];}if(!S.chat.sid&&S.chat.sessions.length===0){try{var r=await aapi('/chat/sessions',{method:'POST',body:{}});if(r.session){S.chat.sessions=[r.session];S.chat.sid=r.session.id;await loadMsgs(r.session.id);if(!S.chat.allModels.length)await loadModels();}}catch(e){}}else if(!S.chat.sid&&S.chat.sessions.length===1){S.chat.sid=S.chat.sessions[0].id;await loadMsgs(S.chat.sessions[0].id);}else renderMainOnly();}
async function loadMsgs(sid){if(!sid)return;try{var r=await aapi('/chat/sessions/'+sid);S.chat.msgs=r.messages||[];S.chat.qtns=r.openQuestions||[];}catch(e){S.chat.msgs=[];S.chat.qtns=[];}renderMainOnly();scrollChat();}
async function loadModels(){try{S.chat.allModels=(await aapi('/models').catch(function(){return{models:[]};})).models||[];}catch(e){S.chat.allModels=[];}}
async function loadDashboard(){try{S.dashData=await aapi('/dashboard').catch(function(){return null;});}catch(e){S.dashData=null;}renderMainOnly();}
async function loadFileTree(){try{S._fileTree=(await aapi('/filetree').catch(function(){return{files:[]};})).files||[];}catch(e){S._fileTree=[];}if(S.tab==='files')renderFileTree();}

function scrollChat(){setTimeout(function(){var m=$e('chat-msgs');if(m)m.scrollTop=m.scrollHeight;},40);}

function modelOptions(a){
  var o='<option value="">default</option>';
  var seen={};
  if(a&&a.models)for(var k in a.models){var m=a.models[k];if(!m||seen[m])continue;seen[m]=1;o+='<option value="'+esc(m)+'">'+esc(k)+': '+esc(m)+'</option>';}
  var byProv={},order=[];
  S.chat.allModels.forEach(function(m){
    var idx=m.indexOf(':'),prov=idx>0?m.slice(0,idx):'other',name=idx>0?m.slice(idx+1):m;
    if(!byProv[prov]){byProv[prov]=[];order.push(prov);}
    byProv[prov].push(name);
  });
  if(order.length)order.forEach(function(prov){o+='<optgroup label="'+esc(prov)+'">';byProv[prov].forEach(function(name){var fm=prov+':'+name;if(seen[fm])return;o+='<option value="'+esc(fm)+'">'+esc(name)+'</option>';});o+='</optgroup>';});
  return o;
}

async function ensureProject(){if(S.projects&&S.projects.length>0)return S.projects[0].id;try{var r=await api('/projects',{method:'POST',body:{name:'Default'}});if(r.project){S.projects.push(r.project);return r.project.id;}}catch(e){}return'default';}

/* ── Shell ── */
function renderShell(){
  var tb=$e('topbar');if(!tb)return;
  var sc=(S.status&&S.status.agents)||{},tc=(S.status&&S.status.tasks)||{};
  var on=sc.online||0,run=tc.running||0,rev=tc.needs_review||0,fail=tc.failed||0;
  tb.innerHTML='<span class=tb-logo>Agent Smith</span><span class=tb-dot>\\u2022</span>'+
    (hasSidebar?'<span class="tb-stat on">'+on+'/'+S.agents.length+' agents</span>':'')+
    (run?'<span class="tb-stat run">'+run+' running</span>':'')+
    (rev?'<span class="tb-stat rev">'+rev+' review</span>':'')+
    (fail?'<span class="tb-stat err">'+fail+' failed</span>':'')+
    '<span class=tb-fill></span>'+
    '<button class=tb-icon-btn onclick=doRefresh() title=Refresh>&#8635;</button>';
  renderBottomNav();
}
function renderBottomNav(){
  var el=$e('bottom-nav');if(!el||window.innerWidth>=768){if(el)el.innerHTML='';return;}
  if(!S.agentId&&!hasSidebar){el.innerHTML='';return;} /* LAN: show when rendering */
  if(!S.agentId&&hasSidebar){el.innerHTML='';return;}
  var tasks=S.tasks.filter(function(t){return t.assignedAgentId===S.agentId;});
  var rc=tasks.filter(function(t){return t.status==='needs_review';}).length;
  el.innerHTML=
    '<button class="bn-btn'+(S.tab==='chat'?' active':'')+'" onclick="setTab(\\'chat\\')"><span class=bn-icon>&#9993;</span>Chat</button>'+
    '<button class="bn-btn'+(S.tab==='tasks'?' active':'')+'" onclick="setTab(\\'tasks\\')"><span class=bn-icon>&#9783;</span>Tasks'+(rc?'<span class=bn-badge>'+rc+'</span>':'')+'</button>'+
    '<button class="bn-btn'+(S.tab==='files'?' active':'')+'" onclick="setTab(\\'files\\')"><span class=bn-icon>&#9642;</span>Files</button>'+
    '<button class="bn-btn'+(S.tab==='overview'?' active':'')+'" onclick="setTab(\\'overview\\')"><span class=bn-icon>&#9654;</span>Overview</button>';
}

function render(){
  renderShell();
  if(hasSidebar)renderSidebar();
  renderMainOnly();
}

/* ── Sidebar ── */
function renderSidebar(){
  var el=$e('sidebar');if(!el||!hasSidebar){if(el)el.style.display='none';return;}
  el.style.display='flex';
  var h='<div class=sb-hdr><span class=sb-title>Agents</span><span class=sb-ct>'+S.agents.length+'</span></div><div class=sb-list>';
  if(!S.agents.length)h+='<div class=sb-empty>No agents connected</div>';
  else S.agents.forEach(function(a){
    var sel=S.agentId===a.id;
    var tasks=S.tasks.filter(function(t){return t.assignedAgentId===a.id;});
    var act=tasks.filter(function(t){return t.status==='running'||t.status==='iterating'||t.status==='reviewing';}).length;
    var rev=tasks.filter(function(t){return t.status==='needs_review';}).length;
    h+='<div class="ai'+(sel?' sel':'')+'" onclick="selectAgent(\\''+a.id+'\\')">'+
      '<div class=ai-r1><span class="dot '+dotC(a.status)+'"></span><span class=ai-name>'+esc(a.name||short(a.id))+'</span></div>'+
      '<div class=ai-proj>'+esc(a.project_name||a.hostname||'\\u2014')+'</div>'+
      '<div class=ai-chips>'+(act?'<span class="ai-chip run">'+act+' running</span>':'')+(rev?'<span class="ai-chip rev">'+rev+' review</span>':'')+'</div>'+
      '<div class=ai-age>'+ago(a.last_heartbeat_at)+(a.index&&a.index.files?' \\u00b7 '+a.index.files+'f':'')+'</div>'+
    '</div>';
  });
  h+='</div>';el.innerHTML=h;
}

/* ── Main panel ── */
function renderMainOnly(){
  var el=$e('main-panel');if(!el)return;

  if(!S.agentId){
    el.innerHTML='<div class=empty-state><div class=es-inner><div class=es-icon>&#9635;</div><div class=es-title>Agent Smith</div><div class=es-sub>'+(hasSidebar?'Select an agent to manage tasks and chat':'')+'</div></div></div>';
    return;
  }
  var a=S.agents.find(function(x){return x.id===S.agentId;});
  var tasks=S.tasks.filter(function(t){return t.assignedAgentId===S.agentId;});
  var rc=tasks.filter(function(t){return t.status==='needs_review';}).length;

  var h='<div class=tab-bar>'+
    '<button class="tb2'+(S.tab==='chat'?' active':'')+'" onclick="setTab(\\'chat\\')">Chat</button>'+
    '<button class="tb2'+(S.tab==='tasks'?' active':'')+'" onclick="setTab(\\'tasks\\')">Tasks ('+tasks.length+')</button>'+
    '<button class="tb2'+(S.tab==='files'?' active':'')+'" onclick="setTab(\\'files\\')">Files</button>'+
    '<button class="tb2'+(S.tab==='overview'?' active':'')+'" onclick="setTab(\\'overview\\')">Overview</button>'+
    (a?'<div class=tab-agent><span class="dot '+dotC(a.status)+'"></span><span class=tab-agent-nm>'+esc(a.name||short(a.id))+'</span></div>':'')+
    '</div><div class=tab-content id=tab-content></div>';
  el.innerHTML=h;

  var tc=$e('tab-content');if(!tc)return;
  if(S.tab==='chat')renderChat(tc,a);
  else if(S.tab==='tasks')renderTasks(tc,a);
  else if(S.tab==='files')renderFiles(tc,a);
  else if(S.tab==='overview')renderOverview(tc,a);
}

/* ── Tabs ── */
function setTab(t){S.tab=t;if(t==='chat'){if(!S.chat.sessions.length)loadSessions();if(!S.chat.allModels.length)loadModels();}if(t==='files')loadFileTree();if(t==='overview'&&!S.dashData)loadDashboard();render();}
function selectAgent(id){
  S.agentId=id;S.tab='chat';
  if(hasSidebar&&id){agentBase='/api/agents/'+id;window.__setAgentApiBase(agentBase);}
  S.chat={sessions:[],sid:null,msgs:[],qtns:[],sending:false,allModels:[]};
  S.exp={};S.tl={};S.ingestOpen=false;S.newOpen=false;S.currentFile=null;S.fileContent=null;S.fileMimeType=null;S.fileIsImage=false;S.dashData=null;
  render();
  loadSessions();
  loadModels();
}

/* ── Chat ── */
function renderChat(el,a){
  var h='<div class=chat-outer><div class=chat-tb><select id=chat-sess class="sel ct-sel" onchange="pickSession(this.value)"><option value="">Select session...</option>'+S.chat.sessions.map(function(s){return'<option value="'+s.id+'"'+(S.chat.sid===s.id?' selected':'')+'>'+esc(s.title||short(s.id))+'</option>';}).join('')+'</select><button class="btn btn-sm btn-primary" onclick=newSession()>+ New</button>'+(S.chat.sid?'<button class="btn btn-sm" onclick=renameSession() title="Rename">&#9998;</button><button class="btn btn-sm btn-danger" onclick=deleteSession() title="Delete">&#10005;</button>':'')+'</div>';
  if(!S.chat.sid)h+='<div class=chat-no-sess>Select or create a session</div>';
  else{
    h+='<div class=chat-msgs id=chat-msgs>';
    if(!S.chat.msgs.length)h+='<div style="color:var(--tx2);font-size:12px;padding:10px;text-align:center">No messages yet</div>';
    else S.chat.msgs.forEach(function(m){var own=m.role==='user';h+='<div class="msg '+(own?'user':m.role)+'"><div class=msg-meta><span class="msg-role '+m.role+'">'+esc(m.role)+'</span>'+(m.model?'<span class=msg-model>'+esc(m.model)+'</span>':'')+(m.ts?'<span class=msg-time>'+new Date(m.ts).toISOString().slice(11,19)+'</span>':'')+'</div><div class=msg-bub>'+md(m.content||'')+'</div></div>';});
    h+='</div>';
    if(S.chat.qtns&&S.chat.qtns.length){h+='<div class=chat-qtns><div class=cq-title>Questions ('+S.chat.qtns.length+')</div>';S.chat.qtns.forEach(function(q){h+='<div class=cq-item><div class=cq-text>'+esc(q.question||q.text||'')+'</div><div class=cq-row><input class=cq-inp id="qa-'+q.id+'" placeholder="Answer..." onkeydown="if(event.key===\\'Enter\\'){answerQ(\\''+q.id+'\\');}"><button class="btn btn-sm btn-warn" onclick=answerQ("'+q.id+'")>Answer</button></div></div>';});h+='</div>';}
    h+='<div class=chat-inp-area><div class=chat-row><textarea id=chat-ta class=chat-ta rows=1 placeholder="Enter to send, Shift+Enter for newline" onkeydown="if(event.key===\\'Enter\\'&&!event.shiftKey){event.preventDefault();sendMsg();}" oninput="this.style.height=\\'auto\\';this.style.height=Math.min(this.scrollHeight,120)+\\'px\\'"></textarea><button class=chat-send-btn id=send-btn onclick=sendMsg() title=Send>&#10148;</button></div><div class=chat-opts><select class="sel chat-opt-sel" id=chat-kind><option value=ask>ask</option><option value=patch>patch</option><option value=retrieve>retrieve</option><option value=context>context</option></select><select class="sel chat-opt-sel" id=chat-model>'+modelOptions(a)+'</select></div><div class=chat-hint>Enter to send</div></div>';
  }
  h+='</div>';el.innerHTML=h;if(S.chat.sid)scrollChat();
}
async function pickSession(s){S.chat.sid=s||null;S.chat.msgs=[];S.chat.qtns=[];if(s)await loadMsgs(s);else renderMainOnly();}
async function newSession(){try{var r=await aapi('/chat/sessions',{method:'POST',body:{}});if(r.session){S.chat.sid=r.session.id;if(!S.chat.allModels.length)await loadModels();await loadSessions();await loadMsgs(r.session.id);}}catch(e){toast(e.message,true);}}
async function sendMsg(){if(!S.chat.sid)return;var inp=$e('chat-ta');if(!inp)return;var p=inp.value.trim();if(!p)return;var btn=$e('send-btn');S.chat.sending=true;inp.disabled=true;if(btn)btn.disabled=true;S.chat.msgs.push({role:'user',content:p,ts:Date.now()});inp.value='';inp.style.height='auto';renderMainOnly();scrollChat();try{var b={prompt:p};var ak=$e('chat-kind');if(ak&&ak.value)b.actionKind=ak.value;var mk=$e('chat-model');if(mk&&mk.value)b.model=mk.value;await aapi('/chat/sessions/'+S.chat.sid,{method:'POST',body:b});await loadMsgs(S.chat.sid);}catch(e){toast(e.message,true);}S.chat.sending=false;var i=$e('chat-ta');if(i)i.disabled=false;var b2=$e('send-btn');if(b2)b2.disabled=false;}
async function answerQ(qid){var inp=$e('qa-'+qid);if(!inp)return;var a=inp.value.trim();if(!a){toast('Enter an answer',true);return;}try{await aapi('/questions/'+qid,{method:'POST',body:{answer:a}});toast('Answered','');await loadMsgs(S.chat.sid);}catch(e){toast(e.message,true);}}
async function deleteSession(){if(!S.chat.sid)return;ask('Delete this session and all its messages?',async function(){try{await aapi('/chat/sessions/'+S.chat.sid,{method:'DELETE'});toast('Deleted','');S.chat.sid=null;S.chat.msgs=[];S.chat.qtns=[];await loadSessions();}catch(e){toast(e.message,true);}});}
async function renameSession(){if(!S.chat.sid)return;var cur=S.chat.sessions.find(function(s){return s.id===S.chat.sid;});var nm=prompt('New session name:',cur?cur.title:'');if(!nm||!nm.trim())return;try{await aapi('/chat/sessions/'+S.chat.sid,{method:'PATCH',body:{title:nm.trim()}});toast('Renamed','');var sel=$e('chat-sess');if(sel){var opt=sel.querySelector('option[value="'+S.chat.sid+'"]');if(opt)opt.textContent=nm.trim();}}catch(e){toast(e.message,true);}}

/* ── Tasks ── */
function renderTasks(el,a){
  var all=S.tasks.filter(function(t){return t.assignedAgentId===S.agentId;});
  var tasks=all;if(S.filter.status)tasks=tasks.filter(function(t){return t.status===S.filter.status;});if(S.filter.q){var q=S.filter.q.toLowerCase();tasks=tasks.filter(function(t){return t.title&&t.title.toLowerCase().indexOf(q)!==-1;});}
  var h='<div class=tab-scroll><div class=action-bar style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick=doDispatchNext()>Dispatch Next</button><button class="btn btn-sm" onclick=toggleIngest()>Ingest Flow</button><button class="btn btn-sm" onclick=toggleNew()>+ New Task</button></div>';
  if(S.ingestOpen)h+=renderIngest();
  if(S.newOpen)h+=renderNew();
  h+='<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap"><input class=inp style="flex:1;min-width:100px;min-height:36px" id=fq placeholder="Search" value="'+esc(S.filter.q||'')+'" oninput="S.filter.q=this.value;renderTasksOnly()"><select class=sel onchange="S.filter.status=this.value;renderTasksOnly()" style="min-height:36px"><option value="">All</option>'+['queued','assigned','running','reviewing','iterating','needs_review','auto_approved','completed','failed','skipped'].map(function(s){return'<option value="'+s+'"'+(S.filter.status===s?' selected':'')+'>'+s.replace(/_/g,' ')+'</option>';}).join('')+'</select></div>';
  if(!tasks.length)h+='<div class=empty style="padding:20px">'+(all.length?'No tasks match filters':'No tasks assigned yet')+'</div>';
  else{var g={},ord=['running','reviewing','iterating','needs_review','auto_approved','assigned','queued','completed','failed','skipped','cancelled'];tasks.forEach(function(t){g[t.status]=g[t.status]||[];g[t.status].push(t);});ord.forEach(function(grp){var arr=g[grp];if(!arr||!arr.length)return;h+='<div class=task-group><div class=group-hdr>'+grp.replace(/_/g,' ')+'<span class=group-ct>'+arr.length+'</span></div>';arr.forEach(function(t){h+=taskCard(t);});h+='</div>';});}
  h+='</div>';el.innerHTML=h;
}
function taskCard(t){var exp=!!S.exp[t.id];var h='<div class="tcard'+(exp?' exp':'')+'"><div class=tc-head onclick="toggleExpand(\\''+t.id+'\\')">'+stag(t.status)+ibadge(t)+'<span class=tc-title>'+esc(t.title)+'</span><span class=tc-chev>&#9660;</span></div><div class=tc-actions><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();doDispatch(\\''+t.id+'\\')">Dispatch</button>'+(t.status==='needs_review'?'<button class="btn btn-sm btn-success" onclick="event.stopPropagation();ask(\\'Approve?\\',function(){doAct(\\'/tasks/'+t.id+'/approve\\',{apply:false})})">Approve</button>':'')+'<button class="btn btn-sm" onclick="event.stopPropagation();ask(\\'Restart?\\',function(){doAct(\\'/tasks/'+t.id+'/restart\\')})">Restart</button><button class="btn btn-sm" onclick="event.stopPropagation();ask(\\'Skip?\\',function(){doAct(\\'/tasks/'+t.id+'/skip\\')})">Skip</button></div>';if(exp){h+='<div class=tc-exp>';var tl=S.tl[t.id];if(tl===undefined)h+='<div class=loading>Loading...</div>';else if(tl===null)h+='<div style="color:var(--red);font-size:11px;padding:8px">Timeline unavailable</div>';else h+=renderTimeline(t,tl);h+='</div>';}h+='</div>';return h;}
function renderTimeline(t,tl){var tk=tl.task||t,its=tl.iterations||[],evs=tl.events||[];var h='<div class=tl-meta><span class=tl-meta-k>Models:</span><span class=tl-meta-v>'+esc(tk.implementModel||'?')+'->'+esc(tk.reviewModel||'?')+'</span>'+(tk.autoApprove?'<span class=tl-meta-k style="color:var(--green)">Auto-approve</span>':'')+(tk.autoApply?'<span class=tl-meta-k style="color:var(--cyan)">Auto-apply</span>':'')+'</div><div class=tl-sect><div class=tl-sh>Prompt</div><div class=tl-prompt>'+esc(tk.prompt||'')+'</div></div>';
  h+='<div class=tl-sect><div class=tl-sh>Policy <button class="btn btn-xs" onclick="var p=$e(\\'pol-'+t.id+'\\');p.style.display=p.style.display===\\'none\\'?\\'block\\':\\'none\\'">Edit</button></div><div id="pol-'+t.id+'" style=display:none class=pol-form><div class=pol-grid><div class=pol-field><label>Impl Model</label><input id="pi-'+t.id+'" value="'+esc(tk.implementModel||'')+'"></div><div class=pol-field><label>Rev Model</label><input id="pr-'+t.id+'" value="'+esc(tk.reviewModel||'')+'"></div></div><div class=pol-checks><label class=pol-ck><input type=checkbox id="pa-'+t.id+'"'+(tk.autoApprove?' checked':'')+'>Auto Approve</label><label class=pol-ck><input type=checkbox id="pl-'+t.id+'"'+(tk.autoApply?' checked':'')+'>Auto Apply</label></div><button class="btn btn-sm btn-primary" onclick="savePolicy(\\''+t.id+'\\')">Save</button></div></div>';
  if(its.length){h+='<div class=tl-sect><div class=tl-sh>Iterations ('+its.length+')</div>';its.forEach(function(d){var it=d.iteration;h+='<div class=it-card><div class=it-hdr><span class=it-n>#'+it.iterationIndex+'</span>'+stag(it.status)+(it.implementModel?'<span class=badge>'+esc(it.implementModel)+'</span>':'')+'</div>';if(d.implementationSummary)h+='<div class=it-sum>'+md(d.implementationSummary.slice(0,500))+'</div>';if(Array.isArray(d.changedFiles)&&d.changedFiles.length){h+='<div class=it-files>';d.changedFiles.forEach(function(f){h+='<span class=it-file>'+(typeof f==='string'?esc(f):'+'+f.additions+' -'+f.deletions+' '+esc(f.path))+'</span>';});h+='</div>';}if(Array.isArray(d.checkResults)&&d.checkResults.length){h+='<div class=it-checks>';d.checkResults.forEach(function(c){h+='<span class="it-ck '+(c.ok?'pass':'fail')+'">'+(c.ok?'ok':'fail')+' '+esc(c.name)+'</span>';});h+='</div>';}if(d.diffPreview){var df='df-'+t.id+'-'+it.iterationIndex;h+='<button class=diff-btn onclick="var p=$e(\\''+df+'\\');p.style.display=p.style.display===\\'none\\'?\\'block\\':\\'none\\'">Show diff</button><pre class=diff-block id="'+df+'" style=display:none>'+esc(d.diffPreview)+'</pre>';}if(d.reviewDecision)h+='<div class=it-rev><span class="it-dec '+d.reviewDecision+'">'+d.reviewDecision+'</span> '+md(d.reviewFeedback||'')+'</div>';if(d.reviewNextPrompt)h+='<div class=it-next>'+md(d.reviewNextPrompt.slice(0,400))+'</div>';h+='</div>';});h+='</div>';}
  if(evs.length){h+='<div class=tl-sect><div class=tl-sh>Events</div>';evs.slice(-15).forEach(function(e){h+='<div style="font-size:10px;color:var(--tx2);padding:3px 0;border-bottom:1px solid var(--bd)"><span style="color:var(--tx3);margin-right:6px;font-family:var(--mono)">'+new Date(e.createdAt).toISOString().slice(11,19)+'</span>'+esc(e.eventType)+': '+esc((e.message||'').slice(0,200))+'</div>';});h+='</div>';}
  h+='<div class=tl-actions><button class="btn btn-sm btn-primary" onclick="doDispatch(\\''+t.id+'\\')">Dispatch</button>'+'<button class="btn btn-sm" onclick="ask(\\'Restart?\\',function(){doAct(\\'/tasks/'+t.id+'/restart\\')})">Restart</button>'+'<button class="btn btn-sm" onclick="ask(\\'Skip?\\',function(){doAct(\\'/tasks/'+t.id+'/skip\\')})">Skip</button></div>';
  return h;
}
function renderIngest(){return'<div class=ingest-panel><div class=ip-title>Ingest Task Flow</div><div class=ip-grid><div class=ip-field><label>Format</label><select id=ing-fmt onchange="S.ing.format=this.value">'+['auto','markdown','json','csv','plain'].map(function(f){return'<option value='+f+'>'+f+'</option>';}).join('')+'</select></div><div class=ip-field><label>Max Iterations</label><input id=ing-mi type=number value="'+S.ing.maxIter+'" min=1 max=20 oninput="S.ing.maxIter=parseInt(this.value)||1"></div></div><textarea class=ingest-ta id=ing-text placeholder="Paste tasks (markdown, JSON, CSV, plain)..." oninput="S.ing.text=this.value">'+esc(S.ing.text)+'</textarea><div class=ip-btns><button class=btn onclick=previewIngest()>Preview</button><button class="btn btn-success" onclick=runIngest()>Import</button><button class=btn onclick="S.ingestOpen=false;renderTasksOnly()">Close</button></div>'+(S.ing.preview?'<div class=ip-result>Parsed: '+(S.ing.preview.tasks?S.ing.preview.tasks.length:0)+' tasks</div>':'')+'</div>';}
function renderNew(){return'<div class=new-task-panel><div class=ntp-title>+ New Task</div><input id=nt-title class=inp placeholder="Task title..." style="margin-bottom:6px;min-height:36px"><textarea id=nt-prompt class=nt-ta rows=3 placeholder="Description..."></textarea><div class=nt-grid><div class=nt-field><label>Mode</label><select id=nt-mode><option value=patch>Patch</option><option value=ask>Ask</option><option value=retrieve>Retrieve</option></select></div><div class=nt-field><label>Max Iterations</label><input id=nt-mi type=number value=3 min=1 max=20></div></div><div class=nt-btns><button class="btn btn-primary btn-sm" onclick=createTask()>Create Task</button><button class="btn btn-sm" onclick="S.newOpen=false;renderTasksOnly()">Cancel</button></div></div>';}
async function doAct(path,body){try{await api(path,{method:'POST',body:body});toast('Done','');refresh(true);}catch(e){toast(e.message,true);}}
async function doDispatch(id){doAct('/tasks/'+id+'/dispatch',{});}
async function doDispatchNext(){try{await api('/tasks/dispatch-next',{method:'POST',body:{agentId:S.agentId}});toast('Dispatched','');refresh(true);}catch(e){toast(e.message,true);}}
async function savePolicy(id){try{await api('/tasks/'+id,{method:'PATCH',body:{implementModel:($e('pi-'+id)||{}).value||null,reviewModel:($e('pr-'+id)||{}).value||null,autoApprove:!!($e('pa-'+id)||{}).checked,autoApply:!!($e('pl-'+id)||{}).checked}});toast('Saved','');delete S.tl[id];refresh(true);}catch(e){toast(e.message,true);}}
async function createTask(){var ti=($e('nt-title')||{}).value||'',pr=($e('nt-prompt')||{}).value||'';if(!ti.trim()||!pr.trim()){toast('Title and prompt required',true);return;}try{var pid=S.projects[0]?S.projects[0].id:'default';var r=await api('/tasks',{method:'POST',body:{projectId:pid,title:ti.trim(),prompt:pr.trim(),mode:($e('nt-mode')||{}).value||'patch',maxIterations:parseInt(($e('nt-mi')||{}).value)||3}});if(r.task&&S.agentId)await api('/tasks/'+r.task.id+'/assign',{method:'POST',body:{agentId:S.agentId}});toast('Created','');S.newOpen=false;refresh(true);}catch(e){toast(e.message,true);}}
async function previewIngest(){var t=($e('ing-text')||{}).value||'';if(!t.trim()){toast('Paste tasks first',true);return;}try{var r=await api('/tasks/import-preview',{method:'POST',body:{text:t,format:S.ing.format}});S.ing.preview=r.preview||r;toast('Parsed '+((S.ing.preview.tasks||[]).length)+' tasks','');}catch(e){toast(e.message,true);}renderTasksOnly();}
async function runIngest(){var t=($e('ing-text')||{}).value||'';if(!t.trim()){toast('Nothing to import',true);return;}try{var pid=await ensureProject();await api('/tasks/import',{method:'POST',body:{text:t,format:S.ing.format,defaults:{projectId:pid,assignedAgentId:S.agentId||undefined,maxIterations:S.ing.maxIter||1},options:{createMissingBuckets:true,skipDuplicates:true}}});toast('Imported','');S.ingestOpen=false;S.ing.preview=null;refresh(true);}catch(e){toast(e.message,true);}}
function toggleIngest(){S.ingestOpen=!S.ingestOpen;S.newOpen=false;renderTasksOnly();}
function toggleNew(){S.newOpen=!S.newOpen;S.ingestOpen=false;renderTasksOnly();}
function toggleExpand(id){S.exp[id]=!S.exp[id];if(S.exp[id]&&S.tl[id]===undefined)loadTimeline(id);else renderTasksOnly();}
function renderTasksOnly(){var tc=$e('tab-content'),a=S.agents.find(function(x){return x.id===S.agentId;});if(!tc||!a||S.tab!=='tasks')return;renderTasks(tc,a);}

/* ── Files ── */
function renderFiles(el,a){
  var h='<div class=files-layout><div class=file-tree-pane><div class=ftp-hdr><input class=ftp-search placeholder="Filter files..." value="'+esc(S.treeFilter||'')+'" oninput="filterTree(this.value)"></div><div class=ftp-tree id=file-tree></div></div><div class=file-preview-pane id=file-preview-pane><div class=fpp-empty>Select a file to preview</div></div></div>';
  el.innerHTML=h;loadFileTree();
}
function renderFileTree(){var el=$e('file-tree');if(!el||!S._fileTree)return;var files=S._fileTree;if(!files.length){el.innerHTML='<div class=empty style="padding:12px">No indexed files</div>';return;}var tree={},all=files.slice().sort(function(a,b){return a.path.localeCompare(b.path);});all.forEach(function(f){var p=f.path.replace(/^\\.\\//,'');var parts=p.split('/');var node=tree;for(var i=0;i<parts.length-1;i++){if(!node[parts[i]])node[parts[i]]={d:true,c:{}};node=node[parts[i]].c;}node[parts[parts.length-1]]={f:true,path:f.path,lang:f.language};});function renderNode(name,n,depth){if(n.f){var ext=name.split('.').pop();var icon={ts:'ts',tsx:'tsx',js:'js',py:'py',go:'go',rs:'rs',json:'{}',md:'md',html:'htm',css:'css',sql:'sql'}[ext]||'\\u00b7';var sel=S.currentFile===n.path?' active':'';return'<div class="tree-file'+sel+'" onclick="openFile(\\''+n.path+'\\')" style=padding-left:'+(depth*12+8)+'px><span class=tree-icon>'+icon+'</span><span class=tree-name>'+esc(name)+'</span>'+(n.lang?'<span class=tree-lang>'+esc(n.lang)+'</span>':'')+'</div>';}var ch=n.c||{},sorted=Object.entries(ch).sort(function(a,b){var af=a[1].f,bf=b[1].f;if(af!==bf)return af?1:-1;return a[0].localeCompare(b[0]);});var id='fd'+Math.random().toString(36).slice(2);return'<div class=tree-folder style=padding-left:'+(depth*12+6)+'px onclick="var c=$e(\\''+id+'\\');c.classList.toggle(\\'collapsed\\')"><span class=tree-icon>&#9660;</span><span class=tree-name>'+esc(name)+'</span></div><div class=tree-children id='+id+'>'+sorted.map(function(e){return renderNode(e[0],e[1],depth+1);}).join('')+'</div>';}var entries=Object.entries(tree).sort(function(a,b){var af=a[1].f,bf=b[1].f;if(af!==bf)return af?1:-1;return a[0].localeCompare(b[0]);});el.innerHTML=entries.map(function(e){return renderNode(e[0],e[1],0);}).join('');}
function filterTree(q){S.treeFilter=q;var lq=q.toLowerCase();document.querySelectorAll('#file-tree .tree-file').forEach(function(el){el.style.display=(!lq||(el.querySelector('.tree-name')||{}).textContent.toLowerCase().indexOf(lq)!==-1)?'':'none';});document.querySelectorAll('#file-tree .tree-folder').forEach(function(el){var ch=el.nextElementSibling;if(!ch||!ch.classList.contains('tree-children'))return;var any=ch.querySelectorAll('.tree-file:not([style*="display: none"])').length>0;el.style.display=(any||!lq)?'':'none';if(lq&&any)ch.classList.remove('collapsed');});}
async function openFile(path){
  S.currentFile=path;S.fileEditing=false;S.fileSummary=null;
  var pp=$e('file-preview-pane');if(!pp)return;
  var ext=(path.split('.').pop()||'').toLowerCase();
  var imgExts={png:1,jpg:1,jpeg:1,gif:1,svg:1,webp:1,bmp:1,ico:1};
  pp.innerHTML='<div class=fpp-hdr><span class=fpp-path>'+esc(path)+'</span><div class=fpp-actions>'+(imgExts[ext]?'':'<button class="btn btn-xs" id=edit-btn onclick=toggleEdit()>Edit</button>')+'</div></div><div class=fpp-body id=fpp-body>'+(imgExts[ext]?'<div class=fpp-img-wrap id=fpp-img-wrap>Loading...</div>':'<div class=fpp-pre id=fpp-pre>Loading...</div><textarea class=fpp-ta id=fpp-ta style=display:none></textarea>')+'</div><div class=fpp-summary id=fpp-sum style=display:none></div>';
  try{var r=await aapi('/file?path='+encodeURIComponent(path));S.fileContent=r.content||'';S.fileSummary=r.summary||null;S.fileMimeType=r.mimeType||null;S.fileIsImage=r.isImage||false;updateFilePreview();}catch(e){var pre=$e('fpp-pre');if(pre)pre.textContent='Error: '+e.message;var iw=$e('fpp-img-wrap');if(iw)iw.textContent='Error: '+e.message;}
}
function updateFilePreview(){
  if(S.fileIsImage){
    var iw=$e('fpp-img-wrap');if(iw&&S.fileContent){iw.innerHTML='<img src="data:'+(S.fileMimeType||'image/png')+';base64,'+S.fileContent+'" style="max-width:100%;max-height:70vh;display:block;margin:0 auto" alt="'+esc(S.currentFile||'')+'">';}
    var sum=$e('fpp-sum');if(sum){if(S.fileSummary){sum.textContent=S.fileSummary;sum.style.display='';}else sum.style.display='none';}
    return;
  }
  var pre=$e('fpp-pre'),ta=$e('fpp-ta'),eb=$e('edit-btn'),sum=$e('fpp-sum');
  if(S.fileEditing){if(pre)pre.style.display='none';if(ta){ta.value=S.fileContent||'';ta.style.display='';}if(eb)eb.textContent='View';}else{if(pre){pre.textContent=S.fileContent||'';pre.style.display='';}if(ta)ta.style.display='none';if(eb)eb.textContent='Edit';}
  if(sum){if(S.fileSummary){sum.textContent=S.fileSummary;sum.style.display='';}else sum.style.display='none';}
}
function toggleEdit(){S.fileEditing=!S.fileEditing;if(S.fileEditing){var ta=$e('fpp-ta');if(ta)S.fileContent=ta.value||S.fileContent;}updateFilePreview();}

/* ── Overview ── */
function renderOverview(el,a){
  if(!S.dashData){el.innerHTML='<div class=tab-scroll><div class=empty style="padding:40px">Loading...</div></div>';return;}
  var d=S.dashData,sp=d.totalFiles>0?Math.min(100,Math.round(d.totalWithSummary/d.totalFiles*100)):0;
  var h='<div class=tab-scroll><div class=ov-grid>'+card(d.totalFiles,'Files')+card(d.totalSymbols||0,'Symbols')+card(d.totalImports||0,'Imports')+card(sp+'%','Summarized',sp)+'</div>';
  if(d.projectSummary)h+='<div class=ov-sect><div class=ov-sh>Project Summary</div><div class=ov-summary>'+esc(d.projectSummary)+'</div></div>';
  if(d.langCounts&&d.langCounts.length){var max=d.langCounts[0]?d.langCounts[0].count:1;h+='<div class=ov-sect><div class=ov-sh>Languages</div>';d.langCounts.slice(0,12).forEach(function(l){h+='<div class=lang-bar><span class=lang-name>'+esc(l.language)+'</span><div class=lang-track><div class=lang-fill style=width:'+Math.round(l.count/max*100)+'%></div></div><span class=lang-ct>'+l.count+'</span></div>';});h+='</div>';}
  if(d.topTags&&d.topTags.length){h+='<div class=ov-sect><div class=ov-sh>Key Tags</div><div style="display:flex;gap:4px;flex-wrap:wrap">';d.topTags.forEach(function(t){h+='<span class=ftag>'+esc(t.name)+' '+t.count+'</span>';});h+='</div></div>';}
  var top=(d.files||[]).filter(function(f){return f.summary;}).sort(function(a,b){return b.importance-a.importance;}).slice(0,20);
  h+='<div class=ov-sect><div class=ov-sh>Top Files</div>';if(!top.length)h+='<div style="color:var(--tx3);font-size:11px">No summaries yet</div>';else top.forEach(function(f,i){var stars=f.importance>=8?'\\u2605\\u2605\\u2605':f.importance>=5?'\\u2605\\u2605':f.importance>=3?'\\u2605':'';h+='<div class=file-row onclick="openFile(\\''+f.path+'\\');setTab(\\'files\\')"><div style="display:flex;gap:6px"><span style="color:var(--tx3);font-size:10px">'+(i+1)+'.</span><span class=file-path>'+esc(f.path)+'</span>'+stars+'</div>'+(f.tags&&f.tags.length?'<div class=file-tags>'+f.tags.map(function(x){return'<span class=ftag>'+esc(x)+'</span>';}).join('')+'</div>':'')+(f.summary?'<div class=file-sum>'+esc(f.summary)+'</div>':'')+'</div>';});
  h+='</div>';el.innerHTML=h;
}
function card(v,l,p){return'<div class=ov-card><div class=ov-val>'+esc(String(v))+'</div><div class=ov-lbl>'+esc(l)+'</div>'+(p!=null?'<div class=ov-bar><div class=ov-bar-fill style=width:'+p+'%></div></div>':'')+'</div>';}

/* ── Actions ── */
function doRefresh(){refresh(false);}

/* ── Boot ── */
window.addEventListener('DOMContentLoaded',function(){
  document.addEventListener('focusin',function(e){if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT')S.typing=true;});
  document.addEventListener('focusout',function(e){if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT')S.typing=false;});
  window.addEventListener('resize',function(){renderBottomNav();});
  if(!hasSidebar&&!S.agentId)S.agentId='_'; /* LAN: always have an agent context */
  loadModels();
  refresh(false);
  setInterval(function(){if(!S.typing&&!S.chat.sending)refresh(true);},3000);
});

/* ── Exports ── */
window.$e=$e;window.S=S;
window.selectAgent=selectAgent;window.setTab=setTab;window.doRefresh=doRefresh;
window.toggleExpand=toggleExpand;window.doDispatchNext=doDispatchNext;
window.doDispatch=doDispatch;window.doAct=doAct;window.savePolicy=savePolicy;
window.createTask=createTask;window.previewIngest=previewIngest;window.runIngest=runIngest;
window.toggleIngest=toggleIngest;window.toggleNew=toggleNew;
window.pickSession=pickSession;window.newSession=newSession;window.sendMsg=sendMsg;window.answerQ=answerQ;
window.deleteSession=deleteSession;window.renameSession=renameSession;
window.openFile=openFile;window.filterTree=filterTree;window.toggleEdit=toggleEdit;
window.ask=ask;window.yesConfirm=yesConfirm;window.noConfirm=noConfirm;
window.render=render;window.refresh=refresh;window.renderTasksOnly=renderTasksOnly;
window.renderMainOnly=renderMainOnly;
})();
`;
