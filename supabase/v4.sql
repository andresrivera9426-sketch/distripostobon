-- DistriPostobon v4: importación atómica, transiciones de pedido, movimientos de inventario y combos.
-- Ejecutar DESPUÉS de esquema.sql y v3.sql. Reversión: v4_revertir.sql (no borra productos ni pedidos).

-- 1) Movimientos de inventario (solo se escriben desde funciones; delta con signo)
create table if not exists public.inventario_movimientos(
  id bigserial primary key,
  producto_id uuid not null references public.productos(id) on delete cascade,
  tipo text not null check (tipo in ('entrada','salida','ajuste','venta','devolucion','importacion')),
  cantidad int not null,
  stock_resultante int not null,
  pedido_id uuid references public.pedidos(id) on delete set null,
  nota text not null default '',
  usuario_id uuid references public.profiles(id) on delete set null,
  creado timestamptz not null default now());
create index if not exists inv_mov_prod on public.inventario_movimientos(producto_id, creado desc);
create index if not exists inv_mov_ped on public.inventario_movimientos(pedido_id);
alter table public.inventario_movimientos enable row level security;
drop policy if exists im_sel on public.inventario_movimientos;
create policy im_sel on public.inventario_movimientos for select to authenticated using (public.es_staff());

-- 2) Componentes de combos: al vender un combo se descuenta también el stock de cada componente
create table if not exists public.combo_componentes(
  combo_id uuid not null references public.productos(id) on delete cascade,
  componente_id uuid not null references public.productos(id) on delete restrict,
  cantidad int not null check (cantidad between 1 and 999),
  primary key(combo_id, componente_id),
  check (combo_id <> componente_id));
alter table public.combo_componentes enable row level security;
drop policy if exists cc_sel on public.combo_componentes;
create policy cc_sel on public.combo_componentes for select to anon, authenticated using (true);
drop policy if exists cc_all on public.combo_componentes;
create policy cc_all on public.combo_componentes for all to authenticated using (public.mi_rol()='administrador') with check (public.mi_rol()='administrador');
-- Un componente no puede ser a su vez un combo (evita ciclos y descuentos en cascada)
create or replace function public.valida_combo() returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.combo_componentes where combo_id=new.componente_id) then raise exception 'Un componente no puede ser otro combo'; end if;
  if exists(select 1 from public.combo_componentes where componente_id=new.combo_id) then raise exception 'Este combo ya es componente de otro combo'; end if;
  return new;
end $$;
drop trigger if exists combo_valida on public.combo_componentes;
create trigger combo_valida before insert or update on public.combo_componentes for each row execute function public.valida_combo();

-- Mueve stock y deja rastro. Falla si el stock quedaría negativo.
create or replace function public.mover_stock(p_prod uuid, p_delta int, p_tipo text, p_pedido uuid default null, p_nota text default '') returns int
language plpgsql security definer set search_path=public as $$
declare nuevo int; nom text;
begin
  update public.productos set stock=stock+p_delta where id=p_prod and stock+p_delta>=0 returning stock, nombre into nuevo, nom;
  if nuevo is null then
    select nombre into nom from public.productos where id=p_prod;
    if nom is null then raise exception 'Producto no existe'; end if;
    raise exception 'Sin stock suficiente de %', nom;
  end if;
  insert into public.inventario_movimientos(producto_id,tipo,cantidad,stock_resultante,pedido_id,nota,usuario_id)
  values(p_prod,p_tipo,p_delta,nuevo,p_pedido,left(coalesce(p_nota,''),200),auth.uid());
  return nuevo;
end $$;
revoke all on function public.mover_stock(uuid,int,text,uuid,text) from anon, authenticated, public;

-- Ajuste manual (bodega/admin): entrada, salida o conteo físico (ajuste fija el stock)
create or replace function public.ajustar_inventario(p_prod uuid, p_tipo text, p_cantidad int, p_nota text default '') returns int
language plpgsql security definer set search_path=public as $$
declare actual int;
begin
  if public.mi_rol() not in ('bodega','administrador') then raise exception 'No autorizado'; end if;
  if p_cantidad is null or p_cantidad<0 or p_cantidad>1000000 then raise exception 'Cantidad inválida'; end if;
  if coalesce(trim(p_nota),'')='' then raise exception 'Escribe el motivo del movimiento'; end if;
  select stock into actual from public.productos where id=p_prod for update;
  if actual is null then raise exception 'Producto no existe'; end if;
  if p_tipo='entrada' then return public.mover_stock(p_prod,p_cantidad,'entrada',null,p_nota);
  elsif p_tipo='salida' then return public.mover_stock(p_prod,-p_cantidad,'salida',null,p_nota);
  elsif p_tipo='ajuste' then
    if p_cantidad=actual then return actual; end if;
    return public.mover_stock(p_prod,p_cantidad-actual,'ajuste',null,p_nota);
  end if;
  raise exception 'Tipo de movimiento inválido';
end $$;

-- 3) Importación atómica: todo el lote o nada. p_filas = [{nombre,categoria,presentacion,precio,precio_promo,stock,activo,destacado,descripcion,foto_url}]
create or replace function public.importar_productos(p_filas jsonb) returns json language plpgsql security definer set search_path=public as $$
declare f jsonb; ex record; creados int:=0; actualizados int:=0; n int:=0; nid uuid; k text; claves text[]:='{}';
  v_nombre text; v_pres text; v_precio numeric; v_promo numeric; v_stock int;
begin
  if public.mi_rol() is distinct from 'administrador' then raise exception 'No autorizado'; end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas)=0 then raise exception 'El archivo no tiene filas'; end if;
  if jsonb_array_length(p_filas)>2000 then raise exception 'Máximo 2000 filas por importación'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    n:=n+1;
    v_nombre:=left(trim(coalesce(f->>'nombre','')),120); v_pres:=left(trim(coalesce(f->>'presentacion','')),60);
    if v_nombre='' then raise exception 'Fila %: falta el nombre', n; end if;
    begin v_precio:=(f->>'precio')::numeric; v_stock:=(f->>'stock')::int; v_promo:=nullif(f->>'precio_promo','')::numeric;
    exception when others then raise exception 'Fila %: precio o stock inválido', n; end;
    if v_precio is null or v_precio<0 then raise exception 'Fila %: precio inválido', n; end if;
    if v_stock is null or v_stock<0 then raise exception 'Fila %: stock inválido', n; end if;
    if v_promo is not null and (v_promo<0 or v_promo>=v_precio) then v_promo:=null; end if;
    k:=lower(v_nombre)||'|'||lower(v_pres);
    if k = any(claves) then raise exception 'Fila %: producto duplicado en el archivo (%)', n, v_nombre; end if;
    claves:=claves||k;
    select id, stock, foto_url into ex from public.productos
     where case when nullif(f->>'id','') is not null then id=(f->>'id')::uuid else lower(nombre)=lower(v_nombre) and lower(presentacion)=lower(v_pres) end
     order by creado limit 1 for update;
    if not found and nullif(f->>'id','') is not null then raise exception 'Fila %: el producto a actualizar ya no existe', n; end if;
    if found then
      update public.productos set nombre=v_nombre, presentacion=v_pres, categoria=coalesce(nullif(left(trim(f->>'categoria'),40),''),'General'), precio=v_precio, precio_promo=v_promo,
        activo=coalesce((f->>'activo')::boolean,true), destacado=coalesce((f->>'destacado')::boolean,false),
        descripcion=left(coalesce(f->>'descripcion',''),140), foto_url=coalesce(nullif(f->>'foto_url',''),ex.foto_url)
       where id=ex.id;
      if v_stock<>ex.stock then perform public.mover_stock(ex.id, v_stock-ex.stock, 'importacion', null, 'Importación Excel (reemplaza stock)'); end if;
      actualizados:=actualizados+1;
    else
      insert into public.productos(nombre,categoria,presentacion,precio,precio_promo,stock,activo,destacado,descripcion,foto_url)
      values(v_nombre, coalesce(nullif(left(trim(f->>'categoria'),40),''),'General'), v_pres, v_precio, v_promo, 0,
        coalesce((f->>'activo')::boolean,true), coalesce((f->>'destacado')::boolean,false), left(coalesce(f->>'descripcion',''),140), nullif(f->>'foto_url',''))
      returning id into nid;
      if v_stock>0 then perform public.mover_stock(nid, v_stock, 'importacion', null, 'Importación Excel (producto nuevo)'); end if;
      creados:=creados+1;
    end if;
  end loop;
  return json_build_object('creados',creados,'actualizados',actualizados);
end $$;

-- 4) Pedidos: crear con descuento de componentes de combos y movimientos
create or replace function public.crear_pedido(p_items jsonb, p_notas text default '', p_fecha date default null, p_franja text default '') returns json language plpgsql security definer set search_path=public as $$
declare pid uuid; cod text; tot numeric:=0; it jsonb; pr record; q int; minimo numeric; precio numeric; c record;
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
    precio:=coalesce(pr.precio_promo,pr.precio);
    perform public.mover_stock(pr.id,-q,'venta',pid,'Pedido '||cod);
    for c in select componente_id, cantidad from public.combo_componentes where combo_id=pr.id order by componente_id loop
      perform public.mover_stock(c.componente_id,-(c.cantidad*q),'venta',pid,'Componente de combo · pedido '||cod);
    end loop;
    insert into public.pedido_items(pedido_id,producto_id,nombre,presentacion,precio,precio_lista,cantidad) values(pid,pr.id,pr.nombre,pr.presentacion,precio,pr.precio,q);
    tot:=tot+precio*q;
  end loop;
  select pedido_minimo into minimo from public.config where id=1;
  if tot<coalesce(minimo,0) then raise exception 'El pedido mínimo es $%', minimo; end if;
  update public.pedidos set total=tot where id=pid;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(pid,'Recibido',auth.uid());
  return json_build_object('id',pid,'codigo',cod,'total',tot);
end $$;

-- Transiciones permitidas (una sola fuente de verdad)
create or replace function public.transicion_valida(p_de text, p_a text) returns boolean language sql immutable as $$
  select (p_de, p_a) in (('Recibido','Confirmado'),('Confirmado','Alistando'),('Alistando','En ruta'),('En ruta','Entregado'),
    ('Recibido','Cancelado'),('Confirmado','Cancelado'),('Alistando','Cancelado'),('En ruta','Cancelado')) $$;

create or replace function public.cambiar_estado(p_pedido uuid, p_estado text, p_motivo text default '') returns void language plpgsql security definer set search_path=public as $$
declare r text := public.mi_rol(); ant text; dueno uuid; m record;
begin
  select estado, cliente_id into ant, dueno from public.pedidos where id=p_pedido for update;
  if ant is null then raise exception 'Pedido no existe'; end if;
  if r='cliente' then
    if dueno<>auth.uid() or p_estado<>'Cancelado' then raise exception 'No autorizado'; end if;
    if ant<>'Recibido' then raise exception 'Solo puedes cancelar mientras el pedido está Recibido. Escribe a tu vendedor.'; end if;
  elsif r is null or r not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if r='bodega' and p_estado not in ('Alistando','En ruta','Entregado') then raise exception 'Bodega solo puede marcar Alistando, En ruta o Entregado'; end if;
  if ant in ('Entregado','Cancelado') then raise exception 'El pedido ya está cerrado'; end if;
  if not public.transicion_valida(ant, p_estado) then raise exception 'No se puede pasar de % a %', ant, p_estado; end if;
  if p_estado='Entregado' and coalesce(current_setting('dp.entrega', true),'')<>p_pedido::text then
    raise exception 'Para marcar Entregado registra quién recibió y la prueba (foto o firma)';
  end if;
  if p_estado='Cancelado' then
    if exists(select 1 from public.inventario_movimientos where pedido_id=p_pedido and tipo='venta') then
      for m in select producto_id, sum(cantidad)::int s from public.inventario_movimientos where pedido_id=p_pedido and tipo in ('venta','devolucion') group by producto_id having sum(cantidad)<>0 loop
        perform public.mover_stock(m.producto_id, -m.s, 'devolucion', p_pedido, 'Cancelación de pedido');
      end loop;
    else -- pedidos anteriores a v4: sin movimientos registrados
      update public.productos p set stock=p.stock+i.cantidad from public.pedido_items i where i.pedido_id=p_pedido and i.producto_id=p.id;
    end if;
  end if;
  update public.pedidos set estado=p_estado, actualizado=now(), motivo_cancelacion=case when p_estado='Cancelado' then left(coalesce(p_motivo,''),300) else motivo_cancelacion end where id=p_pedido;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(p_pedido,p_estado,auth.uid());
end $$;

create or replace function public.entregar_pedido(p_pedido uuid, p_recibio text, p_foto text default null, p_firma text default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if public.mi_rol() is null or public.mi_rol() not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_recibio),'')='' then raise exception 'Escribe quién recibió'; end if;
  if coalesce(trim(p_foto),'')='' and coalesce(trim(p_firma),'')='' then raise exception 'Agrega foto o firma como prueba de entrega'; end if;
  update public.pedidos set recibio=left(p_recibio,120), prueba_foto=nullif(trim(p_foto),''), prueba_firma=nullif(trim(p_firma),'') where id=p_pedido;
  perform set_config('dp.entrega', p_pedido::text, true);
  perform public.cambiar_estado(p_pedido,'Entregado');
  perform set_config('dp.entrega', '', true);
end $$;

revoke all on function public.ajustar_inventario(uuid,text,int,text), public.importar_productos(jsonb), public.crear_pedido(jsonb,text,date,text), public.cambiar_estado(uuid,text,text), public.entregar_pedido(uuid,text,text,text) from anon, public;
grant execute on function public.ajustar_inventario(uuid,text,int,text), public.importar_productos(jsonb), public.crear_pedido(jsonb,text,date,text), public.cambiar_estado(uuid,text,text), public.entregar_pedido(uuid,text,text,text) to authenticated;

-- Marca de versión: la app activa los módulos solo cuando la base la reporta.
alter table public.config add column if not exists version_esquema int not null default 3;
update public.config set version_esquema=greatest(version_esquema,4) where id=1;
