create schema if not exists private;

create table private.contas_config (
  singleton boolean primary key default true check (singleton),
  principal_id uuid not null references public.pessoas(id) on delete restrict
);

-- Em um projeto existente, a primeira conta administrativa confirmada é a titular.
insert into private.contas_config (principal_id)
select p.id from public.pessoas p join auth.users a on a.id = p.id
where p.tipo_usuario = 'ADMINISTRADOR' and a.email_confirmed_at is not null
order by p.criado_em nulls last, p.id
limit 1;

create table public.pedidos_acesso (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 120),
  email text not null unique check (char_length(email) <= 254),
  referencia text check (char_length(referencia) <= 160),
  status text not null default 'PENDENTE' check (status in ('PENDENTE','APROVADO','RECUSADO')),
  solicitado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por uuid,
  envio_id uuid,
  envio_ate timestamptz,
  convite_enviado_em timestamptz
);

alter table public.pedidos_acesso enable row level security;
revoke all on public.pedidos_acesso from public, anon, authenticated;
grant select (id, nome, email, referencia, status, solicitado_em, decidido_em, convite_enviado_em)
  on public.pedidos_acesso to authenticated;
create policy pedidos_admin_select on public.pedidos_acesso for select to authenticated
  using ((select public.eh_admin()));
create index pedidos_acesso_fila on public.pedidos_acesso (status, solicitado_em desc);

create function public.solicitar_acesso(p_nome text, p_email text, p_referencia text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := trim(p_nome);
  v_email text := lower(trim(p_email));
  v_referencia text := nullif(trim(p_referencia), '');
begin
  if v_nome is null or char_length(v_nome) not between 2 and 120
    or v_email is null or char_length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(v_referencia) > 160 then
    raise exception 'Confira o nome e o e-mail informados' using errcode = '22023';
  end if;

  -- Uma solicitação por e-mail. A resposta é a mesma para pedidos repetidos e contas existentes.
  insert into public.pedidos_acesso (nome, email, referencia)
  select v_nome, v_email, v_referencia
  where not exists (select 1 from auth.users a where lower(a.email) = v_email)
  on conflict (email) do update set
    nome = excluded.nome, referencia = excluded.referencia,
    status = 'PENDENTE', solicitado_em = now(), decidido_em = null, decidido_por = null
  where pedidos_acesso.status = 'RECUSADO'
    and pedidos_acesso.decidido_em < now() - interval '1 day';
end $$;

create function public.eh_admin_principal()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.contas_config c join public.pessoas p on p.id = c.principal_id
    where p.id = (select auth.uid()) and p.tipo_usuario = 'ADMINISTRADOR'
  );
$$;

create or replace function public.proteger_tipo_usuario() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'postgres' then return new; end if;
  if not public.eh_admin() then
    if new.tipo_usuario is distinct from old.tipo_usuario or new.email is distinct from old.email then
      raise exception 'Somente o administrador pode alterar o perfil ou e-mail cadastrado' using errcode = '42501';
    end if;
  elsif (old.tipo_usuario = 'ADMINISTRADOR' or new.tipo_usuario = 'ADMINISTRADOR')
      and not public.eh_admin_principal() and
      (new.tipo_usuario is distinct from old.tipo_usuario or new.email is distinct from old.email) then
    raise exception 'Somente o administrador principal pode alterar contas administrativas' using errcode = '42501';
  elsif public.eh_admin_principal() and old.id = (select auth.uid())
      and new.tipo_usuario is distinct from old.tipo_usuario then
    raise exception 'O administrador principal deve manter seu perfil administrativo' using errcode = '42501';
  end if;
  return new;
end $$;

create function public.recusar_pedido_acesso(p_pedido uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Acesso restrito' using errcode = '42501'; end if;
  update public.pedidos_acesso set status = 'RECUSADO', decidido_em = now(), decidido_por = auth.uid(),
    envio_id = null, envio_ate = null
  where id = p_pedido and status = 'PENDENTE' and (envio_ate is null or envio_ate < now())
    and not exists (select 1 from auth.users a where lower(a.email) = pedidos_acesso.email);
  return found;
end $$;

-- O pedido é reservado enquanto o servidor envia o convite, para impedir decisões concorrentes.
create function public.reservar_convite_acesso(p_pedido uuid)
returns table (id_envio uuid, email text, nome text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Acesso restrito' using errcode = '42501'; end if;
  -- Reconcilia um convite utilizado se a confirmação chegou antes do retorno do envio.
  update public.pedidos_acesso p set status = 'APROVADO', decidido_em = coalesce(p.decidido_em, a.invited_at),
    decidido_por = coalesce(p.decidido_por, auth.uid()), convite_enviado_em = coalesce(p.convite_enviado_em, a.invited_at),
    envio_id = null, envio_ate = null
  from auth.users a
  where p.id = p_pedido and p.status = 'PENDENTE' and lower(a.email) = p.email
    and a.invited_at >= p.solicitado_em and a.email_confirmed_at is not null;
  return query
    update public.pedidos_acesso as p set envio_id = gen_random_uuid(), envio_ate = now() + interval '2 minutes'
    where p.id = p_pedido and p.status in ('PENDENTE', 'APROVADO')
      and (p.envio_ate is null or p.envio_ate < now())
      and (p.convite_enviado_em is null or p.convite_enviado_em < now() - interval '2 minutes')
      and not exists (
        select 1 from auth.users a where lower(a.email) = p.email
          and (a.invited_at is null or a.email_confirmed_at is not null)
      )
    returning p.envio_id, p.email, p.nome;
end $$;

create function public.finalizar_convite_acesso(p_envio uuid, p_sucesso boolean, p_admin uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.pedidos_acesso set
    status = case when p_sucesso then 'APROVADO' else status end,
    decidido_em = case when p_sucesso then coalesce(decidido_em, now()) else decidido_em end,
    decidido_por = case when p_sucesso then coalesce(decidido_por, p_admin) else decidido_por end,
    convite_enviado_em = case when p_sucesso then now() else convite_enviado_em end,
    envio_id = null, envio_ate = null
  where envio_id = p_envio;
  return found;
end $$;

-- O Auth registra invited_at antes de concluir a transação do convite.
-- Cadastros públicos não podem escolher uma senha nem criar uma conta diretamente.
create function private.validar_novo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.contas_config) then return new; end if;
  if coalesce(new.encrypted_password, '') <> '' or new.is_anonymous or new.email is null or not exists (
    select 1 from public.pedidos_acesso p where p.email = lower(new.email)
      and p.status in ('PENDENTE','APROVADO') and p.envio_id is not null and p.envio_ate >= now()
  ) then
    raise exception 'A criação de contas requer aprovação pelo portal' using errcode = '42501';
  end if;
  return new;
end $$;

create function private.confirmar_criacao_por_convite()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.contas_config)
    and not exists (select 1 from auth.users where id = new.id and invited_at is not null) then
    raise exception 'A criação de contas requer convite do portal' using errcode = '42501';
  end if;
  return null;
end $$;

create trigger trg_validar_novo_usuario before insert on auth.users
  for each row execute function private.validar_novo_usuario();
create constraint trigger trg_confirmar_criacao_por_convite after insert on auth.users
  deferrable initially deferred for each row execute function private.confirmar_criacao_por_convite();

create function public.conta_precisa_definir_senha()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid()) and invited_at is not null and coalesce(encrypted_password, '') = ''
  );
$$;

create or replace function public.ativar_convites_confirmados() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null or new.email is null
    or (new.invited_at is not null and coalesce(new.encrypted_password, '') = '') then return new; end if;
  with convites_confirmados as (
    update public.convites as c set usado_em = now()
    where lower(c.email) = lower(new.email) and c.usado_em is null
    returning c.unidade_id, c.tipo_vinculo, c.criado_em, c.id
  )
  insert into public.vinculos_unidade (unidade_id, pessoa_id, tipo_vinculo)
  select distinct on (c.unidade_id) c.unidade_id, new.id, c.tipo_vinculo
  from convites_confirmados c
  order by c.unidade_id, c.criado_em desc nulls last, c.id
  on conflict do nothing;
  return new;
end $$;

drop trigger trg_confirmar_convites on auth.users;
create trigger trg_confirmar_convites after insert or update of email_confirmed_at, email, encrypted_password on auth.users
  for each row execute function public.ativar_convites_confirmados();

create or replace function public.convidar_morador(p_unidade uuid, p_email text, p_tipo text default 'PROPRIETARIO')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_pessoa uuid;
  v_email text := lower(trim(p_email));
  v_tipo text := upper(p_tipo);
begin
  if not exists (
    select 1 from public.unidades u where u.id = p_unidade and public.gerencia(u.condominio_id)
  ) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if v_email is null or v_email = '' or v_tipo is null
      or v_tipo not in ('PROPRIETARIO', 'INQUILINO', 'RESPONSAVEL_FINANCEIRO') then
    raise exception 'Convite inválido' using errcode = '22023';
  end if;
  select p.id into v_pessoa
  from auth.users a join public.pessoas p on p.id = a.id
  where lower(a.email) = v_email and a.email_confirmed_at is not null
    and (a.invited_at is null or coalesce(a.encrypted_password, '') <> '');
  if v_pessoa is not null then
    insert into public.vinculos_unidade (unidade_id, pessoa_id, tipo_vinculo)
    values (p_unidade, v_pessoa, v_tipo) on conflict do nothing;
    return 'VINCULADO';
  end if;
  insert into public.convites (email, unidade_id, tipo_vinculo) values (v_email, p_unidade, v_tipo);
  return 'CONVITE_CRIADO';
end $$;

-- Preserve lançamentos, pagamentos e diligências quando a conta for removida.
alter table public.pagamentos drop constraint pagamentos_registrado_por_fkey,
  add constraint pagamentos_registrado_por_fkey foreign key (registrado_por) references public.pessoas(id) on delete set null;
alter table public.despesas drop constraint despesas_criado_por_fkey,
  add constraint despesas_criado_por_fkey foreign key (criado_por) references public.pessoas(id) on delete set null;
alter table public.solicitacoes alter column pessoa_id drop not null,
  drop constraint solicitacoes_pessoa_id_fkey,
  add constraint solicitacoes_pessoa_id_fkey foreign key (pessoa_id) references public.pessoas(id) on delete set null;

revoke delete on public.pessoas from public, anon, authenticated;
drop policy if exists pess_delete on public.pessoas;
create function public.excluir_conta(p_pessoa uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_usuario uuid := auth.uid();
  v_email text;
begin
  if not public.eh_admin_principal() or p_pessoa is null or p_pessoa = v_usuario then
    raise exception 'Somente o administrador principal pode excluir outras contas' using errcode = '42501';
  end if;
  if exists (select 1 from storage.objects where owner_id = p_pessoa::text) then
    raise exception 'A conta possui comprovantes. Transfira a propriedade dos arquivos antes de excluir.'
      using errcode = '55000';
  end if;
  select email into v_email from auth.users where id = p_pessoa for update;
  if not found then return; end if;
  delete from auth.users where id = p_pessoa;
  delete from public.pedidos_acesso where email = lower(v_email);
  delete from public.convites where lower(email) = lower(v_email) and usado_em is null;
  insert into public.auditoria (tabela, operacao, registro_id, usuario)
  values ('contas', 'DELETE', p_pessoa, v_usuario);
end $$;

revoke execute on function public.solicitar_acesso(text,text,text) from public;
grant execute on function public.solicitar_acesso(text,text,text) to anon, authenticated;
revoke execute on function public.eh_admin_principal(), public.recusar_pedido_acesso(uuid),
  public.reservar_convite_acesso(uuid), public.conta_precisa_definir_senha(), public.excluir_conta(uuid) from public, anon;
grant execute on function public.eh_admin_principal(), public.recusar_pedido_acesso(uuid),
  public.reservar_convite_acesso(uuid), public.conta_precisa_definir_senha(), public.excluir_conta(uuid) to authenticated;
revoke execute on function public.finalizar_convite_acesso(uuid,boolean,uuid) from public, anon, authenticated;
grant execute on function public.finalizar_convite_acesso(uuid,boolean,uuid) to service_role;
revoke execute on function private.validar_novo_usuario(), private.confirmar_criacao_por_convite()
  from public, anon, authenticated;
