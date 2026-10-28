# DistriPostobon
Web app de pedidos para tiendas: catálogo, carrito, pedido con código de seguimiento (DP-XXXXX), aviso al vendedor (WhatsApp + tiempo real) y panel del vendedor con estados Recibido → Confirmado → Alistando → En ruta → Entregado.

Proyecto personal e independiente de demostración. No es una app oficial ni está afiliada a Postobón S.A. Precios de ejemplo.

- Configuración: `config.js` (WhatsApp del vendedor, PIN, canal en tiempo real).
- Productos y precios: `productos.js`.
- Tiempo real: ntfy.sh (gratis, sin cuenta). El vendedor puede instalar la app "ntfy" y suscribirse al canal para recibir push de cada pedido nuevo.
- Sin frameworks, sin build: HTML + CSS + JS (~25 KB). PWA instalable.
