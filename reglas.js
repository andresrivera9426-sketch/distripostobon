"use strict";
/** Reglas puras compartidas por la app y las pruebas (window.DPReglas / Node). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DPReglas = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Debe coincidir con public.transicion_valida en supabase/v4.sql
  const SIGUIENTE = { Recibido: "Confirmado", Confirmado: "Alistando", Alistando: "En ruta", "En ruta": "Entregado" };
  const BODEGA = ["Alistando", "En ruta", "Entregado"];

  /** Estados a los que el rol puede mover el pedido ahora (sin contar Cancelado). */
  function siguientesEstados(rol, estado) {
    const s = SIGUIENTE[estado];
    if (!s || !["vendedor", "administrador", "bodega"].includes(rol)) return [];
    if (rol === "bodega" && !BODEGA.includes(s)) return [];
    return [s];
  }
  function puedeCancelar(rol, estado) {
    if (!SIGUIENTE[estado]) return false;
    if (rol === "cliente") return estado === "Recibido";
    return rol === "vendedor" || rol === "administrador";
  }

  const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  /** Búsqueda por palabras: todas deben aparecer, en cualquier orden y sin importar tildes. */
  function coincide(texto, q) {
    const t = norm(texto), palabras = norm(q).split(/\s+/).filter(Boolean);
    return palabras.every(p => t.includes(p));
  }

  /** Convierte la vista previa validada en filas para la RPC importar_productos. */
  function filasImportacion(parsed) {
    if (parsed.bloqueado) throw new Error("El lote tiene errores");
    return parsed.ok.map(it => ({ ...it.producto, id: it.existente ? it.existente.id : null }));
  }

  /** Productos más pedidos por unidades y pedidos pendientes por estado. */
  function resumenTablero(pedidos) {
    const vivos = pedidos.filter(o => o.estado !== "Cancelado");
    const unid = {};
    vivos.forEach(o => (o.pedido_items || []).forEach(i => { const k = i.nombre + (i.presentacion ? " · " + i.presentacion : ""); unid[k] = (unid[k] || 0) + Number(i.cantidad || 0); }));
    const pend = {};
    pedidos.filter(o => SIGUIENTE[o.estado]).forEach(o => { pend[o.estado] = (pend[o.estado] || 0) + 1; });
    return {
      masPedidos: Object.entries(unid).sort((a, b) => b[1] - a[1]),
      pendientes: Object.keys(SIGUIENTE).filter(e => pend[e]).map(e => [e, pend[e]]),
      totalPendientes: Object.values(pend).reduce((a, b) => a + b, 0)
    };
  }
  return { SIGUIENTE, siguientesEstados, puedeCancelar, coincide, filasImportacion, resumenTablero };
});
