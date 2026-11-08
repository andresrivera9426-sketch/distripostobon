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
  assert.deepEqual(R.capacidades({}), { esquema: 3, v4: false, v5: false }); assert.deepEqual(R.capacidades({ version_esquema: 4 }), { esquema: 4, v4: true, v5: false });
  assert.deepEqual(R.capacidades({ version_esquema: 5 }), { esquema: 5, v4: true, v5: true }); assert.equal(R.capacidades(null).esquema, 3);
});
console.log(`\n${n} pruebas de reglas OK`);
