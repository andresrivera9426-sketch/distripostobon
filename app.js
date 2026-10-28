"use strict";
const CFG = window.DP_CONFIG;
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = s => document.querySelector(s), app = $("#app");
const ESTADOS = ["Recibido", "Confirmado", "Alistando", "En ruta", "Entregado"];
const ICON = { Recibido: "📥", Confirmado: "✅", Alistando: "📦", "En ruta": "🚚", Entregado: "🏁", Cancelado: "✖️" };
const ROLES = { cliente: "Tienda", vendedor: "Vendedor", bodega: "Bodega", administrador: "Administrador" };
const LS = (k, v) => v === undefined ? JSON.parse(localStorage.getItem("dp_" + k) || "null") : localStorage.setItem("dp_" + k, JSON.stringify(v));
const S = { user: null, perfil: null, productos: LS("cat_productos") || [], banners: LS("cat_banners") || [], config: LS("cat_config") || { pedido_minimo: 0, whatsapp_vendedor: "", stock_alerta: 10, franjas: [] }, favs: new Set(), frecuentes: [], cat: "Todo", filtro: "", orden: "", q: "", carrito: LS("carrito") || {}, canales: [], chatSub: null, recovery: false, offline: false };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cop = n => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO");
const fecha = d => new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
const fechaCorta = d => d ? new Date(d + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" }) : "";
const hoyISO = (add = 0) => new Date(Date.now() + add * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const staff = () => S.perfil && S.perfil.rol !== "cliente";
const rol = () => S.perfil?.rol;
const enPromo = p => p.precio_promo != null && Number(p.precio_promo) < Number(p.precio);
const precioDe = p => enPromo(p) ? Number(p.precio_promo) : Number(p.precio);
const vigente = t => t === S.navTok;
const debounce = (f, ms = 180) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
async function cargarXLSX() { if (window.XLSX) return true; try { await new Promise((ok, ko) => { const s = document.createElement("script"); s.src = XLSX_URL; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); } catch (e) { } if (!window.XLSX) toast("No pude cargar Excel. Revisa tu conexión.", 1); return !!window.XLSX; }
function toast(m, err) { const t = $("#toast"); t.textContent = m; t.className = "toast on" + (err ? " err" : ""); clearTimeout(t._t); t._t = setTimeout(() => t.className = "toast", 3800); }
function errMsg(e) { const m = e?.message || String(e); if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sin conexión. Revisa tu internet e intenta de nuevo."; return m.replace(/^.*?ERROR:\s*/, "").replace("Invalid login credentials", "Correo o contraseña incorrectos").replace("Email not confirmed", "Debes confirmar tu correo: revisa tu bandeja de entrada").replace("User already registered", "Ese correo ya está registrado"); }
function guardarCarrito() { LS("carrito", S.carrito); barra(); }
function sala(token) { return CFG.jitsi + "DistriPostobon-" + token; }
function wa(tel, txt) { const n = String(tel || "").replace(/\D/g, ""); if (!n) return ""; return "https://wa.me/" + (n.length === 10 ? "57" + n : n) + "?text=" + encodeURIComponent(txt || ""); }
function modal(html) { const m = $("#modal"); m.innerHTML = `<div class="ov" role="dialog" aria-modal="true"><div class="card modal">${html}</div></div>`; m.querySelector(".ov").onclick = e => { if (e.target.classList.contains("ov")) cerrarModal(); }; const f = m.querySelector("input:not([type=file]),textarea,select"); f && f.focus(); return m; }
function cerrarModal() { $("#modal").innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarModal(); });

// ---------- Tema ----------
function aplicarTema() { const t = LS("tema") || "auto"; document.documentElement.dataset.tema = t; const dark = t === "oscuro" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches); document.querySelector("meta[name=theme-color]").content = dark ? "#0d1520" : "#0b5cab"; }
aplicarTema(); matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", aplicarTema);

// ---------- Sonido y notificaciones ----------
let actx;
function sonar() { try { actx = actx || new AudioContext(); [0, .18].forEach((t, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = i ? 1046 : 784; g.gain.setValueAtTime(.25, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + t + .3); o.connect(g).connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + .3); }); } catch (e) { } }
function avisar(titulo, cuerpo, url) {
  sonar(); toast(titulo + " · " + cuerpo); if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    navigator.serviceWorker?.ready.then(r => r.showNotification(titulo, { body: cuerpo, icon: "icon-192.png", badge: "icon-192.png", tag: url || titulo, data: { url } })).catch(() => new Notification(titulo, { body: cuerpo }));
  }
}
function pedirPermiso() { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); }

// ---------- Sesión y datos ----------
async function cargarPerfil() {
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null; S.perfil = null; S.favs = new Set();
  if (S.user) {
    const { data } = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
    const cache = LS("perfil"); S.perfil = data || (cache && cache.id === S.user.id ? cache : null);
    if (data) LS("perfil", data);
    if (!S.perfil) S.perfil = { id: S.user.id, rol: "cliente", nombre: "", correo: S.user.email, sala: "" };
    if (data?.rol === "cliente") { const { data: f } = await sb.from("favoritos").select("producto_id"); S.favs = new Set((f || []).map(x => x.producto_id)); }
  }
  nav(); suscribir(); contarNoLeidos();
}
async function cargarCatalogo() {
  try {
    const [p, c, b] = await Promise.all([sb.from("productos").select("*").order("destacado", { ascending: false }).order("categoria").order("nombre"), sb.from("config").select("*").eq("id", 1).single(), sb.from("banners").select("*").order("orden")]);
    if (p.error) throw p.error;
    S.productos = p.data || []; if (c.data) S.config = c.data; S.banners = b.data || []; S.offline = false;
    if (!staff()) { LS("cat_productos", S.productos); LS("cat_config", S.config); LS("cat_banners", S.banners); }
  } catch (e) { S.offline = true; }
}
async function cargarFrecuentes() {
  S.frecuentes = [];
  if (!S.user || staff() || S.offline) return;
  const { data } = await sb.from("pedidos").select("pedido_items(producto_id,cantidad)").eq("cliente_id", S.user.id).neq("estado", "Cancelado").order("creado", { ascending: false }).limit(20);
  const cnt = {}; (data || []).forEach(o => o.pedido_items.forEach(i => { if (i.producto_id) cnt[i.producto_id] = (cnt[i.producto_id] || 0) + i.cantidad; }));
  S.frecuentes = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([id]) => S.productos.find(p => p.id === id && p.activo && p.stock > 0)).filter(Boolean).slice(0, 10);
}
function nav() {
  const n = $("#nav"), t = $("#tabs");
  if (!S.user) { n.innerHTML = `<a href="#/entrar" class="btn sm">Entrar</a>`; t.innerHTML = `<a href="#/">🛒<span>Catálogo</span></a><a href="#/entrar">👤<span>Entrar</span></a>`; marcarTab(); return; }
  const nom = esc((S.perfil?.nombre || S.user.email).split(" ")[0]);
  n.innerHTML = `<a href="#/perfil" class="chip">${nom} · ${ROLES[rol()] || ""}</a>`;
  t.innerHTML = staff()
    ? `<a href="#/panel">📋<span>Pedidos</span></a>${rol() !== "bodega" ? `<a href="#/chats" class="chatTab">💬<span>Chats</span></a>` : ""}${rol() === "administrador" ? `<a href="#/admin">📊<span>Admin</span></a>` : ""}<a href="#/perfil">👤<span>Perfil</span></a>`
    : `<a href="#/">🛒<span>Catálogo</span></a><a href="#/pedidos">📦<span>Pedidos</span></a><a href="#/chat" class="chatTab">💬<span>Chat</span></a><a href="#/perfil">👤<span>Perfil</span></a>`;
  marcarTab();
}
function marcarTab() { const h = location.hash || "#/"; document.querySelectorAll("#tabs a").forEach(a => { const r = a.getAttribute("href"); const on = r === "#/" ? (h === "#/" || h === "#") : h.startsWith(r); a.classList.toggle("on", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); }); }

// ---------- Mensajes no leídos ----------
const visto = k => LS("visto_" + k) || "1970-01-01T00:00:00Z";
function marcarVisto(k) { LS("visto_" + k, new Date().toISOString()); contarNoLeidos(); }
async function contarNoLeidos() {
  if (!S.user || rol() === "bodega") return;
  const { count } = await sb.from("mensajes").select("id", { count: "exact", head: true }).neq("autor_id", S.user.id).gt("creado", visto(staff() ? "chats" : "cliente"));
  document.querySelectorAll(".chatTab").forEach(a => { a.querySelector(".badge")?.remove(); if (count) a.insertAdjacentHTML("beforeend", `<b class="badge" aria-label="${count} sin leer">${count > 99 ? "99+" : count}</b>`); });
}

// ---------- Realtime ----------
function suscribir() {
  S.canales.forEach(c => sb.removeChannel(c)); S.canales = [];
  if (!S.user) return;
  const ch = sb.channel("dp-" + S.user.id);
  if (staff()) {
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos" }, p => { avisar("Nuevo pedido " + p.new.codigo, "Total " + cop(p.new.total || 0), "#/pedido/" + p.new.codigo); refrescarSi("#/panel"); });
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos" }, p => { if (rol() === "bodega" && p.new.estado === "Confirmado") avisar("Pedido para alistar", p.new.codigo, "#/pedido/" + p.new.codigo); refrescarSi("#/panel"); });
    if (rol() !== "bodega") ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes" }, p => { if (p.new.autor_id !== S.user.id) { if (!document.querySelector("#chatBox")) avisar("Nuevo mensaje", p.new.texto.slice(0, 80)); contarNoLeidos(); refrescarSi("#/chats"); } });
  } else {
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos", filter: "cliente_id=eq." + S.user.id }, p => { avisar("Pedido " + p.new.codigo, ICON[p.new.estado] + " " + p.new.estado, "#/pedido/" + p.new.codigo); refrescarSi("#/pedido"); });
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: "cliente_id=eq." + S.user.id }, p => { if (p.new.autor_id !== S.user.id) { if (!document.querySelector("#chatBox")) avisar("Mensaje de tu vendedor", p.new.texto.slice(0, 80)); contarNoLeidos(); } });
  }
  ch.subscribe(); S.canales.push(ch);
}
function refrescarSi(pref) { if (location.hash.startsWith(pref) && !document.activeElement?.matches("input,textarea,select") && !$("#modal").innerHTML) router(); }

// ---------- Router ----------
const rutas = { "": vCatalogo, entrar: vEntrar, carrito: vCarrito, pedidos: vMisPedidos, pedido: vPedido, seguir: vSeguir, chat: vChatGeneral, perfil: vPerfil, panel: vPanel, chats: vChats, conversacion: vConversacion, admin: vAdmin, clave: vClave };
async function router() {
  if (S.chatSub) { sb.removeChannel(S.chatSub); S.chatSub = null; }
  cerrarModal(); app.onclick = null; S.navTok = (S.navTok || 0) + 1;
  let [r, ...a] = location.hash.replace(/^#\/?/, "").split("/");
  if (!(r in rutas)) r = "";
  if (S.recovery && r !== "clave") { location.hash = "#/clave"; return; }
  const priv = !["", "entrar", "carrito"].includes(r);
  if (priv && !S.user) { location.hash = "#/entrar"; return; }
  if (["panel", "chats", "conversacion", "admin"].includes(r) && !staff()) { location.hash = "#/"; return; }
  if (r === "admin" && rol() !== "administrador") { location.hash = "#/panel"; return; }
  if (r === "" && staff() && sessionStorage.dpVerCat !== "1") { location.hash = "#/panel"; return; }
  marcarTab(); barra();
  try { await rutas[r](...a.map(decodeURIComponent)); } catch (e) { console.error(e); app.innerHTML = `<div class="card"><h2>Algo falló</h2><p>${esc(errMsg(e))}</p><button class="btn" onclick="router()">Reintentar</button></div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);

// ---------- Catálogo ----------
function barra() {
  const n = Object.values(S.carrito).reduce((a, b) => a + b, 0), bar = $("#bar");
  const h = location.hash.replace(/^#\/?/, "");
  if (!n || staff() || h !== "") { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden"); $("#barN").textContent = n + " producto" + (n > 1 ? "s" : ""); $("#barT").textContent = cop(totalCarrito());
}
function totalCarrito() { return Object.entries(S.carrito).reduce((t, [id, q]) => { const p = S.productos.find(x => x.id === id); return t + (p ? precioDe(p) * q : 0); }, 0); }
function foto(p, cls = "ph") { return p.foto_url ? `<img class="${cls}" src="${esc(p.foto_url)}" alt="" loading="lazy" decoding="async">` : `<div class="${cls} nof" aria-hidden="true">${esc((p.nombre || "?").replace(/^EJEMPLO · /, "").slice(0, 2).toUpperCase())}</div>`; }
function tarjeta(p) {
  const c = S.carrito[p.id] || 0, ago = p.stock <= 0, fav = S.favs.has(p.id), pr = enPromo(p);
  return `<article class="prod">${pr ? `<span class="promo">-${Math.round(100 - precioDe(p) * 100 / p.precio)}%</span>` : ""}
   ${S.user && !staff() ? `<button class="fav ${fav ? "on" : ""}" data-f="${p.id}" aria-label="${fav ? "Quitar de" : "Agregar a"} favoritos" aria-pressed="${fav}">${fav ? "♥" : "♡"}</button>` : ""}
   ${foto(p)}<div class="pi"><h3>${esc(p.nombre)}</h3><small>${esc(p.presentacion)}</small>${p.descripcion ? `<small class="desc">${esc(p.descripcion)}</small>` : ""}
   <div class="pr"><span>${pr ? `<s>${cop(p.precio)}</s> ` : ""}<b>${cop(precioDe(p))}</b></span>${ago ? `<span class="tag red">Agotado</span>` : p.stock < 10 ? `<span class="tag">Quedan ${p.stock}</span>` : ""}</div>
   ${ago || staff() ? "" : c ? `<div class="qty"><button data-m="${p.id}" aria-label="Quitar uno de ${esc(p.nombre)}">−</button><span aria-live="polite">${c}</span><button data-p="${p.id}" aria-label="Agregar uno de ${esc(p.nombre)}">+</button></div>` : `<button class="btn w" data-p="${p.id}">Agregar</button>`}</div></article>`;
}
const sinTilde = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
async function vCatalogo() {
  if (!S.productos.length) app.innerHTML = `<div class="grid">${"<div class='prod sk'></div>".repeat(6)}</div>`;
  const T = S.navTok; await cargarCatalogo(); await cargarFrecuentes(); if (!vigente(T)) return;
  const activos = S.productos.filter(p => p.activo);
  const cats = ["Todo", ...new Set(activos.map(p => p.categoria))];
  if (!cats.includes(S.cat)) S.cat = "Todo";
  const ban = S.banners.filter(b => b.activo);
  const colorOk = c => /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#0b5cab";
  app.innerHTML = `
  ${S.offline ? `<div class="note warn">📴 Sin conexión: ves el catálogo guardado. Podrás enviar el pedido cuando vuelva el internet.</div>` : ""}
  ${S.user ? "" : `<section class="hero"><h1>Pide para tu tienda en segundos</h1><p>Catálogo, promociones, chat con tu vendedor y seguimiento de cada pedido con código.</p><a class="btn y" href="#/entrar/registro">Inscribir mi tienda</a> <a class="btn ghost" href="#/entrar">Ya tengo cuenta</a></section>`}
  ${staff() ? `<div class="note">Estás viendo el catálogo como ${ROLES[rol()]}. <a href="#/panel" onclick="sessionStorage.dpVerCat=''">Volver al panel</a></div>` : ""}
  ${ban.length ? `<div class="banners" aria-label="Promociones">${ban.map(b => `<div class="banner" style="--bc:${colorOk(b.color)}">${b.imagen_url ? `<img src="${esc(b.imagen_url)}" alt="" loading="lazy">` : ""}<div><b>${esc(b.titulo)}</b><p>${esc(b.texto)}</p></div></div>`).join("")}</div>` : ""}
  ${S.frecuentes.length ? `<h3 class="sec">🔁 Pide de nuevo</h3><div class="hscroll grid" id="frec"></div>` : ""}
  <div class="search"><input id="q" type="search" placeholder="🔎 Buscar producto…" aria-label="Buscar producto" value="${esc(S.q)}" autocomplete="off">
   <select id="orden" aria-label="Ordenar"><option value="">Orden</option><option value="pa" ${S.orden === "pa" ? "selected" : ""}>Precio ↑</option><option value="pd" ${S.orden === "pd" ? "selected" : ""}>Precio ↓</option><option value="n" ${S.orden === "n" ? "selected" : ""}>Nombre A-Z</option></select></div>
  <div class="cats" role="toolbar" aria-label="Filtros">${S.user && !staff() ? `<button class="cat ${S.filtro === "fav" ? "on" : ""}" data-x="fav">♥ Favoritos</button>` : ""}${activos.some(enPromo) ? `<button class="cat ${S.filtro === "promo" ? "on" : ""}" data-x="promo">🔥 Promos</button>` : ""}${cats.map(c => `<button class="cat ${c === S.cat ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
  ${S.config.pedido_minimo > 0 ? `<p class="muted small">Pedido mínimo: <b>${cop(S.config.pedido_minimo)}</b></p>` : ""}
  <div id="grid" class="grid"></div>`;
  const pintar = () => {
    const q = sinTilde(S.q);
    let l = activos.filter(p => (S.cat === "Todo" || p.categoria === S.cat) && (S.filtro !== "fav" || S.favs.has(p.id)) && (S.filtro !== "promo" || enPromo(p)) && (!q || sinTilde(p.nombre + " " + p.presentacion + " " + p.categoria + " " + (p.descripcion || "")).includes(q)));
    if (S.orden === "pa") l.sort((a, b) => precioDe(a) - precioDe(b)); if (S.orden === "pd") l.sort((a, b) => precioDe(b) - precioDe(a)); if (S.orden === "n") l.sort((a, b) => a.nombre.localeCompare(b.nombre));
    $("#grid").innerHTML = l.length ? l.map(tarjeta).join("") : `<div class="empty">${S.productos.length ? (S.filtro === "fav" ? "Aún no tienes favoritos. Toca ♡ en un producto." : "No hay productos con ese filtro.") : "Aún no hay productos. El administrador los carga desde su panel."}</div>`;
    const fr = $("#frec"); if (fr) fr.innerHTML = S.frecuentes.map(tarjeta).join("");
  };
  pintar();
  $("#q").oninput = debounce(e => { S.q = e.target.value; pintar(); });
  $("#orden").onchange = e => { S.orden = e.target.value; pintar(); };
  app.querySelectorAll(".cat").forEach(b => b.onclick = () => { if (b.dataset.x) S.filtro = S.filtro === b.dataset.x ? "" : b.dataset.x; else S.cat = b.dataset.c; vCatalogo(); });
  app.onclick = async e => {
    const b = e.target.closest("button[data-p],button[data-m],button[data-f]"); if (!b || staff()) return;
    if (b.dataset.f) {
      const id = b.dataset.f, on = S.favs.has(id);
      on ? S.favs.delete(id) : S.favs.add(id); pintar();
      const { error } = on ? await sb.from("favoritos").delete().eq("cliente_id", S.user.id).eq("producto_id", id) : await sb.from("favoritos").insert({ cliente_id: S.user.id, producto_id: id });
      if (error) { on ? S.favs.add(id) : S.favs.delete(id); pintar(); toast(errMsg(error), 1); }
      return;
    }
    const id = b.dataset.p || b.dataset.m, p = S.productos.find(x => x.id === id);
    if (b.dataset.p) { if ((S.carrito[id] || 0) >= p.stock) return toast("No hay más unidades disponibles", 1); S.carrito[id] = (S.carrito[id] || 0) + 1; }
    else { S.carrito[id]--; if (S.carrito[id] <= 0) delete S.carrito[id]; }
    if (navigator.vibrate) navigator.vibrate(12);
    guardarCarrito(); pintar();
  };
}

async function vCarrito() {
  const T = S.navTok; await cargarCatalogo(); if (!vigente(T)) return;
  for (const id in S.carrito) if (!S.productos.find(p => p.id === id && p.activo)) delete S.carrito[id];
  guardarCarrito();
  const items = Object.entries(S.carrito).map(([id, q]) => ({ p: S.productos.find(x => x.id === id), q }));
  const tot = totalCarrito(), min = Number(S.config.pedido_minimo) || 0;
  const ahorro = items.reduce((a, { p, q }) => a + (p.precio - precioDe(p)) * q, 0);
  if (!items.length) { app.innerHTML = `<div class="empty big">🛒<p>Tu carrito está vacío.</p><a class="btn" href="#/">Ver catálogo</a></div>`; return; }
  const franjas = S.config.franjas || [];
  const prev = { notas: $("#notas")?.value || "", fecha: $("#fecha")?.value, franja: $("#franja")?.value || "" };
  app.innerHTML = `<h2>Tu carrito</h2><div class="card list" id="lc">${items.map(({ p, q }) => `
    <div class="row">${foto(p, "mini")}<div class="grow"><b>${esc(p.nombre)}</b><small>${esc(p.presentacion)} · ${cop(precioDe(p))}${enPromo(p) ? " 🔥" : ""}</small></div>
    <div class="qty"><button data-m="${p.id}" aria-label="Quitar uno de ${esc(p.nombre)}">−</button><span>${q}</span><button data-p="${p.id}" aria-label="Agregar uno de ${esc(p.nombre)}">+</button></div><b class="num">${cop(precioDe(p) * q)}</b></div>`).join("")}
    ${ahorro > 0 ? `<div class="row"><span class="grow ok-t">Ahorro por promociones</span><b class="ok-t">−${cop(ahorro)}</b></div>` : ""}
    <div class="row tot"><span class="grow">Total</span><b>${cop(tot)}</b></div></div>
    ${tot < min ? `<div class="note warn">Te faltan ${cop(min - tot)} para el pedido mínimo de ${cop(min)}.</div>` : ""}
    <div class="card"><h3>Entrega</h3><div class="two"><label>Fecha preferida<input id="fecha" type="date" min="${hoyISO()}" max="${hoyISO(30)}" value="${prev.fecha || hoyISO(1)}"></label>
     <label>Franja<select id="franja"><option value="">Cualquier hora</option>${franjas.map(f => `<option ${f === prev.franja ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></label></div>
     <label>Notas para el vendedor (opcional)<textarea id="notas" maxlength="500" placeholder="Ej.: llamar al llegar">${esc(prev.notas)}</textarea></label></div>
    ${S.offline ? `<div class="note warn">📴 Sin conexión. Tu carrito queda guardado.</div>` : ""}
    ${S.user ? `<button id="enviar" class="btn y w big" ${tot < min || S.offline ? "disabled" : ""}>Enviar pedido · ${cop(tot)}</button>`
             : `<a class="btn y w big" href="#/entrar">Entra o inscribe tu tienda para enviar el pedido</a>`}
    <button id="vaciar" class="btn ghost w">Vaciar carrito</button>`;
  $("#lc").onclick = e => { const b = e.target.closest("button"); if (!b) return; const id = b.dataset.p || b.dataset.m, p = S.productos.find(x => x.id === id);
    if (b.dataset.p) { if (S.carrito[id] >= p.stock) return toast("No hay más unidades disponibles", 1); S.carrito[id]++; } else { S.carrito[id]--; if (S.carrito[id] <= 0) delete S.carrito[id]; } guardarCarrito(); vCarrito(); };
  $("#vaciar").onclick = () => { if (confirm("¿Vaciar el carrito?")) { S.carrito = {}; guardarCarrito(); vCarrito(); } };
  const env = $("#enviar"); if (env) env.onclick = async () => {
    env.disabled = true; env.textContent = "Enviando…"; pedirPermiso();
    const { data, error } = await sb.rpc("crear_pedido", { p_items: items.map(({ p, q }) => ({ producto_id: p.id, cantidad: q })), p_notas: $("#notas").value, p_fecha: $("#fecha").value || null, p_franja: $("#franja").value });
    if (error) { toast(errMsg(error), 1); env.disabled = false; env.textContent = "Enviar pedido · " + cop(tot); return; }
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
    <label>Nombre de la tienda o persona<input name="nombre" required maxlength="120" autocomplete="organization"></label>
    <label>Cédula o NIT<input name="cedula" required inputmode="numeric" maxlength="20" pattern="[0-9.\\- ]{5,20}" title="Solo números, de 5 a 20"></label>
    <label>Teléfono celular<input name="telefono" required type="tel" inputmode="tel" maxlength="20" pattern="[0-9+ ]{7,20}" autocomplete="tel"></label>
    <label>Dirección de entrega<input name="direccion" required maxlength="200" autocomplete="street-address"></label>` : ""}
    <label>Correo electrónico<input name="correo" type="email" required autocomplete="email"></label>
    <label>Contraseña<span class="pw"><input name="clave" type="password" required minlength="8" autocomplete="${reg ? "new-password" : "current-password"}"><button type="button" class="ver" aria-label="Mostrar u ocultar contraseña">👁</button></span></label>
    ${reg ? `<label class="chk"><input type="checkbox" required> Acepto que mis datos se usen solo para gestionar mis pedidos.</label>` : ""}
    <button class="btn y w big" type="submit">${reg ? "Crear mi cuenta" : "Entrar"}</button></form>
    ${reg ? "" : `<button id="olv" class="link">¿Olvidaste tu contraseña?</button>`}</div>`;
  app.querySelector(".ver").onclick = () => { const i = app.querySelector("[name=clave]"); i.type = i.type === "password" ? "text" : "password"; };
  $("#f").onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), b = e.target.querySelector("[type=submit]"); b.disabled = true;
    if (reg) {
      const { data, error } = await sb.auth.signUp({ email: f.correo.trim(), password: f.clave, options: { emailRedirectTo: location.origin + location.pathname, data: { nombre: f.nombre.trim(), cedula: f.cedula.trim(), telefono: f.telefono.trim(), direccion: f.direccion.trim() } } });
      b.disabled = false; if (error) return toast(errMsg(error), 1);
      if (!data.session) { app.innerHTML = `<div class="card ok"><div class="bigi">📧</div><h2>Revisa tu correo</h2><p>Te enviamos un enlace a <b>${esc(f.correo)}</b> para activar tu cuenta (mira también en spam). Después entra con tu correo y contraseña.</p><a class="btn w" href="#/entrar">Ir a entrar</a></div>`; return; }
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
  const p = S.perfil, t = LS("tema") || "auto";
  app.innerHTML = `<h2>Mi perfil</h2><div class="card"><p><span class="tag">${ROLES[p.rol]}</span> ${esc(p.correo)}</p><form id="f">
   <label>Nombre<input name="nombre" required maxlength="120" value="${esc(p.nombre)}"></label><label>Cédula o NIT<input name="cedula" required maxlength="20" value="${esc(p.cedula)}"></label>
   <label>Teléfono<input name="telefono" required type="tel" maxlength="20" value="${esc(p.telefono)}"></label><label>Dirección<input name="direccion" required maxlength="200" value="${esc(p.direccion)}"></label>
   <button class="btn w">Guardar cambios</button></form></div>
   <div class="card"><h3>Preferencias</h3><label>Tema<select id="tema"><option value="auto" ${t === "auto" ? "selected" : ""}>Automático</option><option value="claro" ${t === "claro" ? "selected" : ""}>Claro</option><option value="oscuro" ${t === "oscuro" ? "selected" : ""}>Oscuro</option></select></label>
   <button id="notif" class="btn ghost w">🔔 Activar notificaciones</button><a class="btn ghost w" href="#/clave">🔑 Cambiar contraseña</a>${staff() ? `<a class="btn ghost w" href="#/" onclick="sessionStorage.dpVerCat='1'">🛒 Ver catálogo</a>` : ""}<button id="salir" class="btn red w">Cerrar sesión</button></div>`;
  $("#f").onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); for (const k in f) f[k] = f[k].trim(); const { error } = await sb.from("profiles").update(f).eq("id", p.id); if (error) return toast(errMsg(error), 1); await cargarPerfil(); toast("Datos guardados"); };
  $("#tema").onchange = e => { LS("tema", e.target.value); aplicarTema(); };
  $("#notif").onclick = async () => { if (!("Notification" in window)) return toast("Tu navegador no permite notificaciones", 1); const r = await Notification.requestPermission(); sonar(); toast(r === "granted" ? "Notificaciones activadas" : "No se activaron las notificaciones", r !== "granted"); };
  $("#salir").onclick = async () => { await sb.auth.signOut(); S.carrito = {}; guardarCarrito(); sessionStorage.dpVerCat = ""; ["cat_productos", "perfil"].forEach(k => localStorage.removeItem("dp_" + k)); await cargarPerfil(); location.hash = "#/"; };
}

// ---------- Pedidos ----------
function tagEstado(e) { return `<span class="est e${ESTADOS.indexOf(e)}${e === "Cancelado" ? " red" : ""}">${ICON[e] || ""} ${esc(e)}</span>`; }
function estrellas(n) { return n ? `<span class="stars" aria-label="${n} de 5 estrellas">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>` : ""; }
async function vMisPedidos() {
  const T = S.navTok; const { data, error } = await sb.from("pedidos").select("*").eq("cliente_id", S.user.id).order("creado", { ascending: false }).limit(100); if (error) throw error; if (!vigente(T)) return;
  app.innerHTML = `<h2>Mis pedidos</h2><a class="btn ghost w" href="#/seguir">🔎 Buscar por código</a>
  ${data.length ? `<div class="card list">${data.map(o => `<a class="row" href="#/pedido/${o.codigo}"><div class="grow"><b>${o.codigo}</b><small>${fecha(o.creado)}${o.fecha_entrega ? " · Entrega " + fechaCorta(o.fecha_entrega) : ""}</small>${estrellas(o.calificacion)}</div>${tagEstado(o.estado)}<b class="num">${cop(o.total)}</b></a>`).join("")}</div>` : `<div class="empty">Aún no has hecho pedidos.</div>`}`;
}
function vSeguir() {
  app.innerHTML = `<h2>Seguir pedido</h2><form id="f" class="card"><label>Código del pedido<input name="c" required placeholder="DP-XXXXX" style="text-transform:uppercase" autocomplete="off"></label><button class="btn w">Buscar</button></form>`;
  $("#f").onsubmit = e => { e.preventDefault(); let c = e.target.c.value.trim().toUpperCase(); if (!c.startsWith("DP-")) c = "DP-" + c; location.hash = "#/pedido/" + c; };
}
async function urlPrueba(path) { if (!path) return ""; const { data } = await sb.storage.from("entregas").createSignedUrl(path, 3600); return data?.signedUrl || ""; }
async function vPedido(codigo) {
  const T = S.navTok;
  const { data: o } = await sb.from("pedidos").select("*, pedido_items(*), pedido_historial(*), cliente:profiles!pedidos_cliente_id_fkey(nombre,telefono,direccion,cedula), vendedor:profiles!pedidos_vendedor_id_fkey(nombre)").eq("codigo", (codigo || "").toUpperCase()).maybeSingle();
  if (!o) { app.innerHTML = `<div class="empty big">🔎<p>No encontramos el pedido <b>${esc(codigo)}</b> en tu cuenta.</p><a class="btn" href="#/seguir">Buscar otro</a></div>`; return; }
  const h = o.pedido_historial.sort((a, b) => new Date(a.creado) - new Date(b.creado)), idx = ESTADOS.indexOf(o.estado);
  const cuando = e => { const x = h.filter(y => y.estado === e).pop(); return x ? fecha(x.creado) : ""; };
  const r = rol(), cerr = ["Entregado", "Cancelado"].includes(o.estado);
  const sig = { vendedor: ESTADOS.slice(1), administrador: ESTADOS.slice(1), bodega: ["Alistando", "En ruta", "Entregado"] }[r] || [];
  if (!staff() && !S.config.franjas) await cargarCatalogo();
  const telV = staff() ? o.cliente?.telefono : S.config.whatsapp_vendedor;
  const [fFoto, fFirma, eq] = await Promise.all([urlPrueba(o.prueba_foto), urlPrueba(o.prueba_firma), ["vendedor", "administrador"].includes(r) && !cerr ? sb.rpc("equipo_ventas") : { data: [] }]);
  const equipo = eq.data || []; if (!vigente(T)) return;
  app.innerHTML = `<a href="${staff() ? "#/panel" : "#/pedidos"}" class="back noprint">← Volver</a>
  <div class="card recibo"><div class="printonly"><b>DistriPostobon</b> · Comprobante de pedido</div>
  <div class="row nb"><div class="grow"><small>Pedido</small><div class="code sm">${o.codigo}</div><small>${fecha(o.creado)}</small></div>${tagEstado(o.estado)}</div>
  ${o.fecha_entrega || o.franja ? `<p class="muted">🗓️ Entrega preferida: <b>${fechaCorta(o.fecha_entrega)}</b> ${esc(o.franja || "")}</p>` : ""}
  ${o.vendedor || o.ruta ? `<p class="muted">🧑‍💼 ${esc(o.vendedor?.nombre || "Sin vendedor asignado")}${o.ruta ? " · Ruta " + esc(o.ruta) : ""}</p>` : ""}
  ${o.estado === "Cancelado" ? `<div class="note warn">Este pedido fue cancelado.${o.motivo_cancelacion ? " Motivo: " + esc(o.motivo_cancelacion) : ""}</div>` : `<ol class="tl">${ESTADOS.map((e, i) => `<li class="${i < idx ? "done" : i === idx ? "now" : ""}"><span aria-hidden="true">${ICON[e]}</span><div><b>${e}</b><small>${cuando(e)}</small></div></li>`).join("")}</ol>`}
  <div class="cli"><b>${esc(o.cliente?.nombre)}</b> · CC/NIT ${esc(o.cliente?.cedula)}<br>📞 ${esc(o.cliente?.telefono)} · 📍 ${esc(o.cliente?.direccion)}</div>
  <div class="list items">${o.pedido_items.map(i => `<div class="row"><div class="grow"><b>${i.cantidad} × ${esc(i.nombre)}</b><small>${esc(i.presentacion)} · ${cop(i.precio)}${i.precio_lista && Number(i.precio_lista) > Number(i.precio) ? ` <s>${cop(i.precio_lista)}</s>` : ""}</small></div><b class="num">${cop(i.precio * i.cantidad)}</b></div>`).join("")}
   <div class="row tot"><span class="grow">Total</span><b>${cop(o.total)}</b></div></div>${o.notas ? `<p class="muted">📝 ${esc(o.notas)}</p>` : ""}
  ${o.estado === "Entregado" && (o.recibio || fFoto || fFirma) ? `<div class="prueba"><h3>Prueba de entrega</h3><p>Recibió: <b>${esc(o.recibio)}</b> · ${cuando("Entregado")}</p><div class="pimgs">${fFoto ? `<img src="${esc(fFoto)}" alt="Foto de la entrega">` : ""}${fFirma ? `<img class="firma" src="${esc(fFirma)}" alt="Firma de quien recibió">` : ""}</div></div>` : ""}
  ${o.calificacion ? `<p>Calificación: ${estrellas(o.calificacion)} ${esc(o.comentario_calif || "")}</p>` : ""}
  <div class="btns noprint"><button class="btn ghost" id="imp">🖨️ Imprimir / PDF</button>${!staff() ? `<button class="btn ghost" id="rep">🔁 Repetir pedido</button>` : ""}${!staff() && o.estado === "Recibido" ? `<button class="btn red" id="canc">Cancelar pedido</button>` : ""}</div></div>
  ${!staff() && o.estado === "Entregado" && !o.calificacion ? `<div class="card noprint"><h3>¿Cómo te fue con este pedido?</h3><div class="rate" role="radiogroup" aria-label="Calificación">${[1, 2, 3, 4, 5].map(n => `<button data-s="${n}" role="radio" aria-checked="false" aria-label="${n} estrellas">☆</button>`).join("")}</div><textarea id="com" maxlength="300" placeholder="Comentario opcional" aria-label="Comentario"></textarea><button id="cal" class="btn w" disabled>Enviar calificación</button></div>` : ""}
  ${["vendedor", "administrador"].includes(r) && !cerr ? `<div class="card noprint"><h3>Asignación</h3><div class="two"><label>Vendedor<select id="asV"><option value="">Sin asignar</option>${equipo.map(v => `<option value="${v.id}" ${v.id === o.vendedor_id ? "selected" : ""}>${esc(v.nombre)}</option>`).join("")}</select></label><label>Ruta<input id="asR" maxlength="80" value="${esc(o.ruta || "")}" placeholder="Ej.: Norte"></label></div><button id="asG" class="btn ghost w">Guardar asignación</button></div>` : ""}
  ${staff() && !cerr ? `<div class="card noprint"><h3>Cambiar estado</h3><div class="btns">${sig.map(e => `<button class="btn ${e === o.estado ? "dis" : ""}" data-e="${e}" ${e === o.estado ? "disabled" : ""}>${ICON[e]} ${e}</button>`).join("")}${r !== "bodega" ? `<button class="btn red" data-e="Cancelado">Cancelar</button>` : ""}</div></div>` : ""}
  <div class="card noprint"><h3>Chat de este pedido</h3>${botonesLlamada(o.sala, telV, "Pedido " + o.codigo)}<div id="chatBox"></div></div>`;
  $("#imp").onclick = () => print();
  const rep = $("#rep"); if (rep) rep.onclick = async () => { await cargarCatalogo(); let n = 0, falt = 0; o.pedido_items.forEach(i => { const p = S.productos.find(x => x.id === i.producto_id && x.activo && x.stock > 0); if (p) { S.carrito[p.id] = Math.min(p.stock, (S.carrito[p.id] || 0) + i.cantidad); n++; } else falt++; }); guardarCarrito(); toast(`${n} producto(s) al carrito${falt ? ` · ${falt} ya no disponible(s)` : ""}`); location.hash = "#/carrito"; };
  const cc = $("#canc"); if (cc) cc.onclick = async () => { const m = prompt("¿Por qué cancelas? (opcional)"); if (m === null) return; const { error } = await sb.rpc("cambiar_estado", { p_pedido: o.id, p_estado: "Cancelado", p_motivo: m }); if (error) return toast(errMsg(error), 1); toast("Pedido cancelado"); vPedido(o.codigo); };
  let est = 0; app.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { est = +b.dataset.s; app.querySelectorAll("[data-s]").forEach(x => { x.textContent = +x.dataset.s <= est ? "★" : "☆"; x.setAttribute("aria-checked", +x.dataset.s === est); }); $("#cal").disabled = false; });
  const cal = $("#cal"); if (cal) cal.onclick = async () => { const { error } = await sb.rpc("calificar_pedido", { p_pedido: o.id, p_estrellas: est, p_comentario: $("#com").value }); if (error) return toast(errMsg(error), 1); toast("¡Gracias por calificar!"); vPedido(o.codigo); };
  const ag = $("#asG"); if (ag) ag.onclick = async () => { const { error } = await sb.rpc("asignar_pedido", { p_pedido: o.id, p_vendedor: $("#asV").value || null, p_ruta: $("#asR").value }); if (error) return toast(errMsg(error), 1); toast("Asignación guardada"); vPedido(o.codigo); };
  app.querySelectorAll("[data-e]").forEach(b => b.onclick = async () => {
    const e = b.dataset.e;
    if (e === "Entregado") return modalEntrega(o);
    let motivo = ""; if (e === "Cancelado") { motivo = prompt("Motivo de la cancelación (el stock vuelve al inventario):"); if (motivo === null) return; }
    b.disabled = true; const { error } = await sb.rpc("cambiar_estado", { p_pedido: o.id, p_estado: e, p_motivo: motivo }); if (error) { b.disabled = false; return toast(errMsg(error), 1); } toast("Estado: " + e); vPedido(o.codigo);
  });
  chat($("#chatBox"), o.cliente_id, o.id);
}
function modalEntrega(o) {
  modal(`<h3>Confirmar entrega · ${o.codigo}</h3><label>¿Quién recibió?<input id="rec" required maxlength="120" placeholder="Nombre de quien recibe"></label>
   <label>Foto de la entrega<input id="fot" type="file" accept="image/*" capture="environment"></label>
   <div class="flab"><b>Firma</b><button type="button" class="link" id="limp">Borrar firma</button></div><canvas id="firma" class="firma" width="600" height="220" aria-label="Recuadro para firmar con el dedo"></canvas>
   <p class="muted small">Agrega foto, firma o ambas.</p><div class="btns"><button class="btn y" id="okE">🏁 Marcar entregado</button><button class="btn ghost" id="cxE">Cancelar</button></div>`);
  const cv = $("#firma"), ctx = cv.getContext("2d"); let dib = false, firmo = false;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { dib = true; firmo = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { } ctx.beginPath(); ctx.moveTo(...pos(e)); };
  cv.onpointermove = e => { if (dib) { ctx.lineTo(...pos(e)); ctx.stroke(); } };
  cv.onpointerup = cv.onpointerleave = () => dib = false;
  $("#limp").onclick = () => { ctx.fillRect(0, 0, cv.width, cv.height); firmo = false; };
  $("#cxE").onclick = cerrarModal;
  $("#okE").onclick = async () => {
    const rec = $("#rec").value.trim(), f = $("#fot").files[0]; if (!rec) return toast("Escribe quién recibió", 1); if (!f && !firmo) return toast("Agrega una foto o la firma", 1);
    const b = $("#okE"); b.disabled = true; b.textContent = "Guardando…";
    const base = o.cliente_id + "/" + o.id + "-" + Date.now();
    let pf = null, pfi = null;
    try {
      if (f) { const blob = await comprimir(f, 1000); pf = base + "-foto.webp"; const { error } = await sb.storage.from("entregas").upload(pf, blob, { contentType: "image/webp" }); if (error) throw error; }
      if (firmo) { const blob = await new Promise(r => cv.toBlob(r, "image/png")); pfi = base + "-firma.png"; const { error } = await sb.storage.from("entregas").upload(pfi, blob, { contentType: "image/png" }); if (error) throw error; }
      const { error } = await sb.rpc("entregar_pedido", { p_pedido: o.id, p_recibio: rec, p_foto: pf, p_firma: pfi }); if (error) throw error;
      cerrarModal(); toast("Pedido entregado"); vPedido(o.codigo);
    } catch (e) { b.disabled = false; b.textContent = "🏁 Marcar entregado"; toast(errMsg(e), 1); }
  };
}
function botonesLlamada(token, tel, txt) {
  const w = wa(tel, "Hola, te escribo por DistriPostobon (" + txt + ")");
  return `<div class="btns call"><a class="btn ghost" target="_blank" rel="noopener" href="${sala(token)}#config.startWithVideoMuted=true">📞 Llamar</a><a class="btn ghost" target="_blank" rel="noopener" href="${sala(token)}">🎥 Videollamada</a>${w ? `<a class="btn g" target="_blank" rel="noopener" href="${w}">WhatsApp</a>` : ""}</div>
  <p class="muted small">Llamadas y videollamadas gratis con Jitsi Meet en una sala privada para esta conversación. Avisa por el chat para que la otra persona entre.</p>`;
}

// ---------- Chat ----------
async function chat(box, clienteId, pedidoId) {
  box.innerHTML = `<div class="msgs" id="msgs" role="log" aria-live="polite"><div class="muted small">Cargando…</div></div><form class="send" id="fs"><input id="txt" maxlength="2000" placeholder="Escribe un mensaje…" aria-label="Mensaje" autocomplete="off" required><button class="btn" aria-label="Enviar mensaje">➤</button></form>`;
  let q = sb.from("mensajes").select("*, autor:profiles!mensajes_autor_id_fkey(nombre,rol)").eq("cliente_id", clienteId).order("creado").limit(300);
  q = pedidoId ? q.eq("pedido_id", pedidoId) : q.is("pedido_id", null);
  const { data } = await q; const lista = data || [];
  const k = clienteId + (pedidoId || "");
  const leer = () => { if (staff()) LS("visto_c_" + k, new Date().toISOString()); else marcarVisto("cliente"); };
  const pintar = () => { const m = $("#msgs"); if (!m) return;
    m.innerHTML = lista.length ? lista.map(x => `<div class="msg ${x.autor_id === S.user.id ? "me" : ""}"><small>${esc(x.autor?.nombre || "")}${x.autor?.rol && x.autor.rol !== "cliente" ? " · " + ROLES[x.autor.rol] : ""}</small><p>${esc(x.texto)}</p><time>${fecha(x.creado)}</time></div>`).join("") : `<div class="muted small">Aún no hay mensajes. Escribe el primero.</div>`;
    m.scrollTop = m.scrollHeight; };
  pintar(); leer();
  S.chatSub = sb.channel("chat-" + k + Date.now()).on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: "cliente_id=eq." + clienteId }, async p => {
    if ((p.new.pedido_id || null) !== (pedidoId || null) || lista.some(x => x.id === p.new.id)) return;
    if (p.new.autor_id !== S.user.id) { const { data: a } = await sb.from("mensajes").select("autor:profiles!mensajes_autor_id_fkey(nombre,rol)").eq("id", p.new.id).single(); p.new.autor = a?.autor; sonar(); leer(); }
    else p.new.autor = { nombre: S.perfil.nombre, rol: S.perfil.rol };
    if (!lista.some(x => x.id === p.new.id)) { lista.push(p.new); pintar(); }
  }).subscribe();
  $("#fs").onsubmit = async e => { e.preventDefault(); const t = $("#txt").value.trim(); if (!t) return; $("#txt").value = "";
    const { data: n, error } = await sb.from("mensajes").insert({ cliente_id: clienteId, pedido_id: pedidoId || null, autor_id: S.user.id, texto: t }).select().single();
    if (error) { $("#txt").value = t; return toast(errMsg(error), 1); }
    if (!lista.some(x => x.id === n.id)) { n.autor = { nombre: S.perfil.nombre, rol: S.perfil.rol }; lista.push(n); pintar(); } };
}
async function vChatGeneral() {
  const T = S.navTok; await cargarCatalogo(); if (!vigente(T)) return;
  app.innerHTML = `<h2>Chat con ventas</h2><div class="card">${botonesLlamada(S.perfil.sala, S.config.whatsapp_vendedor, "consulta general")}<div id="chatBox"></div></div>`;
  chat($("#chatBox"), S.user.id, null);
}
async function vChats() {
  const T = S.navTok;
  if (rol() === "bodega") { location.hash = "#/panel"; return; }
  const { data } = await sb.from("mensajes").select("cliente_id,pedido_id,texto,creado,autor_id, cliente:profiles!mensajes_cliente_id_fkey(nombre), pedido:pedidos(codigo)").order("creado", { ascending: false }).limit(500);
  const conv = new Map(); (data || []).forEach(m => { const k = m.cliente_id + (m.pedido_id || ""); if (!conv.has(k)) conv.set(k, { ...m, nuevos: 0 }); if (m.autor_id !== S.user.id && new Date(m.creado) > new Date(visto("c_" + k))) conv.get(k).nuevos++; });
  const { data: cl } = await sb.from("profiles").select("id,nombre").eq("rol", "cliente").order("nombre").limit(1000);
  if (!vigente(T)) return; marcarVisto("chats");
  app.innerHTML = `<h2>Chats</h2><div class="card"><label>Escribir a una tienda<select id="nuevo"><option value="">Elige una tienda…</option>${(cl || []).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select></label></div>
   ${conv.size ? `<div class="card list">${[...conv.values()].map(m => `<a class="row ${m.nuevos ? "unread" : ""}" href="#/conversacion/${m.cliente_id}${m.pedido_id ? "/" + m.pedido_id : ""}"><div class="grow"><b>${esc(m.cliente?.nombre)}</b>${m.pedido ? ` <span class="tag">${m.pedido.codigo}</span>` : ""}<small>${m.autor_id === S.user.id ? "Tú: " : ""}${esc(m.texto.slice(0, 70))}</small></div>${m.nuevos ? `<b class="badge static" aria-label="${m.nuevos} sin leer">${m.nuevos}</b>` : ""}<small>${fecha(m.creado)}</small></a>`).join("")}</div>` : `<div class="empty">No hay conversaciones todavía.</div>`}`;
  $("#nuevo").onchange = e => { if (e.target.value) location.hash = "#/conversacion/" + e.target.value; };
}
async function vConversacion(clienteId, pedidoId) {
  const T = S.navTok;
  if (pedidoId) { const { data: o } = await sb.from("pedidos").select("codigo").eq("id", pedidoId).single(); if (o) { location.hash = "#/pedido/" + o.codigo; return; } }
  const { data: c } = await sb.from("profiles").select("*").eq("id", clienteId).single();
  if (!vigente(T)) return;
  if (!c) { app.innerHTML = `<div class="empty">Conversación no disponible.</div>`; return; }
  app.innerHTML = `<a href="#/chats" class="back">← Chats</a><h2>${esc(c.nombre)}</h2><p class="muted small">📞 ${esc(c.telefono)} · 📍 ${esc(c.direccion)}</p><div class="card">${botonesLlamada(c.sala, c.telefono, "consulta general")}<div id="chatBox"></div></div>`;
  chat($("#chatBox"), clienteId, null);
}

// ---------- Panel del personal ----------
async function vPanel(filtro) {
  filtro = filtro || (rol() === "bodega" ? "preparar" : "activos");
  let q = sb.from("pedidos").select("*, cliente:profiles!pedidos_cliente_id_fkey(nombre,telefono,direccion), vendedor:profiles!pedidos_vendedor_id_fkey(nombre)").order("creado", { ascending: false }).limit(300);
  if (filtro === "activos") q = q.not("estado", "in", "(Entregado,Cancelado)");
  if (filtro === "preparar") q = q.in("estado", ["Confirmado", "Alistando", "En ruta"]);
  if (filtro === "hoy") q = q.eq("fecha_entrega", hoyISO()).not("estado", "in", "(Entregado,Cancelado)");
  if (filtro === "mios") q = q.eq("vendedor_id", S.user.id);
  if (filtro === "cerrados") q = q.in("estado", ["Entregado", "Cancelado"]);
  const T = S.navTok; const [{ data, error }] = await Promise.all([q, cargarCatalogo()]); if (error) throw error; if (!vigente(T)) return;
  const bajos = S.productos.filter(p => p.activo && p.stock <= (S.config.stock_alerta ?? 10));
  const hoy = new Date().toDateString(), deHoy = data.filter(o => new Date(o.creado).toDateString() === hoy);
  const F = [["activos", "Activos"], ["preparar", "Para bodega"], ["hoy", "Entregar hoy"], ...(rol() !== "bodega" ? [["mios", "Asignados a mí"]] : []), ["cerrados", "Cerrados"], ["todos", "Todos"]];
  app.innerHTML = `<div class="head"><h2>Pedidos</h2><button id="xls" class="btn ghost sm">⬇️ Excel</button></div>
  ${bajos.length ? `<div class="note warn">⚠️ Stock bajo: ${bajos.slice(0, 6).map(p => `${esc(p.nombre)} (${p.stock})`).join(", ")}${bajos.length > 6 ? ` y ${bajos.length - 6} más` : ""}</div>` : ""}
  <div class="kpis"><div><small>En esta vista</small><b>${data.length}</b></div><div><small>Llegaron hoy</small><b>${deHoy.length}</b></div><div><small>Valor</small><b>${cop(data.filter(o => o.estado !== "Cancelado").reduce((a, o) => a + Number(o.total), 0))}</b></div></div>
  <div class="cats">${F.map(([k, n]) => `<a class="cat ${k === filtro ? "on" : ""}" href="#/panel/${k}">${n}</a>`).join("")}</div>
  <input id="bq" type="search" placeholder="🔎 Buscar código, tienda o ruta…" aria-label="Buscar pedidos">
  <div class="card list" id="lp"></div>`;
  const pintar = t => { t = (t || "").toLowerCase(); const l = data.filter(o => !t || (o.codigo + " " + (o.cliente?.nombre || "") + " " + (o.ruta || "")).toLowerCase().includes(t));
    $("#lp").innerHTML = l.length ? l.map(o => `<a class="row" href="#/pedido/${o.codigo}"><div class="grow"><b>${o.codigo}</b> · ${esc(o.cliente?.nombre)}<small>${fecha(o.creado)} · 📍 ${esc(o.cliente?.direccion)}</small>${o.fecha_entrega || o.vendedor || o.ruta ? `<small>${o.fecha_entrega ? "🗓️ " + fechaCorta(o.fecha_entrega) + " " + esc(o.franja || "") : ""}${o.vendedor ? " · 🧑‍💼 " + esc(o.vendedor.nombre) : ""}${o.ruta ? " · 🛣️ " + esc(o.ruta) : ""}</small>` : ""}</div>${tagEstado(o.estado)}<b class="num">${cop(o.total)}</b></a>`).join("") : `<div class="empty">No hay pedidos en esta vista.</div>`; };
  pintar(); $("#bq").oninput = debounce(e => pintar(e.target.value));
  $("#xls").onclick = () => exportarPedidos();
  pedirPermiso();
}
async function exportarPedidos() {
  const { data, error } = await sb.from("pedidos").select("codigo,estado,total,notas,creado,fecha_entrega,franja,ruta,calificacion,recibio, cliente:profiles!pedidos_cliente_id_fkey(nombre,cedula,telefono,direccion), vendedor:profiles!pedidos_vendedor_id_fkey(nombre), pedido_items(nombre,presentacion,precio,cantidad)").order("creado", { ascending: false }).limit(5000);
  if (error) return toast(errMsg(error), 1);
  const ped = data.map(o => ({ Código: o.codigo, Fecha: fecha(o.creado), Estado: o.estado, Tienda: o.cliente?.nombre, Cédula: o.cliente?.cedula, Teléfono: o.cliente?.telefono, Dirección: o.cliente?.direccion, "Entrega preferida": o.fecha_entrega || "", Franja: o.franja, Vendedor: o.vendedor?.nombre || "", Ruta: o.ruta, Total: Number(o.total), Calificación: o.calificacion || "", Recibió: o.recibio, Notas: o.notas }));
  const det = data.flatMap(o => o.pedido_items.map(i => ({ Código: o.codigo, Producto: i.nombre, Presentación: i.presentacion, Precio: Number(i.precio), Cantidad: i.cantidad, Subtotal: i.precio * i.cantidad })));
  libro({ Pedidos: ped, Detalle: det }, "pedidos");
}
async function libro(hojas, nombre) {
  if (!await cargarXLSX()) return;
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(hojas)) { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]); ws["!cols"] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.min(50, Math.max(10, k.length + 2, ...rows.slice(0, 200).map(r => String(r[k] ?? "").length))) })); XLSX.utils.book_append_sheet(wb, ws, n); }
  XLSX.writeFile(wb, `distripostobon-${nombre}-${hoyISO()}.xlsx`);
  toast("Excel descargado. Súbelo a tu Drive o ábrelo con Google Sheets.");
}

// ---------- Administración ----------
async function vAdmin(tab = "tablero") {
  const T = [["tablero", "📊 Tablero"], ["productos", "📦 Productos"], ["banners", "🖼️ Banners"], ["usuarios", "👥 Usuarios"], ["clientes", "🏪 Tiendas"], ["ajustes", "⚙️ Ajustes"]];
  app.innerHTML = `<h2>Administración</h2><div class="cats">${T.map(([k, n]) => `<a class="cat ${k === tab ? "on" : ""}" href="#/admin/${k}">${n}</a>`).join("")}</div><div id="ad"></div>`;
  await ({ tablero: aTablero, productos: aProductos, banners: aBanners, usuarios: aUsuarios, clientes: aClientes, ajustes: aAjustes }[tab] || aTablero)($("#ad"));
}
function barras(rows, fmt = cop) {
  if (!rows.length) return `<p class="muted small">Sin datos en este periodo.</p>`;
  const max = Math.max(...rows.map(r => r[1]), 1);
  return `<div class="bars">${rows.map(([k, v]) => `<div class="bar-r"><span title="${esc(k)}">${esc(k)}</span><div><i style="width:${Math.max(2, v * 100 / max)}%"></i></div><b>${fmt(v)}</b></div>`).join("")}</div>`;
}
function columnas(rows) {
  const max = Math.max(...rows.map(r => r[1]), 1);
  return `<div class="cols" role="img" aria-label="Ventas por día">${rows.map(([k, v]) => `<div title="${esc(k)}: ${cop(v)}"><i style="height:${v ? Math.max(3, v * 100 / max) : 0}%"></i><small>${esc(k.slice(8))}</small></div>`).join("")}</div>`;
}
async function aTablero(el, dias = 30) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const [{ data, error }] = await Promise.all([sb.from("pedidos").select("total,estado,creado,calificacion, cliente:profiles!pedidos_cliente_id_fkey(nombre), vendedor:profiles!pedidos_vendedor_id_fkey(nombre), pedido_items(nombre,cantidad,precio)").gte("creado", desde).limit(5000), cargarCatalogo()]);
  if (error) throw error;
  const v = data.filter(o => o.estado !== "Cancelado"), tot = v.reduce((a, o) => a + Number(o.total), 0);
  const cal = data.filter(o => o.calificacion), prom = cal.length ? (cal.reduce((a, o) => a + o.calificacion, 0) / cal.length).toFixed(1) : "–";
  const sum = (arr, key, val) => { const m = {}; arr.forEach(x => { const k = key(x); if (k) m[k] = (m[k] || 0) + val(x); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const dia = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const porDia = []; for (let i = Math.min(dias, 30) - 1; i >= 0; i--) { const d = hoyISO(-i); porDia.push([d, v.filter(o => dia(o.creado) === d).reduce((a, o) => a + Number(o.total), 0)]); }
  const bajos = S.productos.filter(p => p.activo && p.stock <= (S.config.stock_alerta ?? 10));
  if (!el.isConnected) return;
  el.innerHTML = `<div class="cats">${[7, 30, 90].map(d => `<button class="cat ${d === dias ? "on" : ""}" data-d="${d}">Últimos ${d} días</button>`).join("")}</div>
   <div class="kpis k4"><div><small>Ventas</small><b>${cop(tot)}</b></div><div><small>Pedidos</small><b>${v.length}</b></div><div><small>Ticket promedio</small><b>${cop(v.length ? tot / v.length : 0)}</b></div><div><small>Calificación</small><b>${prom} ★</b></div></div>
   <div class="card"><h3>Ventas por día${dias > 30 ? " (últimos 30)" : ""}</h3>${columnas(porDia)}</div>
   <div class="dash"><div class="card"><h3>Productos más vendidos</h3>${barras(sum(v.flatMap(o => o.pedido_items), i => i.nombre, i => i.precio * i.cantidad).slice(0, 8))}</div>
   <div class="card"><h3>Mejores tiendas</h3>${barras(sum(v, o => o.cliente?.nombre, o => Number(o.total)).slice(0, 8))}</div>
   <div class="card"><h3>Por vendedor asignado</h3>${barras(sum(v, o => o.vendedor?.nombre || "Sin asignar", o => Number(o.total)).slice(0, 8))}</div>
   <div class="card"><h3>Pedidos por estado</h3>${barras(sum(data, o => o.estado, () => 1), n => n)}</div></div>
   <div class="card"><h3>⚠️ Stock bajo (≤ ${S.config.stock_alerta ?? 10})</h3>${bajos.length ? `<div class="list">${bajos.map(p => `<div class="row"><div class="grow"><b>${esc(p.nombre)}</b><small>${esc(p.presentacion)}</small></div><span class="tag red">${p.stock}</span></div>`).join("")}</div>` : `<p class="muted small">Todo con stock suficiente.</p>`}</div>`;
  el.querySelectorAll("[data-d]").forEach(b => b.onclick = () => aTablero(el, +b.dataset.d));
}
async function aProductos(el) {
  await cargarCatalogo();
  if (!el.isConnected) return;
  el.innerHTML = `<div class="btns"><button id="nuevo" class="btn y">➕ Nuevo producto</button><label class="btn ghost">📥 Importar Excel<input id="imp" type="file" accept=".xlsx,.xls,.csv" hidden></label><button id="exp" class="btn ghost">⬇️ Exportar Excel</button><button id="pla" class="btn ghost">📄 Plantilla</button></div>
  <p class="muted small">Columnas del Excel: Nombre, Categoría, Presentación, Precio, Precio promo (opcional), Stock, Activo (SI/NO), Destacado (SI/NO), Descripción, Foto (enlace opcional). Si el nombre y la presentación ya existen, se actualiza. Para un combo, crea un producto con categoría "Combos".</p>
  <input id="bq" type="search" placeholder="🔎 Buscar producto…" aria-label="Buscar producto"><div class="card list" id="lp"></div>`;
  const al = S.config.stock_alerta ?? 10;
  const pintar = t => { t = (t || "").toLowerCase(); const l = S.productos.filter(p => !t || (p.nombre + p.categoria).toLowerCase().includes(t));
    $("#lp").innerHTML = l.length ? l.map(p => `<div class="row">${foto(p, "mini")}<div class="grow"><b>${esc(p.nombre)}</b> ${p.activo ? "" : `<span class="tag red">Oculto</span>`}${enPromo(p) ? ` <span class="tag">🔥 Promo</span>` : ""}${p.destacado ? ` <span class="tag">⭐</span>` : ""}<small>${esc(p.categoria)} · ${esc(p.presentacion)} · Stock <span class="${p.stock <= al ? "red-t" : ""}">${p.stock}</span></small></div><b class="num">${enPromo(p) ? `<s>${cop(p.precio)}</s> ` : ""}${cop(precioDe(p))}</b><button class="btn sm ghost" data-ed="${p.id}">Editar</button></div>`).join("") : `<div class="empty">No hay productos. Crea uno o importa tu Excel.</div>`; };
  pintar(); $("#bq").oninput = debounce(e => pintar(e.target.value));
  $("#lp").onclick = e => { const b = e.target.closest("[data-ed]"); if (b) formProducto(S.productos.find(p => p.id === b.dataset.ed)); };
  $("#nuevo").onclick = () => formProducto({ nombre: "", categoria: "", presentacion: "", precio: "", precio_promo: null, stock: 0, activo: true, destacado: false, descripcion: "" });
  $("#exp").onclick = () => libro({ Productos: S.productos.map(p => ({ Nombre: p.nombre, Categoría: p.categoria, Presentación: p.presentacion, Precio: Number(p.precio), "Precio promo": p.precio_promo ?? "", Stock: p.stock, Activo: p.activo ? "SI" : "NO", Destacado: p.destacado ? "SI" : "NO", Descripción: p.descripcion || "", Foto: p.foto_url || "" })) }, "productos");
  $("#pla").onclick = () => libro({ Productos: [{ Nombre: "EJEMPLO · Producto", Categoría: "Gaseosas", Presentación: "Paca x12", Precio: 20000, "Precio promo": "", Stock: 50, Activo: "SI", Destacado: "NO", Descripción: "", Foto: "" }] }, "plantilla-productos");
  $("#imp").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !await cargarXLSX()) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer()), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const norm = o => { const m = {}; for (const k in o) m[sinTilde(k).trim()] = o[k]; return m; };
      const num = v => Number(String(v).replace(/[^\d.]/g, "")), si = v => /^(si|s|1|true|x)$/i.test(sinTilde(String(v)).trim());
      const ok = [], malas = [];
      rows.map(norm).forEach((r, i) => { const precio = num(r.precio); if (!String(r.nombre).trim() || r.precio === "" || !(precio >= 0)) { malas.push(i + 2); return; }
        const pp = r["precio promo"] === "" || r["precio promo"] === undefined ? null : num(r["precio promo"]);
        ok.push({ nombre: String(r.nombre).trim().slice(0, 120), categoria: String(r.categoria || "General").trim().slice(0, 40), presentacion: String(r.presentacion || "").trim().slice(0, 60), precio, precio_promo: pp != null && pp < precio ? pp : null, stock: Math.max(0, parseInt(r.stock) || 0), activo: !/^(no|n|0|false)$/i.test(String(r.activo).trim()), destacado: si(r.destacado), descripcion: String(r.descripcion || "").trim().slice(0, 140), foto_url: /^https:\/\//.test(String(r.foto || "").trim()) ? String(r.foto).trim() : null }); });
      if (!ok.length) return toast("No encontré filas válidas. Usa la plantilla.", 1);
      if (!confirm(`¿Importar ${ok.length} producto(s)?${malas.length ? `\nSe omiten filas con error: ${malas.slice(0, 15).join(", ")}` : ""}`)) return;
      let n = 0;
      for (const p of ok) { const ex = S.productos.find(x => x.nombre.toLowerCase() === p.nombre.toLowerCase() && (x.presentacion || "").toLowerCase() === p.presentacion.toLowerCase());
        if (!p.foto_url && ex) delete p.foto_url;
        const { error } = ex ? await sb.from("productos").update(p).eq("id", ex.id) : await sb.from("productos").insert(p); if (!error) n++; }
      toast(`Importados ${n} de ${ok.length} productos`); aProductos(el);
    } catch (er) { toast("No pude leer el archivo: " + er.message, 1); }
  };
}
function formProducto(p) {
  const cats = [...new Set(S.productos.map(x => x.categoria).concat(["Combos"]))];
  modal(`<form id="fp"><h3>${p.id ? "Editar" : "Nuevo"} producto</h3>
    <div class="fotoed">${foto(p, "ph")}<label class="btn ghost sm">📷 Foto<input type="file" id="ff" accept="image/*" hidden></label></div>
    <label>Nombre<input name="nombre" required maxlength="120" value="${esc(p.nombre)}"></label>
    <div class="two"><label>Categoría<input name="categoria" required maxlength="40" list="dlc" value="${esc(p.categoria)}"><datalist id="dlc">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></label><label>Presentación<input name="presentacion" maxlength="60" placeholder="Paca x12" value="${esc(p.presentacion)}"></label></div>
    <div class="two"><label>Precio (COP)<input name="precio" type="number" min="0" step="50" required value="${esc(p.precio)}" inputmode="numeric"></label><label>Precio promo (opcional)<input name="precio_promo" type="number" min="0" step="50" value="${esc(p.precio_promo ?? "")}" inputmode="numeric"></label></div>
    <div class="two"><label>Stock<input name="stock" type="number" min="0" required value="${esc(p.stock)}" inputmode="numeric"></label><label>Descripción<input name="descripcion" maxlength="140" value="${esc(p.descripcion || "")}" placeholder="Ej.: incluye 2 sabores"></label></div>
    <label class="chk"><input type="checkbox" name="activo" ${p.activo ? "checked" : ""}> Visible en el catálogo</label>
    <label class="chk"><input type="checkbox" name="destacado" ${p.destacado ? "checked" : ""}> ⭐ Destacado (sale primero)</label>
    <div class="btns"><button class="btn y" type="submit">Guardar</button><button type="button" class="btn ghost" id="cx">Cancelar</button>${p.id ? `<button type="button" class="btn red" id="del">Eliminar</button>` : ""}</div></form>`);
  let archivo = null;
  $("#ff").onchange = e => { archivo = e.target.files[0]; if (archivo) $(".fotoed .ph").outerHTML = `<img class="ph" alt="" src="${URL.createObjectURL(archivo)}">`; };
  $("#cx").onclick = cerrarModal;
  if ($("#del")) $("#del").onclick = async () => { if (!confirm("¿Eliminar este producto? Los pedidos anteriores lo conservan.")) return; const { error } = await sb.from("productos").delete().eq("id", p.id); if (error) return toast(errMsg(error), 1); toast("Producto eliminado"); vAdmin("productos"); };
  $("#fp").onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), b = e.target.querySelector("[type=submit]"); b.disabled = true; b.textContent = "Guardando…";
    const pp = f.get("precio_promo");
    const d = { nombre: f.get("nombre").trim(), categoria: f.get("categoria").trim(), presentacion: f.get("presentacion").trim(), precio: Number(f.get("precio")), precio_promo: pp === "" ? null : Number(pp), stock: parseInt(f.get("stock")) || 0, activo: !!f.get("activo"), destacado: !!f.get("destacado"), descripcion: f.get("descripcion").trim() };
    if (d.precio_promo != null && d.precio_promo >= d.precio) { b.disabled = false; b.textContent = "Guardar"; return toast("El precio promo debe ser menor que el precio", 1); }
    if (archivo) { try { const img = await comprimir(archivo); const ruta = crypto.randomUUID() + ".webp";
      const { error } = await sb.storage.from("productos").upload(ruta, img, { contentType: "image/webp", cacheControl: "31536000" }); if (error) throw error; d.foto_url = sb.storage.from("productos").getPublicUrl(ruta).data.publicUrl; }
      catch (er) { b.disabled = false; b.textContent = "Guardar"; return toast(errMsg(er), 1); } }
    const { error } = p.id ? await sb.from("productos").update(d).eq("id", p.id) : await sb.from("productos").insert(d);
    if (error) { b.disabled = false; b.textContent = "Guardar"; return toast(errMsg(error), 1); }
    cerrarModal(); toast("Producto guardado"); vAdmin("productos");
  };
}
function comprimir(file, max = 600) { return new Promise((ok, ko) => { const i = new Image(); i.onload = () => { const s = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement("canvas"); c.width = Math.round(i.width * s); c.height = Math.round(i.height * s); c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); c.toBlob(b => b ? ok(b) : ko(new Error("No pude procesar la imagen")), "image/webp", .82); }; i.onerror = () => ko(new Error("Archivo de imagen inválido")); i.src = URL.createObjectURL(file); }); }
async function aBanners(el) {
  const { data } = await sb.from("banners").select("*").order("orden");
  if (!el.isConnected) return;
  el.innerHTML = `<button id="nb" class="btn y">➕ Nuevo banner</button><p class="muted small">Los banners salen arriba del catálogo. Úsalos para promociones, combos o avisos.</p>
   <div class="card list">${(data || []).map(b => `<div class="row"><span class="dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(b.color) ? b.color : "#0b5cab"}"></span><div class="grow"><b>${esc(b.titulo)}</b> ${b.activo ? "" : `<span class="tag red">Oculto</span>`}<small>${esc(b.texto)}</small></div><button class="btn sm ghost" data-b="${b.id}">Editar</button></div>`).join("") || `<div class="empty">Sin banners.</div>`}</div>`;
  const form = b => { modal(`<form id="fb"><h3>${b.id ? "Editar" : "Nuevo"} banner</h3><label>Título<input name="titulo" required maxlength="60" value="${esc(b.titulo)}"></label><label>Texto<input name="texto" maxlength="140" value="${esc(b.texto)}"></label>
     <div class="two"><label>Color<input name="color" type="color" value="${esc(b.color || "#0b5cab")}"></label><label>Orden<input name="orden" type="number" value="${esc(b.orden || 0)}"></label></div>
     <label>Imagen (opcional)<input type="file" id="fbi" accept="image/*"></label><label class="chk"><input type="checkbox" name="activo" ${b.activo !== false ? "checked" : ""}> Visible</label>
     <div class="btns"><button class="btn y" type="submit">Guardar</button><button type="button" class="btn ghost" id="cx">Cancelar</button>${b.id ? `<button type="button" class="btn red" id="del">Eliminar</button>` : ""}</div></form>`);
    $("#cx").onclick = cerrarModal;
    if ($("#del")) $("#del").onclick = async () => { if (!confirm("¿Eliminar banner?")) return; await sb.from("banners").delete().eq("id", b.id); cerrarModal(); aBanners(el); };
    $("#fb").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const d = { titulo: f.get("titulo").trim(), texto: f.get("texto").trim(), color: f.get("color"), orden: +f.get("orden") || 0, activo: !!f.get("activo") };
      const fi = $("#fbi").files[0]; if (fi) { try { const img = await comprimir(fi, 1000), ruta = "banner-" + crypto.randomUUID() + ".webp"; const { error } = await sb.storage.from("productos").upload(ruta, img, { contentType: "image/webp" }); if (error) throw error; d.imagen_url = sb.storage.from("productos").getPublicUrl(ruta).data.publicUrl; } catch (er) { return toast(errMsg(er), 1); } }
      const { error } = b.id ? await sb.from("banners").update(d).eq("id", b.id) : await sb.from("banners").insert(d); if (error) return toast(errMsg(error), 1); cerrarModal(); toast("Banner guardado"); aBanners(el); }; };
  $("#nb").onclick = () => form({ titulo: "", texto: "", color: "#0b5cab", orden: 0, activo: true });
  el.querySelectorAll("[data-b]").forEach(x => x.onclick = () => form(data.find(b => b.id === x.dataset.b)));
}
async function aUsuarios(el) {
  const { data } = await sb.from("profiles").select("*").order("rol").order("nombre").limit(2000);
  const n = r => data.filter(u => u.rol === r).length;
  if (!el.isConnected) return;
  el.innerHTML = `<div class="kpis"><div><small>Vendedores</small><b>${n("vendedor")}/4</b></div><div><small>Bodega</small><b>${n("bodega")}/2</b></div><div><small>Tiendas</small><b>${n("cliente")}</b></div></div>
  <p class="muted small">Para dar un rol, la persona primero se inscribe en la app con su correo. Luego aquí le asignas Vendedor (máx. 4) o Bodega (máx. 2).</p>
  <input id="bq" type="search" placeholder="🔎 Buscar por nombre, correo o cédula…" aria-label="Buscar usuarios"><div class="card list" id="lu"></div>`;
  const pintar = t => { t = (t || "").toLowerCase(); $("#lu").innerHTML = data.filter(u => !t || (u.nombre + u.correo + u.cedula).toLowerCase().includes(t)).map(u => `<div class="row"><div class="grow"><b>${esc(u.nombre || "(sin nombre)")}</b><small>${esc(u.correo)} · CC ${esc(u.cedula)}</small></div>
    ${u.rol === "administrador" ? `<span class="tag">Administrador</span>` : `<select data-u="${u.id}" aria-label="Rol de ${esc(u.nombre)}">${["cliente", "vendedor", "bodega"].map(r => `<option value="${r}" ${u.rol === r ? "selected" : ""}>${ROLES[r]}</option>`).join("")}</select>`}</div>`).join(""); };
  pintar(); $("#bq").oninput = debounce(e => pintar(e.target.value));
  $("#lu").onchange = async e => { const s = e.target.closest("select"); if (!s) return; const { error } = await sb.rpc("asignar_rol", { p_usuario: s.dataset.u, p_rol: s.value }); if (error) { toast(errMsg(error), 1); } else toast("Rol actualizado"); aUsuarios(el); };
}
async function aClientes(el) {
  const { data } = await sb.from("profiles").select("nombre,cedula,telefono,direccion,correo,creado,id").eq("rol", "cliente").order("nombre").limit(5000);
  if (!el.isConnected) return;
  el.innerHTML = `<div class="head"><b>${data.length} tienda(s) inscritas</b><button id="xls" class="btn ghost sm">⬇️ Excel</button></div><div class="card list">${data.map(c => `<a class="row" href="#/conversacion/${c.id}"><div class="grow"><b>${esc(c.nombre)}</b><small>📞 ${esc(c.telefono)} · 📍 ${esc(c.direccion)}</small></div><span aria-hidden="true">💬</span></a>`).join("") || `<div class="empty">Aún no hay tiendas inscritas.</div>`}</div>`;
  $("#xls").onclick = () => libro({ Tiendas: data.map(c => ({ Nombre: c.nombre, Cédula: c.cedula, Teléfono: c.telefono, Dirección: c.direccion, Correo: c.correo, Inscrita: fecha(c.creado) })) }, "tiendas");
}
async function aAjustes(el) {
  await cargarCatalogo();
  if (!el.isConnected) return;
  el.innerHTML = `<form id="fa" class="card"><label>Pedido mínimo (COP)<input name="pedido_minimo" type="number" min="0" step="1000" value="${esc(S.config.pedido_minimo)}"></label>
   <label>WhatsApp de ventas (ej. 3001234567)<input name="whatsapp_vendedor" type="tel" maxlength="15" value="${esc(S.config.whatsapp_vendedor)}"></label>
   <label>Alerta de stock bajo (unidades)<input name="stock_alerta" type="number" min="0" value="${esc(S.config.stock_alerta ?? 10)}"></label>
   <label>Franjas de entrega (una por línea)<textarea name="franjas">${esc((S.config.franjas || []).join("\n"))}</textarea></label><button class="btn y w">Guardar ajustes</button></form>`;
  $("#fa").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const { error } = await sb.from("config").update({ pedido_minimo: Number(f.get("pedido_minimo")) || 0, whatsapp_vendedor: f.get("whatsapp_vendedor").replace(/\D/g, ""), stock_alerta: parseInt(f.get("stock_alerta")) || 0, franjas: f.get("franjas").split("\n").map(x => x.trim()).filter(Boolean).slice(0, 8), actualizado: new Date().toISOString() }).eq("id", 1); toast(error ? errMsg(error) : "Ajustes guardados", !!error); };
}

// ---------- Inicio ----------
sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") { S.recovery = true; location.hash = "#/clave"; } if (ev === "SIGNED_OUT") { S.user = null; S.perfil = null; nav(); } });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
navigator.serviceWorker?.addEventListener("message", e => { if (e.data?.url) location.hash = e.data.url; });
addEventListener("online", () => { toast("Conexión restablecida"); router(); });
addEventListener("offline", () => toast("Sin conexión: puedes seguir viendo el catálogo", 1));
(async () => { try { await cargarPerfil(); } catch (e) { nav(); } await router(); })();
