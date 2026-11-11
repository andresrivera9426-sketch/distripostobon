// Navegación simple por rol y número de toques para las tareas clave, en Chrome headless con Supabase FALSO (datos ficticios).
// No prueba Supabase real ni un teléfono. Uso: NODE_PATH=<node_modules con puppeteer-core> node tests/humo.roles.mjs
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const puppeteer = createRequire(import.meta.url)("puppeteer-core");
const raiz = path.resolve(new URL("..", import.meta.url).pathname);
const T = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(raiz, u === "/" ? "index.html" : u);
  if (!f.startsWith(raiz) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); }).listen(0);
const base = `http://127.0.0.1:${srv.address().port}/`;
const mock = anon => { const m = fs.readFileSync(path.join(raiz, "tests/supabase_mock.js"), "utf8"); return anon ? m.replace("getSession: async () => ({ data: { session: sess } })", "getSession: async () => ({ data: { session: null } })") : m; };
const br = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true });
const esp = ms => new Promise(r => setTimeout(r, ms)); let n = 0, fallos = 0;
const ok = (c, m) => { n++; if (!c) fallos++; console.log(c ? "✓" : "✗", m); };
const MOVIL = { width: 390, height: 844, isMobile: true, hasTouch: true }, PC = { width: 1366, height: 768 };
async function abrir({ rol = "cliente", anon = false, ruta = "#/", esq = "5", extra = "", vp = MOVIL, ls = {} } = {}) {
  const ctx = await br.createBrowserContext(); const pg = await ctx.newPage(); pg.errs = []; pg.toques = 0; await pg.setViewport(vp);
  pg.on("pageerror", e => pg.errs.push(e.message)); pg.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) pg.errs.push(m.text()); });
  await pg.setRequestInterception(true); const body = mock(anon);
  pg.on("request", r => { const u = r.url(); if (u.includes("supabase-js")) return r.respond({ status: 200, contentType: "text/javascript", body }); if (!u.startsWith(base)) return r.abort(); if (u.endsWith("sw.js")) return r.respond({ status: 404, body: "" }); r.continue(); });
  await pg.evaluateOnNewDocument(l => { for (const [k, v] of Object.entries(l)) localStorage.setItem("dp_" + k, JSON.stringify(v)); }, ls);
  await pg.goto(base + "?rol=" + rol + "&esquema=" + esq + extra + ruta, { waitUntil: "networkidle0" }); await esp(400);
  pg.toca = async sel => { const h = typeof sel === "string" ? await pg.waitForSelector(sel, { visible: true, timeout: 5000 }) : sel; await h.click(); pg.toques++; await esp(450); };
  pg.tab = txt => pg.evaluateHandle(t => [...document.querySelectorAll("#tabs a")].find(a => a.innerText.includes(t)), txt).then(h => pg.toca(h));
  return { pg, ctx };
}
const tabs = pg => pg.$$eval("#tabs a", l => l.map(a => a.querySelector("span").innerText.trim()));
const txt = pg => pg.$eval("#app", e => e.innerText);
const hash = pg => pg.evaluate(() => location.hash);
// Botones, campos y pestañas de menos de 44 px (se excluyen enlaces dentro de un texto y casillas de verificación).
const chicos = pg => pg.evaluate(() => [...document.querySelectorAll("#app button,#app .btn,#app select,#app input:not([type=checkbox]):not([type=hidden]),#app .cat,#tabs a,.bar .btn")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth && (r.height < 44 || r.width < 44); }).map(e => e.tagName + "." + e.className + ":" + e.innerText.slice(0, 15)));

// ===== Visitante =====
let { pg, ctx } = await abrir({ anon: true });
ok(JSON.stringify(await tabs(pg)) === '["Inicio","Carrito","Entrar"]', "visitante: 3 pestañas Inicio · Carrito · Entrar");
ok(await pg.$$eval(".hero2 .collage img", l => l.length === 5 && l.every(i => i.complete && i.naturalWidth > 0)), "portada: collage con 5 fotos oficiales cargadas");
ok(await pg.$eval(".hero2 h1", e => e.innerText.includes("Surte tu tienda")) && !!await pg.$(".hero2 #q"), "portada: propuesta de valor y buscador dentro de la portada");
ok((await pg.$$(".trust li")).length === 3, "portada: franja de confianza (entrega, chat/WhatsApp, seguimiento)");
await pg.evaluate(async () => { const t = document.querySelector(".cats.tiles"); for (let x = 0; x <= t.scrollWidth; x += 200) { t.scrollLeft = x; await new Promise(r => setTimeout(r, 40)); } t.scrollLeft = 0; }); await esp(500);
ok(await pg.$$eval(".cats.tiles .cat .ti img", l => l.length >= 10 && l.every(i => i.complete && i.naturalWidth > 0)), "portada: mosaicos de categoría con foto");
ok(await pg.$$eval("#dest .prod", l => l.length >= 4), "portada: fila «Destacados»");
ok((await chicos(pg)).length === 0, "visitante Inicio: todos los toques ≥ 44 px " + (await chicos(pg)).slice(0, 3).join(" "));
await pg.toca("#q"); await pg.keyboard.type("pepsi"); await esp(400);
ok(pg.toques === 1 && (await txt(pg)).toLowerCase().includes("pepsi"), "buscar un producto: 1 toque + escribir");
await pg.evaluate(() => { const q = document.querySelector("#q"); q.value = ""; q.dispatchEvent(new Event("input")); }); await esp(400); pg.toques = 0;
await pg.toca('[data-pid="p1"] button[data-p]');
ok(pg.toques === 1 && await pg.$eval(".cartTab .badge", b => b.innerText === "1") && await pg.$eval("#bar", b => !b.classList.contains("hidden")), "agregar al carrito: 1 toque; la pestaña Carrito muestra 1 y aparece la barra con el total");
ok(await pg.$eval("#barT", b => b.innerText === "$20.000"), "barra del carrito con el total correcto ($20.000)");
await pg.toca("#bar .btn"); ok(pg.toques === 2 && (await hash(pg)) === "#/carrito", "ver carrito: 1 toque más desde la barra");
await pg.goto(base + "?rol=cliente&esquema=5#/", { waitUntil: "networkidle0" }); await esp(300); pg.toques = 0;
await pg.toca('.hero2 a[href="#/entrar/registro"]');
ok(pg.toques === 1 && (await pg.$$("#f input:not([type=checkbox])")).length === 6 && (await pg.$$eval(".paso", l => l.length)) === 2, "inscribir tienda: 1 toque a un formulario en 2 pasos (6 campos)");
ok(await pg.$eval(".authb h1", e => e.innerText === "Inscribe tu tienda") && (await pg.$$(".authb .benef li")).length === 3, "registro: tarjeta de marca con beneficios");
pg.toques = 0; await pg.tab("Entrar"); ok(pg.toques === 1 && (await txt(pg)).includes("¡Hola de nuevo!") && !!await pg.$('a[href="#/entrar/registro"]'), "entrar: 1 toque; enlace para inscribirse");
ok((await chicos(pg)).length === 0, "pantalla Entrar: toques ≥ 44 px " + (await chicos(pg)).join(" "));
ok(await pg.evaluate(() => { const b = document.querySelector("#hBus"), m = document.querySelector(".top .marca"); const r = b && b.getBoundingClientRect(); return !!m && r && r.width >= 44 && r.height >= 44 && b.getAttribute("aria-label") === "Buscar productos"; }), "encabezado: marca propia y botón de búsqueda ≥ 44 px");
ok(!pg.errs.length, "visitante sin errores de JavaScript " + pg.errs.join(" | ")); await ctx.close();
// Modo oscuro
({ pg, ctx } = await abrir({ anon: true, ls: { tema: "oscuro" } }));
ok(await pg.evaluate(() => (() => { const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (r * 299 + g * 587 + b * 114) / 1000; }; return lum(getComputedStyle(document.body).backgroundColor) < 40 && lum(getComputedStyle(document.querySelector(".trust li")).backgroundColor) < 60; })() && !!document.querySelector(".hero2")), "modo oscuro: portada, franja y fondo oscuros");
await pg.screenshot({ path: "/tmp/humo-roles-oscuro.png" }); ok(!pg.errs.length, "modo oscuro sin errores"); await ctx.close();
// Escritorio
({ pg, ctx } = await abrir({ anon: true, vp: PC }));
ok(await pg.evaluate(() => { const t = document.querySelector("#tabs").getBoundingClientRect(), c = document.querySelector(".hero2 .collage").getBoundingClientRect(), h = document.querySelector(".hero2 h1").getBoundingClientRect(); return t.top < 60 && c.left > h.right - 10 && document.documentElement.scrollWidth <= innerWidth; }), "escritorio: pestañas arriba y collage a la derecha del título, sin desborde");
await ctx.close();

// ===== Tienda =====
({ pg, ctx } = await abrir({ ls: { carrito: { p1: 2 } } }));
ok(JSON.stringify(await tabs(pg)) === '["Inicio","Carrito","Pedidos","Chat","Cuenta"]', "tienda: 5 pestañas Inicio · Carrito · Pedidos · Chat · Cuenta");
ok(await pg.evaluate(() => { const a = document.querySelector(".top .avatar"), r = a && a.getBoundingClientRect(); return !!a && /^[A-Z]{1,2}$/.test(a.innerText.trim()) && r.width >= 44 && r.height >= 44 && a.getAttribute("href") === "#/perfil"; }), "encabezado con sesión: avatar con iniciales ≥ 44 px que abre Mi cuenta");
await pg.click("#hBus"); await new Promise(r => setTimeout(r, 300));
ok(await pg.evaluate(() => document.activeElement && document.activeElement.id === "q"), "encabezado: el botón de búsqueda lleva el foco al buscador");
ok(await pg.$eval(".cartTab .badge", b => b.innerText === "2") && await pg.$eval("#barT", b => b.innerText === "$36.000"), "tienda: contador del carrito (2) y total en la barra con su precio de tienda ($36.000)");
ok((await chicos(pg)).length === 0, "tienda Inicio: toques ≥ 44 px " + (await chicos(pg)).slice(0, 3).join(" "));
await ctx.close(); ({ pg, ctx } = await abrir()); pg.toques = 0;
await pg.toca("#repUltH"); ok(pg.toques === 1 && (await hash(pg)) === "#/carrito" && (await txt(pg)).includes("PRUEBA Gaseosa"), "repetir último pedido: 1 toque desde Inicio lleva al carrito lleno");
await pg.toca("#enviar"); ok(pg.toques === 2 && (await txt(pg)).includes("¡Pedido enviado!") && await pg.evaluate(() => __llamadas.some(l => l[1] === "crear_pedido")), "repetir y enviar: 2 toques en total");
pg.toques = 0; await pg.tab("Pedidos"); ok(pg.toques === 1 && (await txt(pg)).includes("Mis pedidos"), "mis pedidos: 1 toque");
await pg.tab("Carrito"); ok((await hash(pg)) === "#/carrito", "carrito a 1 toque desde cualquier pantalla");
ok(await pg.evaluate(() => ![...document.scripts].some(s => /chat\.js/.test(s.src))), "chat.js no se descarga sin usar el chat (base v5)");
await pg.tab("Chat"); ok((await txt(pg)).includes("Chat con ventas") && await pg.evaluate(() => !window.DPChat && ![...document.scripts].some(s => /chat\.js/.test(s.src))), "base v5: la tienda usa el chat básico y no descarga el chat v6");
ok(!pg.errs.length, "tienda sin errores de JavaScript " + pg.errs.join(" | ")); await ctx.close();
({ pg, ctx } = await abrir({ extra: "&pedido=" + encodeURIComponent("En ruta") }));
await pg.toca('.accb[href="#/pedido/DP-PRUEB"]'); ok(pg.toques === 1 && (await txt(pg)).includes("Chat de este pedido") && (await txt(pg)).includes("En ruta"), "seguir pedido en curso: 1 toque desde Inicio");
await ctx.close();
({ pg, ctx } = await abrir({ esq: "6", ruta: "#/chat" }));
ok(await pg.evaluate(() => !!window.DPChat), "base v6: el chat mejorado se descarga al abrir el chat"); await ctx.close();

// ===== Vendedor y bodega =====
for (const [r, esper] of [["vendedor", '["Pedidos","Chats","Catálogo","Cuenta"]'], ["bodega", '["Pedidos","Catálogo","Cuenta"]']]) {
  ({ pg, ctx } = await abrir({ rol: r }));
  ok((await hash(pg)).startsWith("#/panel") && JSON.stringify(await tabs(pg)) === esper, `${r}: entra a Pedidos; pestañas ${JSON.parse(esper).join(" · ")}`);
  ok((await chicos(pg)).length === 0, `${r} Pedidos: toques ≥ 44 px ` + (await chicos(pg)).slice(0, 3).join(" "));
  pg.toques = 0; await pg.tab("Catálogo"); ok(pg.toques === 1 && (await hash(pg)) === "#/catalogo" && (await txt(pg)).includes("Estás viendo el catálogo como") && !(await pg.$("#app button[data-p]")), `${r}: catálogo a 1 toque (antes 2: Perfil → Ver catálogo), sin botones de compra`);
  ok(await pg.$eval('#tabs a[href="#/catalogo"]', a => a.classList.contains("on")), `${r}: pestaña Catálogo marcada`);
  await pg.goto(base + "?rol=" + r + "&esquema=5#/mas", { waitUntil: "networkidle0" }); await esp(300);
  ok((await hash(pg)).startsWith("#/panel"), `${r}: «Más» de administración no disponible`);
  ok(!pg.errs.length, `${r} sin errores ` + pg.errs.join(" | ")); await ctx.close();
}

// ===== Administrador =====
({ pg, ctx } = await abrir({ rol: "administrador" }));
ok(JSON.stringify(await tabs(pg)) === '["Pedidos","Chats","Resumen","Más","Cuenta"]', "administrador: 5 pestañas Pedidos · Chats · Resumen · Más · Cuenta");
pg.toques = 0; await pg.tab("Resumen"); ok(pg.toques === 1 && (await txt(pg)).includes("Pendientes por atender") && !(await pg.$("#app .cats a.cat[href^='#/admin/']")), "reportes: 1 toque a Resumen (sin la fila de 11 pestañas)");
ok(await pg.evaluate(() => innerWidth === 390 && document.documentElement.scrollWidth === 390), "Resumen cabe en 390 px (antes el gráfico lo ensanchaba a 448 px)");
await pg.tab("Más"); const mods = await pg.$$eval(".tilesm .mod", l => l.map(x => x.querySelector("b").innerText));
ok(mods.length === 12 && mods.includes("Cobros y abonos") && mods.includes("Inventario") && mods.includes("Productos y precios"), "Más: 12 mosaicos grandes (" + mods.length + ")");
ok(await pg.$$eval(".tilesm .mod", l => l.every(e => e.getBoundingClientRect().height >= 100)), "Más: mosaicos de al menos 100 px de alto");
const ESPERA = { productos: "Importar", inventario: "Lotes y vencimientos", cartera: "Por cobrar", cierre: "Cerrar día", comercial: "Zonas y días de entrega", clientes: "tienda(s) inscritas", usuarios: "", banners: "", ajustes: "Pedido mínimo", estado: "Esquema de base de datos: v5" };
for (const [k, frase] of Object.entries(ESPERA)) {
  await pg.goto(base + "?rol=administrador&esquema=5#/mas", { waitUntil: "networkidle0" }); await esp(250); pg.toques = 0;
  await pg.toca(`.tilesm a[href="#/admin/${k}"]`); const t = await txt(pg);
  ok(pg.toques === 1 && t.includes(frase) && t.includes("← Más") && await pg.$eval('#tabs a[href="#/mas"]', a => a.classList.contains("on")), `Más → ${k}: 1 toque, con «← Más» y pestaña Más marcada`);
}
await pg.toca("a.back"); ok((await hash(pg)) === "#/mas", "«← Más» vuelve a los mosaicos");
pg.toques = 0; await pg.toca('.tilesm a[href="#/catalogo"]'); ok(pg.toques === 1 && (await txt(pg)).includes("Estás viendo el catálogo"), "administrador: catálogo desde Más");
await pg.goto(base + "?rol=administrador&esquema=5#/pedido/DP-PRUEB", { waitUntil: "networkidle0" }); await esp(500);
ok((await txt(pg)).includes("pendiente de activación") && await pg.evaluate(() => !!window.DPChat), "base v5: el administrador ve el aviso del chat v6 pendiente (chat.js cargado bajo demanda)");
await pg.goto(base + "?rol=administrador&esquema=5#/admin/productos", { waitUntil: "networkidle0" }); await esp(400);
ok(await pg.evaluate(() => !!window.DPImport), "importación de productos se carga al abrir Productos");
ok(!pg.errs.length, "administrador sin errores " + pg.errs.join(" | ")); await ctx.close();
({ pg, ctx } = await abrir({ rol: "administrador", vp: PC, ruta: "#/mas" }));
ok(await pg.evaluate(() => document.querySelectorAll("#tabs a").length === 5 && document.querySelector("#tabs").getBoundingClientRect().top < 60 && document.documentElement.scrollWidth <= innerWidth), "escritorio: 5 pestañas en el encabezado sin desborde"); await ctx.close();

await br.close(); srv.close();
const hechas = n; console.log(`\n${fallos ? fallos + " de " + hechas + " fallaron" : hechas + " comprobaciones de navegación por rol OK (Supabase falso)"}`); process.exit(fallos ? 1 : 0);
