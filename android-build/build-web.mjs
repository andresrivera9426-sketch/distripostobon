// Copia la interfaz web a www/ con librerías locales (sin CDN) y el puente Android. No incluye secretos privilegiados:
// config.js solo trae la URL pública de Supabase y la clave anon (pública por diseño; la seguridad está en RLS).
import fs from "node:fs"; import path from "node:path";
const R = path.resolve(new URL("..", import.meta.url).pathname), W = path.join(R, "www");
fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(path.join(W, "vendor"), { recursive: true });
for (const f of ["app.js", "config.js", "import-productos.js", "styles.css", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"]) fs.copyFileSync(path.join(R, f), path.join(W, f));
fs.copyFileSync(path.join(R, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"), path.join(W, "vendor/supabase.js"));
fs.copyFileSync(path.join(R, "node_modules/xlsx/dist/xlsx.full.min.js"), path.join(W, "vendor/xlsx.full.min.js"));
fs.copyFileSync(path.join(R, "android-build/android.js"), path.join(W, "android.js"));
fs.copyFileSync(path.join(R, "android-build/android.css"), path.join(W, "android.css"));
let html = fs.readFileSync(path.join(R, "index.html"), "utf8");
const cdn = /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"><\/script>/;
if (!cdn.test(html)) throw new Error("index.html: no encontré el script de supabase-js a reemplazar");
html = html.replace(cdn, '<script defer src="vendor/supabase.js"></script>')
  .replace(/<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net">/, "")
  .replace('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="android.css">')
  .replace('<script defer src="app.js"></script>', '<script defer src="android.js"></script><script defer src="app.js"></script>');
fs.writeFileSync(path.join(W, "index.html"), html);
let app = fs.readFileSync(path.join(W, "app.js"), "utf8");
const x = 'const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";';
if (!app.includes(x)) throw new Error("app.js: no encontré XLSX_URL"); app = app.replace(x, 'const XLSX_URL = "vendor/xlsx.full.min.js";');
const sw = 'if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js")';
if (!app.includes(sw)) throw new Error("app.js: no encontré registro del service worker");
app = app.replace(sw, 'if (false && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js")'); // en la app los archivos ya son locales
fs.writeFileSync(path.join(W, "app.js"), app);
console.log("www listo:", fs.readdirSync(W).join(", "));
