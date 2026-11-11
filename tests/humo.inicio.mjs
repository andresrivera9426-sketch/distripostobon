// Prueba de Inicio optimizado en Chrome headless con Supabase FALSO (datos ficticios). No prueba Supabase real ni un teléfono.
// Uso: NODE_PATH=<node_modules con puppeteer-core> node tests/humo.inicio.mjs
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const puppeteer = createRequire(import.meta.url)("puppeteer-core");
const raiz = path.resolve(new URL("..", import.meta.url).pathname);
const T = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(raiz, u === "/" ? "index.html" : u);
  if (!f.startsWith(raiz) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); }).listen(0);
const base = `http://127.0.0.1:${srv.address().port}/`;
const REF = JSON.parse(fs.readFileSync(path.join(raiz, "portafolio.json"), "utf8")).productos;
// Variante del mock: agrega un EJEMPLO activo; "activado" agrega una referencia del portafolio ya activa con precio y stock; "anon" sin sesión.
function mock(v) {
  let m = fs.readFileSync(path.join(raiz, "tests/supabase_mock.js"), "utf8");
  const extra = [`{ ...P1, id: "pe", nombre: "EJEMPLO · Agua 600 ml", categoria: "Aguas" }`];
  if (v.activado) extra.push(`{ ...P1, id: "pa", nombre: ${JSON.stringify(REF[0].nombre)}, categoria: ${JSON.stringify(REF[0].categoria)}, presentacion: ${JSON.stringify(REF[0].presentacion)}, foto_url: ${JSON.stringify(REF[0].imagen)}, precio: 16800, stock: 10 }`);
  m = m.replace("productos: [P1, P2]", `productos: [P1, P2, ${extra.join(", ")}]`);
  if (v.anon) m = m.replace("getSession: async () => ({ data: { session: sess } })", "getSession: async () => ({ data: { session: null } })");
  return m;
}
const br = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true });
const esp = ms => new Promise(r => setTimeout(r, ms)); let n = 0, fallos = 0;
const ok = (c, m) => { n++; if (!c) fallos++; console.log(c ? "✓" : "✗", m); };
async function abrir(v, vp = { width: 390, height: 844, isMobile: true, hasTouch: true }, ruta = "#/") {
  const ctx = await br.createBrowserContext(); const pg = await ctx.newPage(); pg.errs = []; await pg.setViewport(vp);
  pg.on("pageerror", e => pg.errs.push(e.message)); pg.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) pg.errs.push(m.text()); });
  await pg.setRequestInterception(true); const body = mock(v);
  pg.on("request", r => { const u = r.url(); if (u.includes("supabase-js")) return r.respond({ status: 200, contentType: "text/javascript", body }); if (!u.startsWith(base)) return r.abort(); if (u.endsWith("sw.js")) return r.respond({ status: 404, body: "" }); r.continue(); });
  await pg.goto(base + "?rol=" + (v.rol || "cliente") + (v.esq ? "&esquema=" + v.esq : "") + ruta, { waitUntil: "networkidle0" }); await esp(500); return { pg, ctx };
}
const txt = pg => pg.$eval("#app", e => e.innerText);

// 1) Visitante sin sesión, móvil
let { pg, ctx } = await abrir({ anon: true });
let t = await txt(pg);
ok(!t.includes("EJEMPLO"), "visitante: los productos EJEMPLO no se muestran");
ok(t.includes("PRUEBA Gaseosa") && t.includes("Precio a consultar"), "visitante: Inicio muestra productos reales y el portafolio con «Precio a consultar»");
const secs = await pg.$$eval(".catsec .sech h3", h => h.map(x => x.innerText.split("\n")[0].replace(/\s*\d+$/, "")));
ok(secs[0] === "Gaseosas" && secs.includes("Aguas") && secs.length >= 10, "Inicio organizado por categorías (" + secs.length + "): " + secs.slice(0, 4).join(", "));
ok(await pg.$eval("#nav", e => e.innerText.trim() === ""), "sin botón «Entrar» duplicado en el encabezado del móvil");
ok((await pg.$$eval("#tabs a", a => a.map(x => x.innerText.replace(/\s+/g, " ").trim()))).join("|").includes("Carrito"), "pestañas del visitante incluyen Carrito");
const vis = await pg.$$eval("#app .prod", l => l.filter(e => { const r = e.getBoundingClientRect(); return r.top < innerHeight - 70 && r.bottom > 0 && r.left < innerWidth; }).length);
ok(vis >= 2, "productos visibles en la primera pantalla del móvil (" + vis + ")");
ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "sin desborde horizontal a 390 px");
ok(await pg.evaluate(() => __tablas.filter(x => x === "productos").length === 1), "una sola consulta a productos al abrir Inicio (" + await pg.evaluate(() => __tablas.filter(x => x === "productos").length) + ")");
const sinLazy = await pg.$$eval("#app img", l => l.filter((i, k) => k >= 4 && i.loading !== "lazy").length); ok(sinLazy === 0, "imágenes fuera de la primera fila con carga diferida");
const rutas = await pg.$$eval("#app img", l => [...new Set(l.map(i => new URL(i.src).pathname))]);
const malas = []; for (const p of rutas) { const r = await pg.evaluate(async u => (await fetch(u)).status, p); if (r !== 200) malas.push(p); }
ok(rutas.length > 5 && !malas.length, `todas las imágenes del Inicio existen en el paquete (${rutas.length} distintas)` + (malas.length ? " faltan: " + malas.join(",") : ""));
// categoría -> grilla paginada
await pg.evaluate(() => [...document.querySelectorAll(".cats .cat")].find(b => b.dataset.c === "Gaseosas").click()); await esp(200);
let c1 = await pg.$$eval("#grid .prod", l => l.length); ok(c1 === 24 && !!(await pg.$("#grid .mas")), "categoría con muchas referencias: primera página de 24 + «Ver más» (" + c1 + ")");
await pg.click("#grid .mas"); await esp(200); let c2 = await pg.$$eval("#grid .prod", l => l.length);
const totalG = REF.filter(p => p.categoria === "Gaseosas").length + 1; ok(c2 === Math.min(48, totalG), `«Ver más» agrega la siguiente página (${c2} de ${totalG})`);
// búsqueda sin tildes
await pg.evaluate(() => [...document.querySelectorAll(".cats .cat")].find(b => b.dataset.c === "Todo").click()); await pg.type("#q", "te hatsu"); await esp(400);
t = await txt(pg); const cn = await pg.$$eval("#grid .prod", l => l.length); ok(cn > 0 && cn < 60 && /té/i.test(t), "búsqueda «te hatsu» filtra (" + cn + ")");
ok(!pg.errs.length, "visitante: sin errores JS " + pg.errs.join(" | ")); await ctx.close();

// 2) Tienda con sesión: agregar al carrito sin repintar todo; EJEMPLO fuera del carrito
({ pg, ctx } = await abrir({ rol: "cliente" }));
await pg.evaluate(() => window.scrollTo(0, 300)); const y0 = await pg.evaluate(() => scrollY);
await pg.click('[data-pid="p1"] button[data-p]'); await esp(150);
ok(await pg.$eval('[data-pid="p1"] .qty span', e => e.textContent === "1") && !(await pg.$eval("#bar", e => e.classList.contains("hidden"))), "Agregar actualiza la tarjeta y muestra la barra del carrito");
ok(Math.abs(await pg.evaluate(() => scrollY) - y0) < 5, "agregar no mueve la pantalla");
await pg.evaluate(() => { S.carrito.pe = 1; guardarCarrito(); location.hash = "#/carrito"; }); await esp(500);
t = await txt(pg); ok(!t.includes("EJEMPLO") && t.includes("PRUEBA Gaseosa"), "carrito descarta productos EJEMPLO y conserva los reales");
ok(!pg.errs.length, "tienda: sin errores JS " + pg.errs.join(" | ")); await ctx.close();

// 3) Escenario «portafolio activado»: la referencia activa aparece una sola vez y se puede pedir
({ pg, ctx } = await abrir({ rol: "cliente", activado: true }, { width: 1366, height: 768 }));
await pg.type("#q", "Agua Cristal Pet 300"); await esp(400);
const tarjetas = await pg.$$eval("#grid .prod", l => l.map(e => [e.querySelector("h3").innerText, !!e.querySelector("button[data-p]"), e.innerText.includes("Precio a consultar")]));
const mismo = tarjetas.filter(x => x[0] === REF[0].nombre);
ok(mismo.length === 1 && mismo[0][1] && !mismo[0][2], "referencia activada: una sola tarjeta, con precio y botón Agregar");
ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "sin desborde horizontal a 1366 px");
ok(!pg.errs.length, "activado: sin errores JS " + pg.errs.join(" | ")); await ctx.close();

// 4) Ruta #/portafolio paginada (antes pintaba 201 filas de golpe)
({ pg, ctx } = await abrir({ rol: "cliente" }, undefined, "#/portafolio"));
ok((await pg.$$eval("#pl .prod", l => l.length)) === 24 && !!(await pg.$("#pl .mas")), "portafolio: primera página de 24 tarjetas");
ok(!pg.errs.length, "portafolio: sin errores JS " + pg.errs.join(" | ")); await ctx.close();

// 5) Personal: esquema 5 sigue con chat básico (v6 apagado)
({ pg, ctx } = await abrir({ rol: "administrador", esq: 5 }, undefined, "#/pedido/DP-PRUEB"));
ok(!(await pg.$("#cMic")) && !!(await pg.$("#fs")), "esquema 5: chat v6 sigue apagado (chat básico)"); await ctx.close();

await br.close(); srv.close(); console.log(fallos ? `\n${fallos} de ${n} fallaron` : `\n${n} verificaciones OK (Supabase falso)`); process.exit(fallos ? 1 : 0);
