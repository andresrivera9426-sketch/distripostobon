-- DistriPostobon v6: chat mejorado (respuestas citadas, reacciones, búsqueda/paginación, adjuntos privados,
-- notas de voz, edición y eliminación con tombstone auditable, confirmación de lectura con evidencia real).
-- Requisito: esquema.sql + v3.sql (+ v4/v5 opcionales). Incremental e idempotente: se puede ejecutar dos veces.
-- No borra mensajes existentes. Los mensajes v3 siguen siendo válidos (tipo 'texto').
-- Reversión: supabase/v6_revertir.sql (lee las advertencias de pérdida antes de usarlo).

do $$ begin
  if coalesce((select (to_jsonb(c)->>'version_esquema')::int from public.config c where id=1),3) < 5 then
    raise exception 'v6 requiere v5 aplicado (config.version_esquema >= 5). Aplica antes supabase/v4_v5_consolidada.sql o usa supabase/v4_v5_v6_consolidada.sql';
  end if;
end $$;

-- 1) Columnas nuevas en mensajes (nulas o con default: compatibles con clientes v3)
alter table public.mensajes add column if not exists responde_a bigint references public.mensajes(id) on delete set null;
alter table public.mensajes add column if not exists tipo text not null default 'texto';
alter table public.mensajes add column if not exists adjunto_ruta text;
alter table public.mensajes add column if not exists adjunto_mime text;
alter table public.mensajes add column if not exists adjunto_bytes int;
alter table public.mensajes add column if not exists adjunto_nombre text;
alter table public.mensajes add column if not exists voz_seg int;
alter table public.mensajes add column if not exists editado timestamptz;
alter table public.mensajes add column if not exists eliminado timestamptz;
alter table public.mensajes add column if not exists eliminado_por uuid references public.profiles(id) on delete set null;

alter table public.mensajes drop constraint if exists mensajes_texto_check;
alter table public.mensajes drop constraint if exists mensajes_contenido_chk;
alter table public.mensajes add constraint mensajes_contenido_chk check (
  length(texto) <= 2000
  and (eliminado is not null or length(texto) >= 1 or adjunto_ruta is not null)
  and tipo in ('texto','imagen','documento','voz')
  and (tipo = 'texto') = (adjunto_ruta is null)
  and (adjunto_ruta is null or coalesce(
        adjunto_mime in ('image/jpeg','image/png','image/webp','application/pdf','audio/webm','audio/ogg','audio/mp4')
        and adjunto_bytes between 1 and 10485760
        and adjunto_ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf|webm|ogg|m4a)$'
        and (tipo <> 'imagen' or adjunto_mime like 'image/%')
        and (tipo <> 'documento' or adjunto_mime = 'application/pdf')
        and substring(adjunto_ruta from '\.([a-z0-9]+)$') = case adjunto_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
              when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg' when 'audio/mp4' then 'm4a' end
        and (tipo <> 'voz' or (adjunto_mime like 'audio/%' and voz_seg between 1 and 300))
        and (tipo = 'voz' or voz_seg is null), false)));

-- Índices: paginación por conversación (keyset por id) y adjuntos
create index if not exists mensajes_conv_idx on public.mensajes(cliente_id, pedido_id, id desc);
create index if not exists mensajes_adjunto_idx on public.mensajes(adjunto_ruta) where adjunto_ruta is not null;
create index if not exists mensajes_responde_idx on public.mensajes(responde_a) where responde_a is not null;

-- 2) Permiso de conversación (misma regla que m_sel de v3) reutilizable
create or replace function public.puede_ver_conv(c uuid, p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select c = auth.uid() or public.mi_rol() in ('vendedor','administrador') or (public.mi_rol()='bodega' and p is not null) $$;
create or replace function public.puede_ver_mensaje(m bigint) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.mensajes x where x.id=m and public.puede_ver_conv(x.cliente_id, x.pedido_id)) $$;

-- 4) Historial de ediciones/eliminaciones (auditoría; solo administrador puede leerlo)
create table if not exists public.mensajes_historial(
  id bigserial primary key, mensaje_id bigint not null references public.mensajes(id) on delete cascade,
  accion text not null check (accion in ('edicion','eliminacion')), texto_anterior text not null,
  adjunto_anterior text, usuario_id uuid references public.profiles(id) on delete set null, creado timestamptz not null default now());
alter table public.mensajes_historial enable row level security;
drop policy if exists mh_sel on public.mensajes_historial; create policy mh_sel on public.mensajes_historial for select to authenticated using (public.mi_rol()='administrador');

-- El archivo debe existir en el bucket privado, haberlo subido quien escribe, estar en la carpeta de esa tienda
-- y no pertenecer ya a otro mensaje (security definer: el que sube aún no puede leer el objeto por RLS).
create or replace function public.adjunto_disponible(ruta text, c uuid) returns boolean language sql stable security definer set search_path=public as
$$ select (storage.foldername(ruta))[1] = c::text
     and exists(select 1 from storage.objects o where o.bucket_id='chat' and o.name=ruta and o.owner=auth.uid())
     and not exists(select 1 from public.mensajes y where y.adjunto_ruta=ruta)
     and not exists(select 1 from public.mensajes_historial h where h.adjunto_anterior=ruta) $$;

-- 3) Inserción: autor = usuario, conversación permitida, cita y adjunto de la MISMA conversación/tienda
drop policy if exists m_ins on public.mensajes; create policy m_ins on public.mensajes for insert to authenticated
  with check (autor_id=auth.uid() and editado is null and eliminado is null and eliminado_por is null and (
     (cliente_id=auth.uid() and (pedido_id is null or exists(select 1 from public.pedidos x where x.id=pedido_id and x.cliente_id=auth.uid())))
     or public.mi_rol() in ('vendedor','administrador')
     or (public.mi_rol()='bodega' and pedido_id is not null))
   and (responde_a is null or exists(select 1 from public.mensajes r where r.id=mensajes.responde_a and r.cliente_id=mensajes.cliente_id
        and r.pedido_id is not distinct from mensajes.pedido_id))
   and (adjunto_ruta is null or public.adjunto_disponible(adjunto_ruta, cliente_id)));
-- Sin políticas UPDATE/DELETE: los cambios solo pasan por las funciones auditadas de abajo.

create or replace function public.editar_mensaje(m bigint, nuevo text) returns void language plpgsql security definer set search_path=public as $$
declare x public.mensajes; t text := btrim(coalesce(nuevo,''));
begin
  select * into x from public.mensajes where id=m for update;
  if x.id is null or x.autor_id <> auth.uid() then raise exception 'No autorizado'; end if;
  if x.eliminado is not null then raise exception 'El mensaje fue eliminado'; end if;
  if x.tipo <> 'texto' then raise exception 'Solo se edita texto'; end if;
  if now() - x.creado > interval '15 minutes' then raise exception 'Solo se puede editar durante 15 minutos'; end if;
  if length(t) not between 1 and 2000 then raise exception 'Texto inválido'; end if;
  if t = x.texto then return; end if;
  insert into public.mensajes_historial(mensaje_id,accion,texto_anterior,usuario_id) values(m,'edicion',x.texto,auth.uid());
  update public.mensajes set texto=t, editado=now() where id=m;
end $$;

-- Eliminar para todos = tombstone: el contenido sale de la vista de los participantes, queda copia en historial (admin).
-- El objeto de Storage NO se borra (queda referenciado en historial para auditoría) y deja de poder firmarse.
create or replace function public.eliminar_mensaje(m bigint) returns void language plpgsql security definer set search_path=public as $$
declare x public.mensajes;
begin
  select * into x from public.mensajes where id=m for update;
  if x.id is null or not public.puede_ver_conv(x.cliente_id, x.pedido_id) then raise exception 'No autorizado'; end if;
  if x.eliminado is not null then return; end if;
  if not (public.mi_rol()='administrador' or (x.autor_id=auth.uid() and now() - x.creado <= interval '24 hours')) then
    raise exception 'Solo el autor durante 24 horas o un administrador'; end if;
  insert into public.mensajes_historial(mensaje_id,accion,texto_anterior,adjunto_anterior,usuario_id) values(m,'eliminacion',x.texto,x.adjunto_ruta,auth.uid());
  update public.mensajes set texto='', eliminado=now(), eliminado_por=auth.uid() where id=m;
  delete from public.mensaje_reacciones where mensaje_id=m;
end $$;

-- 5) Reacciones (una por persona y mensaje; conjunto cerrado)
create table if not exists public.mensaje_reacciones(
  mensaje_id bigint not null references public.mensajes(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  cliente_id uuid not null, emoji text not null check (emoji in ('👍','❤️','😂','😮','🙏','✅')),
  creado timestamptz not null default now(), primary key(mensaje_id, usuario_id));
create index if not exists reacciones_cliente_idx on public.mensaje_reacciones(cliente_id);
alter table public.mensaje_reacciones enable row level security;
create or replace function public.reaccion_cliente() returns trigger language plpgsql security definer set search_path=public as $$
begin new.cliente_id := (select cliente_id from public.mensajes where id=new.mensaje_id); return new; end $$;
drop trigger if exists reaccion_cliente on public.mensaje_reacciones;
create trigger reaccion_cliente before insert or update on public.mensaje_reacciones for each row execute function public.reaccion_cliente();
drop policy if exists r_sel on public.mensaje_reacciones; create policy r_sel on public.mensaje_reacciones for select to authenticated using (public.puede_ver_mensaje(mensaje_id));
drop policy if exists r_ins on public.mensaje_reacciones; create policy r_ins on public.mensaje_reacciones for insert to authenticated
  with check (usuario_id=auth.uid() and public.puede_ver_mensaje(mensaje_id) and exists(select 1 from public.mensajes x where x.id=mensaje_id and x.eliminado is null));
drop policy if exists r_upd on public.mensaje_reacciones; create policy r_upd on public.mensaje_reacciones for update to authenticated
  using (usuario_id=auth.uid()) with check (usuario_id=auth.uid() and public.puede_ver_mensaje(mensaje_id));
drop policy if exists r_del on public.mensaje_reacciones; create policy r_del on public.mensaje_reacciones for delete to authenticated using (usuario_id=auth.uid());

-- 6) Lecturas: solo se registra cuando la persona abre la conversación en la app (evidencia real, no inferida)
create table if not exists public.chat_lecturas(
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  cliente_id uuid not null references public.profiles(id) on delete cascade,
  conv text not null, ultimo_id bigint not null, actualizado timestamptz not null default now(),
  primary key(usuario_id, cliente_id, conv));
alter table public.chat_lecturas enable row level security;
drop policy if exists l_sel on public.chat_lecturas; create policy l_sel on public.chat_lecturas for select to authenticated
  using (public.puede_ver_conv(cliente_id, case when conv='general' then null else conv::uuid end));
create or replace function public.marcar_leido(c uuid, p uuid, ultimo bigint) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.puede_ver_conv(c, p) then raise exception 'No autorizado'; end if;
  if not exists(select 1 from public.mensajes where id=ultimo and cliente_id=c and pedido_id is not distinct from p) then raise exception 'Mensaje inválido'; end if;
  insert into public.chat_lecturas(usuario_id,cliente_id,conv,ultimo_id) values(auth.uid(),c,coalesce(p::text,'general'),ultimo)
  on conflict (usuario_id,cliente_id,conv) do update set ultimo_id=greatest(chat_lecturas.ultimo_id,excluded.ultimo_id), actualizado=now();
end $$;

-- 7) Storage privado para adjuntos: carpeta = id de la tienda (cliente). Tipos y tamaño limitados; sin SVG/HTML.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat','chat',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','audio/webm','audio/ogg','audio/mp4'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists ch_ins on storage.objects; create policy ch_ins on storage.objects for insert to authenticated with check (
  bucket_id='chat' and owner=auth.uid() and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf|webm|ogg|m4a)$'
  and (((storage.foldername(name))[1] = auth.uid()::text) or public.mi_rol() in ('vendedor','administrador','bodega')));
create or replace function public.chat_objeto_huerfano(ruta text) returns boolean language sql stable security definer set search_path=public as
$$ select not exists(select 1 from public.mensajes x where x.adjunto_ruta=ruta)
      and not exists(select 1 from public.mensajes_historial h where h.adjunto_anterior=ruta) $$;
revoke all on function public.chat_objeto_huerfano(text) from anon, public; grant execute on function public.chat_objeto_huerfano(text) to authenticated;
-- Leer (y por tanto firmar URL temporal) solo si el objeto pertenece a un mensaje visible y no eliminado
drop policy if exists ch_sel on storage.objects; create policy ch_sel on storage.objects for select to authenticated using (
  bucket_id='chat' and exists(select 1 from public.mensajes x where x.adjunto_ruta=objects.name and x.eliminado is null
    and public.puede_ver_conv(x.cliente_id, x.pedido_id))
  or ((owner=auth.uid() or public.mi_rol()='administrador') and public.chat_objeto_huerfano(name)));
-- Borrar: solo objetos huérfanos (sin mensaje ni historial que los referencie): el propio subidor o el administrador
drop policy if exists ch_del on storage.objects; create policy ch_del on storage.objects for delete to authenticated using (
  bucket_id='chat' and (owner=auth.uid() or public.mi_rol()='administrador')
  and public.chat_objeto_huerfano(name));

create or replace function public.chat_huerfanos() returns setof text language sql stable security definer set search_path=public as $$
  select o.name from storage.objects o where o.bucket_id='chat' and public.mi_rol()='administrador'
    and coalesce(o.created_at, now()) < now() - interval '24 hours'
    and not exists(select 1 from public.mensajes x where x.adjunto_ruta=o.name)
    and not exists(select 1 from public.mensajes_historial h where h.adjunto_anterior=o.name) limit 500 $$;

revoke all on function public.adjunto_disponible(text,uuid) from anon, public; grant execute on function public.adjunto_disponible(text,uuid) to authenticated;
revoke all on function public.editar_mensaje(bigint,text), public.eliminar_mensaje(bigint), public.marcar_leido(uuid,uuid,bigint), public.chat_huerfanos() from anon, public;
grant execute on function public.editar_mensaje(bigint,text), public.eliminar_mensaje(bigint), public.marcar_leido(uuid,uuid,bigint), public.chat_huerfanos() to authenticated;

-- 8) Realtime: un canal por conversación abierta (no por mensaje)
do $$ begin
  begin alter publication supabase_realtime add table public.mensaje_reacciones; exception when others then null; end;
  begin alter publication supabase_realtime add table public.chat_lecturas; exception when others then null; end;
end $$;

alter table public.config add column if not exists version_esquema int not null default 3;
update public.config set version_esquema=greatest(version_esquema,6);
