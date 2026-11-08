-- Revierte v6 (chat mejorado). ATENCIÓN, PÉRDIDA DE DATOS: elimina reacciones, lecturas, historial de ediciones
-- y las columnas de citas/adjuntos/edición. Exporta mensajes, mensaje_reacciones, chat_lecturas y mensajes_historial antes.
-- Los mensajes eliminados (tombstone) quedan como '[mensaje eliminado]'; los adjuntos sin texto como '[adjunto no disponible]'.
-- NO borra el bucket 'chat' ni sus archivos: revísalos y bórralos manualmente desde Storage si ya no se necesitan.
update public.mensajes set texto='[mensaje eliminado]' where eliminado is not null;
update public.mensajes set texto='[adjunto no disponible]' where length(texto)=0;
drop function if exists public.chat_huerfanos();
drop function if exists public.marcar_leido(uuid,uuid,bigint);
drop function if exists public.editar_mensaje(bigint,text);
drop function if exists public.eliminar_mensaje(bigint);
drop policy if exists ch_ins on storage.objects; drop policy if exists ch_sel on storage.objects; drop policy if exists ch_del on storage.objects;
drop function if exists public.chat_objeto_huerfano(text);
drop table if exists public.chat_lecturas;
drop table if exists public.mensaje_reacciones;
drop function if exists public.reaccion_cliente();
drop table if exists public.mensajes_historial;
drop policy if exists m_ins on public.mensajes;
drop function if exists public.adjunto_disponible(text,uuid);
create policy m_ins on public.mensajes for insert to authenticated
  with check (autor_id=auth.uid() and (
     (cliente_id=auth.uid() and (pedido_id is null or exists(select 1 from public.pedidos x where x.id=pedido_id and x.cliente_id=auth.uid())))
     or public.mi_rol() in ('vendedor','administrador')
     or (public.mi_rol()='bodega' and pedido_id is not null)));
drop function if exists public.puede_ver_mensaje(bigint);
drop function if exists public.puede_ver_conv(uuid,uuid);
drop index if exists public.mensajes_adjunto_idx; drop index if exists public.mensajes_responde_idx;
alter table public.mensajes drop constraint if exists mensajes_contenido_chk;
alter table public.mensajes drop column if exists responde_a, drop column if exists tipo, drop column if exists adjunto_ruta,
  drop column if exists adjunto_mime, drop column if exists adjunto_bytes, drop column if exists adjunto_nombre, drop column if exists voz_seg,
  drop column if exists editado, drop column if exists eliminado, drop column if exists eliminado_por;
alter table public.mensajes drop constraint if exists mensajes_texto_check;
alter table public.mensajes add constraint mensajes_texto_check check (length(texto) between 1 and 2000);
update public.config set version_esquema=least(version_esquema,5);
