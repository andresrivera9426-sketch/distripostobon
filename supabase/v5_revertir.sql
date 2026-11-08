-- Revierte v5. Después ejecuta v4.sql para restaurar crear_pedido/cambiar_estado/entregar_pedido/mover_stock de v4.
-- ATENCIÓN: elimina zonas, fichas comerciales, precios por tipo, descuentos, abonos, devoluciones, envases, lotes y cierres.
-- Haz una copia (exporta esas tablas) antes; productos, pedidos y stock actual se conservan.
-- Si hay productos con exige_lote, el stock actual se conserva tal cual (sin lotes).
drop view if exists public.cartera;
drop function if exists public.crear_pedido(jsonb,text,date,text,text);
drop function if exists public.registrar_abono(uuid,numeric,text,text,uuid);
drop function if exists public.reversar_abono(bigint,text);
drop function if exists public.registrar_devolucion(bigint,int,text,text,uuid);
drop function if exists public.devolver_envases(uuid,uuid,int,text,uuid);
drop function if exists public.reversar_envase_mov(bigint,text);
drop function if exists public.activar_lotes(uuid,jsonb);
drop function if exists public.recibir_lote(uuid,text,date,int,text);
drop function if exists public.baja_lote(uuid,int,text);
drop function if exists public.resumen_dia(date);
drop function if exists public.cerrar_dia(date,numeric,text);
drop function if exists public.anular_cierre(bigint,text);
drop function if exists public.mis_precios();
drop function if exists public.precio_para(uuid,text,int);
drop function if exists public.saldo_pedido(uuid);
drop function if exists public.saldo_envase(uuid,uuid);
drop trigger if exists productos_stock_lote on public.productos;
drop function if exists public.protege_stock_lote();
drop table if exists public.cierres, public.lote_consumos, public.lotes, public.envases_mov, public.producto_envases, public.envases,
  public.devoluciones, public.abonos, public.descuentos_cantidad, public.precios_tipo, public.clientes_comercial, public.tipos_cliente, public.zonas;
alter table public.productos drop column if exists exige_lote;
alter table public.pedidos drop constraint if exists pedidos_condicion_chk;
alter table public.pedidos drop column if exists condicion;
alter table public.pedidos drop column if exists vence_pago;
alter table public.inventario_movimientos drop constraint if exists inventario_movimientos_tipo_check;
-- tipos v5 (retorno/baja) pueden existir; se permiten para no reescribir historial
alter table public.inventario_movimientos add constraint inventario_movimientos_tipo_check
  check (tipo in ('entrada','salida','ajuste','venta','devolucion','importacion','retorno','baja'));
drop function if exists public.es_admin();
drop function if exists public.hoy_co();
drop trigger if exists cc_valida on public.clientes_comercial;
drop function if exists public.valida_cliente_comercial();

do $$ begin update public.config set version_esquema=4 where id=1; exception when undefined_column then null; end $$;
