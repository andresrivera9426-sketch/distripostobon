"use strict";
/* DistriPostobon v5 (frontend): precios por cliente, crédito/cartera, devoluciones, envases, lotes, comercial y cierre.
   Se carga antes de app.js; usa sus utilidades globales (sb, $, esc, cop, fecha, toast, modal, S...) solo al ejecutarse. */
const V5 = { precios: {}, ficha: null, ok: true };
const nuevaClave = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const fechaCO = d => d ? new Date(d + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "";
const DIAS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const sinV5 = e => /does not exist|schema cache|Could not find/i.test(e?.message || "");
const avisoV5 = e => `<div class="note warn">${sinV5(e) ? "Esta sección requiere aplicar la migración <b>supabase/v5.sql</b>." : esc(errMsg(e))}</div>`;

// ---------- Tienda: precios propios, ficha comercial ----------
async function cargarComercial() {
  V5.precios = {}; V5.ficha = null;
  if (!S.user || staff() || S.offline) return;
  const [p, f] = await Promise.all([sb.rpc("mis_precios"), sb.from("clientes_comercial").select("*, zona:zonas(nombre,dias)").eq("cliente_id", S.user.id).maybeSingle()]);
  if (p.error) { V5.ok = !sinV5(p.error); return; }
  (p.data || []).forEach(r => { V5.precios[r.producto_id] = { precio: Number(r.precio), descuentos: r.descuentos || [] }; });
  V5.ficha = f.data || null;
}
function precioCant(p, q) {
  const x = V5.precios[p.id];
  return x ? DPReglas.precioCliente(x.precio, null, x.descuentos, q) : (enPromo(p) ? Number(p.precio_promo) : Number(p.precio));
}
function textoDescuentos(p) {
  const d = V5.precios[p.id]?.descuentos || []; return d.length ? d.map(x => `${x.min}+ und: −${Number(x.pct)}%`).join(" · ") : "";
}
function creditoDisponible() { const f = V5.ficha; return f && Number(f.cupo_credito) > 0 && f.plazo_dias ? f : null; }
function opcionesEntregaZona() {
  const z = V5.ficha?.zona; if (!z || !z.dias?.length) return "";
  return `<p class="muted small">Tu zona <b>${esc(z.nombre)}</b> recibe: ${z.dias.map(d => DIAS[d]).join(", ")}.</p>`;
}

async function seccionesPerfilCliente(box) {
  const [c, e] = await Promise.all([sb.from("cartera").select("*").gt("saldo", 0).order("creado"), sb.from("envases_mov").select("cantidad, envase:envases(nombre)")]);
  if (c.error) { box.innerHTML = sinV5(c.error) ? "" : avisoV5(c.error); return; }
  const env = {}; (e.data || []).forEach(m => { const k = m.envase?.nombre || "Envase"; env[k] = (env[k] || 0) + m.cantidad; });
  const f = V5.ficha, deuda = c.data.reduce((a, x) => a + Number(x.saldo), 0);
  box.innerHTML = `<div class="card"><h3>💳 Mi cuenta</h3>
    ${f?.zona ? `<p class="muted small">Zona: <b>${esc(f.zona.nombre)}</b>${f.zona.dias?.length ? " · " + f.zona.dias.map(d => DIAS[d]).join(", ") : ""}</p>` : ""}
    ${creditoDisponible() ? `<p>Cupo de crédito: <b>${cop(f.cupo_credito)}</b> · Plazo ${f.plazo_dias} días · Disponible <b>${cop(Math.max(0, f.cupo_credito - c.data.filter(x => x.condicion === "credito").reduce((a, x) => a + Number(x.saldo), 0)))}</b></p>` : ""}
    <p>Saldo pendiente: <b>${cop(deuda)}</b></p>
    ${c.data.length ? `<div class="list">${c.data.map(x => `<a class="row" href="#/pedido/${x.codigo}"><div class="grow"><b>${x.codigo}</b><small>${x.condicion === "credito" ? "Crédito" : "Contado"}${x.vence_pago ? " · vence " + fechaCO(x.vence_pago) : ""}</small></div><b class="num">${cop(x.saldo)}</b></a>`).join("")}</div>` : `<p class="muted small">No tienes saldos pendientes.</p>`}
    ${Object.keys(env).length ? `<h3>📦 Envases por devolver</h3><div class="list">${Object.entries(env).filter(([, v]) => v).map(([k, v]) => `<div class="row"><span class="grow">${esc(k)}</span><b>${v}</b></div>`).join("") || `<p class="muted small">Sin envases pendientes.</p>`}</div>` : ""}</div>`;
}

// ---------- Pedido: cartera y devoluciones ----------
async function seccionPedidoV5(o, box) {
  const r = rol(), admin = r === "administrador", vendAsig = r === "vendedor" && o.vendedor_id === S.user.id;
  const verCartera = admin || vendAsig || r === "cliente";
  const [ab, dv] = await Promise.all([verCartera ? sb.from("abonos").select("*").eq("pedido_id", o.id).order("id") : { data: [] }, sb.from("devoluciones").select("*").eq("pedido_id", o.id).order("id")]);
  if (ab.error || dv.error) { box.innerHTML = sinV5(ab.error || dv.error) ? "" : avisoV5(ab.error || dv.error); return; }
  const abonado = ab.data.reduce((a, x) => a + Number(x.valor), 0), devuelto = dv.data.reduce((a, x) => a + Number(x.valor), 0);
  const saldo = Number(o.total) - abonado - devuelto, revertidos = new Set(ab.data.filter(x => x.reversa_de).map(x => x.reversa_de));
  let html = "";
  if (verCartera && o.estado !== "Cancelado") html += `<div class="card noprint"><h3>💳 Pago · ${o.condicion === "credito" ? "Crédito" : "Contado"}${o.vence_pago ? ` · vence ${fechaCO(o.vence_pago)}` : ""}</h3>
    <div class="kpis k4"><div><small>Total</small><b>${cop(o.total)}</b></div><div><small>Abonado</small><b>${cop(abonado)}</b></div><div><small>Devoluciones</small><b>${cop(devuelto)}</b></div><div><small>${saldo < 0 ? "Saldo a favor" : "Saldo"}</small><b>${cop(Math.abs(saldo))}</b></div></div>
    ${ab.data.length ? `<div class="list">${ab.data.map(a => `<div class="row"><div class="grow"><b>${a.valor < 0 ? "Reverso" : "Abono"} · ${esc(a.metodo)}</b><small>${fecha(a.creado)}${a.referencia ? " · Ref " + esc(a.referencia) : ""}${a.motivo ? " · " + esc(a.motivo) : ""}${revertidos.has(a.id) ? " · <span class='red-t'>reversado</span>" : ""}</small></div><b class="num">${cop(a.valor)}</b>${admin && a.valor > 0 && !revertidos.has(a.id) ? `<button class="btn sm ghost" data-rev="${a.id}">Reversar</button>` : ""}</div>`).join("")}</div>` : ""}
    ${(admin || vendAsig) && saldo > 0 ? `<form id="fab" class="two"><label>Valor (COP)<input name="v" required inputmode="numeric" placeholder="${saldo}"></label><label>Método<select name="m"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="otro">Otro</option></select></label><label>Referencia<input name="r" maxlength="80" placeholder="Opcional"></label><button class="btn y">Registrar abono</button></form><p class="muted small">Registro operativo manual; no es conciliación bancaria ni factura.</p>` : ""}</div>`;
  const puedeDev = ["vendedor", "bodega", "administrador"].includes(r) && o.estado === "Entregado";
  if (dv.data.length || puedeDev) {
    const dev = id => dv.data.filter(d => d.item_id === id).reduce((a, d) => a + d.cantidad, 0);
    html += `<div class="card noprint"><h3>↩️ Devoluciones</h3>
      ${dv.data.length ? `<div class="list">${dv.data.map(d => `<div class="row"><div class="grow"><b>${d.cantidad} × ${esc(o.pedido_items.find(i => i.id === d.item_id)?.nombre || "")}</b><small>${d.destino === "reventa" ? "Apto para reventa (vuelve al inventario)" : "Avería (no vuelve al inventario)"} · ${esc(d.motivo)} · ${fecha(d.creado)}</small></div><b class="num">${cop(d.valor)}</b></div>`).join("")}</div>` : ""}
      ${puedeDev ? `<form id="fdv"><div class="two"><label>Producto<select name="i">${o.pedido_items.filter(i => i.cantidad > dev(i.id)).map(i => `<option value="${i.id}">${esc(i.nombre)} (máx ${i.cantidad - dev(i.id)})</option>`).join("")}</select></label><label>Cantidad<input name="q" type="number" min="1" required inputmode="numeric"></label></div>
        <div class="two"><label>Destino<select name="d"><option value="averia">Avería / no apto</option><option value="reventa">Apto para reventa</option></select></label><label>Motivo<input name="mo" required maxlength="200"></label></div><button class="btn ghost w">Registrar devolución</button></form>` : ""}</div>`;
  }
  box.innerHTML = html;
  const fab = box.querySelector("#fab"); if (fab) { const k = nuevaClave(); fab.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(fab), v = DPReglas.copValido(f.get("v"));
    if (!v) return toast("Valor inválido: pesos enteros mayores a 0", 1); if (v > saldo) return toast("El abono supera el saldo", 1);
    fab.querySelector("button").disabled = true;
    const { error } = await sb.rpc("registrar_abono", { p_pedido: o.id, p_valor: v, p_metodo: f.get("m"), p_referencia: f.get("r"), p_idem: k });
    if (error) { fab.querySelector("button").disabled = false; return toast(errMsg(error), 1); } toast("Abono registrado"); vPedido(o.codigo); }; }
  box.querySelectorAll("[data-rev]").forEach(b => b.onclick = async () => { const m = prompt("Motivo del reverso (queda registrado):"); if (!m) return; const { error } = await sb.rpc("reversar_abono", { p_abono: +b.dataset.rev, p_motivo: m }); if (error) return toast(errMsg(error), 1); toast("Abono reversado"); vPedido(o.codigo); });
  const fdv = box.querySelector("#fdv"); if (fdv) { const k = nuevaClave(); fdv.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(fdv); if (!f.get("i")) return toast("No quedan unidades por devolver", 1);
    fdv.querySelector("button").disabled = true;
    const { error } = await sb.rpc("registrar_devolucion", { p_item: +f.get("i"), p_cantidad: +f.get("q"), p_destino: f.get("d"), p_motivo: f.get("mo"), p_idem: k });
    if (error) { fdv.querySelector("button").disabled = false; return toast(errMsg(error), 1); } toast("Devolución registrada"); vPedido(o.codigo); }; }
}

// ---------- Admin › Comercial: zonas, fichas, tipos, precios, descuentos, envases ----------
async function aComercial(el) {
  await cargarCatalogo();
  const [z, t, pt, dc, en, pe, cl, cc, eq] = await Promise.all([sb.from("zonas").select("*").order("nombre"), sb.from("tipos_cliente").select("*").order("nombre"), sb.from("precios_tipo").select("*"),
    sb.from("descuentos_cantidad").select("*").order("min_cantidad"), sb.from("envases").select("*").order("nombre"), sb.from("producto_envases").select("*"),
    sb.from("profiles").select("id,nombre,telefono").eq("rol", "cliente").order("nombre").limit(5000), sb.from("clientes_comercial").select("*"), sb.rpc("equipo_ventas")]);
  if (!el.isConnected) return;
  const err = [z, t, pt, dc, en, pe, cc].find(x => x.error); if (err) { el.innerHTML = avisoV5(err.error); return; }
  const nomP = id => { const p = S.productos.find(x => x.id === id); return p ? `${p.nombre}${p.presentacion ? " · " + p.presentacion : ""}` : "(eliminado)"; };
  const optP = S.productos.map(p => `<option value="${p.id}">${esc(nomP(p.id))} — lista ${cop(p.precio)}</option>`).join("");
  const optT = (sel, todos) => (todos ? `<option value="">Todos</option>` : "") + t.data.map(x => `<option value="${esc(x.codigo)}" ${x.codigo === sel ? "selected" : ""}>${esc(x.nombre)}</option>`).join("");
  const ficha = id => cc.data.find(x => x.cliente_id === id) || {};
  el.innerHTML = `<p class="muted small">Todo aquí lo define el administrador; la app no trae tarifas, zonas, cupos, plazos ni envases precargados.</p>
  <div class="card"><h3>🗺️ Zonas y días de entrega</h3><div class="list">${z.data.map(x => `<div class="row"><div class="grow"><b>${esc(x.nombre)}</b> ${x.activo ? "" : `<span class="tag red">Inactiva</span>`}<small>${x.dias.length ? x.dias.map(d => DIAS[d]).join(", ") : "Cualquier día"}</small></div><button class="btn sm ghost" data-z="${x.id}">Editar</button></div>`).join("") || `<p class="muted small">Sin zonas.</p>`}</div><button class="btn ghost sm" data-z="">➕ Zona</button></div>
  <div class="card"><h3>🏪 Tiendas: zona, vendedor, tipo y crédito</h3><input id="bcl" type="search" placeholder="🔎 Buscar tienda"><div class="list" id="lcl"></div></div>
  <div class="card"><h3>🏷️ Tipos de cliente</h3><div class="list">${t.data.map(x => `<div class="row"><span class="grow"><b>${esc(x.nombre)}</b> <small>${esc(x.codigo)}</small></span></div>`).join("") || `<p class="muted small">Sin tipos. Sin tipo, la tienda paga precio de lista.</p>`}</div>
   <form id="ftc" class="two"><input name="c" required pattern="[a-z0-9_]{2,30}" placeholder="código (ej.: mayorista)" aria-label="Código"><input name="n" required maxlength="60" placeholder="Nombre visible" aria-label="Nombre"><button class="btn ghost sm">Agregar tipo</button></form></div>
  <div class="card"><h3>💲 Precio por tipo de cliente</h3><div class="list">${pt.data.map(x => `<div class="row"><span class="grow">${esc(nomP(x.producto_id))} <small>${esc(t.data.find(y => y.codigo === x.tipo)?.nombre || x.tipo)}</small></span><b class="num">${cop(x.precio)}</b><button class="btn sm ghost" data-dpt="${x.producto_id}|${esc(x.tipo)}">Quitar</button></div>`).join("") || `<p class="muted small">Sin precios especiales.</p>`}</div>
   ${t.data.length ? `<form id="fpt"><label>Producto<select name="p">${optP}</select></label><div class="two"><label>Tipo<select name="t">${optT()}</select></label><label>Precio (COP)<input name="v" required inputmode="numeric"></label></div><button class="btn ghost w">Guardar precio</button></form>` : ""}</div>
  <div class="card"><h3>📉 Descuentos por cantidad</h3><div class="list">${dc.data.map(x => `<div class="row"><span class="grow">${esc(nomP(x.producto_id))} <small>${x.min_cantidad}+ und · ${x.tipo ? esc(t.data.find(y => y.codigo === x.tipo)?.nombre || x.tipo) : "todos"}</small></span><b>−${Number(x.porcentaje)}%</b><button class="btn sm ghost" data-ddc="${x.id}">Quitar</button></div>`).join("") || `<p class="muted small">Sin descuentos.</p>`}</div>
   <form id="fdc"><label>Producto<select name="p">${optP}</select></label><div class="two"><label>Tipo<select name="t">${optT("", true)}</select></label><label>Desde (unidades)<input name="m" type="number" min="2" required></label></div><label>Descuento %<input name="pct" type="number" min="0.5" max="90" step="0.5" required></label><button class="btn ghost w">Guardar descuento</button></form></div>
  <div class="card"><h3>🧺 Envases retornables</h3><div class="list">${en.data.map(x => `<div class="row"><span class="grow"><b>${esc(x.nombre)}</b><small>${pe.data.filter(y => y.envase_id === x.id).map(y => `${y.cantidad} por ${esc(nomP(y.producto_id))}`).join(" · ") || "Sin productos asociados"}</small></span></div>`).join("") || `<p class="muted small">Sin envases.</p>`}</div>
   <form id="fen" class="two"><input name="n" required maxlength="60" placeholder="Ej.: Canasta x24" aria-label="Nombre envase"><button class="btn ghost sm">Agregar envase</button></form>
   ${en.data.length ? `<form id="fpe"><label>Producto<select name="p">${optP}</select></label><div class="two"><label>Envase<select name="e">${en.data.map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join("")}</select></label><label>Envases por unidad<input name="q" type="number" min="1" max="999" required></label></div><button class="btn ghost w">Asociar</button></form><p class="muted small">Al entregar un pedido, la tienda queda debiendo esos envases hasta que se registre su devolución.</p>` : ""}</div>`;
  const pintarCl = q => { $("#lcl").innerHTML = cl.data.filter(c => !q || DPReglas.coincide(c.nombre + " " + c.telefono, q)).slice(0, 100).map(c => { const f = ficha(c.id); return `<div class="row"><div class="grow"><b>${esc(c.nombre)}</b><small>${esc(z.data.find(x => x.id === f.zona_id)?.nombre || "Sin zona")} · ${esc((eq.data || []).find(v => v.id === f.vendedor_id)?.nombre || "Sin vendedor")} · ${esc(t.data.find(x => x.codigo === f.tipo)?.nombre || "Precio lista")}${Number(f.cupo_credito) > 0 ? " · Cupo " + cop(f.cupo_credito) + "/" + f.plazo_dias + "d" : ""}</small></div><button class="btn sm ghost" data-cl="${c.id}">Editar</button></div>`; }).join("") || `<div class="empty">Sin tiendas.</div>`; };
  pintarCl(""); $("#bcl").oninput = debounce(e => pintarCl(e.target.value));
  const recargar = m => { toast(m); aComercial(el); };
  const run = async (q, m) => { const { error } = await q; if (error) return toast(errMsg(error), 1); cerrarModal(); recargar(m); };
  el.onclick = async e => {
    const b = e.target.closest("[data-z],[data-cl],[data-dpt],[data-ddc]"); if (!b) return;
    if (b.dataset.z !== undefined) { const x = z.data.find(y => y.id === b.dataset.z) || { nombre: "", dias: [], activo: true };
      modal(`<form id="fz"><h3>${x.id ? "Editar" : "Nueva"} zona</h3><label>Nombre<input name="n" required maxlength="60" value="${esc(x.nombre)}"></label><p class="small">Días de entrega (ninguno = cualquier día)</p><div class="cats">${[1, 2, 3, 4, 5, 6, 7].map(d => `<label class="chk"><input type="checkbox" name="d" value="${d}" ${x.dias.includes(d) ? "checked" : ""}> ${DIAS[d]}</label>`).join("")}</div><label class="chk"><input type="checkbox" name="a" ${x.activo ? "checked" : ""}> Activa</label><div class="btns"><button class="btn y">Guardar</button><button type="button" class="btn ghost" onclick="cerrarModal()">Cancelar</button></div></form>`);
      $("#fz").onsubmit = ev => { ev.preventDefault(); const f = new FormData(ev.target), d = { nombre: f.get("n").trim(), dias: f.getAll("d").map(Number), activo: !!f.get("a") }; run(x.id ? sb.from("zonas").update(d).eq("id", x.id) : sb.from("zonas").insert(d), "Zona guardada"); }; }
    else if (b.dataset.cl) { const c = cl.data.find(y => y.id === b.dataset.cl), f = ficha(c.id);
      modal(`<form id="fcl"><h3>${esc(c.nombre)}</h3><div class="two"><label>Zona<select name="z"><option value="">Sin zona</option>${z.data.map(x => `<option value="${x.id}" ${x.id === f.zona_id ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select></label><label>Vendedor<select name="v"><option value="">Sin vendedor</option>${(eq.data || []).map(x => `<option value="${x.id}" ${x.id === f.vendedor_id ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select></label></div>
        <label>Tipo de cliente<select name="t"><option value="">Precio de lista</option>${optT(f.tipo)}</select></label>
        <div class="two"><label>Cupo de crédito (COP, vacío = sin crédito)<input name="c" inputmode="numeric" value="${f.cupo_credito ?? ""}"></label><label>Plazo (días)<input name="p" type="number" min="1" max="180" value="${f.plazo_dias ?? ""}"></label></div>
        <div class="btns"><button class="btn y">Guardar</button><button type="button" class="btn ghost" onclick="cerrarModal()">Cancelar</button></div></form>`);
      $("#fcl").onsubmit = ev => { ev.preventDefault(); const g = new FormData(ev.target), cupo = g.get("c").trim() ? DPReglas.copValido(g.get("c")) : null;
        if (g.get("c").trim() && !cupo) return toast("Cupo inválido", 1); if (cupo && !g.get("p")) return toast("Define el plazo del crédito", 1);
        run(sb.from("clientes_comercial").upsert({ cliente_id: c.id, zona_id: g.get("z") || null, vendedor_id: g.get("v") || null, tipo: g.get("t") || null, cupo_credito: cupo, plazo_dias: g.get("p") ? +g.get("p") : null }), "Tienda actualizada"); }; }
    else if (b.dataset.dpt) { const [pid, tp] = b.dataset.dpt.split("|"); if (confirm("¿Quitar este precio especial?")) run(sb.from("precios_tipo").delete().eq("producto_id", pid).eq("tipo", tp), "Precio quitado"); }
    else if (b.dataset.ddc) { if (confirm("¿Quitar este descuento?")) run(sb.from("descuentos_cantidad").delete().eq("id", b.dataset.ddc), "Descuento quitado"); }
  };
  $("#ftc").onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); run(sb.from("tipos_cliente").insert({ codigo: f.get("c").trim(), nombre: f.get("n").trim() }), "Tipo creado"); };
  const fpt = $("#fpt"); if (fpt) fpt.onsubmit = e => { e.preventDefault(); const f = new FormData(e.target), v = DPReglas.copValido(f.get("v")); if (!v) return toast("Precio inválido", 1); run(sb.from("precios_tipo").upsert({ producto_id: f.get("p"), tipo: f.get("t"), precio: v }), "Precio guardado"); };
  $("#fdc").onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); run(sb.from("descuentos_cantidad").insert({ producto_id: f.get("p"), tipo: f.get("t") || null, min_cantidad: +f.get("m"), porcentaje: +f.get("pct") }), "Descuento guardado"); };
  $("#fen").onsubmit = e => { e.preventDefault(); run(sb.from("envases").insert({ nombre: new FormData(e.target).get("n").trim() }), "Envase creado"); };
  const fpe = $("#fpe"); if (fpe) fpe.onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); run(sb.from("producto_envases").upsert({ producto_id: f.get("p"), envase_id: f.get("e"), cantidad: +f.get("q") }), "Envase asociado"); };
}

// ---------- Admin › Cartera ----------
async function aCartera(el) {
  const [c, cl, en, em] = await Promise.all([sb.from("cartera").select("*").gt("saldo", 0).order("vence_pago", { nullsFirst: false }).limit(2000), sb.from("profiles").select("id,nombre").eq("rol", "cliente").limit(5000),
    sb.from("envases").select("id,nombre"), sb.from("envases_mov").select("id,cliente_id,envase_id,cantidad,tipo,creado,nota,reversa_de").order("id", { ascending: false }).limit(3000)]);
  if (!el.isConnected) return;
  if (c.error) { el.innerHTML = avisoV5(c.error); return; }
  const nom = id => cl.data?.find(x => x.id === id)?.nombre || "—", hoy = DPReglas.hoyBogota();
  const venc = c.data.filter(x => x.vence_pago && x.vence_pago < hoy), tot = c.data.reduce((a, x) => a + Number(x.saldo), 0);
  const sal = {}; (em.data || []).forEach(m => { const k = m.cliente_id + "|" + m.envase_id; sal[k] = (sal[k] || 0) + m.cantidad; });
  const revertidos = new Set((em.data || []).filter(m => m.reversa_de).map(m => m.reversa_de));
  el.innerHTML = `<div class="kpis k4"><div><small>Por cobrar</small><b>${cop(tot)}</b></div><div><small>Pedidos con saldo</small><b>${c.data.length}</b></div><div><small>Vencidos</small><b class="red-t">${venc.length}</b></div><div><small>Valor vencido</small><b class="red-t">${cop(venc.reduce((a, x) => a + Number(x.saldo), 0))}</b></div></div>
   <div class="btns"><button id="xc" class="btn ghost sm">⬇️ Excel cartera</button></div>
   <div class="card list">${c.data.map(x => `<a class="row" href="#/pedido/${x.codigo}"><div class="grow"><b>${esc(nom(x.cliente_id))}</b><small>${x.codigo} · ${x.condicion === "credito" ? "Crédito" : "Contado"} · ${esc(x.estado)}${x.vence_pago ? " · vence " + fechaCO(x.vence_pago) : ""}</small></div>${x.vence_pago && x.vence_pago < hoy ? `<span class="tag red">Vencido</span>` : ""}<b class="num">${cop(x.saldo)}</b></a>`).join("") || `<div class="empty">Sin saldos pendientes.</div>`}</div>
   <div class="card"><h3>🧺 Envases por recoger</h3><div class="list">${Object.entries(sal).filter(([, v]) => v > 0).map(([k, v]) => { const [cid, eid] = k.split("|"); return `<div class="row"><div class="grow"><b>${esc(nom(cid))}</b><small>${esc(en.data?.find(e => e.id === eid)?.nombre || "")}</small></div><b>${v}</b><button class="btn sm ghost" data-dev="${k}">Recibir</button></div>`; }).join("") || `<p class="muted small">Sin envases pendientes.</p>`}</div>
   <h3>Últimos movimientos de envases</h3><div class="list">${(em.data || []).slice(0, 30).map(m => `<div class="row"><div class="grow"><b>${esc(nom(m.cliente_id))}</b><small>${esc(m.tipo)} · ${fecha(m.creado)} ${esc(m.nota)}${revertidos.has(m.id) ? " · <span class='red-t'>reversado</span>" : ""}</small></div><b>${m.cantidad > 0 ? "+" : ""}${m.cantidad}</b>${m.tipo !== "reverso" && !revertidos.has(m.id) ? `<button class="btn sm ghost" data-rve="${m.id}">Reversar</button>` : ""}</div>`).join("")}</div></div>`;
  $("#xc").onclick = () => libro({ Cartera: c.data.map(x => ({ Tienda: nom(x.cliente_id), Pedido: x.codigo, Condición: x.condicion, Estado: x.estado, Total: Number(x.total), Abonado: Number(x.abonado), Devoluciones: Number(x.devuelto), Saldo: Number(x.saldo), Vence: x.vence_pago || "" })) }, "cartera");
  el.querySelectorAll("[data-dev]").forEach(b => { const k = nuevaClave(); b.onclick = async () => { const [cid, eid] = b.dataset.dev.split("|"); const q = prompt("¿Cuántos envases recibes?"); if (!q) return; const { error } = await sb.rpc("devolver_envases", { p_cliente: cid, p_envase: eid, p_cantidad: +q, p_nota: "Recibidos", p_idem: k }); if (error) return toast(errMsg(error), 1); toast("Envases recibidos"); aCartera(el); }; });
  el.querySelectorAll("[data-rve]").forEach(b => b.onclick = async () => { const m = prompt("Motivo del reverso:"); if (!m) return; const { error } = await sb.rpc("reversar_envase_mov", { p_mov: +b.dataset.rve, p_motivo: m }); if (error) return toast(errMsg(error), 1); toast("Movimiento reversado"); aCartera(el); });
}

// ---------- Admin › Cierre diario ----------
async function aCierre(el, f) {
  f = f || DPReglas.hoyBogota();
  const [r, c] = await Promise.all([sb.rpc("resumen_dia", { p_fecha: f }), sb.from("cierres").select("*").order("id", { ascending: false }).limit(60)]);
  if (!el.isConnected) return;
  if (r.error) { el.innerHTML = avisoV5(r.error); return; }
  const x = r.data, vig = (c.data || []).find(y => y.fecha === f && !y.anulado_motivo);
  el.innerHTML = `<div class="card"><label>Día (hora Colombia)<input type="date" id="fd" value="${f}" max="${DPReglas.hoyBogota()}"></label>
   <div class="kpis k4"><div><small>Entregas</small><b>${x.entregas.pedidos} · ${cop(x.entregas.total)}</b></div><div><small>Contado / crédito</small><b>${cop(x.entregas.contado)} / ${cop(x.entregas.credito)}</b></div><div><small>Abonos efectivo</small><b>${cop(x.abonos.efectivo)}</b></div><div><small>Transferencia / otro</small><b>${cop(x.abonos.transferencia)} / ${cop(x.abonos.otro)}</b></div></div>
   <div class="kpis k4"><div><small>Devoluciones</small><b>${x.devoluciones.registros} · ${cop(x.devoluciones.valor)}</b></div><div><small>Reventa / avería (und)</small><b>${x.devoluciones.reventa_unid} / ${x.devoluciones.averia_unid}</b></div><div><small>Envases entregados / devueltos</small><b>${x.envases.entregados} / ${x.envases.devueltos}</b></div><div><small>Pendientes de entrega</small><b>${x.pendientes_entrega}</b></div></div>
   <p class="muted small">Reversos de abonos en el día: ${x.abonos.reversos}. El efectivo esperado es la suma neta de abonos en efectivo registrados ese día. Registro operativo; no reemplaza contabilidad.</p>
   ${vig ? `<div class="note">Día cerrado: efectivo declarado ${cop(vig.efectivo_declarado)} · diferencia <b class="${Number(vig.diferencia) ? "red-t" : "ok-t"}">${cop(vig.diferencia)}</b> ${esc(vig.notas)} <button class="btn sm ghost" id="anu">Anular cierre</button></div>`
     : `<form id="fci" class="two"><label>Efectivo contado (COP)<input name="e" required inputmode="numeric" placeholder="0"></label><label>Notas<input name="n" maxlength="500"></label><button class="btn y">Cerrar día</button></form>`}</div>
   <div class="card"><h3>Historial de cierres</h3><div class="list">${(c.data || []).map(y => `<div class="row"><div class="grow"><b>${fechaCO(y.fecha)}</b><small>Declarado ${cop(y.efectivo_declarado)} · diferencia ${cop(y.diferencia)}${y.anulado_motivo ? ` · <span class="red-t">anulado: ${esc(y.anulado_motivo)}</span>` : ""}</small></div></div>`).join("") || `<p class="muted small">Sin cierres.</p>`}</div></div>`;
  $("#fd").onchange = e => aCierre(el, e.target.value);
  const fci = $("#fci"); if (fci) fci.onsubmit = async e => { e.preventDefault(); const g = new FormData(fci), s = String(g.get("e")).trim(), v = s === "0" ? 0 : DPReglas.copValido(s); if (v == null) return toast("Efectivo inválido", 1);
    const { error } = await sb.rpc("cerrar_dia", { p_fecha: f, p_efectivo: v, p_notas: g.get("n") }); if (error) return toast(errMsg(error), 1); toast("Día cerrado"); aCierre(el, f); };
  const anu = $("#anu"); if (anu) anu.onclick = async () => { const m = prompt("Motivo de la anulación (queda registrado):"); if (!m) return; const { error } = await sb.rpc("anular_cierre", { p_cierre: vig.id, p_motivo: m }); if (error) return toast(errMsg(error), 1); toast("Cierre anulado"); aCierre(el, f); };
}

// ---------- Inventario › Lotes ----------
async function seccionLotes(box) {
  const { data, error } = await sb.from("lotes").select("*").order("vence");
  if (error) { box.innerHTML = sinV5(error) ? "" : avisoV5(error); return; }
  const hoy = DPReglas.hoyBogota(), conLote = S.productos.filter(p => p.exige_lote), sinLote = S.productos.filter(p => !p.exige_lote);
  const nomP = id => { const p = S.productos.find(x => x.id === id); return p ? p.nombre + (p.presentacion ? " · " + p.presentacion : "") : ""; };
  box.innerHTML = `<div class="card"><h3>📅 Lotes y vencimientos</h3><p class="muted small">Solo los productos con lote activado lo exigen; los demás funcionan igual que antes. Se vende primero lo que vence antes y nunca lo vencido. No se crea historia de lotes para ventas pasadas.</p>
    <div class="list">${data.filter(l => l.cantidad > 0).map(l => `<div class="row"><div class="grow"><b>${esc(nomP(l.producto_id))}</b><small>Lote ${esc(l.codigo)} · vence ${fechaCO(l.vence)}${l.origen === "declarado_activacion" ? " · declarado al activar" : ""}</small></div>${l.vence < hoy ? `<span class="tag red">Vencido</span>` : ""}<b>${l.cantidad}</b><button class="btn sm ghost" data-baja="${l.id}">Baja</button></div>`).join("") || `<p class="muted small">Sin lotes con existencias.</p>`}</div>
    ${conLote.length ? `<form id="frl"><h3>Recibir lote</h3><label>Producto<select name="p">${conLote.map(p => `<option value="${p.id}">${esc(nomP(p.id))}</option>`).join("")}</select></label><div class="two"><label>Código de lote<input name="c" required maxlength="40"></label><label>Vence<input name="v" type="date" required></label></div><label>Cantidad<input name="q" type="number" min="1" required></label><button class="btn ghost w">Registrar entrada</button></form>` : ""}
    ${rol() === "administrador" && sinLote.length ? `<form id="fal"><h3>Activar exigencia de lote</h3><label>Producto<select name="p">${sinLote.map(p => `<option value="${p.id}" data-s="${p.stock}">${esc(nomP(p.id))} — stock ${p.stock}</option>`).join("")}</select></label>
      <label>Lotes que hoy cubren el stock (uno por línea: código;AAAA-MM-DD;cantidad)<textarea name="l" required rows="3" placeholder="L-001;2027-01-31;24"></textarea></label><p class="muted small">La suma debe ser igual al stock actual. Esta acción no se puede desactivar en esta versión.</p><button class="btn ghost w">Activar lotes</button></form>` : ""}</div>`;
  const frl = box.querySelector("#frl"); if (frl) frl.onsubmit = async e => { e.preventDefault(); const f = new FormData(frl); const { error } = await sb.rpc("recibir_lote", { p_prod: f.get("p"), p_codigo: f.get("c"), p_vence: f.get("v"), p_cantidad: +f.get("q"), p_nota: "" }); if (error) return toast(errMsg(error), 1); toast("Lote recibido"); aInventario(box.closest("#ad")); };
  const fal = box.querySelector("#fal"); if (fal) fal.onsubmit = async e => { e.preventDefault(); const f = new FormData(fal);
    const lotes = String(f.get("l")).split(/\n/).map(x => x.trim()).filter(Boolean).map(x => { const [codigo, vence, cantidad] = x.split(";").map(y => y.trim()); return { codigo, vence, cantidad: Number(cantidad) }; });
    if (lotes.some(l => !l.codigo || !/^\d{4}-\d{2}-\d{2}$/.test(l.vence || "") || !Number.isInteger(l.cantidad) || l.cantidad < 0)) return toast("Formato: código;AAAA-MM-DD;cantidad", 1);
    if (!confirm("Desde ahora este producto exigirá lote para entradas. ¿Continuar?")) return;
    const { error } = await sb.rpc("activar_lotes", { p_prod: f.get("p"), p_lotes: lotes }); if (error) return toast(errMsg(error), 1); toast("Lotes activados"); aInventario(box.closest("#ad")); };
  box.querySelectorAll("[data-baja]").forEach(b => b.onclick = async () => { const q = prompt("Unidades a dar de baja:"); if (!q) return; const m = prompt("Motivo (vencido, dañado…):"); if (!m) return; const { error } = await sb.rpc("baja_lote", { p_lote: b.dataset.baja, p_cantidad: +q, p_motivo: m }); if (error) return toast(errMsg(error), 1); toast("Baja registrada"); aInventario(box.closest("#ad")); });
}
