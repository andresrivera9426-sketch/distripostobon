"use strict";
/** Parser/validación de importación de productos (fase 1: sin Drive). Expuesto en window.DPImport y usable en Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DPImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const sinTilde = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  function normKeys(o) {
    const m = {};
    for (const k of Object.keys(o || {})) m[sinTilde(k).trim()] = o[k];
    return m;
  }

  function pick(r, names) {
    for (const n of names) {
      if (r[n] !== undefined && r[n] !== null && String(r[n]).trim() !== "") return r[n];
    }
    for (const n of names) {
      if (Object.prototype.hasOwnProperty.call(r, n)) return r[n];
    }
    return undefined;
  }

  /** Parsea COP: rechaza negativos; acepta 20000, 20.000, $20.000, 20000.50 */
  function parsePrecio(v) {
    if (v === "" || v == null) return { ok: false, error: "precio vacío" };
    let s = String(v).trim().replace(/\s/g, "").replace(/\$/g, "");
    if (!s) return { ok: false, error: "precio vacío" };
    if (/^-/.test(s)) return { ok: false, error: "precio negativo" };
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
    else s = s.replace(/[^\d.]/g, "");
    if (!s || (s.match(/\./g) || []).length > 1) return { ok: false, error: "precio inválido" };
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "precio inválido" };
    return { ok: true, value: Math.round(n) };
  }

  function parseStock(v) {
    if (v === "" || v == null) return { ok: false, error: "cantidad/stock vacío" };
    const s = String(v).trim().replace(/\s/g, "").replace(/,/g, "");
    if (!/^\d+$/.test(s)) return { ok: false, error: "stock debe ser entero ≥ 0" };
    return { ok: true, value: parseInt(s, 10) };
  }

  function parseSiNo(v, def) {
    const t = sinTilde(String(v ?? "")).trim();
    if (!t) return def;
    if (/^(si|s|1|true|x)$/.test(t)) return true;
    if (/^(no|n|0|false)$/.test(t)) return false;
    return def;
  }

  function parseFoto(v) {
    const s = String(v ?? "").trim();
    if (!s) return { ok: true, value: null };
    if (!/^https:\/\//i.test(s)) return { ok: false, error: "imagen debe ser URL https://" };
    return { ok: true, value: s };
  }

  function filaAProducto(raw, filaExcel) {
    const r = normKeys(raw);
    const errores = [];
    const nombre = String(pick(r, ["nombre", "producto", "product"]) ?? "").trim().slice(0, 120);
    if (!nombre) errores.push("falta producto/nombre");
    const presentacion = String(pick(r, ["presentacion", "presentación"]) ?? "").trim().slice(0, 60);
    const categoria = String(pick(r, ["categoria", "categoría"]) ?? "General").trim().slice(0, 40) || "General";
    const pr = parsePrecio(pick(r, ["precio", "precio cop", "price"]));
    if (!pr.ok) errores.push(pr.error);
    const ppRaw = pick(r, ["precio promo", "preciopromo", "promo"]);
    let precio_promo = null;
    if (ppRaw !== undefined && String(ppRaw).trim() !== "") {
      const pp = parsePrecio(ppRaw);
      if (!pp.ok) errores.push("precio promo: " + pp.error);
      else precio_promo = pp.value;
    }
    const st = parseStock(pick(r, ["cantidad disponible", "cantidad", "stock", "inventario"]));
    if (!st.ok) errores.push(st.error);
    const fo = parseFoto(pick(r, ["imagen url", "imagen", "foto", "foto url", "image", "url imagen"]));
    if (!fo.ok) errores.push(fo.error);
    if (precio_promo != null && pr.ok && !(precio_promo < pr.value)) precio_promo = null;
    const producto = {
      nombre,
      categoria,
      presentacion,
      precio: pr.ok ? pr.value : 0,
      precio_promo,
      stock: st.ok ? st.value : 0,
      activo: parseSiNo(pick(r, ["activo"]), true),
      destacado: parseSiNo(pick(r, ["destacado"]), false),
      descripcion: String(pick(r, ["descripcion", "descripción"]) ?? "").trim().slice(0, 140),
      foto_url: fo.ok ? fo.value : null
    };
    return { fila: filaExcel, producto, errores, clave: sinTilde(nombre) + "|" + sinTilde(presentacion) };
  }

  function parseFilas(rows, existentes) {
    const byKey = new Map();
    (existentes || []).forEach(p => {
      byKey.set(sinTilde(p.nombre) + "|" + sinTilde(p.presentacion || ""), p);
    });
    const seen = new Map();
    const items = [];
    let bloqueado = false;
    rows.forEach((raw, i) => {
      const fila = i + 2;
      const empty = !Object.keys(raw || {}).some(k => String(raw[k] ?? "").trim() !== "");
      if (empty) return;
      const parsed = filaAProducto(raw, fila);
      if (seen.has(parsed.clave)) {
        parsed.errores.push("duplicado en el archivo (misma fila lógica que " + seen.get(parsed.clave) + ")");
      } else {
        seen.set(parsed.clave, fila);
      }
      const ex = byKey.get(parsed.clave);
      parsed.accion = ex ? "actualizar" : "crear";
      parsed.existente = ex || null;
      parsed.stockAnterior = ex ? ex.stock : null;
      if (parsed.errores.length) bloqueado = true;
      items.push(parsed);
    });
    return { items, bloqueado, ok: items.filter(x => !x.errores.length), malas: items.filter(x => x.errores.length) };
  }

  function plantillaEjemplo() {
    return [{
      Producto: "EJEMPLO · Producto",
      "Cantidad disponible": 50,
      "Precio COP": 20000,
      "Imagen URL": "",
      Categoría: "Gaseosas",
      Presentación: "Paca x12",
      "Precio promo": "",
      Activo: "SI",
      Destacado: "NO",
      Descripción: ""
    }];
  }

  function exportCols(p) {
    return {
      Producto: p.nombre,
      "Cantidad disponible": p.stock,
      "Precio COP": Number(p.precio),
      "Imagen URL": p.foto_url || "",
      Categoría: p.categoria,
      Presentación: p.presentacion,
      "Precio promo": p.precio_promo ?? "",
      Activo: p.activo ? "SI" : "NO",
      Destacado: p.destacado ? "SI" : "NO",
      Descripción: p.descripcion || ""
    };
  }

  return { sinTilde, normKeys, parsePrecio, parseStock, parseFoto, filaAProducto, parseFilas, plantillaEjemplo, exportCols };
});
