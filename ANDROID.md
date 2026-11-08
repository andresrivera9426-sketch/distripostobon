# App Android (Capacitor) — rama android-capacitor

App **híbrida**: la interfaz (HTML/CSS/JS y librerías) va empaquetada dentro del APK y se ejecuta en el WebView del sistema;
no abre el sitio remoto. Login, base de datos, chat y fotos siguen en Supabase (requieren internet). No es una reescritura nativa (Kotlin).

- Base: `main` publicado (a2e8454). No incluye v4/v5 (requieren migraciones no aplicadas).
- Funciones Android: botón Atrás (cierra ventanas, vuelve, minimiza en inicio), WhatsApp/Jitsi y enlaces externos en el navegador del sistema,
  enlaces http bloqueados, selector de fotos/archivos del sistema, márgenes de pantalla completa, ícono y splash propios. Permiso: solo INTERNET.
- Construir: `npm ci && npm run sync && cd android && DP_KEYSTORE_PROPS=<ruta keystore.properties> ./gradlew assembleRelease`.
- La clave de firma NO está en el repo. Perderla impide publicar actualizaciones con la misma firma.
- Prueba: `node android-build/test/humo-movil.mjs` (Chrome móvil + Supabase falso + Capacitor simulado).
