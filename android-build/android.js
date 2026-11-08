"use strict";
/* Puente Android (Capacitor): botón Atrás, enlaces externos fuera de la app y aviso sin conexión.
   Solo actúa dentro de la app nativa; en el navegador no hace nada. */
(function () {
  const C = window.Capacitor; if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  document.documentElement.classList.add("nativo");
  const { App, Browser } = C.Plugins;
  const PERMITIDOS = ["https://wa.me/", "https://api.whatsapp.com/", "https://meet.jit.si/", "https://maps.google.com/", "https://www.google.com/maps"];
  const abrirFuera = url => {
    let u; try { u = new URL(url, location.href); } catch (e) { return false; }
    if (u.origin === location.origin) return false;
    if (u.protocol === "tel:" || u.protocol === "mailto:") { location.href = u.href; return true; }
    if (u.protocol !== "https:") return true; // se bloquea: nunca http ni esquemas raros
    if (PERMITIDOS.some(p => u.href.startsWith(p))) Browser.open({ url: u.href });
    else if (confirm("Abrir enlace externo en el navegador?\n" + u.host)) Browser.open({ url: u.href });
    return true;
  };
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a[href]"); if (!a) return;
    const h = a.getAttribute("href"); if (!h || h.startsWith("#")) return;
    if (abrirFuera(a.href)) e.preventDefault();
  }, true);
  const wo = window.open; window.open = (url, ...r) => { if (url && abrirFuera(url)) return null; return wo.call(window, url, ...r); };
  App.addListener("backButton", () => {
    const m = document.getElementById("modal");
    if (m && m.innerHTML.trim()) { m.innerHTML = ""; return; }
    const h = location.hash.replace(/^#\/?/, "");
    if (h && h !== "panel") history.back(); else App.minimizeApp();
  });
  const aviso = () => { if (!navigator.onLine) { const t = document.getElementById("toast"); if (t) { t.textContent = "Sin internet: puedes ver lo cargado, pero pedidos y chat necesitan conexión."; t.className = "toast on err"; } } };
  window.addEventListener("load", aviso); window.addEventListener("offline", aviso);
})();
