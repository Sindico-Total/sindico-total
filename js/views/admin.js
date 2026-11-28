import { sb } from '../supabase.js';
import { state, recarregar } from '../app.js';
import { esc, brl, data, dataHora, badge, q, toast, modal, dadosForm, vazio, soDigitos, numBR, rotulo, baixarCSV } from '../ui.js';

// ================================================================ CARTEIRA DE GARANTIA (cessões)
export async function carteira(root) {
  const filtroCond = root.dataset.cond || '';
  let consulta = sb.from('cessoes_credito')
    .select('*, condominios(nome_fantasia), faturas(mes_referencia, unidade_id, unidades(identificacao))')
    .order('data_cessao', { ascending: false }).limit(500);
  if (filtroCond) consulta = consulta.eq('condominio_id', filtroCond);
  const [ces, conds] = await Promise.all([q(consulta), q(sb.from('condominios').select('id, nome_fantasia, taxa_garantia_percentual').order('nome_fantasia'))]);

  const soma = (arr, k) => arr.reduce((s, x) => s + Number(x[k]), 0);
  const recuperado = ces.filter((c) => c.status_cobranca === 'RECUPERADO');
  const emAberto = ces.filter((c) => c.status_cobranca !== 'RECUPERADO');
  const face = soma(ces, 'valor_face');
  const taxaRec = face ? ((soma(recuperado, 'valor_face') / face) * 100).toFixed(1) : '0.0';

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><small>Créditos comprados (face)</small><b>${brl(face)}</b></div>
      <div class="kpi"><small>Repassado aos condomínios</small><b>${brl(soma(ces, 'valor_pago_condominio'))}</b></div>
      <div class="kpi erro"><small>Em cobrança</small><b>${brl(soma(emAberto, 'valor_face'))}</b></div>
      <div class="kpi ok"><small>Recuperado</small><b>${brl(soma(recuperado, 'valor_face'))}</b></div>
      <div class="kpi"><small>Taxa de recuperação</small><b>${taxaRec}%</b></div>
    </div>
    <div class="card">
      <h3>Ceder faturas vencidas</h3>
      <p class="mini">A fintech compra os créditos vencidos e não pagos do condomínio, repassando o valor de face menos a taxa de garantia
        (deságio). As faturas passam a <b>CEDIDO</b>. Faça o Pix do repasse ao condomínio fora do app.</p>
      <div class="filtros">
        <label>Condomínio<select id="c-ceder">${conds.map((c) => `<option value="${c.id}">${esc(c.nome_fantasia)} (${c.taxa_garantia_percentual ?? 0}%)</option>`).join('')}</select></label>
        <button class="btn primario" id="ceder">Ceder vencidas agora</button>
      </div>
    </div>
    <div class="card filtros">
      <label>Filtrar carteira<select id="filtro"><option value="">Todos os condomínios</option>
        ${conds.map((c) => `<option value="${c.id}" ${c.id === filtroCond ? 'selected' : ''}>${esc(c.nome_fantasia)}</option>`).join('')}</select></label>
      <button class="btn" id="csv">⬇️ CSV</button>
    </div>
    ${ces.length ? `<div class="card"><table class="tabela">
      <thead><tr><th>Condomínio</th><th>Unidade</th><th>Mês</th><th>Venc. original</th><th class="num">Face</th><th class="num">Repasse</th><th>Cobrança</th></tr></thead>
      <tbody>${ces.map((c) => `<tr>
        <td>${esc(c.condominios?.nome_fantasia)}</td><td>${esc(c.faturas?.unidades?.identificacao)}</td>
        <td>${esc(c.faturas?.mes_referencia?.slice(0, 7))}</td><td>${data(c.data_vencimento_original)}</td>
        <td class="num">${brl(c.valor_face)}</td><td class="num">${brl(c.valor_pago_condominio)}</td>
        <td>${c.status_cobranca === 'RECUPERADO' ? badge('RECUPERADO') : `<select data-ces="${c.id}">${['EM_ABERTO', 'NEGATIVADO', 'PROTESTO', 'ACAO_JUDICIAL']
          .map((k) => `<option value="${k}" ${k === c.status_cobranca ? 'selected' : ''}>${rotulo(k)}</option>`).join('')}</select>`}</td>
      </tr>`).join('')}</tbody></table>
      <p class="mini">Quando o devedor pagar, dê baixa na fatura em Gestão → Faturamento: a cessão vira "Recuperado".</p></div>`
      : vazio('Nenhum crédito cedido ainda.')}`;

  root.querySelector('#ceder').onclick = async () => {
    const id = root.querySelector('#c-ceder').value;
    if (!id || !confirm('Confirmar a cessão de todas as faturas vencidas e não pagas deste condomínio?')) return;
    const n = await q(sb.rpc('ceder_faturas_atrasadas', { p_condominio: id }));
    toast(n ? `${n} fatura(s) cedida(s).` : 'Nenhuma fatura vencida para ceder.', n ? 'ok' : 'alerta');
    carteira(root);
  };
  const filtro = root.querySelector('#filtro');
  filtro.onchange = () => { root.dataset.cond = filtro.value; carteira(root); };
  root.querySelector('#csv').onclick = () => baixarCSV('carteira-garantia.csv', [
    ['Condomínio', 'Unidade', 'Mês', 'Vencimento', 'Face', 'Repasse', 'Status'],
    ...ces.map((c) => [c.condominios?.nome_fantasia, c.faturas?.unidades?.identificacao, c.faturas?.mes_referencia?.slice(0, 7),
      data(c.data_vencimento_original), String(c.valor_face).replace('.', ','), String(c.valor_pago_condominio).replace('.', ','), c.status_cobranca]),
  ]);
  root.querySelectorAll('select[data-ces]').forEach((s) => {
    s.onchange = async () => {
      await q(sb.from('cessoes_credito').update({ status_cobranca: s.value }).eq('id', s.dataset.ces));
      toast('Status de cobrança atualizado.');
    };
  });
}

// ================================================================ CONDOMÍNIOS
export async function condominios(root) {
  const [conds, gest, sindicos] = await Promise.all([
    q(sb.from('condominios').select('*').order('nome_fantasia')),
    q(sb.from('condominio_gestores').select('condominio_id, pessoa_id, pessoas(nome_completo, email)')),
    q(sb.from('pessoas').select('id, nome_completo, email, tipo_usuario').in('tipo_usuario', ['SINDICO_PROFISSIONAL', 'ADMINISTRADOR']).order('nome_completo')),
  ]);

  root.innerHTML = `
    <form class="card" id="f-novo">
      <h3>Cadastrar condomínio (novo cliente)</h3>
      <div class="grade2">
        <label>Nome<input name="nome" required placeholder="Condomínio Edifício Sol"></label>
        <label>CNPJ<input name="cnpj" required inputmode="numeric"></label>
        <label>Endereço<input name="endereco"></label>
        <label>Cidade<input name="cidade" value="São Paulo"></label>
        <label>Taxa de garantia (%)<input name="taxa" inputmode="decimal" value="4,00"></label>
        <label>Dia de vencimento<input name="dia" type="number" min="1" max="28" value="10"></label>
      </div>
      <button class="btn primario">Cadastrar</button>
    </form>
    ${conds.length ? `<div class="card"><table class="tabela">
      <thead><tr><th>Condomínio</th><th>CNPJ</th><th>Status</th><th>Síndico(s)</th><th></th></tr></thead>
      <tbody>${conds.map((c) => `<tr><td><b>${esc(c.nome_fantasia)}</b><br><small>${esc(c.cidade || '')}</small></td>
        <td>${esc(c.cnpj)}</td><td>${badge(c.status_assinatura)}</td>
        <td>${gest.filter((g) => g.condominio_id === c.id).map((g) =>
          `${esc(g.pessoas?.nome_completo)} <button class="btn mini-btn" data-rmg="${c.id}|${g.pessoa_id}" title="Remover">×</button>`).join('<br>') || '<small>—</small>'}</td>
        <td><button class="btn mini-btn" data-addg="${c.id}">+ Síndico</button></td></tr>`).join('')}</tbody></table></div>`
      : vazio('Nenhum condomínio ainda.')}`;

  root.querySelector('#f-novo').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    const cnpj = soDigitos(f.cnpj);
    if (cnpj.length !== 14) return toast('CNPJ deve ter 14 dígitos.', 'erro');
    await q(sb.from('condominios').insert({
      nome_fantasia: f.nome.trim(), cnpj, endereco_completo: f.endereco || null, cidade: f.cidade || null,
      taxa_garantia_percentual: numBR(f.taxa), dia_vencimento: Number(f.dia) || 10,
    }));
    toast('Condomínio cadastrado! Agora vincule o síndico e cadastre as unidades.');
    await recarregar();
  };

  root.onclick = async (e) => {
    const add = e.target.closest('[data-addg]');
    const rm = e.target.closest('[data-rmg]');
    if (rm) {
      const [cid, pid] = rm.dataset.rmg.split('|');
      if (!confirm('Remover este síndico do condomínio?')) return;
      await q(sb.from('condominio_gestores').delete().eq('condominio_id', cid).eq('pessoa_id', pid));
      return recarregar();
    }
    if (!add) return;
    const m = modal('Vincular síndico', `
      ${sindicos.length ? `<form id="fg"><label>Síndico<select name="p">${sindicos.map((s) =>
        `<option value="${s.id}">${esc(s.nome_completo)} — ${esc(s.email)}${s.id === state.user.id ? ' (você)' : ''}</option>`).join('')}</select></label>
        <button class="btn primario">Vincular</button></form>` : ''}
      <p class="mini">Não aparece na lista? A pessoa precisa criar conta no app e você deve mudar o perfil dela para
        "Síndico profissional" em <a href="#/admin/usuarios">Usuários</a>.</p>`);
    m.el.querySelector('#fg')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await q(sb.from('condominio_gestores').insert({ condominio_id: add.dataset.addg, pessoa_id: dadosForm(ev.target).p }));
      m.fechar();
      toast('Síndico vinculado.');
      recarregar();
    });
  };
}

// ================================================================ CONTAS
export async function usuarios(root) {
  const busca = root.dataset.busca || '';
  const situacao = root.dataset.situacao || 'PENDENTE';
  let consulta = sb.from('pessoas').select('id,nome_completo,email,telefone_whatsapp,tipo_usuario')
    .order('criado_em', { ascending: false }).limit(200);
  if (busca) consulta = consulta.or(`nome_completo.ilike.%${busca}%,email.ilike.%${busca}%`);
  const [lista, pedidos, principal] = await Promise.all([
    q(consulta),
    q(sb.from('pedidos_acesso').select('id,nome,email,referencia,status,solicitado_em,decidido_em,convite_enviado_em')
      .eq('status', situacao).order('solicitado_em', { ascending: false }).limit(100)),
    q(sb.rpc('eh_admin_principal')),
  ]);

  const perfis = ['MORADOR', 'SINDICO_PROFISSIONAL', 'ADMINISTRADOR'];
  const situacoes = { PENDENTE: 'Pendentes', APROVADO: 'Aprovadas', RECUSADO: 'Recusadas' };
  root.innerHTML = `
    <section class="card">
      <h2>Solicitações de acesso</h2>
      <label>Situação<select id="situacao">${Object.entries(situacoes).map(([key, label]) =>
        `<option value="${key}" ${key === situacao ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${pedidos.length ? `<div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Solicitante</th><th>Condomínio e unidade</th><th>Solicitado em</th><th>Ações</th></tr></thead>
        <tbody>${pedidos.map((p) => `<tr>
          <td>${esc(p.nome)}<br><small>${esc(p.email)}</small></td>
          <td>${esc(p.referencia || '—')}</td><td>${dataHora(p.solicitado_em)}</td>
          <td class="acoes-linha">${p.status === 'PENDENTE'
            ? `<button class="btn primario mini-btn" data-aprovar="${p.id}">Aprovar e enviar convite</button>
               <button class="btn mini-btn" data-recusar="${p.id}">Recusar</button>`
            : p.status === 'APROVADO'
              ? `<small>Enviado em ${dataHora(p.convite_enviado_em)}</small>
                 <button class="btn mini-btn" data-aprovar="${p.id}">Reenviar convite</button>`
              : `<small>Recusado em ${dataHora(p.decidido_em)}</small>`}</td>
        </tr>`).join('')}</tbody></table></div>` : vazio('Nenhuma solicitação nesta situação.')}
    </section>

    <section class="card">
      <h2>Contas cadastradas</h2>
      <label>Buscar<input id="busca" value="${esc(busca)}" placeholder="nome ou e-mail"></label>
      ${lista.length ? `<div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Nome</th><th>E-mail</th><th>WhatsApp</th><th>Perfil</th>${principal ? '<th>Ações</th>' : ''}</tr></thead>
        <tbody>${lista.map((p) => {
          const propriaConta = p.id === state.user.id;
          const podeEditar = !propriaConta && (principal || p.tipo_usuario !== 'ADMINISTRADOR');
          return `<tr><td>${esc(p.nome_completo)}${propriaConta ? ' <small>(você)</small>' : ''}</td>
            <td>${esc(p.email)}</td><td>${esc(p.telefone_whatsapp || '—')}</td>
            <td>${podeEditar ? `<select data-p="${p.id}" aria-label="Perfil de ${esc(p.nome_completo)}">${perfis
              .filter((k) => principal || k !== 'ADMINISTRADOR')
              .map((k) => `<option value="${k}" ${k === p.tipo_usuario ? 'selected' : ''}>${rotulo(k)}</option>`).join('')}</select>`
              : esc(rotulo(p.tipo_usuario))}</td>
            ${principal ? `<td>${propriaConta ? '—' : `<button class="btn mini-btn perigo" data-excluir="${p.id}">Excluir conta</button>`}</td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>` : vazio('Nenhuma conta encontrada.')}
      <p class="mini">Novas contas começam como morador. Para habilitar um síndico, altere o perfil e vincule a conta em
        <a href="#/admin/condominios">Condomínios</a>.</p>
    </section>`;

  const atualizar = () => usuarios(root).catch(() => {});
  root.querySelector('#situacao').onchange = (e) => {
    root.dataset.situacao = e.target.value;
    atualizar();
  };
  root.querySelector('#busca').onchange = (e) => {
    root.dataset.busca = e.target.value.replace(/[,%()]/g, '').trim();
    atualizar();
  };

  root.querySelectorAll('select[data-p]').forEach((s) => {
    s.onchange = async () => {
      const conta = lista.find((p) => p.id === s.dataset.p);
      if (s.value === 'ADMINISTRADOR' && !confirm('Administradores têm acesso a todos os condomínios. Alterar o perfil?')) {
        s.value = conta.tipo_usuario;
        return;
      }
      s.disabled = true;
      try {
        await q(sb.from('pessoas').update({ tipo_usuario: s.value }).eq('id', conta.id));
        toast('Perfil alterado.');
        await atualizar();
      } catch {
        s.value = conta.tipo_usuario;
      } finally {
        s.disabled = false;
      }
    };
  });

  root.onclick = async (e) => {
    const botao = e.target.closest('button[data-aprovar], button[data-recusar], button[data-excluir]');
    if (!botao) return;
    const { aprovar, recusar, excluir } = botao.dataset;
    const conta = excluir && lista.find((p) => p.id === excluir);
    const pedido = !excluir && pedidos.find((p) => p.id === (aprovar || recusar));
    if (conta && !confirm(`Excluir definitivamente a conta de ${conta.nome_completo} (${conta.email})? A pessoa perderá o acesso e os registros operacionais serão preservados.`)) return;
    if (recusar && !confirm(`Recusar a solicitação de ${pedido.email}?`)) return;
    botao.disabled = true;
    try {
      if (excluir) {
        await q(sb.rpc('excluir_conta', { p_pessoa: excluir }));
        toast('Conta excluída.');
      } else if (recusar) {
        const recusado = await q(sb.rpc('recusar_pedido_acesso', { p_pedido: recusar }));
        toast(recusado ? 'Solicitação recusada.' : 'A solicitação já está sendo processada.', recusado ? 'ok' : 'alerta');
      } else {
        const { data: retorno, error } = await sb.functions.invoke('aprovar-acesso', { body: { pedido: aprovar } });
        if (error) {
          const detalhe = await error.context?.json?.().catch(() => null);
          toast(detalhe?.mensagem || 'Não foi possível enviar o convite.', 'erro');
        } else {
          toast(retorno.mensagem);
        }
      }
      await atualizar();
    } catch {
      // O banco já mostra uma mensagem de erro pelo q().
    } finally {
      botao.disabled = false;
    }
  };
}
