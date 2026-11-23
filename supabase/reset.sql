-- CUIDADO: apaga TODAS as tabelas do Síndico Total (os logins em Authentication continuam).
-- Use só em ambiente de teste. Depois rode schema.sql novamente.
drop trigger if exists trg_ao_criar_usuario on auth.users;
drop table if exists public.auditoria, public.vistorias, public.solicitacoes, public.despesas,
  public.cessoes_credito, public.pagamentos, public.faturas, public.convites,
  public.vinculos_unidade, public.condominio_gestores, public.pessoas, public.unidades,
  public.condominios cascade;
