// Prueba de humo en Chrome headless con Supabase FALSO (tests/supabase_mock.js). Verifica que las pantallas rendericen sin errores.
// No prueba Supabase real. Uso: NODE_PATH=<node_modules con puppeteer-core> CHROME=/usr/bin/google-chrome node tests/humo.navegador.mjs
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const puppeteer = createRequire(import.meta.url)("puppeteer-core");
const raiz = path.resolve(new URL("..", import.meta.url).pathname), mock = fs.readFileSync(path.join(raiz, "tests/supabase_mock.js"), "utf8");
const srv = http.createServer((q, r) => { const f = path.join(raiz, decodeURIComponent(q.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(q.url.split("?")[0]));
  if (!f.startsWith(raiz) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); }).listen(0);
const base = `http://127.0.0.1:${srv.address().port}/`;
const br = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
const casos = [
  ["administrador", "#/admin/tablero", "Pendientes por atender"], ["administrador", "#/admin/inventario", "Lotes y vencimientos"], ["administrador", "#/admin/comercial", "Zonas y días de entrega"],
  ["administrador", "#/admin/cartera", "Por cobrar"], ["administrador", "#/admin/cierre", "Cerrar día"], ["administrador", "#/pedido/DP-PRUEB", "Registrar devolución"],
  ["vendedor", "#/pedido/DP-PRUEB", "Registrar abono"], ["cliente", "#/", "PRUEBA Gaseosa"], ["cliente", "#/carrito", "Forma de pago"], ["cliente", "#/perfil", "Mi cuenta"], ["cliente", "#/pedido/DP-PRUEB", "Saldo"]];
let fallos = 0;
for (const [rol, ruta, txt] of casos) {
  const ctx = await br.createBrowserContext(); const pg = await ctx.newPage(); const errs = [];
  pg.on("pageerror", e => errs.push(e.message)); pg.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
  await pg.setRequestInterception(true);
  pg.on("request", r => { const u = r.url(); if (u.includes("supabase-js")) return r.respond({ status: 200, contentType: "text/javascript", body: mock }); if (!u.startsWith(base)) return r.abort(); if (u.endsWith("sw.js")) return r.respond({ status: 404, body: "" }); r.continue(); });
  await pg.evaluateOnNewDocument(() => localStorage.setItem("dp_carrito", JSON.stringify({ p1: 10 })));
  await pg.goto(base + "?rol=" + rol + ruta, { waitUntil: "networkidle0" }); await new Promise(r => setTimeout(r, 600));
  const html = await pg.$eval("#app", e => e.innerText);
  const ok = html.includes(txt) && !html.includes("Algo falló") && !errs.length;
  if (rol === "vendedor") { await pg.type("#fab input[name=v]", "5.000"); await pg.click("#fab button"); await new Promise(r => setTimeout(r, 300));
    const c = (await pg.evaluate(() => __llamadas)).find(x => x[1] === "registrar_abono"); if (!c || c[2].p_valor !== 5000 || !/^[0-9a-f-]{36}$/.test(c[2].p_idem)) errs.push("abono no enviado bien: " + JSON.stringify(c)); }
  if (rol === "cliente" && ruta === "#/carrito") { await pg.select("#cond", "credito"); await pg.click("#enviar"); await new Promise(r => setTimeout(r, 300));
    const c = (await pg.evaluate(() => __llamadas)).find(x => x[1] === "crear_pedido"); if (!c || c[2].p_condicion !== "credito") errs.push("crear_pedido sin crédito: " + JSON.stringify(c)); }
  if (rol === "cliente" && ruta === "#/carrito" && !html.includes("$162.000")) { errs.push("total carrito esperado $162.000 (10 × 18.000 −10%)"); }
  console.log((ok && !errs.length ? "✓" : "✗"), rol, ruta, errs.join(" | ")); if (!ok || errs.length) { fallos++; console.log(html.slice(0, 400)); }
  await ctx.close();
}
await br.close(); srv.close(); console.log(fallos ? `\n${fallos} fallo(s)` : `\n${casos.length} pantallas OK (Supabase falso)`); process.exit(fallos ? 1 : 0);
