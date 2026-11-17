import "server-only";

import { MCP_PATH } from "../config";
import { sha256Hex } from "../oauth/crypto";

// MCP App confirmation view (BYT-20261117-001 §5, MCP Apps / SEP-1865).
//
// One self-contained HTML document: inline CSS + a minimal hand-written
// postMessage JSON-RPC bridge (ui/initialize → tool-result → tools/call),
// no external scripts, styles, fonts or images, and `_meta.ui.csp` empty
// (→ connect-src 'none'). Every string it shows comes from the tool result
// (`_meta["resiapp/confirm"].labels`, localised server-side from the
// sk/en/cs catalogs); user / third-party text is only ever set via
// textContent. The document is constant — no per-call or per-instance
// content — so hosts can cache it.

export const CONFIRM_VIEW_URI = "ui://resiapp/confirm";

/**
 * Claude's sandbox origin for this instance: first 32 hex chars of
 * SHA-256(<origin>/api/mcp) + ".claudemcpcontent.com" (§5). Computed per
 * instance at runtime.
 */
export function confirmViewDomain(origin: string): string {
  return `${sha256Hex(`${origin}${MCP_PATH}`).slice(0, 32)}.claudemcpcontent.com`;
}

const CSS = `
:root{
  color-scheme:light dark;
  --c-bg:var(--color-background-primary,#ffffff);
  --c-bg2:var(--color-background-secondary,#f4f4f5);
  --c-text:var(--color-text-primary,#18181b);
  --c-muted:var(--color-text-secondary,#52525b);
  --c-border:var(--color-border-primary,#d4d4d8);
  --c-accent:var(--color-background-inverse,#18181b);
  --c-on-accent:var(--color-text-inverse,#ffffff);
  --c-warn-bg:var(--color-background-warning,#fef3c7);
  --c-warn:var(--color-text-warning,#92400e);
  --c-danger:var(--color-text-danger,#b91c1c);
  --c-ok:var(--color-text-success,#15803d);
  --radius:var(--border-radius-lg,12px);
  --radius-sm:var(--border-radius-md,8px);
  --font:var(--font-sans,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
}
:root[data-theme="dark"]{
  --c-bg:var(--color-background-primary,#18181b);
  --c-bg2:var(--color-background-secondary,#27272a);
  --c-text:var(--color-text-primary,#f4f4f5);
  --c-muted:var(--color-text-secondary,#a1a1aa);
  --c-border:var(--color-border-primary,#3f3f46);
  --c-accent:var(--color-background-inverse,#f4f4f5);
  --c-on-accent:var(--color-text-inverse,#18181b);
  --c-warn-bg:var(--color-background-warning,#422006);
  --c-warn:var(--color-text-warning,#fcd34d);
  --c-danger:var(--color-text-danger,#f87171);
  --c-ok:var(--color-text-success,#4ade80);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--c-bg);color:var(--c-text);font-family:var(--font);font-size:16px;line-height:1.45}
main{padding:16px;max-width:640px;margin:0 auto}
h1{font-size:1.2rem;margin:0 0 4px}
.sub{color:var(--c-muted);margin:0 0 12px}
dl{margin:0 0 12px;border:1px solid var(--c-border);border-radius:var(--radius);overflow:hidden}
.row{display:grid;grid-template-columns:minmax(0,38%) minmax(0,1fr);gap:8px;padding:10px 12px;border-top:1px solid var(--c-border)}
.row:first-child{border-top:0}
dt{color:var(--c-muted);overflow-wrap:anywhere}
dd{margin:0;overflow-wrap:anywhere}
.multi{white-space:pre-wrap}
.untrusted{border-left:3px solid var(--c-border);padding-left:8px}
.before{color:var(--c-muted);text-decoration:line-through}
.arrow{color:var(--c-muted);padding:0 6px}
.after{font-weight:600}
@media (max-width:420px){.row{grid-template-columns:1fr;gap:2px}}
h2{font-size:1rem;margin:12px 0 4px}
ul{margin:0 0 8px;padding-left:20px}
.warn{background:var(--c-warn-bg);color:var(--c-warn);border-radius:var(--radius-sm);padding:8px 12px;margin:8px 0}
.warn ul{margin:0}
.note{color:var(--c-muted);font-size:.875rem;margin:8px 0}
.actions{display:flex;gap:12px;margin:16px 0 8px;flex-wrap:wrap}
button{font:inherit;font-size:1.05rem;font-weight:600;min-height:48px;flex:1 1 140px;border-radius:var(--radius-sm);cursor:pointer;padding:10px 16px}
button:disabled{opacity:.55;cursor:default}
.primary{background:var(--c-accent);color:var(--c-on-accent);border:1px solid var(--c-accent)}
.secondary{background:var(--c-bg2);color:var(--c-text);border:1px solid var(--c-border)}
button:focus-visible,a:focus-visible{outline:2px solid var(--color-ring-primary,#2563eb);outline-offset:2px}
.status{margin:8px 0;font-weight:600}
.status.ok{color:var(--c-ok)}
.status.err{color:var(--c-danger)}
a{color:inherit}
.hidden{display:none}
`;

const SCRIPT = `
(function(){
"use strict";
var PROTOCOL="2026-01-26";
var META="resiapp/confirm";
var nextId=1,pending={},payload=null,busy=false;
var root=document.getElementById("app");

function send(m){window.parent.postMessage(m,"*");}
function request(method,params){
  var id=nextId++;
  return new Promise(function(resolve,reject){
    pending[id]={resolve:resolve,reject:reject};
    send({jsonrpc:"2.0",id:id,method:method,params:params||{}});
  });
}
function notify(method,params){send({jsonrpc:"2.0",method:method,params:params||{}});}

function applyContext(ctx){
  if(!ctx)return;
  var el=document.documentElement;
  if(ctx.theme==="dark"||ctx.theme==="light")el.setAttribute("data-theme",ctx.theme);
  var vars=ctx.styles&&ctx.styles.variables;
  if(vars){for(var k in vars){if(k.indexOf("--")===0&&typeof vars[k]==="string")el.style.setProperty(k,vars[k]);}}
}

function h(tag,cls,text){
  var e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!==undefined&&text!==null)e.textContent=String(text);
  return e;
}

function reportSize(){
  notify("ui/notifications/size-changed",{height:Math.ceil(document.documentElement.getBoundingClientRect().height)});
}

function openLink(url){
  request("ui/open-link",{url:url}).catch(function(){});
}

function linkTo(url,label){
  var a=h("a",null,label);
  a.href=url;a.target="_blank";a.rel="noopener noreferrer";
  a.addEventListener("click",function(ev){ev.preventDefault();openLink(url);});
  return a;
}

function errorKey(code){
  if(typeof code!=="string")return "generic";
  if(code.indexOf("validation.")===0)return "validation";
  return code.replace(".","_");
}

function render(p){
  payload=p;
  var L=p.labels,pv=p.preview;
  document.documentElement.lang=p.locale||"sk";
  root.textContent="";
  root.appendChild(h("h1",null,pv.title));
  root.appendChild(h("p","sub",pv.summary));

  var dl=h("dl"),anyUntrusted=false;
  (pv.rows||[]).forEach(function(r){
    var row=h("div","row");
    row.appendChild(h("dt",null,r.label));
    var dd=h("dd",(r.multiline?"multi ":"")+(r.untrusted?"untrusted":""));
    if(r.untrusted)anyUntrusted=true;
    if(r.before!==undefined||r.after!==undefined){
      dd.appendChild(h("span","before",r.before==null?"—":r.before));
      dd.appendChild(h("span","arrow","→"));
      dd.appendChild(h("span","after",r.after==null?"—":r.after));
    }else{
      dd.textContent=r.value==null?"—":String(r.value);
    }
    row.appendChild(dd);
    dl.appendChild(row);
  });
  root.appendChild(dl);

  if(pv.consequences&&pv.consequences.length){
    root.appendChild(h("h2",null,L.consequences));
    var ul=h("ul");
    pv.consequences.forEach(function(c){ul.appendChild(h("li",null,c));});
    root.appendChild(ul);
  }
  if(pv.warnings&&pv.warnings.length){
    var box=h("div","warn");
    box.setAttribute("role","note");
    box.appendChild(h("strong",null,L.warnings));
    var wl=h("ul");
    pv.warnings.forEach(function(w){wl.appendChild(h("li",null,w));});
    box.appendChild(wl);
    root.appendChild(box);
  }
  if(anyUntrusted)root.appendChild(h("p","note",L.untrusted));
  root.appendChild(h("p","note",L.expires));

  var actions=h("div","actions");
  var ok=h("button","primary",pv.confirmLabel||L.confirm);ok.type="button";
  var no=h("button","secondary",L.cancel);no.type="button";
  ok.addEventListener("click",function(){decide("confirm_action");});
  no.addEventListener("click",function(){decide("cancel_action");});
  actions.appendChild(ok);actions.appendChild(no);
  root.appendChild(actions);

  var status=h("p","status");
  status.id="status";
  status.setAttribute("role","status");
  status.setAttribute("aria-live","polite");
  root.appendChild(status);

  var hint=h("p","note");
  hint.appendChild(document.createTextNode(L.fallbackHint+" "));
  hint.appendChild(linkTo(p.confirmUrl,L.openInApp));
  hint.id="hint";
  root.appendChild(hint);
  reportSize();
}

function setStatus(text,kind){
  var s=document.getElementById("status");
  if(!s)return;
  s.textContent=text||"";
  s.className="status"+(kind?" "+kind:"");
}

function finish(){
  var a=root.querySelector(".actions");if(a)a.classList.add("hidden");
  var hint=document.getElementById("hint");if(hint)hint.classList.add("hidden");
  if(payload)payload.confirmToken=null;
}

function decide(tool){
  if(busy||!payload||!payload.confirmToken)return;
  busy=true;
  var buttons=root.querySelectorAll("button");
  for(var i=0;i<buttons.length;i++)buttons[i].disabled=true;
  setStatus(payload.labels.working,"");
  request("tools/call",{name:tool,arguments:{actionId:payload.actionId,confirmToken:payload.confirmToken}})
    .then(function(res){
      var sc=(res&&res.structuredContent)||{};
      if(res&&res.isError){
        var code=sc.error&&sc.error.code;
        var key=errorKey(code);
        var msg=payload.labels.errors[key]||payload.labels.errors.generic;
        setStatus(msg,"err");
        if(code==="rate_limited"||code==="internal"){
          busy=false;
          for(var j=0;j<buttons.length;j++)buttons[j].disabled=false;
        }else{
          finish();
          tellModel("failed",code||"error",null);
        }
        reportSize();
        return;
      }
      setStatus(sc.message||"", sc.status==="confirmed"?"ok":"");
      if(sc.url){
        var s=document.getElementById("status");
        s.appendChild(document.createTextNode(" "));
        s.appendChild(linkTo(sc.url,payload.labels.openInApp));
      }
      finish();
      tellModel(sc.status||"done",sc.message||"",sc.url||null);
      reportSize();
    })
    .catch(function(){
      busy=false;
      for(var k=0;k<buttons.length;k++)buttons[k].disabled=false;
      setStatus(payload.labels.errors.generic,"err");
      reportSize();
    });
}

function tellModel(status,message,url){
  var text="Pending action "+payload.actionId+" ("+payload.preview.kind+"): "+status+(message?" — "+message:"")+(url?" "+url:"");
  request("ui/update-model-context",{
    content:[{type:"text",text:text}],
    structuredContent:{actionId:payload.actionId,kind:payload.preview.kind,status:status,url:url}
  }).catch(function(){});
}

function onToolResult(res){
  var meta=res&&res._meta&&res._meta[META];
  if(meta&&meta.preview&&meta.labels){render(meta);return;}
  var text=res&&res.content&&res.content[0]&&res.content[0].text;
  root.textContent="";
  root.appendChild(h("p","status err",text||"—"));
  reportSize();
}

window.addEventListener("message",function(ev){
  if(ev.source!==window.parent)return;
  var m=ev.data;
  if(!m||m.jsonrpc!=="2.0")return;
  if(m.id!==undefined&&m.id!==null&&!m.method){
    var p=pending[m.id];
    if(!p)return;
    delete pending[m.id];
    if(m.error)p.reject(m.error);else p.resolve(m.result);
    return;
  }
  if(m.method&&m.id!==undefined&&m.id!==null){
    if(m.method==="ui/resource-teardown"||m.method==="ping")send({jsonrpc:"2.0",id:m.id,result:{}});
    else send({jsonrpc:"2.0",id:m.id,error:{code:-32601,message:"Method not found"}});
    return;
  }
  if(m.method==="ui/notifications/tool-result")onToolResult(m.params);
  else if(m.method==="ui/notifications/host-context-changed")applyContext(m.params);
});

if(typeof ResizeObserver==="function"){new ResizeObserver(reportSize).observe(document.body);}

request("ui/initialize",{appInfo:{name:"resiapp-confirm",version:"1.0.0"},appCapabilities:{},protocolVersion:PROTOCOL})
  .then(function(r){if(r&&r.hostContext)applyContext(r.hostContext);notify("ui/notifications/initialized",{});})
  .catch(function(){notify("ui/notifications/initialized",{});});
})();
`;

/** The view document (constant). */
export const CONFIRM_VIEW_HTML = `<!doctype html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ResiApp</title>
<style>${CSS}</style>
</head>
<body>
<main id="app" aria-busy="false"><p class="note">…</p></main>
<script>${SCRIPT}</script>
</body>
</html>`;
