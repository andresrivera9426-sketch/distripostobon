-- DistriPostobon: esquema, seguridad (RLS) y funciones
create extension if not exists pgcrypto;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '', cedula text not null default '', telefono text not null default '',
  direccion text not null default '', correo text not null default '',
  rol text not null default 'cliente' check (rol in ('cliente','vendedor','bodega','administrador')),
  sala text not null default encode(gen_random_bytes(12),'hex'),
  creado timestamptz not null default now());

create table if not exists public.config(
  id int primary key default 1 check (id=1),
  pedido_minimo numeric not null default 0,
  whatsapp_vendedor text not null default '',
  actualizado timestamptz default now());
insert into public.config(id) values(1) on conflict do nothing;

create table if not exists public.productos(
  id uuid primary key default gen_random_uuid(),
  nombre text not null, categoria text not null default 'General', presentacion text not null default '',
  precio numeric not null check (precio>=0), stock int not null default 0 check (stock>=0),
  foto_url text, activo boolean not null default true, creado timestamptz default now());

create table if not exists public.pedidos(
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  cliente_id uuid not null references public.profiles(id) on delete cascade,
  estado text not null default 'Recibido' check (estado in ('Recibido','Confirmado','Alistando','En ruta','Entregado','Cancelado')),
  total numeric not null default 0, notas text default '',
  sala text not null default encode(gen_random_bytes(12),'hex'),
  creado timestamptz default now(), actualizado timestamptz default now());

create table if not exists public.pedido_items(
  id bigserial primary key, pedido_id uuid not null references public.pedidos(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  nombre text not null, presentacion text default '', precio numeric not null, cantidad int not null check (cantidad>0));

create table if not exists public.pedido_historial(
  id bigserial primary key, pedido_id uuid not null references public.pedidos(id) on delete cascade,
  estado text not null, usuario_id uuid references public.profiles(id) on delete set null, creado timestamptz default now());

create table if not exists public.mensajes(
  id bigserial primary key,
  cliente_id uuid not null references public.profiles(id) on delete cascade,
  pedido_id uuid references public.pedidos(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  texto text not null check (length(texto) between 1 and 2000),
  creado timestamptz default now());

-- Helpers
create or replace function public.mi_rol() returns text language sql stable security definer set search_path=public as
$$ select rol from public.profiles where id=auth.uid() $$;
create or replace function public.es_staff() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select rol in ('vendedor','bodega','administrador') from public.profiles where id=auth.uid()),false) $$;

-- Nuevo usuario -> perfil
create or replace function public.nuevo_usuario() returns trigger language plpgsql security definer set search_path=public as $$
declare m jsonb := coalesce(new.raw_user_meta_data,'{}'::jsonb); r text := 'cliente';
begin
  if lower(new.email)='andresrivera9426@gmail.com' and not exists(select 1 from public.profiles where rol='administrador') then r:='administrador'; end if;
  insert into public.profiles(id,nombre,cedula,telefono,direccion,correo,rol)
  values(new.id, coalesce(m->>'nombre',''), coalesce(m->>'cedula',''), coalesce(m->>'telefono',''), coalesce(m->>'direccion',''), lower(new.email), r);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.nuevo_usuario();

-- Límites de roles y protección del rol
create or replace function public.validar_rol() returns trigger language plpgsql security definer set search_path=public as $$
declare lim int; n int;
begin
  if tg_op='UPDATE' and new.rol is distinct from old.rol and auth.uid() is not null and coalesce(public.mi_rol(),'')<>'administrador' then
    raise exception 'Solo el administrador puede cambiar roles';
  end if;
  if tg_op='UPDATE' and new.correo is distinct from old.correo and auth.uid() is not null then new.correo:=old.correo; end if;
  lim := case new.rol when 'administrador' then 1 when 'vendedor' then 4 when 'bodega' then 2 else null end;
  if lim is not null and (tg_op='INSERT' or new.rol is distinct from old.rol) then
    perform pg_advisory_xact_lock(hashtext('rol_'||new.rol));
    select count(*) into n from public.profiles where rol=new.rol and id<>new.id;
    if n>=lim then raise exception 'Límite alcanzado: máximo % usuario(s) con rol %', lim, new.rol; end if;
  end if;
  return new;
end $$;
drop trigger if exists t_validar_rol on public.profiles;
create trigger t_validar_rol before insert or update on public.profiles for each row execute function public.validar_rol();

create or replace function public.asignar_rol(p_usuario uuid, p_rol text) returns void language plpgsql security definer set search_path=public as $$
begin
  if public.mi_rol()<>'administrador' then raise exception 'No autorizado'; end if;
  if p_rol not in ('cliente','vendedor','bodega') then raise exception 'Rol no permitido'; end if;
  if p_usuario=auth.uid() then raise exception 'No puedes cambiar tu propio rol'; end if;
  update public.profiles set rol=p_rol where id=p_usuario;
end $$;

-- Código de pedido
create or replace function public.nuevo_codigo() returns text language plpgsql as $$
declare c text; a text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin loop
  c:='DP-'; for i in 1..5 loop c:=c||substr(a,1+floor(random()*length(a))::int,1); end loop;
  exit when not exists(select 1 from public.pedidos where codigo=c);
end loop; return c; end $$;

create or replace function public.crear_pedido(p_items jsonb, p_notas text default '') returns json language plpgsql security definer set search_path=public as $$
declare pid uuid; cod text; tot numeric:=0; it jsonb; pr record; q int; minimo numeric;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'))=0 then raise exception 'El carrito está vacío'; end if;
  cod:=public.nuevo_codigo();
  insert into public.pedidos(codigo,cliente_id,notas) values(cod,auth.uid(),left(coalesce(p_notas,''),500)) returning id into pid;
  for it in select * from jsonb_array_elements(p_items) loop
    q:=(it->>'cantidad')::int;
    if q is null or q<1 or q>9999 then raise exception 'Cantidad inválida'; end if;
    select * into pr from public.productos where id=(it->>'producto_id')::uuid and activo for update;
    if not found then raise exception 'Producto no disponible'; end if;
    if pr.stock<q then raise exception 'Sin stock suficiente de %', pr.nombre; end if;
    update public.productos set stock=stock-q where id=pr.id;
    insert into public.pedido_items(pedido_id,producto_id,nombre,presentacion,precio,cantidad) values(pid,pr.id,pr.nombre,pr.presentacion,pr.precio,q);
    tot:=tot+pr.precio*q;
  end loop;
  select pedido_minimo into minimo from public.config where id=1;
  if tot<coalesce(minimo,0) then raise exception 'El pedido mínimo es $%', minimo; end if;
  update public.pedidos set total=tot where id=pid;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(pid,'Recibido',auth.uid());
  return json_build_object('id',pid,'codigo',cod,'total',tot);
end $$;

create or replace function public.cambiar_estado(p_pedido uuid, p_estado text) returns void language plpgsql security definer set search_path=public as $$
declare r text := public.mi_rol(); ant text;
begin
  if r not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if p_estado not in ('Recibido','Confirmado','Alistando','En ruta','Entregado','Cancelado') then raise exception 'Estado inválido'; end if;
  if r='bodega' and p_estado not in ('Alistando','En ruta','Entregado') then raise exception 'Bodega solo puede marcar Alistando, En ruta o Entregado'; end if;
  select estado into ant from public.pedidos where id=p_pedido for update;
  if ant is null then raise exception 'Pedido no existe'; end if;
  if ant in ('Entregado','Cancelado') then raise exception 'El pedido ya está cerrado'; end if;
  if p_estado='Cancelado' then
    update public.productos p set stock=p.stock+i.cantidad from public.pedido_items i where i.pedido_id=p_pedido and i.producto_id=p.id;
  end if;
  update public.pedidos set estado=p_estado, actualizado=now() where id=p_pedido;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(p_pedido,p_estado,auth.uid());
end $$;

-- Datos del vendedor visibles para clientes (solo nombre y teléfono del personal de ventas)
create or replace function public.contacto_ventas() returns table(nombre text, telefono text) language sql stable security definer set search_path=public as
$$ select nombre, telefono from public.profiles where rol in ('vendedor','administrador') and auth.uid() is not null order by rol desc $$;

-- RLS
alter table public.profiles enable row level security;
alter table public.config enable row level security;
alter table public.productos enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;
alter table public.pedido_historial enable row level security;
alter table public.mensajes enable row level security;

drop policy if exists p_sel on public.profiles; create policy p_sel on public.profiles for select to authenticated
  using (id=auth.uid() or public.mi_rol() in ('vendedor','administrador')
         or (public.mi_rol()='bodega' and exists(select 1 from public.pedidos x where x.cliente_id=profiles.id)));
drop policy if exists p_upd on public.profiles; create policy p_upd on public.profiles for update to authenticated
  using (id=auth.uid() or public.mi_rol()='administrador') with check (id=auth.uid() or public.mi_rol()='administrador');

drop policy if exists c_sel on public.config; create policy c_sel on public.config for select to anon, authenticated using (true);
drop policy if exists c_upd on public.config; create policy c_upd on public.config for update to authenticated using (public.mi_rol()='administrador');

drop policy if exists pr_sel on public.productos; create policy pr_sel on public.productos for select to anon, authenticated using (activo or public.es_staff());
drop policy if exists pr_all on public.productos; create policy pr_all on public.productos for all to authenticated using (public.mi_rol()='administrador') with check (public.mi_rol()='administrador');

drop policy if exists pe_sel on public.pedidos; create policy pe_sel on public.pedidos for select to authenticated using (cliente_id=auth.uid() or public.es_staff());
drop policy if exists pi_sel on public.pedido_items; create policy pi_sel on public.pedido_items for select to authenticated
  using (exists(select 1 from public.pedidos x where x.id=pedido_id and (x.cliente_id=auth.uid() or public.es_staff())));
drop policy if exists ph_sel on public.pedido_historial; create policy ph_sel on public.pedido_historial for select to authenticated
  using (exists(select 1 from public.pedidos x where x.id=pedido_id and (x.cliente_id=auth.uid() or public.es_staff())));

drop policy if exists m_sel on public.mensajes; create policy m_sel on public.mensajes for select to authenticated
  using (cliente_id=auth.uid() or public.mi_rol() in ('vendedor','administrador')
         or (public.mi_rol()='bodega' and pedido_id is not null));
drop policy if exists m_ins on public.mensajes; create policy m_ins on public.mensajes for insert to authenticated
  with check (autor_id=auth.uid() and (
     (cliente_id=auth.uid() and (pedido_id is null or exists(select 1 from public.pedidos x where x.id=pedido_id and x.cliente_id=auth.uid())))
     or public.mi_rol() in ('vendedor','administrador')
     or (public.mi_rol()='bodega' and pedido_id is not null)));

revoke all on function public.asignar_rol(uuid,text), public.crear_pedido(jsonb,text), public.cambiar_estado(uuid,text), public.contacto_ventas() from anon, public;
grant execute on function public.asignar_rol(uuid,text), public.crear_pedido(jsonb,text), public.cambiar_estado(uuid,text), public.contacto_ventas() to authenticated;
revoke execute on function public.nuevo_codigo() from anon, authenticated, public;

-- Realtime
do $$ begin
  begin alter publication supabase_realtime add table public.pedidos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.pedido_historial; exception when others then null; end;
  begin alter publication supabase_realtime add table public.mensajes; exception when others then null; end;
end $$;

-- Storage: fotos de productos
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('productos','productos',true,3145728,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists f_ins on storage.objects; create policy f_ins on storage.objects for insert to authenticated with check (bucket_id='productos' and public.mi_rol()='administrador');
drop policy if exists f_upd on storage.objects; create policy f_upd on storage.objects for update to authenticated using (bucket_id='productos' and public.mi_rol()='administrador');
drop policy if exists f_del on storage.objects; create policy f_del on storage.objects for delete to authenticated using (bucket_id='productos' and public.mi_rol()='administrador');

-- El administrador solo se asigna cuando el correo está confirmado
create or replace function public.nuevo_usuario() returns trigger language plpgsql security definer set search_path=public as $$
declare m jsonb := coalesce(new.raw_user_meta_data,'{}'::jsonb);
begin
  insert into public.profiles(id,nombre,cedula,telefono,direccion,correo,rol)
  values(new.id, coalesce(m->>'nombre',''), coalesce(m->>'cedula',''), coalesce(m->>'telefono',''), coalesce(m->>'direccion',''), lower(new.email), 'cliente');
  perform public.promover_admin(new.id, new.email, new.email_confirmed_at);
  return new;
end $$;
create or replace function public.promover_admin(p_id uuid, p_email text, p_conf timestamptz) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_conf is not null and lower(p_email)='andresrivera9426@gmail.com' and not exists(select 1 from public.profiles where rol='administrador') then
    update public.profiles set rol='administrador' where id=p_id;
  end if;
end $$;
revoke execute on function public.promover_admin(uuid,text,timestamptz) from anon, authenticated, public;
create or replace function public.usuario_confirmado() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then perform public.promover_admin(new.id,new.email,new.email_confirmed_at); end if;
  return new;
end $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update on auth.users for each row execute function public.usuario_confirmado();
