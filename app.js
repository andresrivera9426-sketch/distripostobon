"use strict";
const CFG = window.DP_CONFIG;
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = s => document.querySelector(s), app = $("#app");
const ESTADOS = ["Recibido", "Confirmado", "Alistando", "En ruta", "Entregado"];
const ICON = { Recibido: "📥", Confirmado: "✅", Alistando: "📦", "En ruta": "🚚", Entregado: "🏁", Cancelado: "✖️" };
const ROLES = { cliente: "Tienda", vendedor: "Vendedor", bodega: "Bodega", administrador: "Administrador" };
const S = { user: null, perfil: null, productos: [], config: { pedido_minimo: 0, whatsapp_vendedor: "" }, cat: "Todo", q: "", carrito: JSON.parse(localStorage.getItem("dp_carrito") || "{}"), canales: [], chatSub: null, recovery: false };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cop = n => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const fecha = d => new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
const staff = () => S.perfil && S.perfil.rol !== "cliente";
const rol = () => S.perfil?.rol;
function toast(m, err) { const t = $("#toast"); t.textContent = m; t.className = "toast on" + (err ? " err" : ""); clearTimeout(t._t); t._t = setTimeout(() => t.className = "toast", 3500); }
function errMsg(e) { const m = e?.message || String(e); return m.replace(/^.*?ERROR:\s*/, "").replace("Invalid login credentials", "Correo o contraseña incorrectos").replace("Email not confirmed", "Debes confirmar tu correo: revisa tu bandeja de entrada").replace("User already registered", "Ese correo ya está registrado"); }
function guardarCarrito() { localStorage.setItem("dp_carrito", JSON.stringify(S.carrito)); barra(); }
function sala(token) { return CFG.jitsi + "DistriPostobon-" + token; }
function wa(tel, txt) { const n = String(tel || "").replace(/\D/g, ""); if (!n) return ""; return "https://wa.me/" + (n.length === 10 ? "57" + n : n) + "?text=" + encodeURIComponent(txt || ""); }

// ---------- Sonido y notificaciones ----------
let actx;
function sonar() { try { actx = actx || new AudioContext(); [0, .18].forEach((t, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = i ? 1046 : 784; g.gain.setValueAtTime(.25, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + t + .3); o.connect(g).connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + .3); }); } catch (e) { } }
function avisar(titulo, cuerpo, url) {
  sonar(); toast(titulo + " · " + cuerpo);
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    navigator.serviceWorker?.ready.then(r => r.showNotification(titulo, { body: cuerpo, icon: "icon-192.png", data: { url } })).catch(() => new Notification(titulo, { body: cuerpo }));
  }
}
function pedirPermiso() { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); }

// ---------- Sesión ----------
async function cargarPerfil() {
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null; S.perfil = null;
  if (S.user) { const { data } = await sb.from("profiles").select("*").eq("id", S.user.id).single(); S.perfil = data; }
  nav(); suscribir();
}
async function cargarCatalogo() {
  const [p, c] = await Promise.all([sb.from("productos").select("*").order("categoria").order("nombre"), sb.from("config").select("*").eq("id", 1).single()]);
  S.productos = p.data || []; if (c.data) S.config = c.data;
}
function nav() {
  const n = $("#nav"), t = $("#tabs");
  if (!S.user) { n.innerHTML = `<a href="#/entrar" class="btn sm">Entrar</a>`; t.innerHTML = `<a href="#/">🛒<span>Catálogo</span></a><a href="#/entrar">👤<span>Entrar</span></a>`; return; }
  const nom = esc((S.perfil?.nombre || S.user.email).split(" ")[0]);
  n.innerHTML = `<a href="#/perfil" class="chip">${nom} · ${ROLES[rol()] || ""}</a>`;
  t.innerHTML = staff()
    ? `<a href="#/panel">📋<span>Pedidos</span></a><a href="#/chats">💬<span>Chats</span></a>${rol() === "administrador" ? `<a href="#/admin">⚙️<span>Admin</span></a>` : ""}<a href="#/perfil">👤<span>Perfil</span></a>`
    : `<a href="#/">🛒<span>Catálogo</span></a><a href="#/pedidos">📦<span>Pedidos</span></a><a href="#/chat">💬<span>Chat</span></a><a href="#/perfil">👤<span>Perfil</span></a>`;
  marcarTab();
}
function marcarTab() { document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", location.hash.startsWith(a.getAttribute("href")) && (a.getAttribute("href") !== "#/" || location.hash === "#/" || location.hash === ""))); }

// ---------- Realtime ----------
function suscribir() {
  S.canales.forEach(c => sb.removeChannel(c)); S.canales = [];
  if (!S.user) return;
  const ch = sb.channel("dp-" + S.user.id);
  if (staff()) {
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos" }, p => { avisar("Nuevo pedido " + p.new.codigo, "Total " + cop(p.new.total || 0), "#/pedido/" + p.new.codigo); refrescarSi("#/panel"); });
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos" }, () => refrescarSi("#/panel"));
    if (rol() !== "bodega") ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes" }, p => { if (p.new.autor_id !== S.user.id) { avisar("Nuevo mensaje", p.new.texto.slice(0, 80)); refrescarSi("#/chats"); } });
  } else {
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos", filter: "cliente_id=eq." + S.user.id }, p => { avisar("Pedido " + p.new.codigo, ICON[p.new.estado] + " " + p.new.estado, "#/pedido/" + p.new.codigo); refrescarSi("#/pedido"); refrescarSi("#/pedidos"); });
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: "cliente_id=eq." + S.user.id }, p => { if (p.new.autor_id !== S.user.id && !document.querySelector("#chatBox")) avisar("Mensaje de tu vendedor", p.new.texto.slice(0, 80)); });
  }
  ch.subscribe(); S.canales.push(ch);
}
function refrescarSi(pref) { if (location.hash.startsWith(pref) && !document.activeElement?.matches("input,textarea,select")) router(); }

// ---------- Router ----------
const rutas = {
  "": vCatalogo, entrar: vEntrar, carrito: vCarrito, pedidos: vMisPedidos, pedido: vPedido, seguir: vSeguir, chat: vChatGeneral,
  perfil: vPerfil, panel: vPanel, chats: vChats, conversacion: vConversacion, admin: vAdmin, clave: vClave
};
async function router() {
  if (S.chatSub) { sb.removeChannel(S.chatSub); S.chatSub = null; }
  const [r, ...a] = location.hash.replace(/^#\/?/, "").split("/");
  if (S.recovery && r !== "clave") { location.hash = "#/clave"; return; }
  const priv = !["", "entrar", "carrito"].includes(r);
  if (priv && !S.user) { location.hash = "#/entrar"; return; }
  if (["panel", "chats", "conversacion", "admin"].includes(r) && !staff()) { location.hash = "#/"; return; }
  if (r === "admin" && rol() !== "administrador") { location.hash = "#/panel"; return; }
  if (r === "" && staff() && !a.length && sessionStorage.dpVerCat !== "1") { location.hash = "#/panel"; return; }
  marcarTab(); barra();
  try { await (rutas[r] || vCatalogo)(...a.map(decodeURIComponent)); } catch (e) { console.error(e); app.innerHTML = `<div class="card"><h2>Algo falló</h2><p>${esc(errMsg(e))}</p><button class="btn" onclick="router()">Reintentar</button></div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);

// ---------- Catálogo ----------
function barra() {
  const n = Object.values(S.carrito).reduce((a, b) => a + b, 0), bar = $("#bar");
  const h = location.hash.replace(/^#\/?/, "");
  if (!n || staff() || !(h === "" || h.startsWith("?"))) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden"); $("#barN").textContent = n + " producto" + (n > 1 ? "s" : ""); $("#barT").textContent = cop(totalCarrito());
}
function totalCarrito() { return Object.entries(S.carrito).reduce((t, [id, q]) => { const p = S.productos.find(x => x.id === id); return t + (p ? p.precio * q : 0); }, 0); }
function foto(p, cls = "ph") { return p.foto_url ? `<img class="${cls}" src="${esc(p.foto_url)}" alt="" loading="lazy">` : `<div class="${cls} nof">${esc((p.nombre || "?").slice(0, 2).toUpperCase())}</div>`; }
async function vCatalogo() {
  await cargarCatalogo();
  const activos = S.productos.filter(p => p.activo);
  const cats = ["Todo", ...new Set(activos.map(p => p.categoria))];
  if (!cats.includes(S.cat)) S.cat = "Todo";
  app.innerHTML = `
  ${S.user ? "" : `<section class="hero"><h1>Pide para tu tienda en segundos</h1><p>Catálogo, carrito, chat con tu vendedor y seguimiento de cada pedido con código.</p><a class="btn y" href="#/entrar/registro">Inscribir mi tienda</a> <a class="btn ghost" href="#/entrar">Ya tengo cuenta</a></section>`}
  ${staff() ? `<div class="note">Estás viendo el catálogo como ${ROLES[rol()]}. <a href="#/panel" onclick="sessionStorage.dpVerCat=''">Volver al panel</a></div>` : ""}
  <div class="search"><input id="q" type="search" placeholder="🔎 Buscar producto…" value="${esc(S.q)}" autocomplete="off"></div>
  <div class="cats">${cats.map(c => `<button class="cat ${c === S.cat ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
  ${S.config.pedido_minimo > 0 ? `<p class="muted small">Pedido mínimo: <b>${cop(S.config.pedido_minimo)}</b></p>` : ""}
  <div id="grid" class="grid"></div>`;
  const pintar = () => {
    const q = S.q.toLowerCase();
    const l = activos.filter(p => (S.cat === "Todo" || p.categoria === S.cat) && (!q || (p.nombre + " " + p.presentacion + " " + p.categoria).toLowerCase().includes(q)));
    $("#grid").innerHTML = l.length ? l.map(p => { const c = S.carrito[p.id] || 0, ago = p.stock <= 0; return `
      <article class="prod">${foto(p)}<div class="pi"><h3>${esc(p.nombre)}</h3><small>${esc(p.presentacion)}</small>
      <div class="pr"><b>${cop(p.precio)}</b>${ago ? `<span class="tag red">Agotado</span>` : p.stock < 10 ? `<span class="tag">Quedan ${p.stock}</span>` : ""}</div>
      ${ago ? "" : c ? `<div class="qty"><button data-m="${p.id}">−</button><span>${c}</span><button data-p="${p.id}">+</button></div>` : `<button class="btn w" data-p="${p.id}">Agregar</button>`}</div></article>`; }).join("")
      : `<div class="empty">${S.productos.length ? "No hay productos con ese filtro." : "Aún no hay productos. El administrador los carga desde su panel."}</div>`;
  };
  pintar();
  $("#q").oninput = e => { S.q = e.target.value; pintar(); };
  app.querySelectorAll(".cat").forEach(b => b.onclick = () => { S.cat = b.dataset.c; vCatalogo(); });
  $("#grid").onclick = e => {
    const b = e.target.closest("button"); if (!b || staff()) return;
    const id = b.dataset.p || b.dataset.m, p = S.productos.find(x => x.id === id);
    if (b.dataset.p) { if ((S.carrito[id] || 0) >= p.stock) return toast("No hay más unidades disponibles", 1); S.carrito[id] = (S.carrito[id] || 0) + 1; }
    else { S.carrito[id]--; if (S.carrito[id] <= 0) delete S.carrito[id]; }
    if (navigator.vibrate) navigator.vibrate(15);
    guardarCarrito(); pintar();
  };
}

async function vCarrito() {
  await cargarCatalogo();
  for (const id in S.carrito) if (!S.productos.find(p => p.id === id && p.activo)) delete S.carrito[id];
  guardarCarrito();
  const items = Object.entries(S.carrito).map(([id, q]) => ({ p: S.productos.find(x => x.id === id), q }));
  const tot = totalCarrito(), min = Number(S.config.pedido_minimo) || 0;
  if (!items.length) { app.innerHTML = `<div class="empty big">🛒<p>Tu carrito está vacío.</p><a class="btn" href="#/">Ver catálogo</a></div>`; return; }
  app.innerHTML = `<h2>Tu carrito</h2><div class="card list">${items.map(({ p, q }) => `
    <div class="row">${foto(p, "mini")}<div class="grow"><b>${esc(p.nombre)}</b><small>${esc(p.presentacion)} · ${cop(p.precio)}</small></div>
    <div class="qty"><button data-m="${p.id}">−</button><span>${q}</span><button data-p="${p.id}">+</button></div><b class="num">${cop(p.precio * q)}</b></div>`).join("")}
    <div class="row tot"><span class="grow">Total</span><b>${cop(tot)}</b></div></div>
    ${tot < min ? `<div class="note warn">Te faltan ${cop(min - tot)} para el pedido mínimo de ${cop(min)}.</div>` : ""}
    <label>Notas para el vendedor (opcional)<textarea id="notas" maxlength="500" placeholder="Ej.: entregar en la tarde"></textarea></label>
    ${S.user ? `<button id="enviar" class="btn y w big" ${tot < min ? "disabled" : ""}>Enviar pedido · ${cop(tot)}</button>`
             : `<a class="btn y w big" href="#/entrar">Entra o inscribe tu tienda para enviar el pedido</a>`}
    <button id="vaciar" class="btn ghost w">Vaciar carrito</button>`;
  app.querySelector(".list").onclick = e => { const b = e.target.closest("button"); if (!b) return; const id = b.dataset.p || b.dataset.m, p = S.productos.find(x => x.id === id);
    if (b.dataset.p) { if (S.carrito[id] >= p.stock) return toast("No hay más unidades disponibles", 1); S.carrito[id]++; } else { S.carrito[id]--; if (S.carrito[id] <= 0) delete S.carrito[id]; } guardarCarrito(); vCarrito(); };
  $("#vaciar").onclick = () => { if (confirm("¿Vaciar el carrito?")) { S.carrito = {}; guardarCarrito(); vCarrito(); } };
  const env = $("#enviar"); if (env) env.onclick = async () => {
    env.disabled = true; env.textContent = "Enviando…"; pedirPermiso();
    const { data, error } = await sb.rpc("crear_pedido", { p_items: items.map(({ p, q }) => ({ producto_id: p.id, cantidad: q })), p_notas: $("#notas").value });
    if (error) { toast(errMsg(error), 1); env.disabled = false; env.textContent = "Enviar pedido"; return; }
    S.carrito = {}; guardarCarrito(); sonar();
    app.innerHTML = `<div class="card ok"><div class="bigi">✅</div><h2>¡Pedido enviado!</h2><p>Tu código de seguimiento es</p><div class="code">${esc(data.codigo)}</div><p>Total ${cop(data.total)}. Te avisamos aquí cada vez que cambie de estado.</p>
      <a class="btn w" href="#/pedido/${esc(data.codigo)}">Ver seguimiento</a><a class="btn ghost w" href="#/">Seguir comprando</a></div>`;
  };
}

// ---------- Entrar / Registro ----------
function vEntrar(modo) {
  if (S.user) { location.hash = staff() ? "#/panel" : "#/"; return; }
  const reg = modo === "registro";
  app.innerHTML = `<div class="card auth"><div class="seg"><a href="#/entrar" class="${reg ? "" : "on"}">Entrar</a><a href="#/entrar/registro" class="${reg ? "on" : ""}">Inscribir tienda</a></div>
  <form id="f">${reg ? `
    <label>Nombre de la tienda o persona<input name="nombre" required maxlength="120" autocomplete="name"></label>
    <label>Cédula o NIT<input name="cedula" required inputmode="numeric" maxlength="20" pattern="[0-9.\\- ]{5,20}"></label>
    <label>Teléfono celular<input name="telefono" required type="tel" inputmode="tel" maxlength="20" pattern="[0-9+ ]{7,20}" autocomplete="tel"></label>
    <label>Dirección de entrega<input name="direccion" required maxlength="200" autocomplete="street-address"></label>` : ""}
    <label>Correo electrónico<input name="correo" type="email" required autocomplete="email"></label>
    <label>Contraseña<input name="clave" type="password" required minlength="8" autocomplete="${reg ? "new-password" : "current-password"}"></label>
    ${reg ? `<label class="chk"><input type="checkbox" required> Acepto que mis datos se usen solo para gestionar mis pedidos.</label>` : ""}
    <button class="btn y w big">${reg ? "Crear mi cuenta" : "Entrar"}</button></form>
    ${reg ? "" : `<button id="olv" class="link">¿Olvidaste tu contraseña?</button>`}</div>`;
  $("#f").onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), b = e.target.querySelector("button"); b.disabled = true;
    if (reg) {
      const { data, error } = await sb.auth.signUp({ email: f.correo.trim(), password: f.clave, options: { emailRedirectTo: location.origin + location.pathname, data: { nombre: f.nombre.trim(), cedula: f.cedula.trim(), telefono: f.telefono.trim(), direccion: f.direccion.trim() } } });
      b.disabled = false; if (error) return toast(errMsg(error), 1);
      if (!data.session) { app.innerHTML = `<div class="card ok"><div class="bigi">📧</div><h2>Revisa tu correo</h2><p>Te enviamos un enlace a <b>${esc(f.correo)}</b> para activar tu cuenta. Después entra con tu correo y contraseña.</p><a class="btn w" href="#/entrar">Ir a entrar</a></div>`; return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: f.correo.trim(), password: f.clave }); b.disabled = false; if (error) return toast(errMsg(error), 1);
    }
    await cargarPerfil(); pedirPermiso(); location.hash = staff() ? "#/panel" : (Object.keys(S.carrito).length ? "#/carrito" : "#/");
  };
  const o = $("#olv"); if (o) o.onclick = async () => { const em = app.querySelector("[name=correo]").value.trim(); if (!em) return toast("Escribe tu correo primero", 1);
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname }); toast(error ? errMsg(error) : "Te enviamos un enlace para cambiar la contraseña", !!error); };
}
function vClave() {
  app.innerHTML = `<div class="card auth"><h2>Nueva contraseña</h2><form id="f"><label>Contraseña nueva<input name="c" type="password" minlength="8" required autocomplete="new-password"></label><button class="btn y w">Guardar</button></form></div>`;
  $("#f").onsubmit = async e => { e.preventDefault(); const { error } = await sb.auth.updateUser({ password: e.target.c.value }); if (error) return toast(errMsg(error), 1); S.recovery = false; toast("Contraseña actualizada"); location.hash = "#/"; };
}
async function vPerfil() {
  const p = S.perfil;
  app.innerHTML = `<h2>Mi perfil</h2><div class="card"><p><span class="tag">${ROLES[p.rol]}</span> ${esc(p.correo)}</p><form id="f">
   <label>Nombre<input name="nombre" required value="${esc(p.nombre)}"></label><label>Cédula o NIT<input name="cedula" required value="${esc(p.cedula)}"></label>
   <label>Teléfono<input name="telefono" required type="tel" value="${esc(p.telefono)}"></label><label>Dirección<input name="direccion" required value="${esc(p.direccion)}"></label>
   <button class="btn w">Guardar cambios</button></form></div>
   <div class="card"><button id="notif" class="btn ghost w">🔔 Activar notificaciones</button>${staff() ? `<a class="btn ghost w" href="#/" onclick="sessionStorage.dpVerCat='1'">🛒 Ver catálogo</a>` : ""}<button id="salir" class="btn red w">Cerrar sesión</button></div>`;
  $("#f").onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const { error } = await sb.from("profiles").update(f).eq("id", p.id); if (error) return toast(errMsg(error), 1); await cargarPerfil(); toast("Datos guardados"); };
  $("#notif").onclick = async () => { if (!("Notification" in window)) return toast("Tu navegador no permite notificaciones", 1); const r = await Notification.requestPermission(); sonar(); toast(r === "granted" ? "Notificaciones activadas" : "No se activaron las notificaciones", r !== "granted"); };
  $("#salir").onclick = async () => { await sb.auth.signOut(); S.carrito = {}; guardarCarrito(); sessionStorage.dpVerCat = ""; await cargarPerfil(); location.hash = "#/"; };
}

// ---------- Pedidos ----------
function tagEstado(e) { return `<span class="est e${ESTADOS.indexOf(e)}${e === "Cancelado" ? " red" : ""}">${ICON[e] || ""} ${esc(e)}</span>`; }
async function vMisPedidos() {
  const { data, error } = await sb.from("pedidos").select("*").eq("cliente_id", S.user.id).order("creado", { ascending: false }).limit(100); if (error) throw error;
  app.innerHTML = `<h2>Mis pedidos</h2><a class="btn ghost w" href="#/seguir">🔎 Buscar por código</a>
  ${data.length ? `<div class="card list">${data.map(o => `<a class="row" href="#/pedido/${o.codigo}"><div class="grow"><b>${o.codigo}</b><small>${fecha(o.creado)}</small></div>${tagEstado(o.estado)}<b class="num">${cop(o.total)}</b></a>`).join("")}</div>` : `<div class="empty">Aún no has hecho pedidos.</div>`}`;
}
function vSeguir() {
  app.innerHTML = `<h2>Seguir pedido</h2><form id="f" class="card"><label>Código del pedido<input name="c" required placeholder="DP-XXXXX" style="text-transform:uppercase" autocomplete="off"></label><button class="btn w">Buscar</button></form>`;
  $("#f").onsubmit = e => { e.preventDefault(); let c = e.target.c.value.trim().toUpperCase(); if (!c.startsWith("DP-")) c = "DP-" + c; location.hash = "#/pedido/" + c; };
}
async function vPedido(codigo) {
  const { data: o } = await sb.from("pedidos").select("*, pedido_items(*), pedido_historial(*), cliente:profiles!pedidos_cliente_id_fkey(nombre,telefono,direccion,correo)").eq("codigo", (codigo || "").toUpperCase()).maybeSingle();
  if (!o) { app.innerHTML = `<div class="empty big">🔎<p>No encontramos el pedido <b>${esc(codigo)}</b> en tu cuenta.</p><a class="btn" href="#/seguir">Buscar otro</a></div>`; return; }
  const h = o.pedido_historial.sort((a, b) => new Date(a.creado) - new Date(b.creado)), idx = ESTADOS.indexOf(o.estado);
  const cuando = e => { const x = h.filter(y => y.estado === e).pop(); return x ? fecha(x.creado) : ""; };
  const r = rol(), cerr = ["Entregado", "Cancelado"].includes(o.estado);
  const sig = { vendedor: ESTADOS.slice(1), administrador: ESTADOS.slice(1), bodega: ["Alistando", "En ruta", "Entregado"] }[r] || [];
  const telV = staff() ? o.cliente?.telefono : S.config.whatsapp_vendedor;
  app.innerHTML = `<a href="${staff() ? "#/panel" : "#/pedidos"}" class="back">← Volver</a>
  <div class="card"><div class="row"><div class="grow"><small>Pedido</small><div class="code sm">${o.codigo}</div><small>${fecha(o.creado)}</small></div>${tagEstado(o.estado)}</div>
  ${o.estado === "Cancelado" ? `<div class="note warn">Este pedido fue cancelado.</div>` : `<ol class="tl">${ESTADOS.map((e, i) => `<li class="${i < idx ? "done" : i === idx ? "now" : ""}"><span>${ICON[e]}</span><div><b>${e}</b><small>${cuando(e)}</small></div></li>`).join("")}</ol>`}</div>
  ${staff() ? `<div class="card"><h3>Cliente</h3><p><b>${esc(o.cliente?.nombre)}</b><br>📞 ${esc(o.cliente?.telefono)}<br>📍 ${esc(o.cliente?.direccion)}<br>✉️ ${esc(o.cliente?.correo)}</p>
     ${cerr ? "" : `<h3>Cambiar estado</h3><div class="btns">${sig.map(e => `<button class="btn ${e === o.estado ? "dis" : ""}" data-e="${e}" ${e === o.estado ? "disabled" : ""}>${ICON[e]} ${e}</button>`).join("")}${r !== "bodega" ? `<button class="btn red" data-e="Cancelado">Cancelar pedido</button>` : ""}</div>`}</div>` : ""}
  <div class="card list"><h3>Productos</h3>${o.pedido_items.map(i => `<div class="row"><div class="grow"><b>${i.cantidad} × ${esc(i.nombre)}</b><small>${esc(i.presentacion)} · ${cop(i.precio)}</small></div><b class="num">${cop(i.precio * i.cantidad)}</b></div>`).join("")}
   <div class="row tot"><span class="grow">Total</span><b>${cop(o.total)}</b></div>${o.notas ? `<p class="muted">📝 ${esc(o.notas)}</p>` : ""}</div>
  <div class="card"><h3>Chat de este pedido</h3>${botonesLlamada(o.sala, telV, "Pedido " + o.codigo)}<div id="chatBox"></div></div>`;
  app.querySelectorAll("[data-e]").forEach(b => b.onclick = async () => {
    if (b.dataset.e === "Cancelado" && !confirm("¿Cancelar este pedido? El stock se devuelve al inventario.")) return;
    b.disabled = true; const { error } = await sb.rpc("cambiar_estado", { p_pedido: o.id, p_estado: b.dataset.e }); if (error) { b.disabled = false; return toast(errMsg(error), 1); } toast("Estado: " + b.dataset.e); vPedido(o.codigo);
  });
  chat($("#chatBox"), o.cliente_id, o.id);
}
function botonesLlamada(token, tel, txt) {
  const w = wa(tel, "Hola, te escribo por DistriPostobon (" + txt + ")");
  return `<div class="btns call"><a class="btn ghost" target="_blank" rel="noopener" href="${sala(token)}#config.startWithVideoMuted=true">📞 Llamar</a><a class="btn ghost" target="_blank" rel="noopener" href="${sala(token)}">🎥 Videollamada</a>${w ? `<a class="btn g" target="_blank" rel="noopener" href="${w}">WhatsApp</a>` : ""}</div>
  <p class="muted small">Llamadas y videollamadas gratis con Jitsi Meet en una sala privada para esta conversación. Comparte el aviso por el chat para que la otra persona entre.</p>`;
}

// ---------- Chat ----------
async function chat(box, clienteId, pedidoId) {
  box.innerHTML = `<div class="msgs" id="msgs"><div class="muted small">Cargando…</div></div><form class="send" id="fs"><input id="txt" maxlength="2000" placeholder="Escribe un mensaje…" autocomplete="off" required><button class="btn">Enviar</button></form>`;
  let q = sb.from("mensajes").select("*, autor:profiles!mensajes_autor_id_fkey(nombre,rol)").eq("cliente_id", clienteId).order("creado").limit(300);
  q = pedidoId ? q.eq("pedido_id", pedidoId) : q.is("pedido_id", null);
  const { data } = await q; const lista = data || [];
  const nombres = {};
  const pintar = () => { const m = $("#msgs"); if (!m) return;
    m.innerHTML = lista.length ? lista.map(x => `<div class="msg ${x.autor_id === S.user.id ? "me" : ""}"><small>${esc(x.autor?.nombre || nombres[x.autor_id] || "")}${x.autor?.rol && x.autor.rol !== "cliente" ? " · " + ROLES[x.autor.rol] : ""}</small><p>${esc(x.texto)}</p><time>${fecha(x.creado)}</time></div>`).join("") : `<div class="muted small">Aún no hay mensajes. Escribe el primero.</div>`;
    m.scrollTop = m.scrollHeight; };
  pintar();
  const filtro = "cliente_id=eq." + clienteId;
  S.chatSub = sb.channel("chat-" + clienteId + (pedidoId || "") + Date.now()).on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: filtro }, async p => {
    if ((p.new.pedido_id || null) !== (pedidoId || null) || lista.some(x => x.id === p.new.id)) return;
    if (p.new.autor_id !== S.user.id) { const { data: a } = await sb.from("mensajes").select("autor:profiles!mensajes_autor_id_fkey(nombre,rol)").eq("id", p.new.id).single(); p.new.autor = a?.autor; sonar(); }
    else p.new.autor = { nombre: S.perfil.nombre, rol: S.perfil.rol };
    lista.push(p.new); pintar();
  }).subscribe();
  $("#fs").onsubmit = async e => { e.preventDefault(); const t = $("#txt").value.trim(); if (!t) return; $("#txt").value = "";
    const { data: n, error } = await sb.from("mensajes").insert({ cliente_id: clienteId, pedido_id: pedidoId || null, autor_id: S.user.id, texto: t }).select().single();
    if (error) { $("#txt").value = t; return toast(errMsg(error), 1); }
    if (!lista.some(x => x.id === n.id)) { n.autor = { nombre: S.perfil.nombre, rol: S.perfil.rol }; lista.push(n); pintar(); } };
}
async function vChatGeneral() {
  app.innerHTML = `<h2>Chat con ventas</h2><div class="card">${botonesLlamada(S.perfil.sala, S.config.whatsapp_vendedor, "consulta general")}<div id="chatBox"></div></div>`;
  await cargarCatalogo(); chat($("#chatBox"), S.user.id, null);
}
async function vChats() {
  if (rol() === "bodega") { app.innerHTML = `<h2>Chats</h2><div class="empty">Bodega conversa con la tienda desde el chat de cada pedido. Abre un pedido en la pestaña Pedidos.</div>`; return; }
  const { data } = await sb.from("mensajes").select("cliente_id,pedido_id,texto,creado,autor_id, cliente:profiles!mensajes_cliente_id_fkey(nombre), pedido:pedidos(codigo)").order("creado", { ascending: false }).limit(500);
  const conv = new Map(); (data || []).forEach(m => { const k = m.cliente_id + "|" + (m.pedido_id || ""); if (!conv.has(k)) conv.set(k, m); });
  const { data: cl } = await sb.from("profiles").select("id,nombre").eq("rol", "cliente").order("nombre").limit(1000);
  app.innerHTML = `<h2>Chats</h2><div class="card"><label>Escribir a una tienda<select id="nuevo"><option value="">Elige una tienda…</option>${(cl || []).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select></label></div>
   ${conv.size ? `<div class="card list">${[...conv.values()].map(m => `<a class="row" href="#/conversacion/${m.cliente_id}${m.pedido_id ? "/" + m.pedido_id : ""}"><div class="grow"><b>${esc(m.cliente?.nombre)}</b>${m.pedido ? ` <span class="tag">${m.pedido.codigo}</span>` : ""}<small>${m.autor_id === S.user.id ? "Tú: " : ""}${esc(m.texto.slice(0, 70))}</small></div><small>${fecha(m.creado)}</small></a>`).join("")}</div>` : `<div class="empty">No hay conversaciones todavía.</div>`}`;
  $("#nuevo").onchange = e => { if (e.target.value) location.hash = "#/conversacion/" + e.target.value; };
}
async function vConversacion(clienteId, pedidoId) {
  if (pedidoId) { const { data: o } = await sb.from("pedidos").select("codigo").eq("id", pedidoId).single(); if (o) { location.hash = "#/pedido/" + o.codigo; return; } }
  const { data: c } = await sb.from("profiles").select("*").eq("id", clienteId).single();
  if (!c) { app.innerHTML = `<div class="empty">Conversación no disponible.</div>`; return; }
  app.innerHTML = `<a href="#/chats" class="back">← Chats</a><h2>${esc(c.nombre)}</h2><p class="muted small">📞 ${esc(c.telefono)} · 📍 ${esc(c.direccion)}</p><div class="card">${botonesLlamada(c.sala, c.telefono, "consulta general")}<div id="chatBox"></div></div>`;
  chat($("#chatBox"), clienteId, null);
}

// ---------- Panel del personal ----------
async function vPanel(filtro) {
  filtro = filtro || (rol() === "bodega" ? "preparar" : "activos");
  let q = sb.from("pedidos").select("*, cliente:profiles!pedidos_cliente_id_fkey(nombre,telefono,direccion)").order("creado", { ascending: false }).limit(300);
  if (filtro === "activos") q = q.not("estado", "in", "(Entregado,Cancelado)");
  if (filtro === "preparar") q = q.in("estado", ["Confirmado", "Alistando", "En ruta"]);
  if (filtro === "cerrados") q = q.in("estado", ["Entregado", "Cancelado"]);
  const { data, error } = await q; if (error) throw error;
  const hoy = new Date().toDateString(), deHoy = data.filter(o => new Date(o.creado).toDateString() === hoy);
  const F = [["activos", "Activos"], ["preparar", "Para bodega"], ["cerrados", "Cerrados"], ["todos", "Todos"]];
  app.innerHTML = `<div class="head"><h2>Pedidos</h2><button id="xls" class="btn ghost sm">⬇️ Excel</button></div>
  <div class="kpis"><div><small>En esta vista</small><b>${data.length}</b></div><div><small>Hoy</small><b>${deHoy.length}</b></div><div><small>Valor</small><b>${cop(data.filter(o => o.estado !== "Cancelado").reduce((a, o) => a + Number(o.total), 0))}</b></div></div>
  <div class="cats">${F.map(([k, n]) => `<a class="cat ${k === filtro ? "on" : ""}" href="#/panel/${k}">${n}</a>`).join("")}</div>
  <input id="bq" type="search" placeholder="🔎 Buscar código o tienda…">
  <div class="card list" id="lp"></div>`;
  const pintar = t => { t = (t || "").toLowerCase(); const l = data.filter(o => !t || (o.codigo + " " + (o.cliente?.nombre || "")).toLowerCase().includes(t));
    $("#lp").innerHTML = l.length ? l.map(o => `<a class="row" href="#/pedido/${o.codigo}"><div class="grow"><b>${o.codigo}</b> · ${esc(o.cliente?.nombre)}<small>${fecha(o.creado)} · 📍 ${esc(o.cliente?.direccion)}</small></div>${tagEstado(o.estado)}<b class="num">${cop(o.total)}</b></a>`).join("") : `<div class="empty">No hay pedidos en esta vista.</div>`; };
  pintar(); $("#bq").oninput = e => pintar(e.target.value);
  $("#xls").onclick = () => exportarPedidos();
  pedirPermiso();
}
async function exportarPedidos() {
  const { data, error } = await sb.from("pedidos").select("codigo,estado,total,notas,creado, cliente:profiles!pedidos_cliente_id_fkey(nombre,cedula,telefono,direccion), pedido_items(nombre,presentacion,precio,cantidad)").order("creado", { ascending: false }).limit(5000);
  if (error) return toast(errMsg(error), 1);
  const ped = data.map(o => ({ Código: o.codigo, Fecha: fecha(o.creado), Estado: o.estado, Tienda: o.cliente?.nombre, Cédula: o.cliente?.cedula, Teléfono: o.cliente?.telefono, Dirección: o.cliente?.direccion, Total: Number(o.total), Notas: o.notas }));
  const det = data.flatMap(o => o.pedido_items.map(i => ({ Código: o.codigo, Producto: i.nombre, Presentación: i.presentacion, Precio: Number(i.precio), Cantidad: i.cantidad, Subtotal: i.precio * i.cantidad })));
  libro({ Pedidos: ped, Detalle: det }, "pedidos");
}
function libro(hojas, nombre) {
  if (!window.XLSX) return toast("Cargando Excel, intenta de nuevo en un segundo", 1);
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(hojas)) { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]); ws["!cols"] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(10, k.length + 2, ...rows.map(r => String(r[k] ?? "").length).slice(0, 200)) })); XLSX.utils.book_append_sheet(wb, ws, n); }
  XLSX.writeFile(wb, `distripostobon-${nombre}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast("Excel descargado. Súbelo a tu Drive o ábrelo con Google Sheets.");
}

// ---------- Administración ----------
async function vAdmin(tab = "productos") {
  const T = [["productos", "📦 Productos"], ["usuarios", "👥 Usuarios"], ["clientes", "🏪 Tiendas"], ["ajustes", "⚙️ Ajustes"]];
  app.innerHTML = `<h2>Administración</h2><div class="cats">${T.map(([k, n]) => `<a class="cat ${k === tab ? "on" : ""}" href="#/admin/${k}">${n}</a>`).join("")}</div><div id="ad"></div>`;
  await ({ productos: aProductos, usuarios: aUsuarios, clientes: aClientes, ajustes: aAjustes }[tab] || aProductos)($("#ad"));
}
async function aProductos(el) {
  await cargarCatalogo();
  el.innerHTML = `<div class="btns"><button id="nuevo" class="btn y">➕ Nuevo producto</button><label class="btn ghost">📥 Importar Excel<input id="imp" type="file" accept=".xlsx,.xls,.csv" hidden></label><button id="exp" class="btn ghost">⬇️ Exportar Excel</button><button id="pla" class="btn ghost">📄 Plantilla</button></div>
  <p class="muted small">Columnas del Excel: Nombre, Categoría, Presentación, Precio, Stock, Activo (SI/NO), Foto (enlace opcional). Si el nombre y la presentación ya existen, se actualiza.</p>
  <input id="bq" type="search" placeholder="🔎 Buscar producto…"><div class="card list" id="lp"></div><div id="modal"></div>`;
  const pintar = t => { t = (t || "").toLowerCase(); const l = S.productos.filter(p => !t || (p.nombre + p.categoria).toLowerCase().includes(t));
    $("#lp").innerHTML = l.length ? l.map(p => `<div class="row">${foto(p, "mini")}<div class="grow"><b>${esc(p.nombre)}</b> ${p.activo ? "" : `<span class="tag red">Oculto</span>`}<small>${esc(p.categoria)} · ${esc(p.presentacion)} · Stock ${p.stock}</small></div><b class="num">${cop(p.precio)}</b><button class="btn sm ghost" data-ed="${p.id}">Editar</button></div>`).join("") : `<div class="empty">No hay productos. Crea uno o importa tu Excel.</div>`; };
  pintar(); $("#bq").oninput = e => pintar(e.target.value);
  $("#lp").onclick = e => { const b = e.target.closest("[data-ed]"); if (b) formProducto(S.productos.find(p => p.id === b.dataset.ed)); };
  $("#nuevo").onclick = () => formProducto({ nombre: "", categoria: "", presentacion: "", precio: "", stock: 0, activo: true });
  $("#exp").onclick = () => libro({ Productos: S.productos.map(p => ({ Nombre: p.nombre, Categoría: p.categoria, Presentación: p.presentacion, Precio: Number(p.precio), Stock: p.stock, Activo: p.activo ? "SI" : "NO", Foto: p.foto_url || "" })) }, "productos");
  $("#pla").onclick = () => libro({ Productos: [{ Nombre: "Producto de ejemplo", Categoría: "Gaseosas", Presentación: "Paca x12", Precio: 20000, Stock: 50, Activo: "SI", Foto: "" }] }, "plantilla-productos");
  $("#imp").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer()), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const norm = o => { const m = {}; for (const k in o) m[k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()] = o[k]; return m; };
      const ok = [], malas = [];
      rows.map(norm).forEach((r, i) => { const precio = Number(String(r.precio).replace(/[^\d.]/g, "")); if (!String(r.nombre).trim() || !(precio >= 0) || r.precio === "") { malas.push(i + 2); return; }
        ok.push({ nombre: String(r.nombre).trim(), categoria: String(r.categoria || "General").trim(), presentacion: String(r.presentacion || "").trim(), precio, stock: Math.max(0, parseInt(r.stock) || 0), activo: !/^(no|n|0|false)$/i.test(String(r.activo).trim()), foto_url: String(r.foto || "").trim() || null }); });
      if (!ok.length) return toast("No encontré filas válidas. Usa la plantilla.", 1);
      if (!confirm(`Importar ${ok.length} producto(s)?${malas.length ? `\nSe omiten filas con error: ${malas.slice(0, 15).join(", ")}` : ""}`)) return;
      let n = 0;
      for (const p of ok) { const ex = S.productos.find(x => x.nombre.toLowerCase() === p.nombre.toLowerCase() && (x.presentacion || "").toLowerCase() === p.presentacion.toLowerCase());
        if (!p.foto_url && ex) delete p.foto_url;
        const { error } = ex ? await sb.from("productos").update(p).eq("id", ex.id) : await sb.from("productos").insert(p); if (!error) n++; }
      toast(`Importados ${n} de ${ok.length} productos`); aProductos(el);
    } catch (er) { toast("No pude leer el archivo: " + er.message, 1); }
  };
}
function formProducto(p) {
  const cats = [...new Set(S.productos.map(x => x.categoria))];
  $("#modal").innerHTML = `<div class="ov"><form class="card modal" id="fp"><h3>${p.id ? "Editar" : "Nuevo"} producto</h3>
    <div class="fotoed">${foto(p, "ph")}<label class="btn ghost sm">📷 Foto<input type="file" id="ff" accept="image/*" hidden></label></div>
    <label>Nombre<input name="nombre" required value="${esc(p.nombre)}"></label>
    <div class="two"><label>Categoría<input name="categoria" required list="dlc" value="${esc(p.categoria)}"><datalist id="dlc">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label><label>Presentación<input name="presentacion" placeholder="Paca x12" value="${esc(p.presentacion)}"></label></div>
    <div class="two"><label>Precio (COP)<input name="precio" type="number" min="0" step="50" required value="${esc(p.precio)}" inputmode="numeric"></label><label>Stock<input name="stock" type="number" min="0" required value="${esc(p.stock)}" inputmode="numeric"></label></div>
    <label class="chk"><input type="checkbox" name="activo" ${p.activo ? "checked" : ""}> Visible en el catálogo</label>
    <div class="btns"><button class="btn y">Guardar</button><button type="button" class="btn ghost" id="cx">Cancelar</button>${p.id ? `<button type="button" class="btn red" id="del">Eliminar</button>` : ""}</div></form></div>`;
  let archivo = null;
  $("#ff").onchange = e => { archivo = e.target.files[0]; if (archivo) $(".fotoed .ph").outerHTML = `<img class="ph" src="${URL.createObjectURL(archivo)}">`; };
  $("#cx").onclick = () => $("#modal").innerHTML = "";
  if ($("#del")) $("#del").onclick = async () => { if (!confirm("¿Eliminar este producto? Los pedidos anteriores lo conservan.")) return; const { error } = await sb.from("productos").delete().eq("id", p.id); if (error) return toast(errMsg(error), 1); toast("Producto eliminado"); vAdmin("productos"); };
  $("#fp").onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), b = e.target.querySelector(".btn.y"); b.disabled = true; b.textContent = "Guardando…";
    const d = { nombre: f.get("nombre").trim(), categoria: f.get("categoria").trim(), presentacion: f.get("presentacion").trim(), precio: Number(f.get("precio")), stock: parseInt(f.get("stock")) || 0, activo: !!f.get("activo") };
    if (archivo) { const img = await comprimir(archivo); const ruta = crypto.randomUUID() + ".webp";
      const { error } = await sb.storage.from("productos").upload(ruta, img, { contentType: "image/webp", cacheControl: "31536000" });
      if (error) { b.disabled = false; b.textContent = "Guardar"; return toast(errMsg(error), 1); } d.foto_url = sb.storage.from("productos").getPublicUrl(ruta).data.publicUrl; }
    const { error } = p.id ? await sb.from("productos").update(d).eq("id", p.id) : await sb.from("productos").insert(d);
    if (error) { b.disabled = false; b.textContent = "Guardar"; return toast(errMsg(error), 1); }
    toast("Producto guardado"); vAdmin("productos");
  };
}
function comprimir(file) { return new Promise((ok, ko) => { const i = new Image(); i.onload = () => { const s = Math.min(1, 600 / Math.max(i.width, i.height)), c = document.createElement("canvas"); c.width = i.width * s; c.height = i.height * s; c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); c.toBlob(b => b ? ok(b) : ko(new Error("imagen")), "image/webp", .82); }; i.onerror = ko; i.src = URL.createObjectURL(file); }); }
async function aUsuarios(el) {
  const { data } = await sb.from("profiles").select("*").order("rol").order("nombre").limit(2000);
  const n = r => data.filter(u => u.rol === r).length;
  el.innerHTML = `<div class="kpis"><div><small>Vendedores</small><b>${n("vendedor")}/4</b></div><div><small>Bodega</small><b>${n("bodega")}/2</b></div><div><small>Tiendas</small><b>${n("cliente")}</b></div></div>
  <p class="muted small">Para dar un rol, la persona primero se inscribe en la app con su correo. Luego aquí le asignas Vendedor (máx. 4) o Bodega (máx. 2).</p>
  <input id="bq" type="search" placeholder="🔎 Buscar por nombre, correo o cédula…"><div class="card list" id="lu"></div>`;
  const pintar = t => { t = (t || "").toLowerCase(); $("#lu").innerHTML = data.filter(u => !t || (u.nombre + u.correo + u.cedula).toLowerCase().includes(t)).map(u => `<div class="row"><div class="grow"><b>${esc(u.nombre || "(sin nombre)")}</b><small>${esc(u.correo)} · CC ${esc(u.cedula)}</small></div>
    ${u.rol === "administrador" ? `<span class="tag">Administrador</span>` : `<select data-u="${u.id}">${["cliente", "vendedor", "bodega"].map(r => `<option value="${r}" ${u.rol === r ? "selected" : ""}>${ROLES[r]}</option>`).join("")}</select>`}</div>`).join(""); };
  pintar(); $("#bq").oninput = e => pintar(e.target.value);
  $("#lu").onchange = async e => { const s = e.target.closest("select"); if (!s) return; const { error } = await sb.rpc("asignar_rol", { p_usuario: s.dataset.u, p_rol: s.value }); if (error) { toast(errMsg(error), 1); } else toast("Rol actualizado"); aUsuarios(el); };
}
async function aClientes(el) {
  const { data } = await sb.from("profiles").select("nombre,cedula,telefono,direccion,correo,creado,id").eq("rol", "cliente").order("nombre").limit(5000);
  el.innerHTML = `<div class="head"><b>${data.length} tienda(s) inscritas</b><button id="xls" class="btn ghost sm">⬇️ Excel</button></div><div class="card list">${data.map(c => `<a class="row" href="#/conversacion/${c.id}"><div class="grow"><b>${esc(c.nombre)}</b><small>📞 ${esc(c.telefono)} · 📍 ${esc(c.direccion)}</small></div><span>💬</span></a>`).join("") || `<div class="empty">Aún no hay tiendas inscritas.</div>`}</div>`;
  $("#xls").onclick = () => libro({ Tiendas: data.map(c => ({ Nombre: c.nombre, Cédula: c.cedula, Teléfono: c.telefono, Dirección: c.direccion, Correo: c.correo, Inscrita: fecha(c.creado) })) }, "tiendas");
}
async function aAjustes(el) {
  await cargarCatalogo();
  el.innerHTML = `<form id="fa" class="card"><label>Pedido mínimo (COP)<input name="pedido_minimo" type="number" min="0" step="1000" value="${esc(S.config.pedido_minimo)}"></label>
   <label>WhatsApp de ventas (ej. 3001234567)<input name="whatsapp_vendedor" type="tel" value="${esc(S.config.whatsapp_vendedor)}"></label><button class="btn y w">Guardar ajustes</button></form>`;
  $("#fa").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const { error } = await sb.from("config").update({ pedido_minimo: Number(f.get("pedido_minimo")) || 0, whatsapp_vendedor: f.get("whatsapp_vendedor").replace(/\D/g, ""), actualizado: new Date().toISOString() }).eq("id", 1); toast(error ? errMsg(error) : "Ajustes guardados", !!error); };
}

// ---------- Inicio ----------
sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") { S.recovery = true; location.hash = "#/clave"; } if (ev === "SIGNED_OUT") { S.user = null; S.perfil = null; nav(); } });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
navigator.serviceWorker?.addEventListener("message", e => { if (e.data?.url) location.hash = e.data.url; });
(async () => { await cargarPerfil(); await router(); })();
