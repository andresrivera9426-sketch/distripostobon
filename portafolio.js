"use strict";
/* Portafolio local (assets): 201 referencias con su foto oficial (WeShop by Postobón) empaquetada. Se carga ANTES de app.js y solo usa sus
   utilidades globales al ejecutarse. Sin precio ni stock: mientras una referencia no esté activa en Supabase se muestra
   como "Precio a consultar" (no se agrega al carrito). Cuando el administrador la activa, Inicio muestra el producto real. */
const DPPF = { datos: null, prom: null };
function cargarPortafolio() {
  return DPPF.prom ||= fetch("portafolio.json").then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
    .then(d => (DPPF.datos = d)).catch(() => { DPPF.prom = null; return null; });
}
// Precarga temprana solo si se entra por Inicio o Portafolio (no en paneles del personal).
if (/^(#\/?(portafolio)?)?$/.test(location.hash)) cargarPortafolio();

const ORDEN_CATS = ["Gaseosas", "Aguas", "Jugos y refrescos", "Té", "Hidratantes", "Energizantes", "Maltas", "Sodas y mezcladores", "Bebidas lácteas", "Bebidas vegetales", "Sueros", "Combos"];
const ordenCat = (a, b) => { const i = ORDEN_CATS.indexOf(a), j = ORDEN_CATS.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b, "es"); };
const normNom = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const esEjemplo = p => /^EJEMPLO\b/i.test(p?.nombre || "");
// Foto oficial empaquetada para un producto de Supabase que corresponde a una referencia del portafolio (mismo nombre).
// Solo reemplaza rutas locales (imagenes/portafolio/...) o vacías; una foto subida por el administrador (https) se respeta.
let _fotoNom = null;
function fotoPortafolio(p) {
  if (!DPPF.datos || (p.foto_url && !/^imagenes\/portafolio\//.test(p.foto_url))) return "";
  _fotoNom ||= new Map(DPPF.datos.productos.map(x => [normNom(x.nombre), x.imagen]));
  return _fotoNom.get(normNom(p.nombre)) || "";
}
function refsPortafolio() {
  return (DPPF.datos?.productos || []).map((x, i) => ({ ref: true, id: "ref" + i, nombre: x.nombre, marca: x.marca, categoria: x.categoria, presentacion: x.presentacion, foto_url: x.imagen, agotado_en_fuente: !!x.agotado_en_fuente }));
}
// Lista única para Inicio: productos reales activos (sin EJEMPLO para el público) + referencias del portafolio que aún no estén activas.
function itemsCatalogo() {
  const reales = S.productos.filter(p => p.activo && (staff() || !esEjemplo(p)));
  const ya = new Set(reales.map(p => normNom(p.nombre)));
  return reales.concat(refsPortafolio().filter(r => !ya.has(normNom(r.nombre))));
}
function consultaRef(p) {
  const txt = `Hola, quiero precio y disponibilidad de: ${p.nombre}`;
  const w = wa(S.config.whatsapp_vendedor, txt);
  if (w) return `<a class="btn ghost w" target="_blank" rel="noopener" href="${w}">Consultar precio</a>`;
  if (S.user && !staff()) return `<a class="btn ghost w" href="#/chat">Consultar precio</a>`;
  if (!S.user) return `<a class="btn ghost w" href="#/entrar/registro">Inscribirme</a>`;
  return "";
}
function tarjetaRef(p, i = 99) {
  return `<article class="prod ref">${foto(p, "ph", i)}<div class="pi"><h3>${esc(p.nombre)}</h3><small>${esc(p.marca || p.categoria)} · ${esc(p.presentacion)}</small>
   <div class="pr"><span class="tag gris">${p.agotado_en_fuente ? "Sin disponibilidad" : "Precio a consultar"}</span></div>${consultaRef(p)}</div></article>`;
}
// Grilla paginada: pinta de a PAG tarjetas y carga más al acercarse al final (o con el botón).
function grillaPaginada(el, lista, pintarUno, PAG = 24) {
  let n = 0; el._obs?.disconnect();
  const mas = () => {
    const sig = lista.slice(n, n + PAG); el.querySelector(".mas")?.remove();
    el.insertAdjacentHTML("beforeend", sig.map((p, k) => pintarUno(p, n + k)).join("")); n += sig.length;
    if (n < lista.length) {
      el.insertAdjacentHTML("beforeend", `<button class="btn ghost w mas">Ver más (${lista.length - n})</button>`);
      const b = el.querySelector(".mas"); b.onclick = mas;
      if ("IntersectionObserver" in window) { el._obs = new IntersectionObserver(e => { if (e[0].isIntersecting) { el._obs.disconnect(); mas(); } }, { rootMargin: "600px" }); el._obs.observe(b); }
    }
  };
  el.innerHTML = ""; mas();
}

async function vPortafolio() {
  const T = S.navTok;
  if (!DPPF.datos) app.innerHTML = `<div class="grid">${"<div class='prod sk'></div>".repeat(6)}</div>`;
  const d = await cargarPortafolio(); if (!vigente(T)) return;
  if (!d) { app.innerHTML = `<div class="note warn">No pude abrir el portafolio. Revisa tu conexión y vuelve a intentar.</div>`; return; }
  const activos = new Set(S.productos.filter(p => p.activo).map(p => normNom(p.nombre)));
  const refs = refsPortafolio();
  const cats = ["Todas", ...[...new Set(refs.map(p => p.categoria))].sort(ordenCat)];
  let cat = "Todas", q = "";
  app.innerHTML = `<a href="#/" class="back">← Catálogo</a><h2>Portafolio de referencia</h2>
   <p class="muted small">${refs.length} referencias de bebidas publicadas en WeShop by Postobón (consulta ${esc(d.fecha_consulta)}). Fotos oficiales de WeShop by Postobón. Las que dicen <b>Precio a consultar</b> aún no se pueden pedir. DistriPostobon no es una app oficial de Postobón.</p>
   <div class="search"><input id="pq" type="search" placeholder="🔎 Buscar marca, sabor o tamaño…" aria-label="Buscar en portafolio" autocomplete="off"></div>
   <div class="cats" role="toolbar">${cats.map(c => `<button class="cat ${c === cat ? "on" : ""}" data-pc="${esc(c)}">${esc(c)}</button>`).join("")}</div>
   <p class="muted small" id="pn" aria-live="polite"></p><div class="grid" id="pl"></div>`;
  const pintar = () => {
    const w = normNom(q).split(" ").filter(Boolean);
    const l = refs.filter(p => (cat === "Todas" || p.categoria === cat) && w.every(x => normNom(p.nombre + " " + p.marca + " " + p.presentacion).includes(x)));
    $("#pn").textContent = l.length + " referencia" + (l.length === 1 ? "" : "s");
    if (!l.length) { $("#pl").innerHTML = `<div class="empty">Sin resultados.</div>`; return; }
    grillaPaginada($("#pl"), l, (p, i) => activos.has(normNom(p.nombre))
      ? `<article class="prod ref">${foto(p, "ph", i)}<div class="pi"><h3>${esc(p.nombre)}</h3><small>${esc(p.marca)} · ${esc(p.presentacion)}</small><div class="pr"><span class="tag">En catálogo</span></div><a class="btn ghost w" href="#/">Pedir en el catálogo</a></div></article>`
      : tarjetaRef(p, i));
  };
  pintar();
  $("#pq").oninput = debounce(e => { q = e.target.value; pintar(); });
  app.querySelectorAll("[data-pc]").forEach(b => b.onclick = () => { cat = b.dataset.pc; app.querySelectorAll("[data-pc]").forEach(x => x.classList.toggle("on", x === b)); pintar(); });
}
