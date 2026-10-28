-- DistriPostobon v3: promociones, banners, favoritos, entrega programada, asignación, cancelación, calificación, prueba de entrega
alter table public.productos add column if not exists precio_promo numeric check (precio_promo is null or precio_promo>=0);
alter table public.productos add column if not exists destacado boolean not null default false;
alter table public.productos add column if not exists descripcion text not null default '';
alter table public.config add column if not exists stock_alerta int not null default 10;
alter table public.config add column if not exists franjas text[] not null default array['Mañana (8 a. m. – 12 m.)','Tarde (2 p. m. – 6 p. m.)'];
alter table public.pedidos add column if not exists fecha_entrega date;
alter table public.pedidos add column if not exists franja text default '';
alter table public.pedidos add column if not exists vendedor_id uuid references public.profiles(id) on delete set null;
alter table public.pedidos add column if not exists ruta text default '';
alter table public.pedidos add column if not exists calificacion int check (calificacion between 1 and 5);
alter table public.pedidos add column if not exists comentario_calif text default '';
alter table public.pedidos add column if not exists recibio text default '';
alter table public.pedidos add column if not exists prueba_foto text;
alter table public.pedidos add column if not exists prueba_firma text;
alter table public.pedidos add column if not exists motivo_cancelacion text default '';
alter table public.pedido_items add column if not exists precio_lista numeric;

create table if not exists public.banners(
  id uuid primary key default gen_random_uuid(), titulo text not null, texto text not null default '',
  imagen_url text, color text not null default '#0b5cab', activo boolean not null default true, orden int not null default 0, creado timestamptz default now());
create table if not exists public.favoritos(
  cliente_id uuid not null references public.profiles(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  primary key(cliente_id,producto_id));
alter table public.banners enable row level security;
alter table public.favoritos enable row level security;
drop policy if exists b_sel on public.banners; create policy b_sel on public.banners for select to anon, authenticated using (activo or public.mi_rol()='administrador');
drop policy if exists b_all on public.banners; create policy b_all on public.banners for all to authenticated using (public.mi_rol()='administrador') with check (public.mi_rol()='administrador');
drop policy if exists fv_all on public.favoritos; create policy fv_all on public.favoritos for all to authenticated using (cliente_id=auth.uid()) with check (cliente_id=auth.uid());

drop function if exists public.crear_pedido(jsonb,text);
create or replace function public.crear_pedido(p_items jsonb, p_notas text default '', p_fecha date default null, p_franja text default '') returns json language plpgsql security definer set search_path=public as $$
declare pid uuid; cod text; tot numeric:=0; it jsonb; pr record; q int; minimo numeric; precio numeric;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if coalesce((select rol from public.profiles where id=auth.uid()),'')<>'cliente' then raise exception 'Solo las tiendas pueden hacer pedidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'))=0 then raise exception 'El carrito está vacío'; end if;
  if jsonb_array_length(p_items)>100 then raise exception 'Demasiados productos en un pedido'; end if;
  if p_fecha is not null and (p_fecha < (now() at time zone 'America/Bogota')::date or p_fecha > (now() at time zone 'America/Bogota')::date + 30) then raise exception 'Fecha de entrega inválida'; end if;
  cod:=public.nuevo_codigo();
  insert into public.pedidos(codigo,cliente_id,notas,fecha_entrega,franja) values(cod,auth.uid(),left(coalesce(p_notas,''),500),p_fecha,left(coalesce(p_franja,''),60)) returning id into pid;
  for it in select * from jsonb_array_elements(p_items) loop
    q:=(it->>'cantidad')::int;
    if q is null or q<1 or q>9999 then raise exception 'Cantidad inválida'; end if;
    select * into pr from public.productos where id=(it->>'producto_id')::uuid and activo for update;
    if not found then raise exception 'Un producto ya no está disponible'; end if;
    if pr.stock<q then raise exception 'Sin stock suficiente de %', pr.nombre; end if;
    precio:=coalesce(pr.precio_promo,pr.precio);
    update public.productos set stock=stock-q where id=pr.id;
    insert into public.pedido_items(pedido_id,producto_id,nombre,presentacion,precio,precio_lista,cantidad) values(pid,pr.id,pr.nombre,pr.presentacion,precio,pr.precio,q);
    tot:=tot+precio*q;
  end loop;
  select pedido_minimo into minimo from public.config where id=1;
  if tot<coalesce(minimo,0) then raise exception 'El pedido mínimo es $%', minimo; end if;
  update public.pedidos set total=tot where id=pid;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(pid,'Recibido',auth.uid());
  return json_build_object('id',pid,'codigo',cod,'total',tot);
end $$;

create or replace function public.cambiar_estado(p_pedido uuid, p_estado text, p_motivo text default '') returns void language plpgsql security definer set search_path=public as $$
declare r text := public.mi_rol(); ant text; dueno uuid;
begin
  select estado, cliente_id into ant, dueno from public.pedidos where id=p_pedido for update;
  if ant is null then raise exception 'Pedido no existe'; end if;
  if r='cliente' then
    if dueno<>auth.uid() or p_estado<>'Cancelado' then raise exception 'No autorizado'; end if;
    if ant<>'Recibido' then raise exception 'Solo puedes cancelar mientras el pedido está Recibido. Escribe a tu vendedor.'; end if;
  elsif r not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if p_estado not in ('Recibido','Confirmado','Alistando','En ruta','Entregado','Cancelado') then raise exception 'Estado inválido'; end if;
  if r='bodega' and p_estado not in ('Alistando','En ruta','Entregado') then raise exception 'Bodega solo puede marcar Alistando, En ruta o Entregado'; end if;
  if ant in ('Entregado','Cancelado') then raise exception 'El pedido ya está cerrado'; end if;
  if p_estado='Cancelado' then
    update public.productos p set stock=p.stock+i.cantidad from public.pedido_items i where i.pedido_id=p_pedido and i.producto_id=p.id;
  end if;
  update public.pedidos set estado=p_estado, actualizado=now(), motivo_cancelacion=case when p_estado='Cancelado' then left(coalesce(p_motivo,''),300) else motivo_cancelacion end where id=p_pedido;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(p_pedido,p_estado,auth.uid());
end $$;

create or replace function public.entregar_pedido(p_pedido uuid, p_recibio text, p_foto text default null, p_firma text default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if public.mi_rol() not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_recibio),'')='' then raise exception 'Escribe quién recibió'; end if;
  if p_foto is null and p_firma is null then raise exception 'Agrega foto o firma como prueba de entrega'; end if;
  update public.pedidos set recibio=left(p_recibio,120), prueba_foto=p_foto, prueba_firma=p_firma where id=p_pedido;
  perform public.cambiar_estado(p_pedido,'Entregado');
end $$;

create or replace function public.asignar_pedido(p_pedido uuid, p_vendedor uuid, p_ruta text default '') returns void language plpgsql security definer set search_path=public as $$
begin
  if public.mi_rol() not in ('vendedor','administrador') then raise exception 'No autorizado'; end if;
  if p_vendedor is not null and not exists(select 1 from public.profiles where id=p_vendedor and rol in ('vendedor','administrador')) then raise exception 'Vendedor inválido'; end if;
  update public.pedidos set vendedor_id=p_vendedor, ruta=left(coalesce(p_ruta,''),80), actualizado=now() where id=p_pedido;
end $$;

create or replace function public.calificar_pedido(p_pedido uuid, p_estrellas int, p_comentario text default '') returns void language plpgsql security definer set search_path=public as $$
begin
  if p_estrellas not between 1 and 5 then raise exception 'Calificación inválida'; end if;
  update public.pedidos set calificacion=p_estrellas, comentario_calif=left(coalesce(p_comentario,''),300)
   where id=p_pedido and cliente_id=auth.uid() and estado='Entregado';
  if not found then raise exception 'Solo puedes calificar tus pedidos entregados'; end if;
end $$;

create or replace function public.equipo_ventas() returns table(id uuid, nombre text) language sql stable security definer set search_path=public as
$$ select id, nombre from public.profiles where rol in ('vendedor','administrador') and public.es_staff() order by nombre $$;

revoke all on function public.crear_pedido(jsonb,text,date,text), public.cambiar_estado(uuid,text,text), public.entregar_pedido(uuid,text,text,text), public.asignar_pedido(uuid,uuid,text), public.calificar_pedido(uuid,int,text), public.equipo_ventas() from anon, public;
grant execute on function public.crear_pedido(jsonb,text,date,text), public.cambiar_estado(uuid,text,text), public.entregar_pedido(uuid,text,text,text), public.asignar_pedido(uuid,uuid,text), public.calificar_pedido(uuid,int,text), public.equipo_ventas() to authenticated;
drop function if exists public.cambiar_estado(uuid,text);
drop function if exists public.contacto_ventas();

-- Bucket privado para pruebas de entrega: ruta <cliente_id>/<pedido_id>-*.{webp,png}
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('entregas','entregas',false,3145728,array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
drop policy if exists e_ins on storage.objects; create policy e_ins on storage.objects for insert to authenticated with check (bucket_id='entregas' and public.es_staff());
drop policy if exists e_sel on storage.objects; create policy e_sel on storage.objects for select to authenticated using (bucket_id='entregas' and (public.es_staff() or (storage.foldername(name))[1]=auth.uid()::text));
drop policy if exists f_ins on storage.objects; create policy f_ins on storage.objects for insert to authenticated with check (bucket_id='productos' and public.mi_rol()='administrador');

do $$ begin begin alter publication supabase_realtime add table public.productos; exception when others then null; end; end $$;
