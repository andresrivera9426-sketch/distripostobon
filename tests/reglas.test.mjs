// Pruebas de reglas puras. Uso: node tests/reglas.test.mjs
import { createRequire } from "node:module"; import assert from "node:assert/strict";
const req = createRequire(import.meta.url); const R = req("../reglas.js"), I = req("../import-productos.js");
let n = 0; const t = (m, f) => { f(); n++; console.log("✓", m); };
t("transiciones: solo el siguiente paso", () => {
  assert.deepEqual(R.siguientesEstados("vendedor", "Recibido"), ["Confirmado"]);
  assert.deepEqual(R.siguientesEstados("administrador", "En ruta"), ["Entregado"]);
  assert.deepEqual(R.siguientesEstados("bodega", "Recibido"), []);
  assert.deepEqual(R.siguientesEstados("bodega", "Confirmado"), ["Alistando"]);
  assert.deepEqual(R.siguientesEstados("cliente", "Recibido"), []);
  assert.deepEqual(R.siguientesEstados("administrador", "Entregado"), []);
});
t("cancelación por rol", () => {
  assert.equal(R.puedeCancelar("cliente", "Recibido"), true); assert.equal(R.puedeCancelar("cliente", "Confirmado"), false);
  assert.equal(R.puedeCancelar("bodega", "Alistando"), false); assert.equal(R.puedeCancelar("vendedor", "En ruta"), true);
  assert.equal(R.puedeCancelar("administrador", "Cancelado"), false);
});
t("búsqueda por palabras sin tildes", () => {
  assert.ok(R.coincide("Gaseosa Colombiana Paca x12", "paca colombiana")); assert.ok(R.coincide("Agua Cristal", "CRÍSTAL"));
  assert.ok(!R.coincide("Agua Cristal", "agua gas")); assert.ok(R.coincide("x", "  "));
});
t("import: filas para RPC con id de existentes y bloqueo si hay errores", () => {
  const ex = [{ id: "e1", nombre: "Gaseosa", presentacion: "x12", stock: 3 }];
  const ok = I.parseFilas([{ Producto: "Gaseosa", Presentación: "x12", "Precio COP": "$20.000", Cantidad: 9 }, { Nombre: "Agua", Precio: 9000, Stock: 1 }], ex);
  const f = R.filasImportacion(ok);
  assert.equal(f.length, 2); assert.equal(f[0].id, "e1"); assert.equal(f[0].precio, 20000); assert.equal(f[1].id, null);
  const malo = I.parseFilas([{ Nombre: "Agua", Precio: -5, Stock: 1 }], []);
  assert.throws(() => R.filasImportacion(malo), /errores/);
  const dup = I.parseFilas([{ Nombre: "Agua", Precio: 1, Stock: 1 }, { Nombre: "agua", Precio: 2, Stock: 1 }], []);
  assert.ok(dup.bloqueado);
});
t("tablero: más pedidos por unidades y pendientes", () => {
  const r = R.resumenTablero([
    { estado: "Recibido", pedido_items: [{ nombre: "A", presentacion: "x6", cantidad: 2 }] },
    { estado: "En ruta", pedido_items: [{ nombre: "B", cantidad: 5 }, { nombre: "A", presentacion: "x6", cantidad: 1 }] },
    { estado: "Cancelado", pedido_items: [{ nombre: "C", cantidad: 99 }] },
    { estado: "Entregado", pedido_items: [] }]);
  assert.deepEqual(r.masPedidos, [["B", 5], ["A · x6", 3]]);
  assert.deepEqual(r.pendientes, [["Recibido", 1], ["En ruta", 1]]); assert.equal(r.totalPendientes, 2);
});
t("v5: precio cliente, COP y fecha Bogotá", () => {
  assert.equal(R.precioCliente(18000, null, [{ min: 10, pct: 10 }], 10), 16200); assert.equal(R.precioCliente(18000, null, [{ min: 10, pct: 10 }], 9), 18000);
  assert.equal(R.precioCliente(20000, 15000, [], 1), 15000); assert.equal(R.precioCliente(20000, 25000, [{ min: 2, pct: 5 }, { min: 5, pct: 8 }], 6), 18400);
  assert.equal(R.copValido("$20.000"), 20000); assert.equal(R.copValido("0"), null); assert.equal(R.copValido("-5"), null); assert.equal(R.copValido("1,5"), null);
  assert.equal(R.hoyBogota(new Date("2026-11-08T03:00:00Z")), "2026-11-07"); assert.equal(R.hoyBogota(new Date("2026-11-08T05:00:00Z")), "2026-11-08");
});
t("capacidades por versión de esquema", () => {
  assert.deepEqual(R.capacidades({}), { esquema: 3, v4: false, v5: false, v6: false }); assert.deepEqual(R.capacidades({ version_esquema: 4 }), { esquema: 4, v4: true, v5: false, v6: false });
  assert.deepEqual(R.capacidades({ version_esquema: 5 }), { esquema: 5, v4: true, v5: true, v6: false }); assert.equal(R.capacidades({ version_esquema: 6 }).v6, true); assert.equal(R.capacidades(null).esquema, 3);
});
t("chat: validación de adjuntos (tipos, tamaño, sin SVG/HTML)", () => {
  assert.equal(R.validarAdjunto({ type: "image/jpeg", size: 5000 }).tipo, "imagen"); assert.equal(R.validarAdjunto({ type: "application/pdf", size: 1 }).ext, "pdf");
  for (const type of ["image/svg+xml", "text/html", "application/javascript", "application/zip", "", "image/gif"]) assert.equal(R.validarAdjunto({ type, size: 10 }).ok, false, type);
  assert.equal(R.validarAdjunto({ type: "image/png", size: 10 * 1024 * 1024 + 1 }).ok, false); assert.equal(R.validarAdjunto({ type: "image/png", size: 0 }).ok, false);
  assert.equal(R.validarAdjunto({ type: "audio/webm", size: 10 }).ok, false); assert.equal(R.validarAdjunto({ type: "audio/webm;codecs=opus", size: 10 }, true).mime, "audio/webm");
});
t("chat: formato de voz según soporte del navegador", () => {
  assert.deepEqual(R.formatoVoz(m => m === "audio/mp4"), { grabar: "audio/mp4", mime: "audio/mp4" }); assert.equal(R.formatoVoz(() => false), null);
  assert.equal(R.formatoVoz(() => true).mime, "audio/webm");
});
t("chat: editar 15 min solo autor/texto; eliminar autor 24 h o admin", () => {
  const ahora = Date.parse("2026-11-07T12:00:00Z"), m = { id: 5, autor_id: "a", tipo: "texto", creado: "2026-11-07T11:50:00Z" };
  assert.ok(R.puedeEditar(m, "a", ahora)); assert.ok(!R.puedeEditar(m, "b", ahora)); assert.ok(!R.puedeEditar({ ...m, creado: "2026-11-07T11:40:00Z" }, "a", ahora));
  assert.ok(!R.puedeEditar({ ...m, tipo: "imagen" }, "a", ahora)); assert.ok(!R.puedeEditar({ ...m, eliminado: "x" }, "a", ahora));
  assert.ok(R.puedeEliminar(m, "a", "cliente", ahora)); assert.ok(!R.puedeEliminar(m, "b", "vendedor", ahora)); assert.ok(R.puedeEliminar({ ...m, creado: "2026-11-01T00:00:00Z" }, "b", "administrador", ahora));
  assert.ok(!R.puedeEliminar({ ...m, creado: "2026-11-05T00:00:00Z" }, "a", "cliente", ahora));
});
t("chat: 'visto' solo con lectura real de otra persona; sin 'entregado' inventado", () => {
  const m = { id: 10, autor_id: "a" };
  assert.equal(R.estadoMensaje(m, [], "a"), "enviado"); assert.equal(R.estadoMensaje(m, [{ usuario_id: "a", ultimo_id: 99 }], "a"), "enviado");
  assert.equal(R.estadoMensaje(m, [{ usuario_id: "b", ultimo_id: 9 }], "a"), "enviado"); assert.equal(R.estadoMensaje(m, [{ usuario_id: "b", ultimo_id: 10 }], "a"), "visto");
  assert.equal(R.estadoMensaje({ ...m, _estado: "error" }, [], "a"), "error"); assert.equal(R.estadoMensaje(m, [], "b"), null);
  assert.equal(R.resumenCita({ eliminado: "x", texto: "" }), "Mensaje eliminado"); assert.equal(R.resumenCita({ tipo: "voz", texto: "" }), "🎤 Nota de voz");
});
console.log(`\n${n} pruebas de reglas OK`);
