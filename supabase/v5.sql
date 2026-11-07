-- DistriPostobon v5: zonas/rutas, precios por tipo de cliente y descuentos por cantidad, cartera (abonos),
-- devoluciones, envases retornables, lotes con vencimiento y cierre diario.
-- Ejecutar DESPUÉS de v4.sql. Todo es configurable por el administrador: este archivo NO crea zonas,
-- tarifas, cupos, plazos, envases ni lotes. Registros operativos manuales; no es contabilidad ni facturación.
-- Fechas operativas en America/Bogota.

create or replace function public.hoy_co() returns date language sql stable as $$ select (now() at time zone 'America/Bogota')::date $$;
create or replace function public.es_admin() returns boolean language sql stable security definer set search_path=public as $$ select coalesce(public.mi_rol()='administrador',false) $$;

-- ========== 1) Zonas, días de entrega y ficha comercial del cliente ==========
create table if not exists public.zonas(
  id uuid primary key default gen_random_uuid(), nombre text not null unique check (length(trim(nombre)) between 1 and 60),
  dias int[] not null default '{}' check (dias <@ array[1,2,3,4,5,6,7]), activo boolean not null default true, creado timestamptz default now());
comment on column public.zonas.dias is 'Días ISO (1=lunes … 7=domingo). Vacío = cualquier día.';

create table if not exists public.tipos_cliente(
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,30}$'), nombre text not null check (length(trim(nombre)) between 1 and 60));

-- Ficha comercial separada de profiles: el cliente puede leerla pero no modificarla.
create table if not exists public.clientes_comercial(
  cliente_id uuid primary key references public.profiles(id) on delete cascade,
  zona_id uuid references public.zonas(id) on delete set null,
  vendedor_id uuid references public.profiles(id) on delete set null,
  tipo text references public.tipos_cliente(codigo) on update cascade on delete set null,
  cupo_credito numeric check (cupo_credito is null or cupo_credito >= 0),
  plazo_dias int check (plazo_dias is null or plazo_dias between 1 and 180),
  actualizado timestamptz default now());

create or replace function public.valida_cliente_comercial() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=new.cliente_id and rol='cliente') then raise exception 'La ficha comercial es solo para tiendas'; end if;
  if new.vendedor_id is not null and not exists(select 1 from public.profiles where id=new.vendedor_id and rol in ('vendedor','administrador')) then raise exception 'Vendedor inválido'; end if;
  new.actualizado:=now(); return new;
end $$;
drop trigger if exists cc_valida on public.clientes_comercial;
create trigger cc_valida before insert or update on public.clientes_comercial for each row execute function public.valida_cliente_comercial();

-- ========== 2) Precios por tipo de cliente y descuentos por cantidad ==========
create table if not exists public.precios_tipo(
  producto_id uuid not null references public.productos(id) on delete cascade,
  tipo text not null references public.tipos_cliente(codigo) on update cascade on delete cascade,
  precio numeric not null check (precio >= 0 and precio = round(precio)),
  primary key(producto_id, tipo));
create table if not exists public.descuentos_cantidad(
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  tipo text references public.tipos_cliente(codigo) on update cascade on delete cascade, -- null = todos
  min_cantidad int not null check (min_cantidad between 2 and 99999),
  porcentaje numeric not null check (porcentaje > 0 and porcentaje <= 90),
  unique nulls not distinct (producto_id, tipo, min_cantidad));

-- Precio unitario efectivo: precio del tipo (o lista), promo si es menor, luego el mayor descuento por cantidad aplicable.
create or replace function public.precio_para(p_prod uuid, p_tipo text, p_cant int) returns numeric language sql stable security definer set search_path=public as $$
  with b as (
    select least(coalesce((select precio from public.precios_tipo where producto_id=p.id and tipo=p_tipo), p.precio),
                 coalesce(p.precio_promo, 'Infinity'::numeric)) base
    from public.productos p where p.id=p_prod)
  select round(b.base * (1 - coalesce((select max(porcentaje) from public.descuentos_cantidad d
     where d.producto_id=p_prod and (d.tipo is null or d.tipo=p_tipo) and d.min_cantidad<=p_cant),0)/100)) from b $$;

-- Precios que ve la tienda autenticada (solo los suyos)
create or replace function public.mis_precios() returns table(producto_id uuid, precio numeric, descuentos jsonb) language sql stable security definer set search_path=public as $$
  select p.id, public.precio_para(p.id, cc.tipo, 1),
    coalesce((select jsonb_agg(jsonb_build_object('min',d.min_cantidad,'pct',d.porcentaje) order by d.min_cantidad) from public.descuentos_cantidad d where d.producto_id=p.id and (d.tipo is null or d.tipo=cc.tipo)),'[]')
  from public.productos p left join public.clientes_comercial cc on cc.cliente_id=auth.uid()
  where p.activo and auth.uid() is not null $$;

-- ========== 3) Cartera: ventas a crédito y abonos ==========
alter table public.pedidos add column if not exists condicion text not null default 'contado';
alter table public.pedidos add column if not exists vence_pago date;
do $$ begin alter table public.pedidos add constraint pedidos_condicion_chk check (condicion in ('contado','credito')); exception when duplicate_object then null; end $$;

create table if not exists public.abonos(
  id bigserial primary key,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  valor numeric not null check (valor <> 0 and valor = round(valor)),
  metodo text not null check (metodo in ('efectivo','transferencia','otro')),
  referencia text not null default '',
  idem uuid not null unique,
  reversa_de bigint unique references public.abonos(id),
  motivo text not null default '',
  usuario_id uuid references public.profiles(id) on delete set null,
  creado timestamptz not null default now(),
  check ((reversa_de is null) = (valor > 0)));
create index if not exists abonos_ped on public.abonos(pedido_id);

-- ========== 4) Devoluciones de producto ==========
create table if not exists public.devoluciones(
  id bigserial primary key,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  item_id bigint not null references public.pedido_items(id) on delete restrict,
  producto_id uuid references public.productos(id) on delete set null,
  cantidad int not null check (cantidad between 1 and 9999),
  destino text not null check (destino in ('reventa','averia')),
  valor numeric not null check (valor >= 0),
  motivo text not null check (length(trim(motivo)) > 0),
  idem uuid not null unique,
  usuario_id uuid references public.profiles(id) on delete set null,
  creado timestamptz not null default now());
create index if not exists dev_ped on public.devoluciones(pedido_id);

create or replace function public.saldo_pedido(p_pedido uuid) returns numeric language sql stable security definer set search_path=public as $$
  select p.total - coalesce((select sum(valor) from public.devoluciones where pedido_id=p.id),0)
                 - coalesce((select sum(valor) from public.abonos where pedido_id=p.id),0)
  from public.pedidos p where p.id=p_pedido $$;

-- ========== 4b) Envases / canastas retornables ==========
create table if not exists public.envases(
  id uuid primary key default gen_random_uuid(), nombre text not null unique check (length(trim(nombre)) between 1 and 60), activo boolean not null default true);
create table if not exists public.producto_envases(
  producto_id uuid not null references public.productos(id) on delete cascade,
  envase_id uuid not null references public.envases(id) on delete restrict,
  cantidad int not null check (cantidad between 1 and 999), primary key(producto_id, envase_id));
create table if not exists public.envases_mov(
  id bigserial primary key,
  cliente_id uuid not null references public.profiles(id) on delete restrict,
  envase_id uuid not null references public.envases(id) on delete restrict,
  cantidad int not null check (cantidad <> 0), -- + el cliente queda debiendo envases, − los devolvió
  tipo text not null check (tipo in ('entrega','devolucion','reverso')),
  pedido_id uuid references public.pedidos(id) on delete restrict,
  idem uuid unique, reversa_de bigint unique references public.envases_mov(id),
  nota text not null default '', usuario_id uuid references public.profiles(id) on delete set null,
  creado timestamptz not null default now());
create unique index if not exists envmov_entrega_unica on public.envases_mov(pedido_id, envase_id) where tipo='entrega';
create or replace function public.saldo_envase(p_cliente uuid, p_envase uuid) returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(cantidad),0)::int from public.envases_mov where cliente_id=p_cliente and envase_id=p_envase $$;

-- ========== 5) Lotes y vencimientos ==========
alter table public.productos add column if not exists exige_lote boolean not null default false;
create table if not exists public.lotes(
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  codigo text not null check (length(trim(codigo)) between 1 and 40),
  vence date not null,
  cantidad int not null default 0 check (cantidad >= 0),
  origen text not null default 'recepcion' check (origen in ('recepcion','declarado_activacion')),
  creado timestamptz not null default now(), unique(producto_id, codigo));
create table if not exists public.lote_consumos(
  id bigserial primary key,
  movimiento_id bigint not null references public.inventario_movimientos(id) on delete cascade,
  lote_id uuid not null references public.lotes(id) on delete cascade,
  cantidad int not null check (cantidad <> 0)); -- + salió del lote, − regresó al lote
create index if not exists lc_mov on public.lote_consumos(movimiento_id);

alter table public.inventario_movimientos drop constraint if exists inventario_movimientos_tipo_check;
alter table public.inventario_movimientos add constraint inventario_movimientos_tipo_check
  check (tipo in ('entrada','salida','ajuste','venta','devolucion','importacion','retorno','baja'));

-- mover_stock v5: igual que v4 y, si el producto exige lote, mueve también los lotes (FEFO) y concilia.
create or replace function public.mover_stock(p_prod uuid, p_delta int, p_tipo text, p_pedido uuid default null, p_nota text default '') returns int
language plpgsql security definer set search_path=public as $$
declare nuevo int; nom text; lote_req boolean; mid bigint; falta int; l record; tomar int; lote_fijo uuid; suma int;
begin
  perform set_config('dp.mov', '1', true);
  update public.productos set stock=stock+p_delta where id=p_prod and stock+p_delta>=0 returning stock, nombre, exige_lote into nuevo, nom, lote_req;
  perform set_config('dp.mov', '', true);
  if nuevo is null then
    select nombre into nom from public.productos where id=p_prod;
    if nom is null then raise exception 'Producto no existe'; end if;
    raise exception 'Sin stock suficiente de %', nom;
  end if;
  insert into public.inventario_movimientos(producto_id,tipo,cantidad,stock_resultante,pedido_id,nota,usuario_id)
  values(p_prod,p_tipo,p_delta,nuevo,p_pedido,left(coalesce(p_nota,''),200),auth.uid()) returning id into mid;
  if not lote_req then return nuevo; end if;

  lote_fijo := nullif(current_setting('dp.lote', true),'')::uuid;
  if lote_fijo is not null and not exists(select 1 from public.lotes where id=lote_fijo and producto_id=p_prod) then raise exception 'Lote no corresponde al producto'; end if;
  if p_delta < 0 then
    falta := -p_delta;
    for l in select * from public.lotes where producto_id=p_prod and cantidad>0
               and (lote_fijo is null or id=lote_fijo)
               and (p_tipo<>'venta' or vence >= public.hoy_co())
             order by vence, creado for update loop
      exit when falta=0;
      tomar := least(falta, l.cantidad);
      update public.lotes set cantidad=cantidad-tomar where id=l.id;
      insert into public.lote_consumos(movimiento_id,lote_id,cantidad) values(mid,l.id,tomar);
      falta := falta - tomar;
    end loop;
    if falta > 0 then
      if p_tipo='venta' then raise exception 'Sin stock vigente (no vencido) suficiente de %', nom; end if;
      raise exception 'Los lotes de % no cubren la salida', nom;
    end if;
  else
    if lote_fijo is not null then
      update public.lotes set cantidad=cantidad+p_delta where id=lote_fijo;
      insert into public.lote_consumos(movimiento_id,lote_id,cantidad) values(mid,lote_fijo,-p_delta);
    elsif p_tipo in ('devolucion','retorno') and p_pedido is not null then
      falta := p_delta; -- regresa a los lotes de los que salió este pedido
      for l in select c.lote_id, sum(c.cantidad)::int neto from public.lote_consumos c join public.inventario_movimientos m on m.id=c.movimiento_id
                where m.pedido_id=p_pedido and m.producto_id=p_prod group by c.lote_id having sum(c.cantidad)>0 order by c.lote_id loop
        exit when falta=0;
        tomar := least(falta, l.neto);
        update public.lotes set cantidad=cantidad+tomar where id=l.lote_id;
        insert into public.lote_consumos(movimiento_id,lote_id,cantidad) values(mid,l.lote_id,-tomar);
        falta := falta - tomar;
      end loop;
      if falta > 0 then raise exception 'No hay registro de lote para devolver % unidad(es) de % (vendidas antes de activar lotes); usa destino avería o registra entrada por lote', falta, nom; end if;
    else
      raise exception '% exige lote: registra la entrada con código de lote y vencimiento', nom;
    end if;
  end if;
  select coalesce(sum(cantidad),0) into suma from public.lotes where producto_id=p_prod;
  if suma <> nuevo then raise exception 'Lotes descuadrados para % (lotes %, stock %)', nom, suma, nuevo; end if;
  return nuevo;
end $$;
revoke all on function public.mover_stock(uuid,int,text,uuid,text) from anon, authenticated, public;

-- Productos con lote: el stock solo cambia por movimientos (evita descuadres por edición directa)
create or replace function public.protege_stock_lote() returns trigger language plpgsql as $$
begin
  if new.exige_lote and old.exige_lote and new.stock is distinct from old.stock and coalesce(current_setting('dp.mov', true),'')<>'1' then
    raise exception '% exige lote: el stock solo cambia con recepción, baja o ventas', new.nombre; end if;
  if old.exige_lote and not new.exige_lote then raise exception 'Desactivar lotes no está soportado en esta versión'; end if;
  return new;
end $$;
drop trigger if exists productos_stock_lote on public.productos;
create trigger productos_stock_lote before update on public.productos for each row execute function public.protege_stock_lote();

-- Activar exigencia de lote: el admin declara los lotes que hoy cubren TODO el stock actual (no se fabrica historia).
create or replace function public.activar_lotes(p_prod uuid, p_lotes jsonb) returns void language plpgsql security definer set search_path=public as $$
declare pr record; f jsonb; tot int:=0;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select * into pr from public.productos where id=p_prod for update;
  if not found then raise exception 'Producto no existe'; end if;
  if pr.exige_lote then raise exception 'El producto ya exige lote'; end if;
  if exists(select 1 from public.combo_componentes where combo_id=p_prod) then raise exception 'Los combos no manejan lote propio; activa lotes en sus componentes'; end if;
  if exists(select 1 from public.lotes where producto_id=p_prod) then raise exception 'El producto ya tiene lotes registrados'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_lotes,'[]')) loop
    if (f->>'cantidad')::int is null or (f->>'cantidad')::int < 0 then raise exception 'Cantidad de lote inválida'; end if;
    insert into public.lotes(producto_id,codigo,vence,cantidad,origen) values(p_prod, trim(f->>'codigo'), (f->>'vence')::date, (f->>'cantidad')::int, 'declarado_activacion');
    tot := tot + (f->>'cantidad')::int;
  end loop;
  if tot <> pr.stock then raise exception 'Los lotes declarados suman % y el stock actual es %; deben coincidir', tot, pr.stock; end if;
  update public.productos set exige_lote=true where id=p_prod;
end $$;

create or replace function public.recibir_lote(p_prod uuid, p_codigo text, p_vence date, p_cantidad int, p_nota text default '') returns int language plpgsql security definer set search_path=public as $$
declare lid uuid; v date; r int;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('bodega','administrador') then raise exception 'No autorizado'; end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 1000000 then raise exception 'Cantidad inválida'; end if;
  if p_vence is null then raise exception 'Fecha de vencimiento obligatoria'; end if;
  if not exists(select 1 from public.productos where id=p_prod and exige_lote) then raise exception 'Este producto no exige lote; usa Registrar movimiento'; end if;
  select id, vence into lid, v from public.lotes where producto_id=p_prod and codigo=trim(p_codigo) for update;
  if lid is null then insert into public.lotes(producto_id,codigo,vence) values(p_prod,trim(p_codigo),p_vence) returning id into lid;
  elsif v <> p_vence then raise exception 'El lote % ya existe con vencimiento %', trim(p_codigo), v; end if;
  perform set_config('dp.lote', lid::text, true);
  r := public.mover_stock(p_prod, p_cantidad, 'entrada', null, coalesce(nullif(trim(p_nota),''),'Recepción lote '||trim(p_codigo)));
  perform set_config('dp.lote', '', true);
  return r;
end $$;

create or replace function public.baja_lote(p_lote uuid, p_cantidad int, p_motivo text) returns int language plpgsql security definer set search_path=public as $$
declare pid uuid; r int;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('bodega','administrador') then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_motivo),'')='' then raise exception 'Escribe el motivo'; end if;
  if p_cantidad is null or p_cantidad < 1 then raise exception 'Cantidad inválida'; end if;
  select producto_id into pid from public.lotes where id=p_lote;
  if pid is null then raise exception 'Lote no existe'; end if;
  perform set_config('dp.lote', p_lote::text, true);
  r := public.mover_stock(pid, -p_cantidad, 'baja', null, p_motivo);
  perform set_config('dp.lote', '', true);
  return r;
end $$;

-- Con lotes activos, el conteo físico no puede subir stock sin lote (lo bloquea mover_stock).

-- ========== crear_pedido v5: precio por cliente, descuentos, zona/vendedor, crédito ==========
drop function if exists public.crear_pedido(jsonb,text,date,text);
create or replace function public.crear_pedido(p_items jsonb, p_notas text default '', p_fecha date default null, p_franja text default '', p_condicion text default 'contado')
returns json language plpgsql security definer set search_path=public as $$
declare pid uuid; cod text; tot numeric:=0; it jsonb; pr record; q int; minimo numeric; precio numeric; c record; cc record; z_nombre text; z_dias int[]; deuda numeric;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if coalesce((select rol from public.profiles where id=auth.uid()),'')<>'cliente' then raise exception 'Solo las tiendas pueden hacer pedidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'))=0 then raise exception 'El carrito está vacío'; end if;
  if jsonb_array_length(p_items)>100 then raise exception 'Demasiados productos en un pedido'; end if;
  if p_condicion not in ('contado','credito') then raise exception 'Condición de pago inválida'; end if;
  if p_fecha is not null and (p_fecha < public.hoy_co() or p_fecha > public.hoy_co() + 30) then raise exception 'Fecha de entrega inválida'; end if;
  select * into cc from public.clientes_comercial where cliente_id=auth.uid() for update;
  if cc.zona_id is not null then select nombre, dias into z_nombre, z_dias from public.zonas where id=cc.zona_id and activo; end if;
  if p_fecha is not null and cardinality(z_dias)>0 and not (extract(isodow from p_fecha)::int = any(z_dias)) then
    raise exception 'Tu zona (%) no tiene entregas ese día', z_nombre; end if;
  cod:=public.nuevo_codigo();
  insert into public.pedidos(codigo,cliente_id,notas,fecha_entrega,franja,vendedor_id,ruta,condicion)
  values(cod,auth.uid(),left(coalesce(p_notas,''),500),p_fecha,left(coalesce(p_franja,''),60),cc.vendedor_id,coalesce(z_nombre,''),p_condicion) returning id into pid;
  for it in select * from jsonb_array_elements(p_items) loop
    q:=(it->>'cantidad')::int;
    if q is null or q<1 or q>9999 then raise exception 'Cantidad inválida'; end if;
    select * into pr from public.productos where id=(it->>'producto_id')::uuid and activo for update;
    if not found then raise exception 'Un producto ya no está disponible'; end if;
    precio:=public.precio_para(pr.id, cc.tipo, q);
    perform public.mover_stock(pr.id,-q,'venta',pid,'Pedido '||cod);
    for c in select componente_id, cantidad from public.combo_componentes where combo_id=pr.id order by componente_id loop
      perform public.mover_stock(c.componente_id,-(c.cantidad*q),'venta',pid,'Componente de combo · pedido '||cod);
    end loop;
    insert into public.pedido_items(pedido_id,producto_id,nombre,presentacion,precio,precio_lista,cantidad) values(pid,pr.id,pr.nombre,pr.presentacion,precio,pr.precio,q);
    tot:=tot+precio*q;
  end loop;
  select pedido_minimo into minimo from public.config where id=1;
  if tot<coalesce(minimo,0) then raise exception 'El pedido mínimo es $%', minimo; end if;
  if p_condicion='credito' then
    if coalesce(cc.cupo_credito,0)<=0 or cc.plazo_dias is null then raise exception 'Tu tienda no tiene crédito habilitado'; end if;
    select coalesce(sum(public.saldo_pedido(id)),0) into deuda from public.pedidos where cliente_id=auth.uid() and condicion='credito' and estado<>'Cancelado' and id<>pid;
    if deuda + tot > cc.cupo_credito then raise exception 'Supera tu cupo de crédito (disponible $%)', greatest(cc.cupo_credito-deuda,0); end if;
    update public.pedidos set vence_pago=coalesce(p_fecha, public.hoy_co()) + cc.plazo_dias where id=pid;
  end if;
  update public.pedidos set total=tot where id=pid;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(pid,'Recibido',auth.uid());
  return json_build_object('id',pid,'codigo',cod,'total',tot);
end $$;

-- cambiar_estado v5: igual a v4; la reposición de pedidos antiguos ahora pasa por mover_stock (respeta lotes y deja rastro)
-- y no se cancela un pedido con abonos vigentes.
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
    if coalesce((select sum(valor) from public.abonos where pedido_id=p_pedido),0)<>0 then raise exception 'El pedido tiene abonos: el administrador debe reversarlos antes de cancelar'; end if;
    if exists(select 1 from public.inventario_movimientos where pedido_id=p_pedido and tipo='venta') then
      for m in select producto_id, sum(cantidad)::int s from public.inventario_movimientos where pedido_id=p_pedido and tipo in ('venta','devolucion') group by producto_id having sum(cantidad)<>0 loop
        perform public.mover_stock(m.producto_id, -m.s, 'devolucion', p_pedido, 'Cancelación de pedido');
      end loop;
    else -- pedidos anteriores a v4
      for m in select producto_id, sum(cantidad)::int s from public.pedido_items where pedido_id=p_pedido and producto_id is not null group by producto_id loop
        perform public.mover_stock(m.producto_id, m.s, 'devolucion', p_pedido, 'Cancelación de pedido anterior a v4');
      end loop;
    end if;
  end if;
  update public.pedidos set estado=p_estado, actualizado=now(), motivo_cancelacion=case when p_estado='Cancelado' then left(coalesce(p_motivo,''),300) else motivo_cancelacion end where id=p_pedido;
  insert into public.pedido_historial(pedido_id,estado,usuario_id) values(p_pedido,p_estado,auth.uid());
end $$;

-- entregar_pedido v5: además genera el saldo de envases (idempotente por pedido+envase)
create or replace function public.entregar_pedido(p_pedido uuid, p_recibio text, p_foto text default null, p_firma text default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if public.mi_rol() is null or public.mi_rol() not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_recibio),'')='' then raise exception 'Escribe quién recibió'; end if;
  if coalesce(trim(p_foto),'')='' and coalesce(trim(p_firma),'')='' then raise exception 'Agrega foto o firma como prueba de entrega'; end if;
  update public.pedidos set recibio=left(p_recibio,120), prueba_foto=nullif(trim(p_foto),''), prueba_firma=nullif(trim(p_firma),'') where id=p_pedido;
  perform set_config('dp.entrega', p_pedido::text, true);
  perform public.cambiar_estado(p_pedido,'Entregado');
  perform set_config('dp.entrega', '', true);
  insert into public.envases_mov(cliente_id,envase_id,cantidad,tipo,pedido_id,nota,usuario_id)
  select p.cliente_id, pe.envase_id, sum(pe.cantidad*i.cantidad)::int, 'entrega', p.id, 'Entrega pedido '||p.codigo, auth.uid()
    from public.pedidos p join public.pedido_items i on i.pedido_id=p.id join public.producto_envases pe on pe.producto_id=i.producto_id
   where p.id=p_pedido group by p.cliente_id, pe.envase_id, p.id, p.codigo
  on conflict do nothing;
end $$;

-- ========== RPC de cartera ==========
create or replace function public.registrar_abono(p_pedido uuid, p_valor numeric, p_metodo text, p_referencia text, p_idem uuid) returns bigint
language plpgsql security definer set search_path=public as $$
declare o record; ex record; nid bigint; saldo numeric;
begin
  if p_idem is null then raise exception 'Falta clave de idempotencia'; end if;
  select * into ex from public.abonos where idem=p_idem;
  if found then
    if ex.pedido_id=p_pedido and ex.valor=p_valor then return ex.id; end if; -- reintento del mismo abono
    raise exception 'Clave de abono ya usada con otros datos';
  end if;
  select * into o from public.pedidos where id=p_pedido for update;
  if not found then raise exception 'Pedido no existe'; end if;
  if not (public.es_admin() or (public.mi_rol()='vendedor' and o.vendedor_id=auth.uid())) then raise exception 'No autorizado: solo el administrador o el vendedor asignado'; end if;
  if o.estado='Cancelado' then raise exception 'El pedido está cancelado'; end if;
  if p_valor is null or p_valor<=0 or p_valor<>round(p_valor) or p_valor>1000000000 then raise exception 'Valor inválido (pesos enteros mayores a 0)'; end if;
  saldo := public.saldo_pedido(p_pedido);
  if p_valor > saldo then raise exception 'El abono ($%) supera el saldo ($%)', p_valor, greatest(saldo,0); end if;
  insert into public.abonos(pedido_id,valor,metodo,referencia,idem,usuario_id) values(p_pedido,p_valor,p_metodo,left(coalesce(p_referencia,''),80),p_idem,auth.uid()) returning id into nid;
  return nid;
end $$;

create or replace function public.reversar_abono(p_abono bigint, p_motivo text) returns bigint language plpgsql security definer set search_path=public as $$
declare a record; nid bigint;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede reversar abonos'; end if;
  if coalesce(trim(p_motivo),'')='' then raise exception 'Escribe el motivo del reverso'; end if;
  select * into a from public.abonos where id=p_abono for update;
  if not found or a.reversa_de is not null then raise exception 'Abono inválido'; end if;
  if exists(select 1 from public.abonos where reversa_de=p_abono) then raise exception 'Ese abono ya fue reversado'; end if;
  insert into public.abonos(pedido_id,valor,metodo,referencia,idem,reversa_de,motivo,usuario_id)
  values(a.pedido_id,-a.valor,a.metodo,a.referencia,gen_random_uuid(),a.id,left(p_motivo,200),auth.uid()) returning id into nid;
  return nid;
end $$;

-- ========== RPC de devoluciones ==========
create or replace function public.registrar_devolucion(p_item bigint, p_cantidad int, p_destino text, p_motivo text, p_idem uuid) returns bigint
language plpgsql security definer set search_path=public as $$
declare i record; o record; ya int; nid bigint; ex record;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if p_idem is null then raise exception 'Falta clave de idempotencia'; end if;
  select * into ex from public.devoluciones where idem=p_idem;
  if found then if ex.item_id=p_item and ex.cantidad=p_cantidad then return ex.id; end if; raise exception 'Clave de devolución ya usada con otros datos'; end if;
  if p_destino not in ('reventa','averia') then raise exception 'Destino inválido'; end if;
  if coalesce(trim(p_motivo),'')='' then raise exception 'Escribe el motivo'; end if;
  if p_cantidad is null or p_cantidad<1 then raise exception 'Cantidad inválida'; end if;
  select * into i from public.pedido_items where id=p_item;
  if not found then raise exception 'Ítem no existe'; end if;
  select * into o from public.pedidos where id=i.pedido_id for update;
  if o.estado<>'Entregado' then raise exception 'Solo se registran devoluciones de pedidos entregados'; end if;
  select coalesce(sum(cantidad),0) into ya from public.devoluciones where item_id=p_item;
  if ya + p_cantidad > i.cantidad then raise exception 'Supera lo entregado: entregadas %, ya devueltas %', i.cantidad, ya; end if;
  if p_destino='reventa' then
    if i.producto_id is null then raise exception 'El producto ya no existe; registra como avería'; end if;
    if exists(select 1 from public.combo_componentes where combo_id=i.producto_id) then raise exception 'Combos: registra como avería o desarma y reingresa sus componentes'; end if;
    perform public.mover_stock(i.producto_id, p_cantidad, 'retorno', o.id, 'Devolución apta · '||left(p_motivo,150));
  end if;
  insert into public.devoluciones(pedido_id,item_id,producto_id,cantidad,destino,valor,motivo,idem,usuario_id)
  values(o.id,p_item,i.producto_id,p_cantidad,p_destino,i.precio*p_cantidad,left(p_motivo,200),p_idem,auth.uid()) returning id into nid;
  return nid;
end $$;

-- ========== RPC de envases ==========
create or replace function public.devolver_envases(p_cliente uuid, p_envase uuid, p_cantidad int, p_nota text, p_idem uuid) returns bigint
language plpgsql security definer set search_path=public as $$
declare s int; nid bigint; ex record;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('vendedor','bodega','administrador') then raise exception 'No autorizado'; end if;
  if p_idem is null then raise exception 'Falta clave de idempotencia'; end if;
  select * into ex from public.envases_mov where idem=p_idem;
  if found then if ex.cliente_id=p_cliente and ex.cantidad=-p_cantidad then return ex.id; end if; raise exception 'Clave ya usada con otros datos'; end if;
  if p_cantidad is null or p_cantidad<1 then raise exception 'Cantidad inválida'; end if;
  perform pg_advisory_xact_lock(hashtext('env_'||p_cliente||p_envase));
  s := public.saldo_envase(p_cliente,p_envase);
  if p_cantidad > s then raise exception 'La tienda solo tiene % envase(s) pendientes', s; end if;
  insert into public.envases_mov(cliente_id,envase_id,cantidad,tipo,idem,nota,usuario_id) values(p_cliente,p_envase,-p_cantidad,'devolucion',p_idem,left(coalesce(p_nota,''),200),auth.uid()) returning id into nid;
  return nid;
end $$;

create or replace function public.reversar_envase_mov(p_mov bigint, p_motivo text) returns bigint language plpgsql security definer set search_path=public as $$
declare m record; nid bigint;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede reversar'; end if;
  if coalesce(trim(p_motivo),'')='' then raise exception 'Escribe el motivo'; end if;
  select * into m from public.envases_mov where id=p_mov for update;
  if not found or m.tipo='reverso' then raise exception 'Movimiento inválido'; end if;
  if exists(select 1 from public.envases_mov where reversa_de=p_mov) then raise exception 'Ya fue reversado'; end if;
  perform pg_advisory_xact_lock(hashtext('env_'||m.cliente_id||m.envase_id));
  if public.saldo_envase(m.cliente_id,m.envase_id) - m.cantidad < 0 then raise exception 'El reverso dejaría el saldo negativo'; end if;
  insert into public.envases_mov(cliente_id,envase_id,cantidad,tipo,reversa_de,nota,usuario_id) values(m.cliente_id,m.envase_id,-m.cantidad,'reverso',p_mov,left(p_motivo,200),auth.uid()) returning id into nid;
  return nid;
end $$;

-- ========== 6) Cierre diario ==========
create table if not exists public.cierres(
  id bigserial primary key, fecha date not null, resumen jsonb not null,
  efectivo_declarado numeric not null check (efectivo_declarado >= 0 and efectivo_declarado = round(efectivo_declarado)),
  diferencia numeric not null, notas text not null default '',
  usuario_id uuid references public.profiles(id) on delete set null, creado timestamptz not null default now(),
  anulado_motivo text, anulado_por uuid references public.profiles(id) on delete set null, anulado_en timestamptz);
create unique index if not exists cierre_unico on public.cierres(fecha) where anulado_motivo is null;

create or replace function public.resumen_dia(p_fecha date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d0 timestamptz := (p_fecha::timestamp at time zone 'America/Bogota'); d1 timestamptz := ((p_fecha+1)::timestamp at time zone 'America/Bogota'); r jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select jsonb_build_object(
    'fecha', p_fecha,
    'entregas', (select jsonb_build_object('pedidos',count(*),'total',coalesce(sum(p.total),0),
        'contado',coalesce(sum(p.total) filter (where p.condicion='contado'),0),'credito',coalesce(sum(p.total) filter (where p.condicion='credito'),0))
      from public.pedidos p where p.estado='Entregado' and exists(select 1 from public.pedido_historial h where h.pedido_id=p.id and h.estado='Entregado' and h.creado>=d0 and h.creado<d1)),
    'abonos', (select jsonb_build_object('efectivo',coalesce(sum(valor) filter (where metodo='efectivo'),0),'transferencia',coalesce(sum(valor) filter (where metodo='transferencia'),0),
        'otro',coalesce(sum(valor) filter (where metodo='otro'),0),'reversos',count(*) filter (where reversa_de is not null),'registros',count(*))
      from public.abonos where creado>=d0 and creado<d1),
    'devoluciones', (select jsonb_build_object('registros',count(*),'valor',coalesce(sum(valor),0),'reventa_unid',coalesce(sum(cantidad) filter (where destino='reventa'),0),'averia_unid',coalesce(sum(cantidad) filter (where destino='averia'),0))
      from public.devoluciones where creado>=d0 and creado<d1),
    'envases', (select jsonb_build_object('entregados',coalesce(sum(cantidad) filter (where tipo='entrega'),0),'devueltos',coalesce(-sum(cantidad) filter (where tipo='devolucion'),0),'reversos',count(*) filter (where tipo='reverso'))
      from public.envases_mov where creado>=d0 and creado<d1),
    'pendientes_entrega', (select count(*) from public.pedidos where fecha_entrega=p_fecha and estado not in ('Entregado','Cancelado'))
  ) into r;
  return r;
end $$;

create or replace function public.cerrar_dia(p_fecha date, p_efectivo numeric, p_notas text default '') returns bigint language plpgsql security definer set search_path=public as $$
declare r jsonb; nid bigint;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  if p_fecha is null or p_fecha > public.hoy_co() then raise exception 'No se puede cerrar un día futuro'; end if;
  if p_efectivo is null or p_efectivo<0 or p_efectivo<>round(p_efectivo) then raise exception 'Efectivo declarado inválido'; end if;
  perform pg_advisory_xact_lock(hashtext('cierre_'||p_fecha));
  if exists(select 1 from public.cierres where fecha=p_fecha and anulado_motivo is null) then raise exception 'Ese día ya está cerrado; anula el cierre para rehacerlo'; end if;
  r := public.resumen_dia(p_fecha);
  insert into public.cierres(fecha,resumen,efectivo_declarado,diferencia,notas,usuario_id)
  values(p_fecha,r,p_efectivo,p_efectivo-(r->'abonos'->>'efectivo')::numeric,left(coalesce(p_notas,''),500),auth.uid()) returning id into nid;
  return nid;
end $$;

create or replace function public.anular_cierre(p_cierre bigint, p_motivo text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_motivo),'')='' then raise exception 'Escribe el motivo'; end if;
  update public.cierres set anulado_motivo=left(p_motivo,200), anulado_por=auth.uid(), anulado_en=now() where id=p_cierre and anulado_motivo is null;
  if not found then raise exception 'Cierre inexistente o ya anulado'; end if;
end $$;

-- ========== RLS (mínimo privilegio) ==========
alter table public.zonas enable row level security;
alter table public.tipos_cliente enable row level security;
alter table public.clientes_comercial enable row level security;
alter table public.precios_tipo enable row level security;
alter table public.descuentos_cantidad enable row level security;
alter table public.abonos enable row level security;
alter table public.devoluciones enable row level security;
alter table public.envases enable row level security;
alter table public.producto_envases enable row level security;
alter table public.envases_mov enable row level security;
alter table public.lotes enable row level security;
alter table public.lote_consumos enable row level security;
alter table public.cierres enable row level security;

drop policy if exists z_sel on public.zonas; create policy z_sel on public.zonas for select to authenticated using (true);
drop policy if exists z_adm on public.zonas; create policy z_adm on public.zonas for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists tc_sel on public.tipos_cliente; create policy tc_sel on public.tipos_cliente for select to authenticated using (public.es_staff());
drop policy if exists tc_adm on public.tipos_cliente; create policy tc_adm on public.tipos_cliente for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists ccm_sel on public.clientes_comercial; create policy ccm_sel on public.clientes_comercial for select to authenticated
  using (cliente_id=auth.uid() or public.mi_rol() in ('vendedor','administrador'));
drop policy if exists ccm_adm on public.clientes_comercial; create policy ccm_adm on public.clientes_comercial for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists pt_sel on public.precios_tipo; create policy pt_sel on public.precios_tipo for select to authenticated using (public.es_staff());
drop policy if exists pt_adm on public.precios_tipo; create policy pt_adm on public.precios_tipo for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists dc_sel on public.descuentos_cantidad; create policy dc_sel on public.descuentos_cantidad for select to authenticated using (public.es_staff());
drop policy if exists dc_adm on public.descuentos_cantidad; create policy dc_adm on public.descuentos_cantidad for all to authenticated using (public.es_admin()) with check (public.es_admin());
-- Abonos: admin todo; vendedor solo de sus pedidos asignados; tienda solo los suyos. Escritura solo por RPC.
drop policy if exists ab_sel on public.abonos; create policy ab_sel on public.abonos for select to authenticated using (
  public.es_admin() or exists(select 1 from public.pedidos x where x.id=pedido_id and (x.cliente_id=auth.uid() or (public.mi_rol()='vendedor' and x.vendedor_id=auth.uid()))));
drop policy if exists dv_sel on public.devoluciones; create policy dv_sel on public.devoluciones for select to authenticated using (
  public.es_staff() or exists(select 1 from public.pedidos x where x.id=pedido_id and x.cliente_id=auth.uid()));
drop policy if exists en_sel on public.envases; create policy en_sel on public.envases for select to authenticated using (true);
drop policy if exists en_adm on public.envases; create policy en_adm on public.envases for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists pe_sel2 on public.producto_envases; create policy pe_sel2 on public.producto_envases for select to authenticated using (true);
drop policy if exists pe_adm on public.producto_envases; create policy pe_adm on public.producto_envases for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists em_sel on public.envases_mov; create policy em_sel on public.envases_mov for select to authenticated using (public.es_staff() or cliente_id=auth.uid());
drop policy if exists lo_sel on public.lotes; create policy lo_sel on public.lotes for select to authenticated using (public.es_staff());
drop policy if exists lc_sel on public.lote_consumos; create policy lc_sel on public.lote_consumos for select to authenticated using (public.es_staff());
drop policy if exists ci_sel on public.cierres; create policy ci_sel on public.cierres for select to authenticated using (public.es_admin());

revoke all on function public.precio_para(uuid,text,int), public.saldo_pedido(uuid), public.saldo_envase(uuid,uuid) from anon, authenticated, public;
revoke all on function public.mis_precios(), public.crear_pedido(jsonb,text,date,text,text), public.entregar_pedido(uuid,text,text,text),
  public.registrar_abono(uuid,numeric,text,text,uuid), public.reversar_abono(bigint,text), public.registrar_devolucion(bigint,int,text,text,uuid),
  public.devolver_envases(uuid,uuid,int,text,uuid), public.reversar_envase_mov(bigint,text), public.activar_lotes(uuid,jsonb),
  public.recibir_lote(uuid,text,date,int,text), public.baja_lote(uuid,int,text), public.resumen_dia(date), public.cerrar_dia(date,numeric,text),
  public.anular_cierre(bigint,text) from anon, public;
grant execute on function public.mis_precios(), public.crear_pedido(jsonb,text,date,text,text), public.entregar_pedido(uuid,text,text,text),
  public.registrar_abono(uuid,numeric,text,text,uuid), public.reversar_abono(bigint,text), public.registrar_devolucion(bigint,int,text,text,uuid),
  public.devolver_envases(uuid,uuid,int,text,uuid), public.reversar_envase_mov(bigint,text), public.activar_lotes(uuid,jsonb),
  public.recibir_lote(uuid,text,date,int,text), public.baja_lote(uuid,int,text), public.resumen_dia(date), public.cerrar_dia(date,numeric,text),
  public.anular_cierre(bigint,text) to authenticated;

-- Saldos visibles para la tienda y el equipo autorizado (vista con security_invoker respeta RLS de pedidos)
create or replace view public.cartera with (security_invoker = true) as
  select p.id pedido_id, p.codigo, p.cliente_id, p.vendedor_id, p.estado, p.condicion, p.total, p.vence_pago, p.creado,
    coalesce((select sum(valor) from public.abonos a where a.pedido_id=p.id),0) abonado,
    coalesce((select sum(valor) from public.devoluciones d where d.pedido_id=p.id),0) devuelto,
    p.total - coalesce((select sum(valor) from public.abonos a where a.pedido_id=p.id),0) - coalesce((select sum(valor) from public.devoluciones d where d.pedido_id=p.id),0) saldo
  from public.pedidos p where p.estado<>'Cancelado'
    and (public.es_admin() or p.cliente_id=auth.uid() or (public.mi_rol()='vendedor' and p.vendedor_id=auth.uid()));
grant select on public.cartera to authenticated;
