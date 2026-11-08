-- Revierte v4 a las funciones de v3. Conserva productos, pedidos y stock actuales.
-- ATENCIÓN: borra el historial de movimientos de inventario y las composiciones de combos.
drop function if exists public.importar_productos(jsonb);
drop function if exists public.ajustar_inventario(uuid,text,int,text);
drop function if exists public.transicion_valida(text,text);
-- Después de este archivo, vuelve a ejecutar v3.sql para restaurar crear_pedido/cambiar_estado/entregar_pedido de v3.
-- crear_pedido/cambiar_estado de v4 dependen de estas tablas y funciones; v3.sql las reemplaza.
drop table if exists public.combo_componentes;
drop function if exists public.valida_combo();
drop table if exists public.inventario_movimientos;
drop function if exists public.mover_stock(uuid,int,text,uuid,text);

update public.config set version_esquema=3 where id=1;
