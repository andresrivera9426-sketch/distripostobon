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
  /** Espejo de public.precio_para: base (tipo o lista), promo si es menor, mayor descuento por cantidad aplicable. */
  function precioCliente(base, promo, descuentos, cant) {
    let b = Number(base); if (promo != null && Number(promo) < b) b = Number(promo);
    const pct = Math.max(0, ...(descuentos || []).filter(d => cant >= d.min).map(d => Number(d.pct)));
    return Math.round(b * (1 - pct / 100));
  }
  /** Valor COP válido: entero > 0. Acepta "20.000" o "$20000". */
  function copValido(v) { const s = String(v ?? "").replace(/[$\s.]/g, ""); if (!/^\d+$/.test(s)) return null; const n = Number(s); return n > 0 && n <= 1e9 ? n : null; }
  /** Fecha AAAA-MM-DD en America/Bogota. */
  function hoyBogota(d = new Date()) { return d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" }); }
  /** Qué módulos están activos según config.version_esquema (lo fija cada migración). Sin columna = v3 publicada. */
  function capacidades(config) {
    const n = Number(config && config.version_esquema) || 3;
    return { esquema: n, v4: n >= 4, v5: n >= 5, v6: n >= 6 };
  }
  // ---------- Chat v6 (debe coincidir con supabase/v6.sql) ----------
  const ADJ = { "image/jpeg": ["jpg", "imagen"], "image/png": ["png", "imagen"], "image/webp": ["webp", "imagen"], "application/pdf": ["pdf", "documento"],
    "audio/webm": ["webm", "voz"], "audio/ogg": ["ogg", "voz"], "audio/mp4": ["m4a", "voz"] };
  const MAX_ADJ = 10 * 1024 * 1024, MAX_VOZ_SEG = 300, EDITAR_MIN = 15, ELIMINAR_H = 24, REACCIONES = ["👍", "❤️", "😂", "😮", "🙏", "✅"];
  /** Valida un archivo antes de subirlo: tipo permitido (sin SVG/HTML), tamaño 1 B..10 MB. Las fotos y PDF usan el tipo declarado por el navegador. */
  function validarAdjunto(f, voz) {
    const mime = String(f && f.type || "").split(";")[0].trim().toLowerCase(), d = ADJ[mime];
    if (!d) return { ok: false, error: "Tipo de archivo no permitido. Solo fotos JPG/PNG/WEBP y documentos PDF." };
    if (!voz && d[1] === "voz") return { ok: false, error: "Los audios se envían con el botón de nota de voz." };
    if (!(f.size > 0)) return { ok: false, error: "El archivo está vacío." };
    if (f.size > MAX_ADJ) return { ok: false, error: "El archivo supera 10 MB." };
    return { ok: true, mime, ext: d[0], tipo: d[1] };
  }
  /** Elige el formato de grabación que el navegador soporta (o null: sin notas de voz en este dispositivo). */
  function formatoVoz(soporta) {
    for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) if (soporta(m)) return { grabar: m, mime: m.split(";")[0] };
    return null;
  }
  const ms = x => new Date(x).getTime();
  function puedeEditar(m, uid, ahora = Date.now()) { return !!m && m.autor_id === uid && !m.eliminado && (m.tipo || "texto") === "texto" && ahora - ms(m.creado) <= EDITAR_MIN * 60000; }
  function puedeEliminar(m, uid, rol, ahora = Date.now()) { return !!m && !m.eliminado && (rol === "administrador" || (m.autor_id === uid && ahora - ms(m.creado) <= ELIMINAR_H * 3600000)); }
  /** "Visto" SOLO si otra persona registró lectura (abrió la conversación) hasta este mensaje o uno posterior. Nunca se infiere. */
  function vistoPor(m, lecturas, uid) { return (lecturas || []).some(l => l.usuario_id !== uid && Number(l.ultimo_id) >= Number(m.id)); }
  /** Estado visible de un mensaje propio. Sin "entregado": no hay evidencia de entrega al dispositivo. */
  function estadoMensaje(m, lecturas, uid) {
    if (m._estado === "enviando") return "enviando"; if (m._estado === "error") return "error";
    if (m.autor_id !== uid) return null; return vistoPor(m, lecturas, uid) ? "visto" : "enviado";
  }
  function resumenCita(m) {
    if (!m) return "Mensaje no disponible"; if (m.eliminado) return "Mensaje eliminado";
    const t = { imagen: "📷 Foto", documento: "📄 " + (m.adjunto_nombre || "Documento"), voz: "🎤 Nota de voz" }[m.tipo];
    const x = (t ? t + (m.texto ? " · " : "") : "") + (m.texto || ""); return x.length > 90 ? x.slice(0, 89) + "…" : x;
  }
  function tamano(b) { return b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB"; }
  return { ADJ, MAX_ADJ, MAX_VOZ_SEG, REACCIONES, validarAdjunto, formatoVoz, puedeEditar, puedeEliminar, vistoPor, estadoMensaje, resumenCita, tamano, capacidades, precioCliente, copValido, hoyBogota, SIGUIENTE, siguientesEstados, puedeCancelar, coincide, filasImportacion, resumenTablero };
});
