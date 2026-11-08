// Cliente Supabase FALSO solo para la prueba de humo en navegador (datos ficticios). Nunca se usa en producción.
(function () {
  const rolQ = new URLSearchParams(location.search).get("rol") || "administrador";
  const ID = { administrador: "a0000000-0000-4000-8000-000000000001", cliente: "c0000000-0000-4000-8000-000000000001", vendedor: "b0000000-0000-4000-8000-000000000001" }[rolQ];
  const P1 = { id: "p1", nombre: "PRUEBA Gaseosa", categoria: "Gaseosas", presentacion: "x12", precio: 20000, precio_promo: null, stock: 50, activo: true, destacado: false, descripcion: "", exige_lote: false };
  const P2 = { ...P1, id: "p2", nombre: "PRUEBA Yogur", presentacion: "u", precio: 3000, stock: 5, exige_lote: true };
  const ped = { id: "o1", codigo: "DP-PRUEB", cliente_id: "c0000000-0000-4000-8000-000000000001", vendedor_id: "b0000000-0000-4000-8000-000000000001", estado: "Entregado", condicion: "credito", vence_pago: "2026-11-20", total: 40000, notas: "", sala: "x", creado: "2026-11-07T15:00:00Z", recibio: "Ana", prueba_foto: null, prueba_firma: null,
    pedido_items: [{ id: 1, producto_id: "p1", nombre: "PRUEBA Gaseosa", presentacion: "x12", precio: 20000, cantidad: 2 }], pedido_historial: [{ estado: "Entregado", creado: "2026-11-07T16:00:00Z" }], cliente: { nombre: "PRUEBA Tienda", telefono: "3000000000", direccion: "Calle 1", cedula: "1" }, vendedor: { nombre: "PRUEBA Vendedor" } };
  const T = {
    profiles: [{ id: ID, rol: rolQ, nombre: "PRUEBA " + rolQ, correo: "x@prueba.test", cedula: "1", telefono: "3", direccion: "d", sala: "s" }, { id: "c0000000-0000-4000-8000-000000000001", rol: "cliente", nombre: "PRUEBA Tienda", telefono: "3000000000" }],
    productos: [P1, P2], config: [{ id: 1, pedido_minimo: 0, whatsapp_vendedor: "", stock_alerta: 10, franjas: ["Mañana"] }], banners: [], favoritos: [], pedidos: [ped], mensajes: [],
    inventario_movimientos: [{ id: 1, tipo: "venta", cantidad: -2, stock_resultante: 50, nota: "", creado: "2026-11-07T15:00:00Z", producto: P1, pedido: { codigo: "DP-PRUEB" } }],
    combo_componentes: [], zonas: [{ id: "z1", nombre: "PRUEBA Norte", dias: [2, 4], activo: true }], tipos_cliente: [{ codigo: "mayorista", nombre: "PRUEBA Mayorista" }],
    precios_tipo: [{ producto_id: "p1", tipo: "mayorista", precio: 18000 }], descuentos_cantidad: [{ id: "d1", producto_id: "p1", tipo: null, min_cantidad: 10, porcentaje: 10 }],
    envases: [{ id: "e1", nombre: "PRUEBA Canasta" }], producto_envases: [{ producto_id: "p1", envase_id: "e1", cantidad: 1 }],
    clientes_comercial: [{ cliente_id: "c0000000-0000-4000-8000-000000000001", zona_id: "z1", vendedor_id: "b0000000-0000-4000-8000-000000000001", tipo: "mayorista", cupo_credito: 100000, plazo_dias: 15, zona: { nombre: "PRUEBA Norte", dias: [2, 4] } }],
    cartera: [{ pedido_id: "o1", codigo: "DP-PRUEB", cliente_id: "c0000000-0000-4000-8000-000000000001", estado: "Entregado", condicion: "credito", total: 40000, abonado: 10000, devuelto: 0, saldo: 30000, vence_pago: "2026-11-01" }],
    envases_mov: [{ id: 1, cliente_id: "c0000000-0000-4000-8000-000000000001", envase_id: "e1", cantidad: 2, tipo: "entrega", creado: "2026-11-07T16:00:00Z", nota: "", reversa_de: null, envase: { nombre: "PRUEBA Canasta" } }],
    abonos: [{ id: 1, pedido_id: "o1", valor: 10000, metodo: "efectivo", referencia: "", motivo: "", reversa_de: null, creado: "2026-11-07T17:00:00Z" }],
    devoluciones: [], lotes: [{ id: "l1", producto_id: "p2", codigo: "L-1", vence: "2026-11-01", cantidad: 5, origen: "declarado_activacion" }], cierres: []
  };
  const RPC = { crear_pedido: { id: "o2", codigo: "DP-NUEVO", total: 162000 }, mis_precios: [{ producto_id: "p1", precio: 18000, descuentos: [{ min: 10, pct: 10 }] }, { producto_id: "p2", precio: 3000, descuentos: [] }], equipo_ventas: [{ id: "b0000000-0000-4000-8000-000000000001", nombre: "PRUEBA Vendedor" }],
    resumen_dia: { fecha: "2026-11-07", entregas: { pedidos: 1, total: 40000, contado: 0, credito: 40000 }, abonos: { efectivo: 10000, transferencia: 0, otro: 0, reversos: 0, registros: 1 }, devoluciones: { registros: 0, valor: 0, reventa_unid: 0, averia_unid: 0 }, envases: { entregados: 2, devueltos: 0, reversos: 0 }, pendientes_entrega: 0 } };
  window.__llamadas = [];
  const q = tabla => { let uno = false; const res = () => { const d = T[tabla] || []; return { data: uno ? (d[0] || null) : d, error: null, count: d.length }; };
    const b = new Proxy({}, { get: (_, k) => k === "then" ? (ok, ko) => Promise.resolve(res()).then(ok, ko) : (k === "single" || k === "maybeSingle") ? () => { uno = true; return b; } : (...a) => { if (["insert", "update", "upsert", "delete"].includes(k)) __llamadas.push([tabla, k, a]); return b; } }); return b; };
  const sess = { user: { id: ID, email: "x@prueba.test" } };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: sess } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
    from: q, rpc: async (n, a) => { __llamadas.push(["rpc", n, a]); return { data: RPC[n] ?? null, error: null }; },
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: () => {},
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "" } }), upload: async () => ({}) }) } }) };
})();
