// Prueba de humo del chat v6 en Chrome headless con Supabase FALSO y micrófono FALSO de Chrome (no es un teléfono real, no es Supabase real).
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const puppeteer = createRequire(import.meta.url)("puppeteer-core");
const raiz = path.resolve(new URL("..", import.meta.url).pathname), mock = fs.readFileSync(path.join(raiz, "tests/supabase_mock.js"), "utf8");
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]), f = path.join(raiz, u === "/" ? "index.html" : u);
  if (!f.startsWith(raiz) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" }[path.extname(f)] || "application/octet-stream" }); r.end(fs.readFileSync(f)); }).listen(0);
const base = `http://127.0.0.1:${srv.address().port}/`;
const br = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const esp = ms => new Promise(r => setTimeout(r, ms)); let n = 0, fallos = 0;
const ok = (c, m) => { n++; if (!c) fallos++; console.log(c ? "✓" : "✗", m); };
async function abrir(rol, esq, ruta = "#/pedido/DP-PRUEB") {
  const ctx = await br.createBrowserContext(); const pg = await ctx.newPage(); pg.errs = [];
  await pg.setViewport({ width: 375, height: 760, isMobile: true, hasTouch: true });
  pg.on("pageerror", e => pg.errs.push(e.message)); pg.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) pg.errs.push(m.text()); });
  await pg.setRequestInterception(true);
  pg.on("request", r => { const u = r.url(); if (u.includes("supabase-js")) return r.respond({ status: 200, contentType: "text/javascript", body: mock }); if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) return r.abort(); if (u.endsWith("sw.js")) return r.respond({ status: 404, body: "" }); r.continue(); });
  await pg.evaluateOnNewDocument(() => { window.__mic = 0; const g = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices); if (g) navigator.mediaDevices.getUserMedia = c => { window.__mic++; return g(c); }; });
  await pg.goto(base + "?rol=" + rol + (esq ? "&esquema=" + esq : "") + ruta, { waitUntil: "networkidle0" }); await esp(700); return { pg, ctx };
}
const texto = pg => pg.$eval("#app", e => e.innerText);
const llam = pg => pg.evaluate(() => ({ l: __llamadas, s: __storage, t: __tablas, mic: __mic }));

// 1) Base v5 (sin v6): chat básico, aviso honesto para admin, cero consultas a tablas/Storage v6
for (const [rol, esq] of [["administrador", "5"], ["cliente", ""]]) {
  const { pg, ctx } = await abrir(rol, esq); const h = await texto(pg), c = await llam(pg);
  ok(h.includes("Chat de este pedido") && !c.t.some(t => ["mensaje_reacciones", "chat_lecturas"].includes(t)) && !c.s.length && !(await pg.$("#cMic")) && !pg.errs.length, `${rol} sin v6: chat básico, sin botones v6 ni consultas v6`);
  if (rol === "administrador") ok(h.includes("Chat mejorado") && h.includes("pendiente de activación"), "admin ve aviso de activación pendiente (v6)");
  else ok(!h.includes("Chat mejorado"), "cliente no ve avisos técnicos");
  await ctx.close();
}
// 2) Base v6
{ const { pg, ctx } = await abrir("administrador", "6"); const h = await texto(pg);
  ok(h.includes("Mensaje eliminado") && h.includes("editado") && h.includes("PRUEBA ¿cuándo llega?") && h.includes("Escuchar nota de voz (7 s)"), "render: tombstone, editado, cita, nota de voz");
  ok(h.includes("✓✓ Visto"), "«Visto» aparece solo donde hay lectura registrada (mensaje 2)");
  ok(!h.includes("Entregado ✓") && !/✓✓ Visto[\s\S]*Mensaje eliminado[\s\S]*✓✓ Visto/.test(h), "sin estados inventados");
  const c0 = await llam(pg); ok(!c0.s.some(x => x[0] === "firmar"), "no se firman URLs hasta que el usuario toca el adjunto");
  ok(c0.mic === 0, "el micrófono no se pide al abrir el chat");
  await pg.click("[data-ver='3']"); await esp(300); const c1 = await llam(pg);
  ok(c1.s.some(x => x[0] === "firmar" && x[1] === "chat" && x[3] === 300) && !!(await pg.$("#adj3 audio")), "al tocar: URL firmada 5 min y reproductor");
  // Responder + enviar texto
  await pg.click("[data-menu='2']"); await pg.click(".menuMsg [data-a='resp']"); await pg.type("#txt", "PRUEBA respuesta citada"); await pg.click("#fs button[aria-label='Enviar mensaje']"); await esp(400);
  let c = await llam(pg), ins = c.l.filter(x => x[0] === "mensajes" && x[1] === "insert").at(-1)?.[2][0];
  ok(ins && ins.responde_a === 2 && ins.tipo === "texto" && ins.adjunto_ruta === null, "respuesta citada enviada con responde_a");
  ok((await texto(pg)).includes("PRUEBA respuesta citada"), "mensaje propio aparece tras confirmación del servidor");
  // Reacción
  await pg.click("[data-menu='1']"); await pg.click(".menuMsg [data-e='🙏']"); await esp(200); c = await llam(pg);
  ok(c.l.some(x => x[0] === "mensaje_reacciones" && x[1] === "upsert" && x[2][0].emoji === "🙏"), "reacción guardada (upsert una por persona)");
  // Adjuntos: SVG rechazado, PNG con vista previa y envío explícito
  const svg = path.join(raiz, "icon.svg"), png = path.join(raiz, "icon-192.png");
  await (await pg.$("#cFile")).uploadFile(svg); await esp(200); c = await llam(pg);
  ok(!c.s.some(x => x[0] === "subir") && (await pg.$eval("#toast", e => e.textContent)).includes("no permitido"), "SVG rechazado antes de subir");
  await (await pg.$("#cFile")).uploadFile(png); await esp(300); c = await llam(pg);
  ok(!!(await pg.$("#cPrev img")) && !c.s.some(x => x[0] === "subir"), "foto: vista previa, nada subido aún");
  await pg.click("#fs button[aria-label='Enviar mensaje']"); await esp(500); c = await llam(pg);
  const up = c.s.find(x => x[0] === "subir"); ins = c.l.filter(x => x[0] === "mensajes" && x[1] === "insert").at(-1)?.[2][0];
  ok(up && up[1] === "chat" && /^c0000000-0000-4000-8000-000000000001\/[0-9a-f-]{36}\.png$/.test(up[2]) && up[3] === "image/png" && ins.tipo === "imagen" && ins.adjunto_ruta === up[2], "foto subida a bucket privado en carpeta de la tienda y luego mensaje");
  // Nota de voz: grabar, detener, escuchar, descartar (nada enviado), grabar y enviar
  const antes = (await llam(pg)).l.length;
  await pg.click("#cMic"); await esp(1600); ok((await llam(pg)).mic === 1, "micrófono pedido solo al tocar 🎤");
  await pg.click("#cMic"); await esp(600);
  ok(!!(await pg.$("#cPrev audio")) && (await llam(pg)).l.length === antes, "grabación detenida: escucha previa, nada enviado");
  await pg.click("#cPrevX"); await esp(100); ok(!(await pg.$("#cPrev audio")) && !(await llam(pg)).s.some(x => x[0] === "subir" && /webm|ogg|m4a/.test(x[2])), "descartar no sube ni envía");
  await pg.click("#cMic"); await esp(1300); await pg.click("#cMic"); await esp(500); await pg.click("#fs button[aria-label='Enviar mensaje']"); await esp(500);
  c = await llam(pg); ins = c.l.filter(x => x[0] === "mensajes" && x[1] === "insert").at(-1)?.[2][0];
  ok(ins.tipo === "voz" && ins.voz_seg >= 1 && /^audio\//.test(ins.adjunto_mime) && c.s.some(x => x[0] === "subir" && x[3] === ins.adjunto_mime), "nota de voz enviada solo tras tocar ➤ (" + ins.adjunto_mime + ", " + ins.voz_seg + " s)");
  // Búsqueda
  await esp(300); await pg.evaluate(() => { document.querySelector("#cBus").click(); document.querySelector("#cBusQ").value = "llega"; document.querySelector("#cBusF").requestSubmit(); }); await esp(400);
  ok((await pg.$$("#cBusR [data-ir]")).length > 0, "búsqueda muestra resultados de la conversación");
  // Accesibilidad / legibilidad móvil
  const a11y = await pg.evaluate(() => ({ f: parseFloat(getComputedStyle(document.querySelector(".msg p")).fontSize), sinNombre: [...document.querySelectorAll("#chatBox button")].filter(b => !(b.getAttribute("aria-label") || b.textContent.trim())).length,
    tam: [...document.querySelectorAll("#fs button")].every(b => b.getBoundingClientRect().height >= 44), ancho: document.documentElement.scrollWidth <= 380 }));
  ok(a11y.f >= 15 && a11y.sinNombre === 0 && a11y.tam && a11y.ancho, `móvil 375px: texto ${a11y.f}px, botones con nombre y ≥44px, sin desborde`);
  await pg.screenshot({ path: path.join(raiz, "tests/captura-chat-v6.png"), fullPage: true });
  ok(!pg.errs.length, "sin errores JS " + pg.errs.join(" | ")); await ctx.close(); }
// 3) Error y reintento
{ const { pg, ctx } = await abrir("cliente", "6"); 
  await pg.evaluate(() => { window.__fallaInsert = 1; });
  await pg.type("#txt", "PRUEBA sin red"); await pg.click("#fs button[aria-label='Enviar mensaje']"); await esp(400);
  ok((await texto(pg)).includes("No enviado") && !!(await pg.$("[data-reint]")), "fallo de red: «No enviado» + Reintentar");
  await pg.click("[data-reint]"); await esp(400); const h = await texto(pg);
  ok(!h.includes("No enviado") && h.includes("PRUEBA sin red"), "reintento exitoso"); ok(!pg.errs.length, "sin errores JS"); await ctx.close(); }
await br.close(); srv.close(); console.log(fallos ? `\n${fallos} fallo(s) de ${n}` : `\n${n} comprobaciones de chat OK (Supabase y micrófono falsos)`); process.exit(fallos ? 1 : 0);
