// Pruebas de migraciones con PGlite (Postgres en memoria). Datos 100 % ficticios.
// Uso: NODE_PATH=<carpeta con @electric-sql/pglite> node tests/sql.test.mjs
import { createRequire } from "node:module"; import fs from "node:fs"; import assert from "node:assert/strict";
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const db = new PGlite(); const rd = f => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
await db.exec(rd("tests/supabase_stub.sql"));
const MIG = ["supabase/esquema.sql", "supabase/v3.sql", "supabase/v4.sql", ...(process.env.HASTA === "v4" ? [] : ["supabase/v5.sql"])];
for (const f of MIG) await db.exec(rd(f).replace(/create extension[^;]*;/g, ""));
const U = { admin: "00000000-0000-0000-0000-00000000000a", bod: "00000000-0000-0000-0000-00000000000b", cli: "00000000-0000-0000-0000-00000000000c" };
for (const [k, id] of Object.entries(U)) { await db.query("insert into auth.users(id,email) values($1,$2)", [id, k + "@prueba.test"]); await db.query("update public.profiles set rol=$2 where id=$1", [id, { admin: "administrador", bod: "bodega", cli: "cliente" }[k]]); }
const as = async (u, sql, p = []) => { await db.query("select set_config('test.uid',$1,false)", [U[u]]); return (await db.query(sql, p)).rows; };
const falla = async (u, sql, p, re) => { await assert.rejects(as(u, sql, p), re); };
let n = 0; const ok = m => { n++; console.log("✓", m); };
const stock = async nom => (await db.query("select stock from productos where nombre=$1", [nom])).rows[0].stock;

// Importación atómica
const lote = [{ nombre: "PRUEBA Gaseosa", presentacion: "x12", precio: 20000, stock: 10 }, { nombre: "PRUEBA Agua", presentacion: "x6", precio: 9000, stock: 5 }];
await falla("cli", "select importar_productos($1)", [JSON.stringify(lote)], /No autorizado/); ok("importar: solo administrador");
await falla("admin", "select importar_productos($1)", [JSON.stringify([...lote, { nombre: "PRUEBA Mala", precio: -1, stock: 1 }])], /precio inválido/);
assert.equal((await db.query("select count(*)::int c from productos")).rows[0].c, 0); ok("importar: lote con error no guarda nada");
await falla("admin", "select importar_productos($1)", [JSON.stringify([...lote, lote[0]])], /duplicado/); ok("importar: duplicados rechazados");
let r = await as("admin", "select importar_productos($1) r", [JSON.stringify(lote)]); assert.deepEqual(r[0].r, { creados: 2, actualizados: 0 });
r = await as("admin", "select importar_productos($1) r", [JSON.stringify([{ ...lote[0], stock: 30 }])]); assert.deepEqual(r[0].r, { creados: 0, actualizados: 1 });
assert.equal(await stock("PRUEBA Gaseosa"), 30);
assert.equal((await db.query("select count(*)::int c from inventario_movimientos where tipo='importacion'")).rows[0].c, 3); ok("importar: crea/actualiza, reemplaza stock y registra movimientos");

// Combos (ficticio)
await as("admin", "insert into productos(nombre,presentacion,precio,stock,categoria) values('PRUEBA Combo','1',25000,4,'Combos')");
const id = async nom => (await db.query("select id from productos where nombre=$1", [nom])).rows[0].id;
await as("admin", "insert into combo_componentes values($1,$2,2),($1,$3,1)", [await id("PRUEBA Combo"), await id("PRUEBA Gaseosa"), await id("PRUEBA Agua")]);
await falla("admin", "insert into combo_componentes values($1,$2,1)", [await id("PRUEBA Gaseosa"), await id("PRUEBA Combo")], /combo/); ok("combos: sin ciclos");
const ped = await as("cli", "select crear_pedido($1) r", [JSON.stringify([{ producto_id: await id("PRUEBA Combo"), cantidad: 3 }])]);
assert.equal(await stock("PRUEBA Combo"), 1); assert.equal(await stock("PRUEBA Gaseosa"), 24); assert.equal(await stock("PRUEBA Agua"), 2); ok("combos: venta descuenta combo y componentes");
await db.query("update productos set stock=0 where nombre='PRUEBA Agua'");
await falla("cli", "select crear_pedido($1)", [JSON.stringify([{ producto_id: await id("PRUEBA Combo"), cantidad: 1 }])], /Sin stock suficiente de PRUEBA Agua/);
await db.query("update productos set stock=2 where nombre='PRUEBA Agua'");
assert.equal(await stock("PRUEBA Combo"), 1); ok("combos: sin stock de componente no crea pedido ni descuenta");
const pid = ped[0].r.id;

// Transiciones
await falla("admin", "select cambiar_estado($1,'En ruta')", [pid], /No se puede pasar de Recibido a En ruta/); ok("pedido: no salta estados");
await as("admin", "select cambiar_estado($1,'Confirmado')", [pid]); await as("bod", "select cambiar_estado($1,'Alistando')", [pid]); await as("bod", "select cambiar_estado($1,'En ruta')", [pid]);
await falla("bod", "select cambiar_estado($1,'Entregado')", [pid], /prueba/); ok("pedido: Entregado directo bloqueado");
await falla("bod", "select entregar_pedido($1,'Ana',' ',null)", [pid], /foto o firma/); ok("pedido: entrega exige evidencia");
await as("bod", "select entregar_pedido($1,'Ana PRUEBA','cli/x.webp',null)", [pid]);
assert.equal((await db.query("select estado from pedidos where id=$1", [pid])).rows[0].estado, "Entregado"); ok("pedido: entrega con evidencia");
await falla("admin", "select cambiar_estado($1,'Cancelado')", [pid], /cerrado/); ok("pedido: cerrado no se reabre");

// Cancelación devuelve combo y componentes
const p2 = (await as("cli", "select crear_pedido($1) r", [JSON.stringify([{ producto_id: await id("PRUEBA Combo"), cantidad: 1 }, { producto_id: await id("PRUEBA Gaseosa"), cantidad: 1 }])]))[0].r.id;
assert.equal(await stock("PRUEBA Gaseosa"), 21);
await as("cli", "select cambiar_estado($1,'Cancelado','prueba')", [p2]);
assert.equal(await stock("PRUEBA Combo"), 1); assert.equal(await stock("PRUEBA Gaseosa"), 24); assert.equal(await stock("PRUEBA Agua"), 2); ok("cancelación: repone exactamente lo descontado");

// Ajustes manuales
await falla("cli", "select ajustar_inventario($1,'entrada',5,'x')", [await id("PRUEBA Agua")], /No autorizado/);
await falla("bod", "select ajustar_inventario($1,'entrada',5,'')", [await id("PRUEBA Agua")], /motivo/);
await as("bod", "select ajustar_inventario($1,'entrada',5,'Llegó camión')", [await id("PRUEBA Agua")]); assert.equal(await stock("PRUEBA Agua"), 7);
await falla("bod", "select ajustar_inventario($1,'salida',50,'Rotura')", [await id("PRUEBA Agua")], /Sin stock/);
await as("admin", "select ajustar_inventario($1,'ajuste',3,'Conteo físico')", [await id("PRUEBA Agua")]); assert.equal(await stock("PRUEBA Agua"), 3);
const m = await db.query("select cantidad, stock_resultante from inventario_movimientos where producto_id=$1 order by id desc limit 1", [await id("PRUEBA Agua")]);
assert.deepEqual(m.rows[0], { cantidad: -4, stock_resultante: 3 }); ok("inventario: entrada/salida/ajuste con rastro y sin negativos");
console.log(`\n${n} pruebas SQL OK`);

// Reversión: v4_revertir.sql + v3.sql deben aplicar sin error y conservar productos
await db.query("select set_config('test.uid','',false)");
const antes = (await db.query("select count(*)::int c from productos")).rows[0].c;
if (MIG.includes("supabase/v5.sql")) await db.exec(rd("supabase/v5_revertir.sql"));
await db.exec(rd("supabase/v4_revertir.sql")); await db.exec(rd("supabase/v3.sql"));
assert.equal((await db.query("select count(*)::int c from productos")).rows[0].c, antes);
assert.equal((await db.query("select to_regclass('public.inventario_movimientos') r")).rows[0].r, null);
console.log("✓ reversión aplica y conserva productos");
// Reaplicar v4 es idempotente
for (const f of MIG.slice(2)) { await db.exec(rd(f)); await db.exec(rd(f)); } console.log("✓ migraciones se pueden aplicar dos veces");
