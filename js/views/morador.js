import { sb } from '../supabase.js';
import { state, carregarContexto } from '../app.js';
import { esc, brl, data, dataHora, badge, q, toast, dadosForm, vazio, mesAtual, mesNome, soDigitos, waLink } from '../ui.js';
import { abrirPix, desenharBalancete, listarDespesasPublicas } from './comum.js';

const semUnidade = () => `
  <div class="card">
    <h3>Bem-vindo(a)! 👋</h3>
    <p>Sua conta ainda não está ligada a nenhuma unidade.</p>
    <p>Peça ao síndico para cadastrar o e-mail <b>${esc(state.perfil?.email)}</b> na sua unidade.
       Assim que ele fizer isso, suas faturas aparecem aqui.</p>
  </div>`;

function condominiosDoMorador() {
  const mapa = new Map();
  state.unidades.forEach((v) => v.unidades?.condominios && mapa.set(v.unidades.condominios.id, v.unidades.condominios));
  return [...mapa.values()];
}

// ---------------------------------------------------------------- Faturas
export async function inicio(root) {
  if (!state.unidades.length) return (root.innerHTML = semUnidade());
  const ids = state.unidades.map((v) => v.unidades.id);
  const faturas = await q(sb.from('faturas').select('*').in('unidade_id', ids).order('mes_referencia', { ascending: false }).limit(60));
  const hoje = new Date().toLocaleDateString('sv-SE');
  const abertas = faturas.filter((f) => ['PENDENTE', 'ATRASADO', 'EM_COBRANCA', 'CEDIDO'].includes(f.status));
  const pagas = faturas.filter((f) => f.status === 'PAGO');
  const unidadeDe = (id) => state.unidades.find((v) => v.unidades.id === id)?.unidades;

  const cartao = (f) => {
    const u = unidadeDe(f.unidade_id);
    const vencida = f.data_vencimento < hoje;
    return `
      <div class="fatura ${vencida ? 'vencida' : ''}">
        <div>
          <small>${esc(u?.condominios?.nome_fantasia)} · ${esc(u?.identificacao)}</small>
          <h3>${brl(f.valor_original)}</h3>
          <p>${esc(mesNome(f.mes_referencia.slice(0, 7)))} · vence ${data(f.data_vencimento)} ${badge(vencida && f.status === 'PENDENTE' ? 'ATRASADO' : f.status)}</p>
        </div>
        <button class="btn primario" data-pagar="${f.id}">Pagar com Pix</button>
      </div>`;
  };

  const sindicos = condominiosDoMorador().filter((c) => c.whatsapp_sindico);
  root.innerHTML = `
    ${abertas.length ? `<h2 class="secao">Em aberto</h2>${abertas.map(cartao).join('')}`
      : '<div class="card ok-card">✅ Nenhuma fatura em aberto. Tudo em dia!</div>'}
    ${sindicos.map((c) => `<a class="btn bloco" target="_blank" rel="noopener"
        href="${esc(waLink(c.whatsapp_sindico, `Olá, sou morador(a) do ${c.nome_fantasia}.`))}">💬 Falar com o síndico — ${esc(c.nome_fantasia)}</a>`).join('')}
    <h2 class="secao">Histórico</h2>
    ${pagas.length ? `<div class="card"><table class="tabela">
      <thead><tr><th>Mês</th><th>Unidade</th><th class="num">Valor</th><th>Status</th></tr></thead>
      <tbody>${pagas.map((f) => `<tr><td>${esc(mesNome(f.mes_referencia.slice(0, 7)))}</td>
        <td>${esc(unidadeDe(f.unidade_id)?.identificacao)}</td><td class="num">${brl(f.valor_original)}</td><td>${badge(f.status)}</td></tr>`).join('')}
      </tbody></table></div>` : vazio('Nenhum pagamento registrado ainda.')}`;

  root.onclick = (e) => {
    const b = e.target.closest('[data-pagar]');
    if (!b) return;
    const f = faturas.find((x) => x.id === b.dataset.pagar);
    const u = unidadeDe(f.unidade_id);
    abrirPix(f, u.condominios, u.identificacao);
  };
}

// ---------------------------------------------------------------- Solicitações
export async function solicitacoes(root) {
  if (!state.unidades.length) return (root.innerHTML = semUnidade());
  const lista = await q(sb.from('solicitacoes').select('*, condominios(nome_fantasia)')
    .eq('pessoa_id', state.user.id).order('criado_em', { ascending: false }));

  root.innerHTML = `
    <form class="card" id="f-sol">
      <h3>Nova solicitação ao síndico</h3>
      <label>Unidade
        <select name="vinculo">${state.unidades.map((v) =>
          `<option value="${v.unidades.id}">${esc(v.unidades.condominios?.nome_fantasia)} · ${esc(v.unidades.identificacao)}</option>`).join('')}
        </select></label>
      <label>Categoria
        <select name="categoria">
          <option>MANUTENCAO</option><option>LIMPEZA</option><option>SEGURANCA</option>
          <option>BARULHO</option><option>FINANCEIRO</option><option>RESERVA_AREA_COMUM</option><option>GERAL</option>
        </select></label>
      <label>Assunto<input name="titulo" required maxlength="140" placeholder="Ex.: Lâmpada queimada no hall do 3º andar"></label>
      <label>Detalhes<textarea name="descricao" rows="3"></textarea></label>
      <button class="btn primario">Enviar</button>
    </form>
    <h2 class="secao">Minhas solicitações</h2>
    ${lista.length ? lista.map((s) => `
      <div class="card item">
        <div class="linha"><b>${esc(s.titulo)}</b>${badge(s.status)}</div>
        <small>${esc(s.condominios?.nome_fantasia)} · ${esc(s.categoria)} · ${dataHora(s.criado_em)}</small>
        ${s.descricao ? `<p>${esc(s.descricao)}</p>` : ''}
        ${s.resposta ? `<p class="resposta"><b>Resposta do síndico:</b> ${esc(s.resposta)}</p>` : ''}
        ${s.status === 'ABERTA' ? `<button class="btn mini-btn" data-cancelar="${s.id}">Cancelar</button>` : ''}
      </div>`).join('') : vazio('Você ainda não abriu solicitações.')}`;

  root.querySelector('#f-sol').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    const v = state.unidades.find((x) => x.unidades.id === f.vinculo);
    await q(sb.from('solicitacoes').insert({
      condominio_id: v.unidades.condominio_id, unidade_id: v.unidades.id, pessoa_id: state.user.id,
      titulo: f.titulo, descricao: f.descricao, categoria: f.categoria,
    }));
    toast('Solicitação enviada ao síndico!');
    solicitacoes(root);
  };
  root.onclick = async (e) => {
    const b = e.target.closest('[data-cancelar]');
    if (!b || !confirm('Cancelar esta solicitação?')) return;
    await q(sb.from('solicitacoes').update({ status: 'CANCELADA', atualizado_em: new Date().toISOString() }).eq('id', b.dataset.cancelar));
    solicitacoes(root);
  };
}

// ---------------------------------------------------------------- Agenda (vistorias)
export async function agenda(root) {
  if (!state.unidades.length) return (root.innerHTML = semUnidade());
  const conds = condominiosDoMorador().map((c) => c.id);
  const lista = await q(sb.from('vistorias').select('*, condominios(nome_fantasia)').in('condominio_id', conds)
    .gte('data_agendada', new Date(Date.now() - 30 * 864e5).toISOString()).order('data_agendada'));
  root.innerHTML = lista.length ? lista.map((v) => `
    <div class="card item">
      <div class="linha"><b>${esc(v.titulo)}</b>${badge(v.status)}</div>
      <small>${esc(v.condominios?.nome_fantasia)} · ${dataHora(v.data_agendada)} · ${esc(v.tipo)}</small>
      ${v.observacoes ? `<p>${esc(v.observacoes)}</p>` : ''}
    </div>`).join('') : vazio('Nenhuma vistoria ou manutenção agendada.');
}

// ---------------------------------------------------------------- Prestação de contas
export async function prestacaoContas(root) {
  if (!state.unidades.length) return (root.innerHTML = semUnidade());
  const conds = condominiosDoMorador();
  root.innerHTML = `
    <div class="card filtros nao-imprimir">
      <label>Condomínio<select id="c">${conds.map((c) => `<option value="${c.id}">${esc(c.nome_fantasia)}</option>`).join('')}</select></label>
      <label>Mês<input type="month" id="m" value="${mesAtual()}"></label>
    </div>
    <div id="bal"></div><div id="det"></div>`;
  const atualizar = async () => {
    const c = conds.find((x) => x.id === root.querySelector('#c').value);
    const ym = root.querySelector('#m').value || mesAtual();
    await desenharBalancete(root.querySelector('#bal'), c.id, ym, c.nome_fantasia);
    await listarDespesasPublicas(root.querySelector('#det'), c.id, ym);
  };
  root.querySelector('#c').onchange = atualizar;
  root.querySelector('#m').onchange = atualizar;
  await atualizar();
}

// ---------------------------------------------------------------- Perfil
export async function perfil(root) {
  const p = state.perfil;
  root.innerHTML = `
    <form class="card" id="f-perfil">
      <label>Nome completo<input name="nome_completo" required value="${esc(p.nome_completo)}"></label>
      <label>CPF/CNPJ<input name="cpf_cnpj" inputmode="numeric" value="${esc(p.cpf_cnpj || '')}"></label>
      <label>WhatsApp<input name="telefone_whatsapp" inputmode="tel" value="${esc(p.telefone_whatsapp || '')}"></label>
      <label>E-mail<input value="${esc(p.email)}" disabled></label>
      <p class="mini">Perfil: <b>${esc(p.tipo_usuario)}</b></p>
      <button class="btn primario">Salvar</button>
    </form>
    <div class="card">
      <h3>Minhas unidades</h3>
      ${state.unidades.length ? `<ul>${state.unidades.map((v) =>
        `<li>${esc(v.unidades.condominios?.nome_fantasia)} · ${esc(v.unidades.identificacao)} <small>(${esc(v.tipo_vinculo)})</small></li>`).join('')}</ul>`
        : '<p class="mini">Nenhuma unidade vinculada.</p>'}
    </div>`;
  root.querySelector('#f-perfil').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    await q(sb.from('pessoas').update({
      nome_completo: f.nome_completo.trim(),
      cpf_cnpj: soDigitos(f.cpf_cnpj) || null,
      telefone_whatsapp: soDigitos(f.telefone_whatsapp) || null,
    }).eq('id', p.id));
    await carregarContexto();
    toast('Perfil atualizado!');
  };
}
