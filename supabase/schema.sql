-- =====================================================================
--  SÍNDICO TOTAL — Banco de dados (PostgreSQL / Supabase)
--  Base para um projeto novo. Depois, aplique supabase/migrations/
--  na ordem indicada no README, antes de abrir o cadastro.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. CONDOMÍNIOS (multi-tenant)
-- ---------------------------------------------------------------------
create table if not exists public.condominios (
  id                        uuid primary key default gen_random_uuid(),
  nome_fantasia             varchar(255) not null,
  cnpj                      varchar(14) unique not null,
  endereco_completo         text,
  cidade                    varchar(60) default 'SAO PAULO',
  data_adesao               timestamptz default now(),
  status_assinatura         varchar(20) default 'ATIVO'
                            check (status_assinatura in ('ATIVO','SUSPENSO','CANCELADO')),
  taxa_garantia_percentual  numeric(5,2) default 4.00,   -- deságio na cessão (ex.: 4.00 = 4%)
  chave_pix                 varchar(77),                 -- chave Pix que recebe as taxas
  nome_recebedor_pix        varchar(25),                 -- nome do titular da chave (máx. 25)
  whatsapp_sindico          varchar(20),                 -- ex.: 5511999999999
  dia_vencimento            int default 10 check (dia_vencimento between 1 and 28),
  criado_em                 timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 2. UNIDADES
-- ---------------------------------------------------------------------
create table if not exists public.unidades (
  id                     uuid primary key default gen_random_uuid(),
  condominio_id          uuid not null references public.condominios(id) on delete cascade,
  identificacao          varchar(50) not null,              -- ex.: "Bloco A - Apto 101"
  fracao_ideal           numeric(10,6),
  valor_taxa_condominio  numeric(10,2) default 0,
  status_ocupacao        varchar(20) default 'OCUPADO'
                         check (status_ocupacao in ('OCUPADO','VAGO','INADIMPLENTE')),
  criado_em              timestamptz default now(),
  unique (condominio_id, identificacao)
);

-- ---------------------------------------------------------------------
-- 3. PESSOAS (1:1 com o login do Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.pessoas (
  id                 uuid primary key references auth.users(id) on delete cascade,
  nome_completo      varchar(255) not null,
  cpf_cnpj           varchar(14) unique,
  email              varchar(255) unique,
  telefone_whatsapp  varchar(20),
  tipo_usuario       varchar(30) not null default 'MORADOR'
                     check (tipo_usuario in ('MORADOR','SINDICO_PROFISSIONAL','ADMINISTRADOR')),
  criado_em          timestamptz default now()
);

-- Síndicos profissionais responsáveis por cada condomínio
create table if not exists public.condominio_gestores (
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  pessoa_id     uuid not null references public.pessoas(id) on delete cascade,
  criado_em     timestamptz default now(),
  primary key (condominio_id, pessoa_id)
);

-- ---------------------------------------------------------------------
-- 4. VÍNCULOS (quem mora / responde por qual unidade)
-- ---------------------------------------------------------------------
create table if not exists public.vinculos_unidade (
  id            uuid primary key default gen_random_uuid(),
  unidade_id    uuid not null references public.unidades(id) on delete cascade,
  pessoa_id     uuid not null references public.pessoas(id) on delete cascade,
  tipo_vinculo  varchar(30) not null
                check (tipo_vinculo in ('PROPRIETARIO','INQUILINO','RESPONSAVEL_FINANCEIRO')),
  data_inicio   date not null default current_date,
  data_fim      date,
  ativo         boolean default true
);
create unique index if not exists ux_vinculo_ativo
  on public.vinculos_unidade(unidade_id, pessoa_id) where ativo;

-- Convites: o síndico cadastra o e-mail; quando a pessoa cria a conta,
-- o vínculo é criado automaticamente.
create table if not exists public.convites (
  id            uuid primary key default gen_random_uuid(),
  email         varchar(255) not null,
  unidade_id    uuid not null references public.unidades(id) on delete cascade,
  tipo_vinculo  varchar(30) not null default 'PROPRIETARIO',
  criado_em     timestamptz default now(),
  usado_em      timestamptz
);

-- ---------------------------------------------------------------------
-- 5. FATURAS
-- ---------------------------------------------------------------------
create table if not exists public.faturas (
  id                      uuid primary key default gen_random_uuid(),
  unidade_id              uuid not null references public.unidades(id) on delete cascade,
  condominio_id           uuid not null references public.condominios(id) on delete cascade,
  mes_referencia          date not null,                -- sempre dia 01
  valor_original          numeric(10,2) not null check (valor_original >= 0),
  data_vencimento         date not null,
  status                  varchar(20) default 'PENDENTE'
                          check (status in ('PENDENTE','PAGO','ATRASADO','EM_COBRANCA','CEDIDO')),
  linha_digitavel_boleto  text,
  txid_pix                varchar(35),
  descricao               varchar(140),
  criado_em               timestamptz default now(),
  unique (unidade_id, mes_referencia)
);

-- ---------------------------------------------------------------------
-- 6. PAGAMENTOS (ledger de entradas)
-- ---------------------------------------------------------------------
create table if not exists public.pagamentos (
  id                    uuid primary key default gen_random_uuid(),
  fatura_id             uuid not null references public.faturas(id) on delete cascade,
  valor_pago            numeric(10,2) not null check (valor_pago > 0),
  data_pagamento        timestamptz default now(),
  metodo_pagamento      varchar(20) not null
                        check (metodo_pagamento in ('PIX','BOLETO','CARTAO','PIX_AUTOMATICO','DINHEIRO','OUTRO')),
  id_transacao_gateway  varchar(255) unique,
  status_conciliacao    varchar(20) default 'CONCILIADO'
                        check (status_conciliacao in ('CONCILIADO','DIVERGENTE')),
  registrado_por        uuid references public.pessoas(id)
);

-- ---------------------------------------------------------------------
-- 7. CESSÃO DE CRÉDITO (garantia)
-- ---------------------------------------------------------------------
create table if not exists public.cessoes_credito (
  id                        uuid primary key default gen_random_uuid(),
  condominio_id             uuid not null references public.condominios(id) on delete cascade,
  fatura_id                 uuid not null unique references public.faturas(id) on delete cascade,
  data_cessao               timestamptz default now(),
  valor_face                numeric(10,2) not null,
  valor_pago_condominio     numeric(10,2) not null,
  status_cobranca           varchar(20) default 'EM_ABERTO'
                            check (status_cobranca in ('EM_ABERTO','NEGATIVADO','PROTESTO','ACAO_JUDICIAL','RECUPERADO')),
  data_vencimento_original  date not null
);

-- ---------------------------------------------------------------------
-- 8. DESPESAS (base do balancete / prestação de contas)
-- ---------------------------------------------------------------------
create table if not exists public.despesas (
  id                uuid primary key default gen_random_uuid(),
  condominio_id     uuid not null references public.condominios(id) on delete cascade,
  descricao         varchar(255) not null,
  categoria         varchar(40) not null default 'OUTROS',
  fornecedor        varchar(255),
  valor             numeric(12,2) not null check (valor >= 0),
  data_competencia  date not null,
  data_pagamento    date,
  comprovante_path  text,            -- caminho no Storage (bucket "comprovantes")
  criado_por        uuid references public.pessoas(id),
  criado_em         timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 9. SOLICITAÇÕES / DILIGÊNCIAS dos moradores
-- ---------------------------------------------------------------------
create table if not exists public.solicitacoes (
  id             uuid primary key default gen_random_uuid(),
  condominio_id  uuid not null references public.condominios(id) on delete cascade,
  unidade_id     uuid references public.unidades(id) on delete set null,
  pessoa_id      uuid not null references public.pessoas(id) on delete cascade,
  titulo         varchar(140) not null,
  descricao      text,
  categoria      varchar(40) default 'GERAL',
  status         varchar(20) default 'ABERTA'
                 check (status in ('ABERTA','EM_ANDAMENTO','CONCLUIDA','CANCELADA')),
  resposta       text,
  origem         varchar(20) default 'APP',   -- APP ou WHATSAPP
  criado_em      timestamptz default now(),
  atualizado_em  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 10. VISTORIAS PERIÓDICAS
-- ---------------------------------------------------------------------
create table if not exists public.vistorias (
  id                uuid primary key default gen_random_uuid(),
  condominio_id     uuid not null references public.condominios(id) on delete cascade,
  titulo            varchar(140) not null,
  tipo              varchar(40) default 'ROTINA',
  data_agendada     timestamptz not null,
  responsavel       varchar(255),
  status            varchar(20) default 'AGENDADA'
                    check (status in ('AGENDADA','REALIZADA','CANCELADA')),
  observacoes       text,
  recorrencia_dias  int check (recorrencia_dias is null or recorrencia_dias > 0),
  criado_em         timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 11. AUDITORIA (append-only: ninguém altera nem apaga pelo app)
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id           bigserial primary key,
  tabela       text not null,
  operacao     text not null,
  registro_id  uuid,
  dados        jsonb,
  usuario      uuid,
  criado_em    timestamptz default now()
);

-- Índices
create index if not exists idx_faturas_status_vencimento on public.faturas(status, data_vencimento);
create index if not exists idx_faturas_condominio_mes   on public.faturas(condominio_id, mes_referencia);
create index if not exists idx_pagamentos_fatura        on public.pagamentos(fatura_id);
create index if not exists idx_cessoes_status           on public.cessoes_credito(status_cobranca);
create index if not exists idx_despesas_cond_data       on public.despesas(condominio_id, data_competencia);
create index if not exists idx_solicitacoes_cond        on public.solicitacoes(condominio_id, status);
create index if not exists idx_vistorias_cond_data      on public.vistorias(condominio_id, data_agendada);
create index if not exists idx_vinculos_pessoa          on public.vinculos_unidade(pessoa_id);
create index if not exists idx_convites_email           on public.convites(lower(email));

-- =====================================================================
--  FUNÇÕES AUXILIARES DE PERMISSÃO
-- =====================================================================
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pessoas where id = auth.uid() and tipo_usuario = 'ADMINISTRADOR');
$$;

create or replace function public.gerencia(p_condominio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or exists (
    select 1 from condominio_gestores where condominio_id = p_condominio and pessoa_id = auth.uid());
$$;

create or replace function public.condominio_da_unidade(p_unidade uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select condominio_id from unidades where id = p_unidade;
$$;

create or replace function public.minhas_unidades() returns setof uuid
language sql stable security definer set search_path = public as $$
  select unidade_id from vinculos_unidade where pessoa_id = auth.uid() and ativo;
$$;

create or replace function public.mora_no_condominio(p_condominio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from vinculos_unidade v join unidades u on u.id = v.unidade_id
    where v.pessoa_id = auth.uid() and v.ativo and u.condominio_id = p_condominio);
$$;

-- Pessoas que o síndico pode ver (moradores dos condomínios que gerencia)
create or replace function public.pessoa_visivel(p_pessoa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_pessoa = auth.uid() or public.eh_admin() or exists (
    select 1 from vinculos_unidade v
      join unidades u on u.id = v.unidade_id
      join condominio_gestores g on g.condominio_id = u.condominio_id
    where v.pessoa_id = p_pessoa and g.pessoa_id = auth.uid());
$$;

-- =====================================================================
--  CADASTRO AUTOMÁTICO AO CRIAR CONTA
--  * Todo cadastro público começa como MORADOR.
--  * A migração vincula convites quando o Auth confirma o e-mail.
-- =====================================================================
create or replace function public.ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cpf  text := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'cpf_cnpj',''), '\D', '', 'g'), '');
begin
  insert into pessoas (id, nome_completo, cpf_cnpj, email, telefone_whatsapp, tipo_usuario)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome_completo',''), split_part(new.email,'@',1)),
    v_cpf,
    lower(new.email),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'telefone_whatsapp',''), '\D', '', 'g'), ''),
    'MORADOR')
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists trg_ao_criar_usuario on auth.users;
create trigger trg_ao_criar_usuario after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- Impede que alguém promova a si mesmo (só ADMINISTRADOR muda tipo_usuario)
create or replace function public.proteger_tipo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo_usuario is distinct from old.tipo_usuario and not public.eh_admin() then
    raise exception 'Somente o administrador pode alterar o tipo de usuário';
  end if;
  if new.email is distinct from old.email and not public.eh_admin() then
    new.email := old.email;  -- e-mail segue o login
  end if;
  return new;
end $$;

drop trigger if exists trg_proteger_tipo on public.pessoas;
create trigger trg_proteger_tipo before update on public.pessoas
  for each row execute function public.proteger_tipo_usuario();

-- =====================================================================
--  AUDITORIA AUTOMÁTICA
-- =====================================================================
create or replace function public.registrar_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria (tabela, operacao, registro_id, dados, usuario)
  values (TG_TABLE_NAME, TG_OP,
          case when TG_OP = 'DELETE' then old.id else new.id end,
          case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['faturas','pagamentos','cessoes_credito','despesas'] loop
    execute format('drop trigger if exists trg_auditoria on public.%I', t);
    execute format('create trigger trg_auditoria after insert or update or delete on public.%I
                    for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;

-- =====================================================================
--  REGRAS DE NEGÓCIO (chamadas pelo app via supabase.rpc)
-- =====================================================================

-- Gera as faturas do mês para todas as unidades com taxa > 0 (não duplica)
create or replace function public.gerar_faturas(p_condominio uuid, p_mes date, p_vencimento date)
returns int language plpgsql security definer set search_path = public as $$
declare v_qtd int;
begin
  if not public.gerencia(p_condominio) then
    raise exception 'Sem permissão para este condomínio';
  end if;
  insert into faturas (unidade_id, condominio_id, mes_referencia, valor_original, data_vencimento, descricao, txid_pix)
  select u.id, u.condominio_id, date_trunc('month', p_mes)::date, u.valor_taxa_condominio, p_vencimento,
         'Taxa condominial ' || to_char(p_mes, 'MM/YYYY'),
         upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 25))
    from unidades u
   where u.condominio_id = p_condominio and coalesce(u.valor_taxa_condominio,0) > 0
  on conflict (unidade_id, mes_referencia) do nothing;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

-- Marca como ATRASADO o que venceu e não foi pago (só nos condomínios que o usuário gerencia)
create or replace function public.atualizar_atrasos() returns int
language plpgsql security definer set search_path = public as $$
declare v_qtd int;
begin
  update faturas f set status = 'ATRASADO'
   where f.status = 'PENDENTE' and f.data_vencimento < current_date
     and public.gerencia(f.condominio_id);
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

-- Registra pagamento com idempotência (não paga duas vezes, não repete transação)
create or replace function public.registrar_pagamento(
  p_fatura uuid, p_valor numeric, p_metodo text default 'PIX', p_id_transacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f  faturas%rowtype;
  v_id uuid;
begin
  select * into f from faturas where id = p_fatura for update;
  if not found then raise exception 'Fatura não encontrada'; end if;
  if not public.gerencia(f.condominio_id) then raise exception 'Sem permissão'; end if;
  if f.status = 'PAGO' then raise exception 'Esta fatura já está paga'; end if;
  if p_id_transacao is not null and exists (select 1 from pagamentos where id_transacao_gateway = p_id_transacao) then
    raise exception 'Transação % já registrada', p_id_transacao;
  end if;

  insert into pagamentos (fatura_id, valor_pago, metodo_pagamento, id_transacao_gateway, status_conciliacao, registrado_por)
  values (p_fatura, p_valor, upper(p_metodo), nullif(p_id_transacao,''),
          case when p_valor = f.valor_original then 'CONCILIADO' else 'DIVERGENTE' end, auth.uid())
  returning id into v_id;

  update faturas set status = 'PAGO' where id = p_fatura;
  update cessoes_credito set status_cobranca = 'RECUPERADO' where fatura_id = p_fatura;
  return v_id;
end $$;

-- Cessão de crédito: a fintech compra as faturas vencidas e repassa (face - deságio)
create or replace function public.ceder_faturas_atrasadas(p_condominio uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_qtd int; v_taxa numeric;
begin
  if not public.eh_admin() then raise exception 'Somente o administrador (fintech) pode ceder créditos'; end if;
  select coalesce(taxa_garantia_percentual, 0) into v_taxa from condominios where id = p_condominio;

  with alvo as (
    select id, condominio_id, valor_original, data_vencimento from faturas
     where condominio_id = p_condominio and status in ('PENDENTE','ATRASADO','EM_COBRANCA')
       and data_vencimento < current_date
       and not exists (select 1 from cessoes_credito c where c.fatura_id = faturas.id)
     for update
  ), ins as (
    insert into cessoes_credito (condominio_id, fatura_id, valor_face, valor_pago_condominio, data_vencimento_original)
    select condominio_id, id, valor_original, round(valor_original * (1 - v_taxa/100), 2), data_vencimento from alvo
    returning fatura_id
  )
  update faturas set status = 'CEDIDO' where id in (select fatura_id from ins);
  get diagnostics v_qtd = row_count;
  return v_qtd;
end $$;

-- Convida morador por e-mail (se já tem conta, vincula na hora)
create or replace function public.convidar_morador(p_unidade uuid, p_email text, p_tipo text default 'PROPRIETARIO')
returns text language plpgsql security definer set search_path = public as $$
declare v_pessoa uuid;
begin
  if not public.gerencia(public.condominio_da_unidade(p_unidade)) then raise exception 'Sem permissão'; end if;
  select id into v_pessoa from pessoas where lower(email) = lower(trim(p_email));
  if v_pessoa is not null then
    insert into vinculos_unidade (unidade_id, pessoa_id, tipo_vinculo)
    values (p_unidade, v_pessoa, upper(p_tipo)) on conflict do nothing;
    return 'VINCULADO';
  end if;
  insert into convites (email, unidade_id, tipo_vinculo) values (lower(trim(p_email)), p_unidade, upper(p_tipo));
  return 'CONVITE_CRIADO';
end $$;

-- Balancete mensal (receitas x despesas) de um condomínio
create or replace function public.balancete(p_condominio uuid, p_mes date)
returns table (grupo text, item text, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
begin
  if not (public.gerencia(p_condominio) or public.mora_no_condominio(p_condominio)) then
    raise exception 'Sem permissão';
  end if;
  return query
    select 'RECEITA'::text, 'Taxas recebidas dos condôminos'::text, coalesce(sum(p.valor_pago),0)
      from pagamentos p join faturas f on f.id = p.fatura_id
     where f.condominio_id = p_condominio and p.data_pagamento >= v_ini and p.data_pagamento < v_fim
       and not exists (select 1 from cessoes_credito c where c.fatura_id = f.id and c.data_cessao < p.data_pagamento)
    union all
    select 'RECEITA', 'Repasse da garantidora (créditos cedidos)', coalesce(sum(c.valor_pago_condominio),0)
      from cessoes_credito c
     where c.condominio_id = p_condominio and c.data_cessao >= v_ini and c.data_cessao < v_fim
    union all
    select 'DESPESA', d.categoria::text, sum(d.valor)
      from despesas d
     where d.condominio_id = p_condominio and d.data_competencia >= v_ini and d.data_competencia < v_fim
     group by d.categoria;
end $$;

-- =====================================================================
--  ROW LEVEL SECURITY (cada um só vê o que é seu)
-- =====================================================================
alter table public.condominios         enable row level security;
alter table public.unidades            enable row level security;
alter table public.pessoas             enable row level security;
alter table public.condominio_gestores enable row level security;
alter table public.vinculos_unidade    enable row level security;
alter table public.convites            enable row level security;
alter table public.faturas             enable row level security;
alter table public.pagamentos          enable row level security;
alter table public.cessoes_credito     enable row level security;
alter table public.despesas            enable row level security;
alter table public.solicitacoes        enable row level security;
alter table public.vistorias           enable row level security;
alter table public.auditoria           enable row level security;

do $$
declare r record;
begin
  -- remove políticas antigas para permitir reexecutar o script
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- condominios
create policy cond_select on public.condominios for select to authenticated
  using (public.gerencia(id) or public.mora_no_condominio(id));
create policy cond_insert on public.condominios for insert to authenticated with check (public.eh_admin());
create policy cond_update on public.condominios for update to authenticated using (public.gerencia(id));
create policy cond_delete on public.condominios for delete to authenticated using (public.eh_admin());

-- unidades
create policy unid_select on public.unidades for select to authenticated
  using (public.gerencia(condominio_id) or id in (select public.minhas_unidades()));
create policy unid_write on public.unidades for all to authenticated
  using (public.gerencia(condominio_id)) with check (public.gerencia(condominio_id));

-- pessoas
create policy pess_select on public.pessoas for select to authenticated using (public.pessoa_visivel(id));
create policy pess_update on public.pessoas for update to authenticated
  using (id = auth.uid() or public.eh_admin());
create policy pess_delete on public.pessoas for delete to authenticated using (public.eh_admin());

-- condominio_gestores
create policy gest_select on public.condominio_gestores for select to authenticated
  using (pessoa_id = auth.uid() or public.gerencia(condominio_id));
create policy gest_write on public.condominio_gestores for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- vinculos
create policy vinc_select on public.vinculos_unidade for select to authenticated
  using (pessoa_id = auth.uid() or public.gerencia(public.condominio_da_unidade(unidade_id)));
create policy vinc_write on public.vinculos_unidade for all to authenticated
  using (public.gerencia(public.condominio_da_unidade(unidade_id)))
  with check (public.gerencia(public.condominio_da_unidade(unidade_id)));

-- convites
create policy conv_all on public.convites for all to authenticated
  using (public.gerencia(public.condominio_da_unidade(unidade_id)))
  with check (public.gerencia(public.condominio_da_unidade(unidade_id)));

-- faturas
create policy fat_select on public.faturas for select to authenticated
  using (public.gerencia(condominio_id) or unidade_id in (select public.minhas_unidades()));
create policy fat_write on public.faturas for all to authenticated
  using (public.gerencia(condominio_id)) with check (public.gerencia(condominio_id));

-- pagamentos (inserção só pela função registrar_pagamento)
create policy pag_select on public.pagamentos for select to authenticated
  using (exists (select 1 from public.faturas f where f.id = fatura_id
                 and (public.gerencia(f.condominio_id) or f.unidade_id in (select public.minhas_unidades()))));

-- cessões
create policy ces_select on public.cessoes_credito for select to authenticated
  using (public.gerencia(condominio_id));
create policy ces_update on public.cessoes_credito for update to authenticated using (public.eh_admin());

-- despesas (moradores podem ver: transparência)
create policy desp_select on public.despesas for select to authenticated
  using (public.gerencia(condominio_id) or public.mora_no_condominio(condominio_id));
create policy desp_write on public.despesas for all to authenticated
  using (public.gerencia(condominio_id)) with check (public.gerencia(condominio_id));

-- solicitações
create policy sol_select on public.solicitacoes for select to authenticated
  using (pessoa_id = auth.uid() or public.gerencia(condominio_id));
create policy sol_insert on public.solicitacoes for insert to authenticated
  with check (pessoa_id = auth.uid() and (public.mora_no_condominio(condominio_id) or public.gerencia(condominio_id)));
create policy sol_update on public.solicitacoes for update to authenticated
  using (public.gerencia(condominio_id) or (pessoa_id = auth.uid() and status = 'ABERTA'));

-- vistorias
create policy vist_select on public.vistorias for select to authenticated
  using (public.gerencia(condominio_id) or public.mora_no_condominio(condominio_id));
create policy vist_write on public.vistorias for all to authenticated
  using (public.gerencia(condominio_id)) with check (public.gerencia(condominio_id));

-- auditoria: só leitura para o administrador
create policy aud_select on public.auditoria for select to authenticated using (public.eh_admin());

-- =====================================================================
--  PERMISSÕES EXPLÍCITAS (projetos novos do Supabase exigem GRANT)
-- =====================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.auditoria from authenticated;
revoke insert, update, delete on public.pagamentos from authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.ao_criar_usuario() from anon, authenticated, public;

-- =====================================================================
--  STORAGE: bucket privado para comprovantes de despesas
--  Caminho dos arquivos: <condominio_id>/<arquivo>
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;

drop policy if exists comp_select on storage.objects;
drop policy if exists comp_insert on storage.objects;
drop policy if exists comp_delete on storage.objects;

create policy comp_select on storage.objects for select to authenticated
  using (bucket_id = 'comprovantes' and (
         public.gerencia(((storage.foldername(name))[1])::uuid)
      or public.mora_no_condominio(((storage.foldername(name))[1])::uuid)));
create policy comp_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comprovantes' and public.gerencia(((storage.foldername(name))[1])::uuid));
create policy comp_delete on storage.objects for delete to authenticated
  using (bucket_id = 'comprovantes' and public.gerencia(((storage.foldername(name))[1])::uuid));

-- Fim da base. Aplique as migrações antes de cadastrar usuários.
