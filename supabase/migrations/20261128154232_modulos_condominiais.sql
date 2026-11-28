create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

create table public.condominio_modulos (
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  modulo text not null check (modulo in ('comunicados','reservas','documentos')),
  habilitado boolean not null default false,
  primary key (condominio_id, modulo)
);

create table public.comunicados (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  mensagem text not null check (length(trim(mensagem)) between 1 and 4000),
  ativo boolean not null default true,
  publicado_em timestamptz not null default now()
);
create index comunicados_cond_data on public.comunicados(condominio_id, publicado_em desc);

create table public.documentos_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  categoria text not null check (categoria in ('Convenção','Regimento','Ata','Circular','Outros')),
  arquivo text generated always as (condominio_id::text || '/' || id::text || '.pdf') stored unique,
  ativo boolean not null default false,
  publicado_em timestamptz
);
create index documentos_cond_data on public.documentos_condominio(condominio_id, publicado_em desc);

create table public.espacos_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 100),
  regras text not null default '' check (length(regras) <= 1500),
  fuso text not null default 'America/Sao_Paulo'
    check (fuso in ('America/Noronha','America/Sao_Paulo','America/Manaus','America/Rio_Branco')),
  abertura int not null check (abertura between 0 and 1439),
  fechamento int not null check (fechamento between 1 and 1440),
  duracao int not null check (duracao in (30,60,90,120,180,240,480)),
  antecedencia_dias int not null default 30 check (antecedencia_dias between 1 and 90),
  ativo boolean not null default true,
  check (fechamento - abertura >= duracao),
  unique(condominio_id, nome),
  unique(id, condominio_id)
);

create table public.reservas_condominio (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  espaco_id uuid not null,
  dia date not null,
  inicio int not null check (inicio between 0 and 1439),
  fim int not null check (fim > inicio and fim <= 1440),
  unidade_id uuid references public.unidades(id) on delete set null,
  solicitante_id uuid references public.pessoas(id) on delete set null,
  bloqueio boolean not null default false,
  cancelada_em timestamptz,
  foreign key (espaco_id, condominio_id) references public.espacos_condominio(id, condominio_id),
  exclude using gist (espaco_id with =, dia with =, int4range(inicio, fim) with &&)
    where (cancelada_em is null)
);
create index reservas_cond_dia on public.reservas_condominio(condominio_id, dia);
create index reservas_unidade on public.reservas_condominio(unidade_id);
create index reservas_solicitante on public.reservas_condominio(solicitante_id);

alter table public.condominio_modulos enable row level security;
alter table public.comunicados enable row level security;
alter table public.documentos_condominio enable row level security;
alter table public.espacos_condominio enable row level security;
alter table public.reservas_condominio enable row level security;

revoke all on public.condominio_modulos, public.comunicados, public.documentos_condominio,
  public.espacos_condominio, public.reservas_condominio from public, anon, authenticated;
grant select on public.condominio_modulos, public.comunicados, public.documentos_condominio,
  public.espacos_condominio, public.reservas_condominio to authenticated;
grant insert (condominio_id, titulo, mensagem), update (titulo, mensagem, ativo) on public.comunicados to authenticated;
grant insert (id, condominio_id, titulo, categoria), update (titulo, categoria, ativo) on public.documentos_condominio to authenticated;
grant insert (condominio_id, nome, regras, fuso, abertura, fechamento, duracao, antecedencia_dias),
  update (nome, regras, abertura, fechamento, duracao, antecedencia_dias, ativo) on public.espacos_condominio to authenticated;

create policy ver_modulos on public.condominio_modulos for select to authenticated
  using (public.gerencia(condominio_id) or public.mora_no_condominio(condominio_id));
create function public.configurar_modulos(p_condominio uuid, p_modulos text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_admin() or auth.uid() is null then
    raise exception 'Somente administradores podem configurar módulos' using errcode='42501';
  end if;
  if p_modulos is null or not p_modulos <@ array['comunicados','reservas','documentos']::text[] then
    raise exception 'Seleção de módulos inválida' using errcode='22023';
  end if;
  insert into public.condominio_modulos(condominio_id,modulo,habilitado)
    select p_condominio, m, m=any(p_modulos) from unnest(array['comunicados','reservas','documentos']) m
  on conflict (condominio_id,modulo) do update set habilitado=excluded.habilitado;
end $$;
revoke execute on function public.configurar_modulos(uuid,text[]) from public, anon;
grant execute on function public.configurar_modulos(uuid,text[]) to authenticated;

create function public.modulo_habilitado(p_condominio uuid, p_modulo text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.condominio_modulos
    where condominio_id = p_condominio and modulo = p_modulo and habilitado);
$$;
revoke execute on function public.modulo_habilitado(uuid,text) from public, anon;
grant execute on function public.modulo_habilitado(uuid,text) to authenticated;

-- As três tabelas de conteúdo usam a mesma regra de gestão por condomínio.
do $$
declare item record;
begin
  for item in select * from (values ('comunicados','comunicados'),
    ('documentos_condominio','documentos'), ('espacos_condominio','reservas')) as v(tabela, modulo)
  loop
    execute format('create policy ler_conteudo on public.%I for select to authenticated
      using (public.modulo_habilitado(condominio_id,%L)
        and (public.gerencia(condominio_id) or (ativo and public.mora_no_condominio(condominio_id))))', item.tabela,item.modulo);
    execute format('create policy publicar_conteudo on public.%I for insert to authenticated
      with check (public.modulo_habilitado(condominio_id,%L) and public.gerencia(condominio_id))', item.tabela,item.modulo);
    execute format('create policy alterar_conteudo on public.%I for update to authenticated
      using (public.modulo_habilitado(condominio_id,%L) and public.gerencia(condominio_id))
      with check (public.modulo_habilitado(condominio_id,%L) and public.gerencia(condominio_id))', item.tabela,item.modulo,item.modulo);
  end loop;
end $$;

create policy ver_reservas on public.reservas_condominio for select to authenticated
  using (public.modulo_habilitado(condominio_id,'reservas')
    and (public.gerencia(condominio_id) or (solicitante_id = (select auth.uid())
      and unidade_id in (select public.minhas_unidades()))));

-- O calendário compartilhado revela apenas os intervalos ocupados.
create function public.horarios_ocupados(p_espaco uuid, p_dia date)
returns table(inicio int, fim int) language sql stable security definer set search_path = '' as $$
  select r.inicio, r.fim
  from public.reservas_condominio r
  join public.condominio_modulos m on m.condominio_id=r.condominio_id and m.modulo='reservas' and m.habilitado
  join public.espacos_condominio e on e.id=r.espaco_id
  where r.espaco_id=p_espaco and r.dia=p_dia and r.cancelada_em is null
    and (public.gerencia(r.condominio_id)
      or (e.ativo and public.mora_no_condominio(r.condominio_id)));
$$;

create function public.criar_reserva(p_espaco uuid, p_dia date, p_inicio int,
  p_unidade uuid default null, p_bloqueio boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_espaco public.espacos_condominio%rowtype;
  v_agora timestamp;
  v_id uuid;
begin
  select e.* into v_espaco from public.espacos_condominio e
  join public.condominio_modulos m on m.condominio_id=e.condominio_id and m.modulo='reservas' and m.habilitado
  where e.id = p_espaco and e.ativo for share of e,m;
  if not found or auth.uid() is null then
    raise exception 'Espaço indisponível' using errcode='42501';
  end if;

  if p_bloqueio is true then
    if p_unidade is not null or not public.gerencia(v_espaco.condominio_id) then
      raise exception 'A gestão do condomínio pode bloquear horários' using errcode='42501';
    end if;
  elsif p_bloqueio is null or not exists (
    select 1 from public.unidades u
    where u.id=p_unidade and u.condominio_id=v_espaco.condominio_id
      and u.id in (select public.minhas_unidades())
  ) then
    raise exception 'Selecione uma unidade vinculada ao seu perfil' using errcode='42501';
  end if;

  v_agora := timezone(v_espaco.fuso, now());
  if p_dia is null or p_inicio is null
    or p_dia not between v_agora::date and v_agora::date + v_espaco.antecedencia_dias
    or p_inicio not between v_espaco.abertura and (v_espaco.fechamento-v_espaco.duracao)
    or mod(p_inicio-v_espaco.abertura,v_espaco.duracao)<>0
    or p_dia+make_interval(mins=>p_inicio)<=v_agora then
    raise exception 'Horário fora das regras de reserva do espaço' using errcode='22023';
  end if;
  insert into public.reservas_condominio(condominio_id,espaco_id,dia,inicio,fim,unidade_id,solicitante_id,bloqueio)
    values (v_espaco.condominio_id,p_espaco,p_dia,p_inicio,p_inicio+v_espaco.duracao,p_unidade,auth.uid(),p_bloqueio)
    returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'Este horário já está ocupado. Escolha outro horário.' using errcode='23P01';
end $$;

create function public.cancelar_reserva(p_reserva uuid)
returns boolean language sql security definer set search_path = '' as $$
  with alteradas as (
    update public.reservas_condominio r set cancelada_em=now()
    from public.condominio_modulos m, public.espacos_condominio e
    where r.id=p_reserva and r.cancelada_em is null and auth.uid() is not null and e.id=r.espaco_id
      and r.condominio_id=m.condominio_id and m.modulo='reservas' and m.habilitado
      and r.dia+make_interval(mins=>r.inicio)>timezone(e.fuso, now())
      and (public.gerencia(r.condominio_id) or (not r.bloqueio and r.solicitante_id=(select auth.uid())
        and r.unidade_id in (select public.minhas_unidades())))
    returning 1
  ) select exists(select 1 from alteradas);
$$;

revoke execute on function public.horarios_ocupados(uuid,date),
  public.criar_reserva(uuid,date,int,uuid,boolean), public.cancelar_reserva(uuid) from public, anon;
grant execute on function public.horarios_ocupados(uuid,date),
  public.criar_reserva(uuid,date,int,uuid,boolean), public.cancelar_reserva(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('documentos-condominio','documentos-condominio',false,10485760,array['application/pdf']);

-- O objeto só pode ser baixado se o catálogo autorizar o solicitante.
create policy documentos_download on storage.objects for select to authenticated
  using (bucket_id='documentos-condominio' and exists(
    select 1 from public.documentos_condominio d where d.arquivo=storage.objects.name
  ));
create policy documentos_upload on storage.objects for insert to authenticated
  with check (bucket_id='documentos-condominio' and exists(
    select 1 from public.documentos_condominio d where d.arquivo=storage.objects.name and not d.ativo
      and public.gerencia(d.condominio_id)
  ));

create function private.publicar_pdf_enviado()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ativo and not old.ativo then
    if not exists(select 1 from storage.objects o
      where o.bucket_id='documentos-condominio' and o.name=old.arquivo) then
      raise exception 'Envie o PDF antes de publicar' using errcode='22023';
    end if;
    new.publicado_em := coalesce(old.publicado_em, now());
  end if;
  return new;
end $$;
revoke execute on function private.publicar_pdf_enviado() from public, anon, authenticated;
create trigger publicar_pdf before update of ativo on public.documentos_condominio
  for each row execute function private.publicar_pdf_enviado();

reset search_path;
