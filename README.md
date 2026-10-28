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
