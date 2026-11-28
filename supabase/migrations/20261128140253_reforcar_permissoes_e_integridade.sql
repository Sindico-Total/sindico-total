-- Preserva os papéis existentes. Novos cadastros começam como MORADOR.
create or replace function public.ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pessoas (id, nome_completo, cpf_cnpj, email, telefone_whatsapp, tipo_usuario)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome_completo', ''), split_part(new.email, '@', 1)),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'cpf_cnpj', ''), '\D', '', 'g'), ''),
    lower(new.email),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefone_whatsapp', ''), '\D', '', 'g'), ''),
    'MORADOR')
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.proteger_tipo_usuario() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'postgres' or public.eh_admin() then return new; end if;
  if new.tipo_usuario is distinct from old.tipo_usuario
      or new.email is distinct from old.email then
    raise exception 'Somente o administrador pode alterar o tipo de usuário ou e-mail do perfil'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- O convite é consumido somente quando o Auth confirma o endereço.
create function public.ativar_convites_confirmados() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is null or new.email is null then return new; end if;
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

create trigger trg_confirmar_convites after insert or update of email_confirmed_at, email on auth.users
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
  where lower(a.email) = v_email and a.email_confirmed_at is not null;
  if v_pessoa is not null then
    insert into public.vinculos_unidade (unidade_id, pessoa_id, tipo_vinculo)
    values (p_unidade, v_pessoa, v_tipo) on conflict do nothing;
    return 'VINCULADO';
  end if;
  insert into public.convites (email, unidade_id, tipo_vinculo) values (v_email, p_unidade, v_tipo);
  return 'CONVITE_CRIADO';
end $$;

alter table public.convites add constraint convites_tipo_valido
  check (tipo_vinculo in ('PROPRIETARIO', 'INQUILINO', 'RESPONSAVEL_FINANCEIRO')) not valid;

-- Mapeamentos de unidade também precisam obedecer ao escopo do usuário.
create or replace function public.condominio_da_unidade(p_unidade uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.condominio_id from public.unidades u
  where u.id = p_unidade and (
    public.gerencia(u.condominio_id) or exists (
      select 1 from public.vinculos_unidade v
      where v.unidade_id = u.id and v.pessoa_id = (select auth.uid()) and v.ativo
    )
  );
$$;

-- As funções expostas ficam restritas aos perfis que as utilizam.
revoke execute on function public.atualizar_atrasos(), public.balancete(uuid,date),
  public.ceder_faturas_atrasadas(uuid), public.condominio_da_unidade(uuid),
  public.convidar_morador(uuid,text,text), public.eh_admin(), public.gerar_faturas(uuid,date,date),
  public.gerencia(uuid), public.minhas_unidades(), public.mora_no_condominio(uuid),
  public.pessoa_visivel(uuid), public.registrar_pagamento(uuid,numeric,text,text)
  from public, anon;
revoke execute on function public.ativar_convites_confirmados(), public.ao_criar_usuario(),
  public.proteger_tipo_usuario(), public.registrar_auditoria()
  from public, anon, authenticated;

create function public.proteger_dados_financeiros_condominio() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'postgres' and not public.eh_admin() and
    (new.cnpj, new.taxa_garantia_percentual, new.status_assinatura, new.chave_pix, new.nome_recebedor_pix)
    is distinct from
    (old.cnpj, old.taxa_garantia_percentual, old.status_assinatura, old.chave_pix, old.nome_recebedor_pix)
  then
    raise exception 'Somente o administrador pode alterar dados financeiros do condomínio'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_proteger_dados_financeiros before update on public.condominios
  for each row execute function public.proteger_dados_financeiros_condominio();
revoke execute on function public.proteger_dados_financeiros_condominio() from public, anon, authenticated;

alter table public.condominios add constraint condominios_taxa_garantia_valida
  check (taxa_garantia_percentual between 0 and 100);

-- A unidade e a fatura precisam pertencer ao mesmo condomínio.
-- Faturas, pagamentos e cessões não são apagados em cascata.
alter table public.unidades add constraint unidades_id_condominio_key unique (id, condominio_id);
alter table public.faturas
  drop constraint faturas_unidade_id_fkey,
  drop constraint faturas_condominio_id_fkey,
  add constraint faturas_condominio_id_fkey foreign key (condominio_id) references public.condominios (id),
  add constraint faturas_unidade_condominio_fkey foreign key (unidade_id, condominio_id)
    references public.unidades (id, condominio_id);
alter table public.pagamentos
  drop constraint pagamentos_fatura_id_fkey,
  add constraint pagamentos_fatura_id_fkey foreign key (fatura_id) references public.faturas (id);
alter table public.cessoes_credito
  drop constraint cessoes_credito_fatura_id_fkey,
  add constraint cessoes_credito_fatura_id_fkey foreign key (fatura_id) references public.faturas (id);

revoke update on public.cessoes_credito from public, anon, authenticated;
grant update (status_cobranca) on public.cessoes_credito to authenticated;

-- A API só permite editar valor/vencimento de faturas pendentes. A baixa e a
-- cessão continuam nas RPCs que atualizam todos os registros da operação.
revoke insert, update on public.faturas from public, anon, authenticated;
grant update (valor_original, data_vencimento) on public.faturas to authenticated;
drop policy fat_write on public.faturas;
create policy fat_update_pendente on public.faturas for update to authenticated
  using (status = 'PENDENTE' and public.gerencia(condominio_id))
  with check (status = 'PENDENTE' and public.gerencia(condominio_id));
create policy fat_delete_pendente on public.faturas for delete to authenticated
  using (status = 'PENDENTE' and public.gerencia(condominio_id));

create or replace function public.registrar_pagamento(
  p_fatura uuid, p_valor numeric, p_metodo text default 'PIX', p_id_transacao text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  f public.faturas%rowtype;
  v_id uuid;
  v_transacao text := nullif(trim(p_id_transacao), '');
begin
  select * into f from public.faturas
  where id = p_fatura and public.gerencia(condominio_id) for update;
  if not found then raise exception 'Fatura indisponível' using errcode = '42501'; end if;
  if f.status = 'PAGO' then raise exception 'Esta fatura já está paga'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> f.valor_original then
    raise exception 'O valor recebido deve ser igual ao valor da fatura para dar baixa'
      using errcode = '22023';
  end if;
  if v_transacao is not null and exists (
    select 1 from public.pagamentos where id_transacao_gateway = v_transacao
  ) then
    raise exception 'Transação já registrada' using errcode = '23505';
  end if;
  insert into public.pagamentos (fatura_id, valor_pago, metodo_pagamento, id_transacao_gateway, status_conciliacao, registrado_por)
  values (p_fatura, p_valor, upper(p_metodo), v_transacao,
    'CONCILIADO', auth.uid())
  returning id into v_id;
  update public.faturas set status = 'PAGO' where id = p_fatura;
  update public.cessoes_credito set status_cobranca = 'RECUPERADO' where fatura_id = p_fatura;
  return v_id;
end $$;

drop policy sol_insert on public.solicitacoes;
create policy sol_insert on public.solicitacoes for insert to authenticated
  with check (
    pessoa_id = (select auth.uid())
    and status = 'ABERTA' and resposta is null and origem = 'APP'
    and exists (
      select 1 from public.unidades u
      where u.id = unidade_id and u.condominio_id = solicitacoes.condominio_id
        and (public.gerencia(u.condominio_id) or u.id in (select public.minhas_unidades()))
    )
  );

drop policy sol_update on public.solicitacoes;
create policy sol_update on public.solicitacoes for update to authenticated
  using (public.gerencia(condominio_id) or (pessoa_id = (select auth.uid()) and status = 'ABERTA'))
  with check (public.gerencia(condominio_id) or (pessoa_id = (select auth.uid()) and status = 'CANCELADA'));
revoke update on public.solicitacoes from public, anon, authenticated;
grant update (status, resposta, atualizado_em) on public.solicitacoes to authenticated;

create function public.proteger_resposta_solicitacao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not public.gerencia(old.condominio_id)
    and new.resposta is distinct from old.resposta then
    raise exception 'Somente o gestor pode responder a uma solicitação' using errcode = '42501';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

create trigger trg_proteger_resposta before update on public.solicitacoes
  for each row execute function public.proteger_resposta_solicitacao();
revoke execute on function public.proteger_resposta_solicitacao() from public, anon, authenticated;

-- RLS protege linhas, mas não autoriza nem restringe TRUNCATE ou TRIGGER.
revoke truncate, trigger, references on public.auditoria, public.cessoes_credito,
  public.condominio_gestores, public.condominios, public.convites, public.despesas,
  public.faturas, public.pagamentos, public.pessoas, public.solicitacoes, public.unidades,
  public.vinculos_unidade, public.vistorias from public, anon, authenticated;
revoke all on sequence public.auditoria_id_seq from public, anon, authenticated;

-- Limites do servidor correspondentes ao formulário de comprovantes.
update storage.buckets
set file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id = 'comprovantes';

-- A função opcional do WhatsApp usa o telefone confirmado pelo Auth.
-- O telefone editável do perfil é apenas um dado de contato.
create function public.morador_whatsapp_verificado(p_telefone text)
returns table (id uuid, nome_completo text)
language sql stable security definer set search_path = '' as $$
  with encontrados as (
    select p.id, p.nome_completo::text
    from auth.users a join public.pessoas p on p.id = a.id
    where p_telefone ~ '^[1-9][0-9]{7,14}$'
      and a.phone in (p_telefone, '+' || p_telefone)
      and a.phone_confirmed_at is not null
      and not a.is_anonymous
  )
  select e.id, e.nome_completo from encontrados e
  where (select count(*) from encontrados) = 1;
$$;
revoke execute on function public.morador_whatsapp_verificado(text) from public, anon, authenticated;
grant execute on function public.morador_whatsapp_verificado(text) to service_role;
grant select (unidade_id, pessoa_id, ativo) on public.vinculos_unidade to service_role;
grant select (id, identificacao, condominio_id) on public.unidades to service_role;
grant select (id, nome_fantasia, chave_pix, nome_recebedor_pix, cidade) on public.condominios to service_role;
grant select (id, unidade_id, mes_referencia, data_vencimento, valor_original, txid_pix, status)
  on public.faturas to service_role;
grant select (titulo, data_agendada, condominio_id, status) on public.vistorias to service_role;
grant insert (condominio_id, unidade_id, pessoa_id, titulo, descricao, categoria, origem)
  on public.solicitacoes to service_role;

-- Convites e novos vínculos passam pela função que consulta o Auth.
revoke insert, update on public.convites from public, anon, authenticated;
revoke insert, update, delete on public.vinculos_unidade from public, anon, authenticated;
grant update (ativo, data_fim) on public.vinculos_unidade to authenticated;
