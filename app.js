"use strict";
const CFG=window.DP_CONFIG,P=window.DP_PRODUCTOS,CATS=window.DP_CATS,PM=Object.fromEntries(P.map(p=>[p.id,p]));
const ESTADOS=["Recibido","Confirmado","Alistando","En ruta","Entregado"];
const $=s=>document.querySelector(s),app=$("#app");
const fmt=n=>"$"+Math.round(n).toLocaleString("es-CO");
const ls={g:(k,d)=>{try{return JSON.parse(localStorage.getItem("dp_"+k))??d}catch{return d}},s:(k,v)=>localStorage.setItem("dp_"+k,JSON.stringify(v))};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fecha=t=>new Date(t).toLocaleString("es-CO",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
let cart=ls.g("cart",{}),cat="todo",q="";
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("on");clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("on"),2200)}
const precio=p=>p.promo?p.precio*(1-p.promo/100):p.precio;
function img(p){const c=p.col;return `<svg viewBox="0 0 120 110" aria-hidden="true"><ellipse cx="60" cy="104" rx="34" ry="5" fill="#0001"/>
${[30,60,90].map((x,i)=>`<g transform="translate(${x-14},${i==1?4:12})"><path d="M10 0h8v10l6 9v66a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V19l6-9z" fill="${c}" opacity="${i==1?1:.75}"/><rect x="4" y="40" width="20" height="22" fill="#fff" opacity=".85"/><rect x="8" y="47" width="12" height="8" rx="2" fill="${c}"/><rect x="10" y="-3" width="8" height="4" fill="#333"/></g>`).join("")}</svg>`}
// ---------- canal en tiempo real (ntfy.sh, sin cuenta) ----------
const TD=CFG.canal+"-datos";
async function pub(topic,obj){try{const r=await fetch(CFG.servidor,{method:"POST",body:JSON.stringify({topic,...obj})});return r.ok}catch{return false}}
async function enviar(ev){return pub(TD,{message:JSON.stringify(ev)})}
async function leerTodo(){try{const r=await fetch(`${CFG.servidor}/${TD}/json?poll=1&since=all`);const t=await r.text();
return t.split("\n").filter(Boolean).map(l=>{try{const m=JSON.parse(l);return m.event=="message"?JSON.parse(m.message):null}catch{return null}}).filter(Boolean)}catch{return null}}
function escuchar(fn){try{const es=new EventSource(`${CFG.servidor}/${TD}/sse`);es.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.event=="message")fn(JSON.parse(m.message))}catch{}};
es.onopen=()=>setDot(true);es.onerror=()=>setDot(false);return es}catch{return null}}
function setDot(on){document.querySelectorAll(".dot").forEach(d=>d.classList.toggle("on",on))}
// pedidos: unión de locales + remotos
function aplicar(map,ev){if(ev.t=="o"&&ev.o&&!map[ev.o.c])map[ev.o.c]=ev.o;
 if(ev.t=="s"&&map[ev.c]){const o=map[ev.c];if(!o.h.some(h=>h[0]==ev.s))o.h.push([ev.s,ev.at]);o.h.sort((a,b)=>a[1]-b[1])}
 if(ev.t=="s"&&!map[ev.c])(map._pend=map._pend||[]).push(ev)}
function fusionar(store,evs){const m=ls.g(store,{});evs.forEach(e=>aplicar(m,e));(m._pend||[]).forEach(e=>{delete m._pend;aplicar(m,e)});delete m._pend;ls.s(store,m);return m}
const estado=o=>o.h[o.h.length-1][0];
// ---------- carrito ----------
function setQ(id,n){n=Math.max(0,Math.min(999,n));if(n)cart[id]=n;else delete cart[id];ls.s("cart",cart);barra();
 document.querySelectorAll(`[data-c="${id}"]`).forEach(el=>el.outerHTML=ctrl(id))}
const totalCart=()=>Object.entries(cart).reduce((s,[id,n])=>s+(PM[id]?precio(PM[id])*n:0),0);
const nCart=()=>Object.values(cart).reduce((a,b)=>a+b,0);
function barra(){const n=nCart(),r=location.hash.replace("#","")||"/";$("#bar").classList.toggle("hidden",!n||r!="/");$("#barN").textContent=n+" paca"+(n>1?"s":"")+" en el carrito";$("#barT").textContent=fmt(totalCart())}
const ctrl=id=>cart[id]?`<div class="step" data-c="${id}"><button aria-label="Quitar uno" onclick="setQ('${id}',${cart[id]-1})">−</button><b>${cart[id]}</b><button aria-label="Agregar uno" onclick="setQ('${id}',${cart[id]+1})">+</button></div>`
 :`<button class="add" data-c="${id}" onclick="setQ('${id}',1)">Agregar</button>`;
// ---------- vistas ----------
function vCatalogo(){const mis=Object.values(ls.g("mios",{})).sort((a,b)=>b.at-a.at),ult=mis[0];
app.innerHTML=`<div class="hero"><div><h1>Haz el pedido de tu tienda</h1><p>Elige, confirma y sigue tu entrega con un código.</p></div>
${ult?`<button class="btn" onclick="repetir('${ult.c}')">↻ Repetir último pedido</button>`:""}</div>
<input class="search" id="q" type="search" placeholder="🔍 Buscar: Colombiana, agua, Hit…" value="${esc(q)}" autocomplete="off">
<div class="chips">${CATS.map(([k,n])=>`<button class="chip ${k==cat?"on":""}" onclick="cat='${k}';pintar()">${n}</button>`).join("")}</div><div class="grid" id="g"></div>`;
$("#q").oninput=e=>{q=e.target.value;pintar()};pintar()}
function pintar(){document.querySelectorAll(".chip").forEach((c,i)=>c.classList.toggle("on",CATS[i][0]==cat));
 const s=q.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
 const l=P.filter(p=>(cat=="todo"||(cat=="promos"?p.promo:p.c==cat))&&p.n.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().includes(s));
 $("#g").innerHTML=l.length?l.map(p=>`<div class="card">${p.promo?`<span class="badge">-${p.promo}%</span>`:""}${p.ret?`<span class="badge r">Retornable</span>`:""}${img(p)}
 <h3>${esc(p.n)}</h3><small>${esc(p.p)}</small><div class="price">${fmt(precio(p))}${p.promo?`<span class="old">${fmt(p.precio)}</span>`:""}</div>${ctrl(p.id)}</div>`).join("")
 :`<p>No encontramos “${esc(q)}”.</p>`}
function repetir(c){const o=ls.g("mios",{})[c];if(!o)return;o.it.forEach(([id,n])=>{if(PM[id])cart[id]=n});ls.s("cart",cart);toast("Pedido anterior cargado al carrito");location.hash="#/carrito"}
function vCarrito(){const it=Object.entries(cart).filter(([id])=>PM[id]),t=totalCart(),d=ls.g("tienda",{}),min=CFG.pedidoMinimo||0;
if(!it.length){app.innerHTML=`<div class="box"><h2>Tu carrito está vacío</h2><a class="btn b" href="#/">Ver productos</a></div>`;return}
app.innerHTML=`<div class="two"><div class="box"><h2>Tu carrito</h2>${it.map(([id,n])=>{const p=PM[id];return `<div class="row"><div><b>${esc(p.n)}</b><br><small>${fmt(precio(p))} · ${esc(p.p)}</small></div>
<div style="display:flex;gap:10px;align-items:center">${ctrl(id)}<b style="min-width:84px;text-align:right">${fmt(precio(p)*n)}</b></div></div>`}).join("")}
<div class="row"><b>Total</b><b style="font-size:22px">${fmt(t)}</b></div>${t<min?`<p style="color:#c0392b">Pedido mínimo ${fmt(min)}. Te faltan ${fmt(min-t)}.</p>`:""}
<a href="#/">← Seguir comprando</a></div>
<form class="box" id="f"><h2>Datos de la tienda</h2>
<label>Nombre de la tienda*<input name="n" required value="${esc(d.n)}"></label>
<label>Quién recibe*<input name="contacto" required value="${esc(d.contacto)}"></label>
<label>Celular (WhatsApp)*<input name="tel" required inputmode="tel" pattern="[0-9 +]{7,15}" value="${esc(d.tel)}"></label>
<label>Dirección*<input name="dir" required value="${esc(d.dir)}"></label>
<label>Barrio / municipio<input name="barrio" value="${esc(d.barrio)}"></label>
<label>Forma de pago<select name="pago">${["Contra entrega (efectivo)","Nequi","Daviplata","Transferencia"].map(x=>`<option ${d.pago==x?"selected":""}>${x}</option>`).join("")}</select></label>
<label>Nota para el vendedor<textarea name="nota" rows="2" placeholder="Ej. traer envases, horario de entrega"></textarea></label>
<button class="btn w" style="margin-top:14px" ${t<min?"disabled":""}>Confirmar pedido · ${fmt(t)}</button><small>Tus datos quedan guardados en este celular para el próximo pedido.</small></form></div>`;
$("#f").onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.target));const nota=fd.nota;delete fd.nota;ls.s("tienda",fd);
 const btn=e.target.querySelector("button");btn.disabled=true;btn.textContent="Enviando…";
 const o={c:codigo(),at:Date.now(),tienda:{...fd,nota},it:it.map(([id,n])=>[id,n,precio(PM[id])]),total:t,h:[["Recibido",Date.now()]]};
 const mios=ls.g("mios",{});mios[o.c]=o;ls.s("mios",mios);
 const ok=await enviar({t:"o",o});
 pub(CFG.canal,{title:`🛒 Nuevo pedido ${o.c} · ${fmt(t)}`,message:resumen(o),tags:["shopping_cart"],priority:4,click:location.href.split("#")[0]+"#/vendedor"});
 cart={};ls.s("cart",cart);sessionStorage.setItem("dp_sync_"+o.c,ok?"1":"0");location.hash="#/pedido/"+o.c}}
function codigo(){const a="ABCDEFGHJKMNPQRSTUVWXYZ23456789";let s="";const r=crypto.getRandomValues(new Uint8Array(5));r.forEach(x=>s+=a[x%a.length]);return "DP-"+s}
function resumen(o){return `Pedido ${o.c}\nTienda: ${o.tienda.n}\nRecibe: ${o.tienda.contacto} · ${o.tienda.tel}\nDirección: ${o.tienda.dir}${o.tienda.barrio?", "+o.tienda.barrio:""}\nPago: ${o.tienda.pago}\n`+
 o.it.map(([id,n,pr])=>`• ${n} x ${PM[id]?.n||id} (${PM[id]?.p||""}) = ${fmt(n*pr)}`).join("\n")+`\nTOTAL: ${fmt(o.total)}`+(o.tienda.nota?`\nNota: ${o.tienda.nota}`:"")}
const waV=t=>`https://wa.me/${CFG.whatsappVendedor||""}?text=${encodeURIComponent(t)}`;
function linea(o){const done=o.h.map(h=>h[0]);if(done.includes("Cancelado"))return `<p><span class="st Cancelado">Pedido cancelado</span></p>`;
 const cur=estado(o);return `<ul class="tl">${ESTADOS.map(s=>{const h=o.h.find(x=>x[0]==s);return `<li class="${h?"d":""} ${s==cur?"c":""}"><b>${s}</b>${h?`<small>${fecha(h[1])}</small>`:""}</li>`}).join("")}</ul>`}
function detalle(o){return o.it.map(([id,n,pr])=>`<div class="row"><span>${n} × ${esc(PM[id]?.n||id)}</span><b>${fmt(n*pr)}</b></div>`).join("")+`<div class="row"><b>Total</b><b>${fmt(o.total)}</b></div>`}
let es=null;
async function vPedido(c){c=(c||"").toUpperCase().trim();let o=ls.g("mios",{})[c]||ls.g("seg",{})[c];
 const pint=()=>{if(!o){app.innerHTML=`<div class="box"><h2>No encontramos ${esc(c)}</h2><p>Revisa el código e intenta de nuevo.</p><a class="btn b" href="#/seguir">Buscar otro</a></div>`;return}
 const nuevo=sessionStorage.getItem("dp_sync_"+c);
 app.innerHTML=`<div class="two"><div class="box">${nuevo?`<h2>✅ ¡Pedido enviado!</h2>`:`<h2>Seguimiento</h2>`}<p>Tu código de seguimiento:</p><div class="code">${esc(o.c)}</div>
 ${nuevo=="0"?`<p style="color:#c0392b">Sin conexión con el panel. Avísale al vendedor por WhatsApp.</p>`:""}
 <a class="btn g w" target="_blank" rel="noopener" href="${waV("Hola, hice este pedido en DistriPostobon:\n"+resumen(o)+"\nSeguimiento: "+location.href.split("#")[0]+"#/pedido/"+o.c)}">Avisar al vendedor por WhatsApp</a>
 <p><button class="btn l w" onclick="navigator.clipboard?.writeText('${o.c}');toast('Código copiado')">Copiar código</button></p>
 <p><small><span class="dot"></span>Se actualiza solo. Pedido hecho el ${fecha(o.at)}.</small></p></div>
 <div class="box"><h3>Estado: <span class="st ${estado(o)}">${estado(o)}</span></h3>${linea(o)}<h3>Detalle</h3>${detalle(o)}</div></div>`};
 pint();const evs=await leerTodo();if(evs){const m=fusionar("seg",evs.filter(e=>e.c==c||e.o?.c==c));if(m[c]){const mios=ls.g("mios",{});if(mios[c]){mios[c].h=m[c].h;ls.s("mios",mios)}o=m[c]}pint();setDot(true)}
 es?.close();es=escuchar(ev=>{if(ev.c==c||ev.o?.c==c){const m=fusionar("seg",[ev]);if(m[c]){o=m[c];pint();setDot(true);toast("Estado: "+estado(o))}}})}
function vSeguir(){const mios=Object.values(ls.g("mios",{})).sort((a,b)=>b.at-a.at);
 app.innerHTML=`<form class="box" id="fs"><h2>Seguir mi pedido</h2><label>Código (ej. DP-7K3Q9)<input id="cod" required placeholder="DP-" style="text-transform:uppercase;font-size:22px"></label><button class="btn b w" style="margin-top:10px">Consultar</button></form>
 ${mios.length?`<div class="box"><h3>Mis pedidos en este celular</h3>${mios.map(o=>`<div class="row"><a href="#/pedido/${o.c}"><b>${o.c}</b></a><span>${fecha(o.at)}</span><b>${fmt(o.total)}</b><button class="btn l" onclick="repetir('${o.c}')">↻</button></div>`).join("")}</div>`:""}`;
 $("#fs").onsubmit=e=>{e.preventDefault();let v=$("#cod").value.toUpperCase().replace(/\s/g,"");if(!v.startsWith("DP-"))v="DP-"+v.replace(/^DP/,"");location.hash="#/pedido/"+v}}
// ---------- panel vendedor ----------
let filtro="Activos",pedidos={},primera=true;
async function vVendedor(){if(sessionStorage.getItem("dp_v")!="1"){app.innerHTML=`<form class="box" id="fp" style="max-width:380px;margin:auto"><h2>Panel del vendedor</h2><label>PIN<input id="pin" type="password" inputmode="numeric" required autofocus></label><button class="btn b w" style="margin-top:10px">Entrar</button></form>`;
 $("#fp").onsubmit=e=>{e.preventDefault();if($("#pin").value==CFG.pinVendedor){sessionStorage.setItem("dp_v","1");if("Notification"in window&&Notification.permission=="default")Notification.requestPermission();vVendedor()}else toast("PIN incorrecto")};return}
 pedidos=ls.g("ven",{});pintarV();const evs=await leerTodo();if(evs){pedidos=fusionar("ven",evs);setDot(true)}pintarV();
 es?.close();es=escuchar(ev=>{const ya=ev.t=="o"&&pedidos[ev.o.c];pedidos=fusionar("ven",[ev]);if(ev.t=="o"&&!ya)alerta(ev.o);pintarV(ev.o?.c)})}
function alerta(o){toast("🛒 Nuevo pedido "+o.c);try{const a=new AudioContext(),os=a.createOscillator(),g=a.createGain();os.frequency.value=880;os.connect(g);g.connect(a.destination);g.gain.value=.15;os.start();setTimeout(()=>{os.frequency.value=1320},150);setTimeout(()=>os.stop(),350)}catch{}
 try{if(Notification.permission=="granted")new Notification("Nuevo pedido "+o.c,{body:o.tienda.n+" · "+fmt(o.total),icon:"icon.svg"})}catch{}}
function pintarV(nuevo){if(!location.hash.startsWith("#/vendedor"))return;const all=Object.values(pedidos).sort((a,b)=>b.at-a.at);
 const act=all.filter(o=>!["Entregado","Cancelado"].includes(estado(o))),hoy=all.filter(o=>new Date(o.at).toDateString()==new Date().toDateString());
 const l=filtro=="Activos"?act:filtro=="Todos"?all:all.filter(o=>estado(o)==filtro);
 app.innerHTML=`<div class="hero"><div><h1>Panel del vendedor</h1><p><span class="dot"></span>Pedidos en tiempo real</p></div><div class="acts"><button class="btn l" onclick="csv()">⬇ Excel (CSV)</button><button class="btn l" onclick="sessionStorage.removeItem('dp_v');vVendedor()">Salir</button></div></div>
 <div class="kpi"><div><b>${act.length}</b>Activos</div><div><b>${hoy.length}</b>Hoy</div><div><b>${fmt(hoy.reduce((s,o)=>s+o.total,0))}</b>Vendido hoy</div><div><b>${all.filter(o=>estado(o)=="En ruta").length}</b>En ruta</div></div>
 <div class="chips">${["Activos",...ESTADOS,"Cancelado","Todos"].map(f=>`<button class="chip ${f==filtro?"on":""}" onclick="filtro='${f}';pintarV()">${f}</button>`).join("")}</div>
 ${l.length?l.map(o=>{const s=estado(o),i=ESTADOS.indexOf(s),sig=ESTADOS[i+1];return `<div class="box ord ${o.c==nuevo?"new":""}"><div class="row"><div><b style="font-size:18px">${o.c}</b> <span class="st ${s}">${s}</span><br><small>${fecha(o.at)}</small></div><b style="font-size:19px">${fmt(o.total)}</b></div>
 <div><b>${esc(o.tienda.n)}</b> · ${esc(o.tienda.contacto)} · <a href="tel:${esc(o.tienda.tel)}">${esc(o.tienda.tel)}</a><br>${esc(o.tienda.dir)} ${esc(o.tienda.barrio||"")} · ${esc(o.tienda.pago)}${o.tienda.nota?`<br>📝 ${esc(o.tienda.nota)}`:""}</div>
 <details><summary>${o.it.length} producto(s)</summary>${detalle(o)}</details>
 <div class="acts">${sig&&s!="Cancelado"?`<button class="btn b" onclick="mover('${o.c}','${sig}')">Pasar a: ${sig} →</button>`:""}
 <a class="btn g" target="_blank" rel="noopener" href="https://wa.me/${tel57(o.tienda.tel)}?text=${encodeURIComponent(`Hola ${o.tienda.contacto}, tu pedido ${o.c} está: ${s}. Síguelo aquí: ${location.href.split("#")[0]}#/pedido/${o.c}`)}">WhatsApp cliente</a>
 ${s!="Entregado"&&s!="Cancelado"?`<button class="btn l" onclick="if(confirm('¿Cancelar ${o.c}?'))mover('${o.c}','Cancelado')">Cancelar</button>`:""}</div></div>`}).join(""):`<div class="box">No hay pedidos ${filtro=="Todos"?"":"en “"+filtro+"”"}. Cuando una tienda pida, aparece aquí al instante.</div>`}`;setDot(!!es&&es.readyState==1)}
const tel57=t=>{t=String(t).replace(/\D/g,"");return t.length==10?"57"+t:t};
async function mover(c,s){const ev={t:"s",c,s,at:Date.now()};pedidos=fusionar("ven",[ev]);pintarV();if(!await enviar(ev))toast("Sin conexión: el cliente verá el cambio cuando vuelva la red");else toast(c+" → "+s)}
function csv(){const r=[["Codigo","Fecha","Tienda","Contacto","Telefono","Direccion","Pago","Estado","Total","Productos"]];
 Object.values(pedidos).forEach(o=>r.push([o.c,new Date(o.at).toLocaleString("es-CO"),o.tienda.n,o.tienda.contacto,o.tienda.tel,o.tienda.dir,o.tienda.pago,estado(o),o.total,o.it.map(([id,n])=>n+"x "+(PM[id]?.n||id)).join(" | ")]));
 const b=new Blob(["\ufeff"+r.map(x=>x.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="pedidos-distripostobon.csv";a.click()}
// ---------- router ----------
function ruta(){const h=location.hash.replace("#","")||"/";if(!h.startsWith("/vendedor")&&!h.startsWith("/pedido")){es?.close();es=null}
 if(h.startsWith("/carrito"))vCarrito();else if(h.startsWith("/pedido/"))vPedido(decodeURIComponent(h.slice(8)));else if(h.startsWith("/seguir"))vSeguir();else if(h.startsWith("/vendedor"))vVendedor();else vCatalogo();
 barra();scrollTo(0,0)}
addEventListener("hashchange",ruta);ruta();
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
