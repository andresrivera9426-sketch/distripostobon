# DistriPostobon

App web (PWA) para que las tiendas hagan pedidos de bebidas, chateen con su vendedor y sigan cada entrega con un código `DP-XXXXX`.

**Proyecto independiente. No es una app oficial ni está afiliada a Postobón S.A.**

- En línea: https://andresrivera9426-sketch.github.io/distripostobon/
- Backend: Supabase (autenticación, base de datos Postgres con RLS, Realtime y Storage).
- Roles: 1 administrador, hasta 4 vendedores, hasta 2 de bodega y tiendas ilimitadas (los límites se aplican en la base de datos).
- Estados: Recibido → Confirmado → Alistando → En ruta → Entregado (o Cancelado), con historial.
- Chat en tiempo real por pedido y general; llamadas y videollamadas con Jitsi Meet; WhatsApp de respaldo.
- Excel (.xlsx): importar/exportar productos, exportar pedidos y tiendas.
- v3: promociones y combos, banners, favoritos, "Pide de nuevo", fecha y franja de entrega, asignación de vendedor y ruta, cancelación por la tienda mientras está Recibido, prueba de entrega con foto o firma, calificaciones, tablero de ventas con gráficas, alertas de stock bajo, modo oscuro, catálogo sin conexión, comprobante imprimible/PDF y contador de mensajes sin leer.
- `supabase/esquema.sql` y `supabase/v3.sql`: tablas, funciones y reglas de seguridad. `supabase/ejemplos.sql`: productos de EJEMPLO (precios no reales).

## v4 (rama `mejoras-operativas`, pendiente de despliegue)
- Aplicar `supabase/v4.sql` en el SQL Editor **después** de `esquema.sql` y `v3.sql`. Reversión: `supabase/v4_revertir.sql` y luego `v3.sql`.
- Importación Excel atómica (`importar_productos`): todo el lote o nada; registra movimientos.
- Pedidos: solo se avanza al siguiente estado; "Entregado" solo con quién recibió + foto/firma (`entregar_pedido`).
- Inventario: tabla `inventario_movimientos`, ajustes con motivo (`ajustar_inventario`), pestaña Admin › Inventario.
- Combos: `combo_componentes`; vender un combo descuenta también sus componentes y cancelar los repone.
- Tablero: pendientes por estado y productos más pedidos por unidades. Catálogo: búsqueda por palabras; "Repetir mi último pedido".
- Pruebas: `node tests/reglas.test.mjs` y `NODE_PATH=<ruta a node_modules con @electric-sql/pglite> node tests/sql.test.mjs` (Postgres en memoria con datos ficticios).

## v5 (misma rama, pendiente de despliegue)
- Aplicar `supabase/v5.sql` después de `v4.sql`. Reversión: `supabase/v5_revertir.sql` y luego `v4.sql` (exporta antes las tablas v5: la reversión las elimina).
- Admin › Comercial: zonas y días de entrega, ficha de cada tienda (zona, vendedor, tipo, cupo y plazo), tipos de cliente, precios por tipo, descuentos por cantidad y envases retornables. Nada viene precargado.
- Crédito: solo si la tienda tiene cupo y plazo; el pedido valida cupo y calcula vencimiento. Abonos (admin o vendedor asignado) con clave de idempotencia; reversos solo admin y auditables. Admin › Cartera.
- Devoluciones en el pedido entregado: destino “apto para reventa” (vuelve al inventario) o “avería” (no vuelve); nunca más de lo entregado.
- Envases: la entrega genera saldo por tienda; devolución limitada al saldo; reversos auditables.
- Lotes: se activan por producto declarando lotes que suman el stock actual; FEFO; no se vende vencido; recepción y baja por lote.
- Admin › Cierre: resumen del día (hora Colombia), efectivo declarado vs. abonos en efectivo, un cierre vigente por día, anulación con motivo. Registro operativo, no contable.
- Pruebas: `tests/v5.test.mjs` (PGlite) y `tests/humo.navegador.mjs` (Chrome headless con Supabase falso `tests/supabase_mock.js`).

## Inicio optimizado (rama `optimizacion-ui`, sin publicar)
- Inicio muestra el portafolio (201 referencias con imagen local) organizado por categorías, con búsqueda, filtros y páginas de 24. Las referencias no activas salen como «Precio a consultar»; al activarlas en Supabase pasan a ser pedibles sin cambiar la app. Los productos EJEMPLO no se muestran al público.
- Una sola carga del catálogo por pantalla (antes se pedía dos veces), banners solo activos para el público, imágenes con carga diferida y caché primero en el service worker (`dp-v9`).
- Prueba: `NODE_PATH=<node_modules con puppeteer-core> node tests/humo.inicio.mjs` (Supabase falso).
