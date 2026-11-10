"use strict";
/* Portafolio de referencia: lista local (assets) de bebidas publicadas en WeShop by Postobón. Solo consulta:
   no tiene precio ni stock, no se agrega al carrito y no crea pedidos. Los productos vendibles siguen siendo los de Supabase. */
window.DPPortafolio = true;
async function vPortafolio() {
  let d; try { d = await (await fetch("portafolio.json")).json(); } catch (e) { app.innerHTML = `<div class="note warn">No pude abrir el portafolio local.</div>`; return; }
  const cats = ["Todas", ...new Set(d.productos.map(p => p.categoria))];
  let cat = "Todas", q = "";
  app.innerHTML = `<h2>Portafolio de referencia</h2>
   <div class="note">Solo para consulta. <b>Sin precio y sin stock</b>: estas referencias no se pueden pedir hasta que el distribuidor las habilite en el catálogo.</div>
   <p class="muted small">${d.productos.length} referencias de bebidas no alcohólicas publicadas en WeShop by Postobón (consulta ${esc(d.fecha_consulta)}). No es la lista completa de productos de Postobón. Las fotos son envases genéricos, sin marcas ni etiquetas. DistriPostobon no es una app oficial de Postobón.</p>
   <div class="search"><input id="pq" type="search" placeholder="🔎 Buscar marca, sabor o tamaño…" aria-label="Buscar en portafolio" autocomplete="off"></div>
   <div class="cats" role="toolbar">${cats.map(c => `<button class="cat ${c === cat ? "on" : ""}" data-pc="${esc(c)}">${esc(c)}</button>`).join("")}</div>
   <div class="card list" id="pl"></div>`;
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const vendible = p => (S.productos || []).some(x => x.activo && norm(x.nombre) === norm(p.nombre));
  const pintar = () => {
    const w = norm(q).split(/\s+/).filter(Boolean);
    const l = d.productos.filter(p => (cat === "Todas" || p.categoria === cat) && w.every(x => norm(p.nombre + " " + p.marca + " " + p.presentacion).includes(x)));
    $("#pl").innerHTML = l.map(p => `<div class="row">${p.imagen ? `<img class="mini" src="${esc(p.imagen)}" alt="" loading="lazy" decoding="async">` : `<div class="mini nof" aria-hidden="true">${esc(p.marca.slice(0, 2).toUpperCase())}</div>`}<div class="grow"><b>${esc(p.nombre)}</b><small>${esc(p.marca)} · ${esc(p.presentacion)}${p.agotado_en_fuente ? " · no disponible en la fuente" : ""}</small></div>${vendible(p) ? `<a class="tag" href="#/">En catálogo</a>` : `<span class="tag red">Sin precio · sin stock</span>`}</div>`).join("") || `<div class="empty">Sin resultados.</div>`;
  };
  pintar();
  $("#pq").oninput = debounce(e => { q = e.target.value; pintar(); });
  app.querySelectorAll("[data-pc]").forEach(b => b.onclick = () => { cat = b.dataset.pc; app.querySelectorAll("[data-pc]").forEach(x => x.classList.toggle("on", x === b)); pintar(); });
}
rutas.portafolio = vPortafolio;
// app.js pudo enrutar antes de que cargara este archivo: re-enrutar si aplica
if (/^#\/(portafolio)?$|^$/.test(location.hash)) router();
