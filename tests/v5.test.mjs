// Pruebas v5 con PGlite (Postgres en memoria, simulación de Supabase; NO es Supabase real). Datos 100 % ficticios.
// Uso: NODE_PATH=<node_modules con @electric-sql/pglite> node tests/v5.test.mjs
import { createRequire } from "node:module"; import fs from "node:fs"; import assert from "node:assert/strict"; import { randomUUID as uid } from "node:crypto";
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const db = new PGlite(); const rd = f => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
await db.exec(rd("tests/supabase_stub.sql"));
for (const f of (process.env.MIG === "consolidada" ? ["supabase/esquema.sql", "supabase/v3.sql", "supabase/v4_v5_consolidada.sql"] : ["supabase/esquema.sql", "supabase/v3.sql", "supabase/v4.sql", "supabase/v5.sql"])) await db.exec(rd(f).replace(/create extension[^;]*;/g, ""));
// Privilegios por defecto de Supabase para el rol authenticated (las políticas RLS hacen el filtrado)
await db.exec(`grant usage on schema public, auth, storage to authenticated; grant all on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated; grant execute on function auth.uid() to authenticated;`);
const U = { admin: uid(), ven: uid(), ven2: uid(), bod: uid(), cli: uid(), cli2: uid() };
const ROL = { admin: "administrador", ven: "vendedor", ven2: "vendedor", bod: "bodega", cli: "cliente", cli2: "cliente" };
for (const [k, id] of Object.entries(U)) { await db.query("insert into auth.users(id,email) values($1,$2)", [id, k + "@prueba.test"]); await db.query("update profiles set rol=$2, nombre=$3 where id=$1", [id, ROL[k], "PRUEBA " + k]); }
// Ejecuta como usuario autenticado real (rol authenticated + RLS activo)
const as = async (u, sql, p = []) => { await db.query("select set_config('test.uid',$1,false)", [U[u]]); await db.query("set role authenticated"); try { return (await db.query(sql, p)).rows; } finally { await db.query("reset role"); } };
const su = async (sql, p = []) => (await db.query(sql, p)).rows;
const falla = (u, sql, p, re) => assert.rejects(as(u, sql, p), re);
let n = 0; const ok = m => { n++; console.log("✓", m); };
const prod = async (nom, precio, stock) => (await su("insert into productos(nombre,presentacion,precio,stock) values($1,'u',$2,$3) returning id", [nom, precio, stock]))[0].id;
const stock = async id => (await su("select stock from productos where id=$1", [id]))[0].stock;
const hoy = (await su("select public.hoy_co()::text d"))[0].d;
const dia = async add => (await su(`select (public.hoy_co()+${add})::text d, extract(isodow from public.hoy_co()+${add})::int w`))[0];
const pedir = (u, items, extra = {}) => as(u, "select crear_pedido($1,'',$2,'',$3) r", [JSON.stringify(items), extra.fecha || null, extra.cond || "contado"]).then(r => r[0].r);
const entregar = async pid => { for (const e of ["Confirmado", "Alistando", "En ruta"]) await as("admin", "select cambiar_estado($1,$2)", [pid, e]); await as("bod", "select entregar_pedido($1,'PRUEBA Ana','x/y.webp',null)", [pid]); };

const G = await prod("PRUEBA Gaseosa", 20000, 100), A = await prod("PRUEBA Agua", 9000, 100);

// 1) Zonas, días y vendedor
const d1 = await dia(1), d2 = await dia(2);
const z = (await as("admin", "insert into zonas(nombre,dias) values('PRUEBA Norte',$1) returning id", [[d1.w]]))[0].id;
await falla("cli", "insert into zonas(nombre) values('x')", [], /row-level security/); ok("zonas: solo admin crea");
await as("admin", "insert into clientes_comercial(cliente_id,zona_id,vendedor_id) values($1,$2,$3)", [U.cli, z, U.ven]);
await falla("admin", "insert into clientes_comercial(cliente_id,vendedor_id) values($1,$2)", [U.cli2, U.bod], /Vendedor inválido/);
await falla("cli", "update clientes_comercial set cupo_credito=999999999 where cliente_id=$1", [U.cli], /row-level security|no rows|permission/).catch(async () => {
  assert.equal((await su("select cupo_credito from clientes_comercial where cliente_id=$1", [U.cli]))[0].cupo_credito, null); });
assert.equal((await su("select cupo_credito from clientes_comercial where cliente_id=$1", [U.cli]))[0].cupo_credito, null); ok("ficha comercial: la tienda no se asigna cupo");
assert.equal((await as("cli2", "select * from clientes_comercial")).length, 0); ok("ficha comercial: una tienda no ve la de otra");
await falla("cli", "select crear_pedido($1,'',$2::date)", [JSON.stringify([{ producto_id: G, cantidad: 1 }]), d2.d], /no tiene entregas ese día/);
let p = await pedir("cli", [{ producto_id: G, cantidad: 1 }], { fecha: d1.d });
let row = (await su("select vendedor_id, ruta from pedidos where id=$1", [p.id]))[0];
assert.equal(row.vendedor_id, U.ven); assert.equal(row.ruta, "PRUEBA Norte"); ok("zonas: valida día de entrega y asigna vendedor/ruta");
await as("cli", "select cambiar_estado($1,'Cancelado','prueba')", [p.id]);

// 2) Precios por tipo y descuentos por cantidad
await as("admin", "insert into tipos_cliente values('mayorista','PRUEBA Mayorista')");
await as("admin", "insert into precios_tipo values($1,'mayorista',18000)", [G]);
await as("admin", "insert into descuentos_cantidad(producto_id,min_cantidad,porcentaje) values($1,10,10)", [G]);
await falla("admin", "insert into descuentos_cantidad(producto_id,min_cantidad,porcentaje) values($1,5,95)", [G], /check/);
p = await pedir("cli2", [{ producto_id: G, cantidad: 1 }]); assert.equal(Number(p.total), 20000);
p = await pedir("cli2", [{ producto_id: G, cantidad: 10 }]); assert.equal(Number(p.total), 180000);
await as("admin", "update clientes_comercial set tipo='mayorista' where cliente_id=$1", [U.cli]);
p = await pedir("cli", [{ producto_id: G, cantidad: 10 }]); assert.equal(Number(p.total), 162000);
const it = (await su("select precio, precio_lista from pedido_items where pedido_id=$1", [p.id]))[0]; assert.equal(Number(it.precio), 16200); assert.equal(Number(it.precio_lista), 20000);
const mp = await as("cli", "select precio from mis_precios() where producto_id=$1", [G]); assert.equal(Number(mp[0].precio), 18000);
assert.equal((await as("cli", "select * from precios_tipo")).length, 0); ok("precios: tipo de cliente + descuento por cantidad; la tienda no lee tarifas ajenas");
await as("cli", "select cambiar_estado($1,'Cancelado','prueba')", [p.id]);

// 3) Crédito, cartera y abonos
await falla("cli2", "select crear_pedido($1,'',null,'','credito')", [JSON.stringify([{ producto_id: A, cantidad: 1 }])], /no tiene crédito/);
await as("admin", "update clientes_comercial set cupo_credito=50000, plazo_dias=15 where cliente_id=$1", [U.cli]);
p = await pedir("cli", [{ producto_id: A, cantidad: 4 }], { cond: "credito" });
assert.equal((await su("select vence_pago::text v from pedidos where id=$1", [p.id]))[0].v, (await dia(15)).d);
await falla("cli", "select crear_pedido($1,'',null,'','credito')", [JSON.stringify([{ producto_id: A, cantidad: 2 }])], /cupo/); ok("crédito: exige cupo/plazo configurados y respeta el cupo");
const k1 = uid();
await falla("ven2", "select registrar_abono($1,10000,'efectivo','',$2)", [p.id, k1], /No autorizado/);
await falla("bod", "select registrar_abono($1,10000,'efectivo','',$2)", [p.id, k1], /No autorizado/);
const a1 = (await as("ven", "select registrar_abono($1,10000,'efectivo','',$2) r", [p.id, k1]))[0].r;
assert.equal((await as("ven", "select registrar_abono($1,10000,'efectivo','',$2) r", [p.id, k1]))[0].r, a1);
await falla("ven", "select registrar_abono($1,5000,'efectivo','',$2)", [p.id, k1], /ya usada/);
await falla("ven", "select registrar_abono($1,30000,'efectivo','',$2)", [p.id, uid()], /supera el saldo/);
await falla("ven", "select registrar_abono($1,100.5,'efectivo','',$2)", [p.id, uid()], /Valor inválido/);
assert.equal(Number((await as("cli", "select saldo from cartera where pedido_id=$1", [p.id]))[0].saldo), 26000); ok("abonos: permisos, idempotencia, sin exceder saldo, COP enteros");
assert.equal((await as("bod", "select * from cartera")).length, 0); assert.equal((await as("ven2", "select * from abonos")).length, 0);
assert.equal((await as("cli2", "select * from abonos")).length, 0); ok("cartera: bodega/otro vendedor/otra tienda no ven abonos");
await falla("cli", "select cambiar_estado($1,'Cancelado','x')", [p.id], /abonos/); ok("no se cancela pedido con abonos vigentes");
await falla("ven", "select reversar_abono($1,'error')", [a1], /administrador/);
await as("admin", "select reversar_abono($1,'Digitado dos veces')", [a1]);
await falla("admin", "select reversar_abono($1,'otra')", [a1], /ya fue reversado/);
assert.equal((await su("select count(*)::int c from abonos where pedido_id=$1", [p.id]))[0].c, 2);
assert.equal(Number((await su("select saldo_pedido($1) s", [p.id]))[0].s), 36000); ok("abonos: reverso auditable una sola vez (no se borra el original)");
const pCred = p;

// 4) Devoluciones y envases
const canasta = (await as("admin", "insert into envases(nombre) values('PRUEBA Canasta') returning id"))[0].id;
await as("admin", "insert into producto_envases values($1,$2,1)", [G, canasta]);
p = await pedir("cli2", [{ producto_id: G, cantidad: 3 }]);
const item = (await su("select id from pedido_items where pedido_id=$1", [p.id]))[0].id;
await falla("bod", "select registrar_devolucion($1,1,'reventa','rota',$2)", [item, uid()], /entregados/);
await entregar(p.id);
assert.equal((await su("select saldo_envase($1,$2) s", [U.cli2, canasta]))[0].s, 3); ok("envases: la entrega genera saldo de canastas según configuración");
const sG = await stock(G); const kd = uid();
await as("bod", "select registrar_devolucion($1,1,'reventa','Cliente no la quiso',$2)", [item, kd]);
await as("bod", "select registrar_devolucion($1,1,'reventa','Cliente no la quiso',$2)", [item, kd]);
assert.equal(await stock(G), sG + 1);
await as("bod", "select registrar_devolucion($1,1,'averia','Golpeada',$2)", [item, uid()]);
assert.equal(await stock(G), sG + 1);
await falla("bod", "select registrar_devolucion($1,2,'averia','x',$2)", [item, uid()], /Supera lo entregado/);
await falla("cli2", "select registrar_devolucion($1,1,'averia','x',$2)", [item, uid()], /No autorizado/);
assert.equal(Number((await su("select saldo_pedido($1) s", [p.id]))[0].s), 20000); ok("devoluciones: idempotentes, separan reventa/avería, no exceden lo entregado y descuentan saldo");
await falla("bod", "select devolver_envases($1,$2,5,'',$3)", [U.cli2, canasta, uid()], /solo tiene 3/);
const em = (await as("ven", "select devolver_envases($1,$2,2,'recogidas',$3) r", [U.cli2, canasta, uid()]))[0].r;
assert.equal((await su("select saldo_envase($1,$2) s", [U.cli2, canasta]))[0].s, 1);
await as("admin", "select reversar_envase_mov($1,'conteo mal hecho')", [em]);
await falla("admin", "select reversar_envase_mov($1,'otra vez')", [em], /Ya fue reversado/);
assert.equal((await su("select saldo_envase($1,$2) s", [U.cli2, canasta]))[0].s, 3);
assert.equal((await as("cli", "select * from envases_mov")).length, 0); ok("envases: devolución limitada al saldo, reverso auditable, tienda solo ve lo suyo");

// 5) Lotes
const L = await prod("PRUEBA Yogur", 3000, 5);
const ayer = (await dia(-1)).d, mes = (await dia(30)).d;
await falla("admin", "select activar_lotes($1,$2)", [L, JSON.stringify([{ codigo: "A", vence: ayer, cantidad: 2 }])], /deben coincidir/);
await falla("bod", "select activar_lotes($1,$2)", [L, JSON.stringify([])], /No autorizado/);
await as("admin", "select activar_lotes($1,$2)", [L, JSON.stringify([{ codigo: "A", vence: ayer, cantidad: 2 }, { codigo: "B", vence: mes, cantidad: 3 }])]);
await falla("cli", "select crear_pedido($1)", [JSON.stringify([{ producto_id: L, cantidad: 4 }])], /vigente/); ok("lotes: activación explícita que cuadra con stock; no se vende vencido");
const pl = await pedir("cli", [{ producto_id: L, cantidad: 3 }]);
const lot = async c => (await su("select cantidad from lotes where producto_id=$1 and codigo=$2", [L, c]))[0].cantidad;
assert.equal(await lot("B"), 0); assert.equal(await lot("A"), 2);
await falla("admin", "update productos set stock=50 where id=$1", [L], /exige lote/);
await falla("bod", "select ajustar_inventario($1,'entrada',5,'llegó')", [L], /exige lote/);
await as("bod", "select recibir_lote($1,'C',$2::date,10,'')", [L, (await dia(60)).d]);
await falla("bod", "select recibir_lote($1,'C',$2::date,1,'')", [L, mes], /ya existe con vencimiento/);
await as("cli", "select cambiar_estado($1,'Cancelado','x')", [pl.id]);
assert.equal(await lot("B"), 3);
await as("bod", "select baja_lote((select id from lotes where producto_id=$1 and codigo='A'),2,'Vencido')", [L]);
assert.equal(await lot("A"), 0);
assert.equal((await su("select sum(cantidad)::int s from lotes where producto_id=$1", [L]))[0].s, await stock(L)); ok("lotes: FEFO, recepción, cancelación al mismo lote, baja de vencidos y conciliación lote=stock");
assert.equal((await as("cli", "select * from lotes")).length, 0);
// Productos sin lote siguen igual
await as("admin", "update productos set stock=stock+1 where id=$1", [A]); ok("productos sin lote conservan edición directa (compatibilidad)");

// Pedido histórico (anterior a v4, sin movimientos) se cancela con rastro
const leg = (await su("insert into pedidos(codigo,cliente_id,total) values('DP-LEG01',$1,9000) returning id", [U.cli2]))[0].id;
await su("insert into pedido_items(pedido_id,producto_id,nombre,precio,cantidad) values($1,$2,'PRUEBA Agua',9000,1)", [leg, A]);
const sA = await stock(A); await as("admin", "select cambiar_estado($1,'Cancelado','x')", [leg]);
assert.equal(await stock(A), sA + 1); ok("histórico: cancelar pedido antiguo repone stock y deja movimiento");

// 6) Cierre diario
const r = (await as("admin", "select resumen_dia($1::date) r", [hoy]))[0].r;
assert.equal(r.entregas.pedidos, 1); assert.equal(r.abonos.efectivo, 0); assert.equal(r.abonos.reversos, 1); assert.equal(r.devoluciones.registros, 2); assert.equal(r.envases.entregados, 3);
await falla("ven", "select resumen_dia($1::date)", [hoy], /No autorizado/);
await falla("admin", "select cerrar_dia($1::date,0,'')", [(await dia(1)).d], /futuro/);
const c1 = (await as("admin", "select cerrar_dia($1::date,5000,'PRUEBA') r", [hoy]))[0].r;
assert.equal(Number((await su("select diferencia from cierres where id=$1", [c1]))[0].diferencia), 5000);
await falla("admin", "select cerrar_dia($1::date,0,'')", [hoy], /ya está cerrado/);
await as("admin", "select anular_cierre($1,'Faltó un abono')", [c1]);
await as("admin", "select cerrar_dia($1::date,0,'')", [hoy]);
assert.equal((await su("select count(*)::int c from cierres")).at(0).c, 2);
assert.equal((await as("ven", "select * from cierres")).length, 0); ok("cierre: resumen por día Bogotá, uno vigente por día, anulación auditable, solo admin");
assert.equal((await su("select version_esquema from config where id=1"))[0].version_esquema, 5); ok("config.version_esquema = 5 tras migrar");
console.log(`\n${n} pruebas v5 OK (PGlite, no Supabase real)`);
await db.close(); void pCred;
