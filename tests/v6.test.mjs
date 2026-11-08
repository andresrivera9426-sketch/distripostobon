// Pruebas v6 (chat) con PGlite: Postgres en memoria + simulación mínima de Supabase. NO es Supabase real. Datos ficticios.
// Uso: NODE_PATH=<node_modules con @electric-sql/pglite> node tests/v6.test.mjs   (MIG=consolidada para el script v4+v5+v6)
import { createRequire } from "node:module"; import fs from "node:fs"; import assert from "node:assert/strict"; import { randomUUID as uid } from "node:crypto";
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const rd = f => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8").replace(/create extension[^;]*;/g, "");
let n = 0; const ok = m => { n++; console.log("✓", m); };

// 0) v6 se niega a correr sobre una base v3 (sin v5)
{ const d0 = new PGlite(); await d0.exec(rd("tests/supabase_stub.sql")); for (const f of ["supabase/esquema.sql", "supabase/v3.sql"]) await d0.exec(rd(f));
  await assert.rejects(d0.exec(rd("supabase/v6.sql")), /requiere v5/); ok("v6 exige v5 previo (no deja una base a medias)"); await d0.close(); }

const db = new PGlite(); await db.exec(rd("tests/supabase_stub.sql"));
const files = process.env.MIG === "consolidada" ? ["supabase/esquema.sql", "supabase/v3.sql", "supabase/v4_v5_v6_consolidada.sql"] : ["supabase/esquema.sql", "supabase/v3.sql", "supabase/v4.sql", "supabase/v5.sql", "supabase/v6.sql"];
for (const f of files) await db.exec(rd(f));
await db.exec(`grant usage on schema public, auth, storage to authenticated; grant all on all tables in schema public to authenticated; grant all on storage.objects to authenticated;
  grant usage on all sequences in schema public to authenticated; grant execute on function auth.uid() to authenticated;`);
const U = { admin: uid(), ven: uid(), bod: uid(), cli: uid(), cli2: uid() };
const ROL = { admin: "administrador", ven: "vendedor", bod: "bodega", cli: "cliente", cli2: "cliente" };
for (const [k, id] of Object.entries(U)) { await db.query("insert into auth.users(id,email) values($1,$2)", [id, k + "@prueba.test"]); await db.query("update profiles set rol=$2, nombre=$3 where id=$1", [id, ROL[k], "PRUEBA " + k]); }
const as = async (u, sql, p = []) => { await db.query("select set_config('test.uid',$1,false)", [U[u]]); await db.query("set role authenticated"); try { return (await db.query(sql, p)).rows; } finally { await db.query("reset role"); } };
const su = async (sql, p = []) => (await db.query(sql, p)).rows;
const falla = (u, sql, p, re) => assert.rejects(as(u, sql, p), re);
assert.equal((await su("select version_esquema v from config"))[0].v, 6); ok("config.version_esquema = 6");

const ped = (await su("insert into pedidos(codigo,cliente_id,total) values('DP-CHAT1',$1,1000) returning id", [U.cli]))[0].id;
const msg = (u, cli, extra = "", vals = []) => as(u, `insert into mensajes(cliente_id,autor_id,texto${extra ? "," + extra.split("|")[0] : ""}) values($1,$2,$3${extra ? "," + extra.split("|")[1] : ""}) returning id`, [U[cli], U[u], ...vals]).then(r => r[0].id);
// Legacy v3: insertar texto simple sigue funcionando
const m1 = await msg("cli", "cli", "", ["PRUEBA hola"]);
const m2 = await msg("ven", "cli", "responde_a|$4", ["PRUEBA respuesta", m1]); ok("texto legacy y respuesta citada en la misma conversación");
const mo = await msg("cli2", "cli2", "", ["PRUEBA otra tienda"]);
await falla("cli", "insert into mensajes(cliente_id,autor_id,texto,responde_a) values($1,$1,'x',$2)", [U.cli, mo], /row-level security/);
const mp = (await as("cli", "insert into mensajes(cliente_id,pedido_id,autor_id,texto) values($1,$2,$1,'PRUEBA pedido') returning id", [U.cli, ped]))[0].id;
await falla("cli", "insert into mensajes(cliente_id,autor_id,texto,responde_a) values($1,$1,'x',$2)", [U.cli, mp], /row-level security/);
ok("no se puede citar un mensaje de otra tienda ni de otra conversación (pedido vs general)");
await falla("cli", "insert into mensajes(cliente_id,autor_id,texto) values($1,$1,'x')", [U.cli2], /row-level security/);
await falla("cli", "insert into mensajes(cliente_id,autor_id,texto,editado) values($1,$1,'x',now())", [U.cli], /row-level security/);
assert.equal((await as("cli2", "select * from mensajes where cliente_id=$1", [U.cli])).length, 0);
assert.equal((await as("bod", "select * from mensajes where pedido_id is null")).length, 0); ok("aislamiento: otra tienda no lee ni escribe; bodega solo chats de pedido");

// Adjuntos: subir al bucket privado y luego referenciar
const b = (await su("select public, file_size_limit, allowed_mime_types from storage.buckets where id='chat'"))[0];
assert.equal(b.public, false); assert.equal(b.file_size_limit, 10485760); assert.ok(!b.allowed_mime_types.some(t => /svg|html|javascript|xml/.test(t)));
ok("bucket 'chat' privado, 10 MB, sin SVG/HTML/JS");
const ruta = (c, ext) => `${U[c]}/${uid()}.${ext}`;
const r1 = ruta("cli", "jpg"); await as("cli", "insert into storage.objects(bucket_id,name,owner) values('chat',$1,$2)", [r1, U.cli]);
await falla("cli", "insert into storage.objects(bucket_id,name,owner) values('chat',$1,$2)", [ruta("cli2", "jpg"), U.cli], /row-level security/);
await falla("cli", "insert into storage.objects(bucket_id,name,owner) values('chat',$1,$2)", [`${U.cli}/${uid()}.svg`, U.cli], /row-level security/);
await falla("cli", "insert into storage.objects(bucket_id,name,owner) values('chat',$1,$2)", [`${U.cli}/x.html`, U.cli], /row-level security/);
ok("Storage: solo carpeta propia, nombre aleatorio, extensiones permitidas (sin .svg/.html)");
assert.equal((await as("cli", "select * from storage.objects where name=$1", [r1])).length, 1); assert.equal((await as("cli2", "select * from storage.objects where name=$1", [r1])).length, 0); assert.equal((await as("ven", "select * from storage.objects where name=$1", [r1])).length, 0);
ok("objeto aún sin mensaje: solo quien lo subió lo ve (otra tienda y ventas no)");
const ins = (u, c, tipo, r, mime, bytes, extra = "", ev = []) => as(u, `insert into mensajes(cliente_id,autor_id,texto,tipo,adjunto_ruta,adjunto_mime,adjunto_bytes,adjunto_nombre${extra ? "," + extra.split("|")[0] : ""}) values($1,$2,'',$3,$4,$5,$6,'foto.jpg'${extra ? "," + extra.split("|")[1] : ""}) returning id`, [U[c], U[u], tipo, r, mime, bytes, ...ev]).then(x => x[0].id);
await falla("cli", "x", [], /syntax/).catch(() => {});
await assert.rejects(ins("cli", "cli", "imagen", r1, "image/svg+xml", 100), /mensajes_contenido_chk/);
await assert.rejects(ins("cli", "cli", "imagen", r1, "image/jpeg", 10485761), /mensajes_contenido_chk/);
await assert.rejects(ins("cli", "cli", "documento", r1, "image/jpeg", 100), /mensajes_contenido_chk/);
await assert.rejects(ins("cli", "cli", "voz", r1, "audio/webm", 100), /mensajes_contenido_chk/);
await assert.rejects(ins("cli", "cli", "imagen", r1, "image/png", 100), /mensajes_contenido_chk/); await assert.rejects(ins("cli", "cli", "imagen", r1, null, 100), /mensajes_contenido_chk/);
ok("formatos y tamaños: SVG, >10 MB, tipo/mime incoherente y voz sin duración son rechazados");
const ma = await ins("cli", "cli", "imagen", r1, "image/jpeg", 2048);
await assert.rejects(ins("cli", "cli", "imagen", r1, "image/jpeg", 2048), /row-level security/); ok("un archivo solo puede pertenecer a un mensaje");
const r2 = ruta("cli2", "pdf"); await as("cli2", "insert into storage.objects(bucket_id,name,owner) values('chat',$1,$2)", [r2, U.cli2]);
await assert.rejects(ins("cli", "cli", "documento", r2, "application/pdf", 10), /row-level security/); ok("no se puede adjuntar un archivo de otra tienda");
assert.equal((await as("cli", "select * from storage.objects where name=$1", [r1])).length, 1);
assert.equal((await as("ven", "select * from storage.objects where name=$1", [r1])).length, 1);
assert.equal((await as("cli2", "select * from storage.objects where name=$1", [r1])).length, 0);
assert.equal((await as("bod", "select * from storage.objects where name=$1", [r1])).length, 0); ok("lectura/firma del adjunto: dueño y ventas sí; otra tienda y bodega (chat general) no");
const rv = ruta("ven", "webm"); // ventas sube a carpeta de la tienda cliente
const rv2 = `${U.cli}/${uid()}.webm`; await as("ven", "insert into storage.objects(bucket_id,name,owner) values('chat',$1,$2)", [rv2, U.ven]); void rv;
const mv = await ins("ven", "cli", "voz", rv2, "audio/webm", 5000, "voz_seg|$7", [12]); ok("nota de voz de ventas en la conversación de la tienda");

// Reacciones
await as("cli", "insert into mensaje_reacciones(mensaje_id,usuario_id,emoji) values($1,$2,'👍')", [m2, U.cli]);
await as("cli", "update mensaje_reacciones set emoji='❤️' where mensaje_id=$1 and usuario_id=$2", [m2, U.cli]);
await falla("cli", "insert into mensaje_reacciones(mensaje_id,usuario_id,emoji) values($1,$2,'💩')", [m1, U.cli], /check/);
await falla("cli2", "insert into mensaje_reacciones(mensaje_id,usuario_id,emoji) values($1,$2,'👍')", [m2, U.cli2], /row-level security/);
await falla("cli", "insert into mensaje_reacciones(mensaje_id,usuario_id,emoji) values($1,$2,'👍')", [m1, U.ven], /row-level security/);
assert.equal((await as("cli2", "select * from mensaje_reacciones")).length, 0);
assert.equal((await as("ven", "select emoji from mensaje_reacciones where mensaje_id=$1", [m2]))[0].emoji, "❤️");
assert.equal((await su("select cliente_id from mensaje_reacciones"))[0].cliente_id, U.cli); ok("reacciones: una por persona, conjunto cerrado, aisladas por tienda");

// Edición y eliminación con tombstone + auditoría
await as("cli", "select editar_mensaje($1,'PRUEBA hola editado')", [m1]);
await falla("ven", "select editar_mensaje($1,'x')", [m1], /No autorizado/);
await falla("cli", "select editar_mensaje($1,'x')", [ma], /Solo se edita texto/);
await su("update mensajes set creado=now()-interval '20 minutes' where id=$1", [m1]);
await falla("cli", "select editar_mensaje($1,'tarde')", [m1], /15 minutos/);
await falla("cli", "update mensajes set texto='x' where id=$1 returning id", [m1], /./).catch(() => {});
assert.equal((await su("select texto from mensajes where id=$1", [m1]))[0].texto, "PRUEBA hola editado"); ok("edición: solo autor, solo texto, 15 min; UPDATE directo no tiene efecto");
await falla("cli2", "select eliminar_mensaje($1)", [ma], /No autorizado/);
await falla("ven", "select eliminar_mensaje($1)", [ma], /Solo el autor/);
await as("cli", "select eliminar_mensaje($1)", [ma]); await as("cli", "select eliminar_mensaje($1)", [ma]);
const t = (await su("select texto, eliminado, adjunto_ruta from mensajes where id=$1", [ma]))[0];
assert.equal(t.texto, ""); assert.ok(t.eliminado); assert.equal((await as("ven", "select * from storage.objects where name=$1", [r1])).length, 0);
assert.equal((await as("cli", "delete from storage.objects where name=$1 returning name", [r1])).length, 0);
assert.equal((await su("select count(*)::int c from storage.objects where name=$1", [r1]))[0].c, 1);
assert.equal((await as("admin", "select accion from mensajes_historial order by id")).map(x => x.accion).join(), "edicion,eliminacion");
assert.equal((await as("cli", "select * from mensajes_historial")).length, 0);
await as("admin", "select eliminar_mensaje($1)", [m2]); assert.equal((await su("select count(*)::int c from mensaje_reacciones where mensaje_id=$1", [m2]))[0].c, 0);
ok("eliminar para todos = tombstone idempotente; adjunto deja de firmarse pero no se borra; historial solo admin; admin modera");

// Lecturas con evidencia real
await falla("cli2", "select marcar_leido($1,null,$2)", [U.cli, m1], /No autorizado/);
await falla("cli", "select marcar_leido($1,null,$2)", [U.cli, mp], /inválido/);
await as("cli", "select marcar_leido($1,null,$2)", [U.cli, mv]); await as("cli", "select marcar_leido($1,null,$2)", [U.cli, m1]);
assert.equal((await as("ven", "select ultimo_id from chat_lecturas where cliente_id=$1", [U.cli]))[0].ultimo_id, mv);
assert.equal((await as("cli2", "select * from chat_lecturas")).length, 0);
await falla("cli", "insert into chat_lecturas(usuario_id,cliente_id,conv,ultimo_id) values($1,$1,'general',999999)", [U.cli], /row-level security/);
ok("leído: solo vía marcar_leido al abrir la conversación, no retrocede, no se falsifica por INSERT, aislado");

// Huérfanos: solo objetos sin referencia y antiguos
const rh = ruta("cli", "png"); await as("cli", "insert into storage.objects(bucket_id,name,owner,created_at) values('chat',$1,$2,now()-interval '2 days')", [rh, U.cli]);
const hu = (await as("admin", "select chat_huerfanos() h")).map(x => x.h);
assert.ok(hu.includes(rh) && hu.includes(r2) === false && !hu.includes(r1) && !hu.includes(rv2));
assert.equal((await as("ven", "select chat_huerfanos()")).length, 0);
assert.equal((await as("admin", "delete from storage.objects where name=any($1) returning name", [[rh, r1, rv2]])).map(x => x.name).join(), rh);
ok("limpieza: solo huérfanos >24 h; nunca borra adjuntos referenciados ni auditados");

// Paginación keyset usa índice de conversación
await su("set enable_seqscan=off"); const plan = (await su("explain select * from mensajes where cliente_id=$1 and pedido_id is null and id < 1000000 order by id desc limit 30", [U.cli])).map(x => x["QUERY PLAN"]).join("\n");
await su("set enable_seqscan=on"); assert.match(plan, /mensajes_conv_idx/); ok("paginación por conversación usa mensajes_conv_idx");

// Idempotencia y reversión
const antes = (await su("select count(*)::int c from mensajes"))[0].c;
await db.exec(rd("supabase/v6.sql")); assert.equal((await su("select count(*)::int c from mensajes"))[0].c, antes); ok("v6 se puede aplicar dos veces sin perder datos");
await db.exec(rd("supabase/v6_revertir.sql"));
assert.equal((await su("select count(*)::int c from mensajes"))[0].c, antes);
assert.equal((await su("select texto from mensajes where id=$1", [ma]))[0].texto, "[mensaje eliminado]");
assert.equal((await su("select version_esquema v from config"))[0].v, 5);
await as("cli", "insert into mensajes(cliente_id,autor_id,texto) values($1,$1,'PRUEBA tras revertir')", [U.cli]);
await db.exec(rd("supabase/v6.sql")); assert.equal((await su("select version_esquema v from config"))[0].v, 6); ok("reversión conserva mensajes (tombstones como texto), vuelve a v5, chat v3 funciona; reaplicar v6 funciona");
console.log(`\n${n} pruebas v6 OK (PGlite, no Supabase real)`); await db.close();
