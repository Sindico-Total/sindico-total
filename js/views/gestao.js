import { sb } from '../supabase.js';
import { state, condAtual, ehAdmin, recarregar } from '../app.js';
import {
  esc, brl, data, dataHora, badge, q, toast, modal, dadosForm, vazio, mesAtual, mesNome,
  baixarCSV, lerCSV, numBR, waLink, soDigitos, rotulo, hojeISO,
} from '../ui.js';
import { pixDaFatura, desenharBalancete, abrirComprovante } from './comum.js';

const fimDoMes = (ym) => {
  const [a, m] = ym.split('-').map(Number);
  return new Date(a, m, 1).toLocaleDateString('sv-SE');
};

// ================================================================ PAINEL
export async function painel(root) {
  const c = condAtual();
  const ym = mesAtual();
  await sb.rpc('atualizar_atrasos');
  const [fat, sols, vist, unid] = await Promise.all([
    q(sb.from('faturas').select('valor_original,status,mes_referencia').eq('condominio_id', c.id).eq('mes_referencia', ym + '-01')),
    q(sb.from('solicitacoes').select('id,titulo,status,criado_em').eq('condominio_id', c.id).in('status', ['ABERTA', 'EM_ANDAMENTO']).order('criado_em')),
    q(sb.from('vistorias').select('*').eq('condominio_id', c.id).eq('status', 'AGENDADA').order('data_agendada').limit(5)),
    q(sb.from('unidades').select('id', { count: 'exact' }).eq('condominio_id', c.id)),
  ]);
  const soma = (arr) => arr.reduce((s, f) => s + Number(f.valor_original), 0);
  const previsto = soma(fat);
  const pago = soma(fat.filter((f) => f.status === 'PAGO'));
  const cedido = soma(fat.filter((f) => f.status === 'CEDIDO'));
  const aberto = soma(fat.filter((f) => ['PENDENTE', 'ATRASADO', 'EM_COBRANCA'].includes(f.status)));
  const atrasado = soma(fat.filter((f) => f.status === 'ATRASADO'));
  const inad = previsto ? ((atrasado / previsto) * 100).toFixed(1) : '0.0';

  const pendencias = [];
  if (!c.chave_pix) pendencias.push('Cadastre a <a href="#/gestao/condominio">chave Pix</a> do condomínio para os moradores pagarem.');
  if (!unid.length) pendencias.push('Cadastre as <a href="#/gestao/unidades">unidades</a> (pode importar planilha).');
  if (unid.length && !fat.length) pendencias.push(`Gere as <a href="#/gestao/faturas">faturas de ${esc(mesNome(ym))}</a>.`);

  root.innerHTML = `
    ${pendencias.length ? `<div class="card alerta-card"><b>Próximos passos</b><ul>${pendencias.map((p) => `<li>${p}</li>`).join('')}</ul></div>` : ''}
    <h2 class="secao">${esc(c.nome_fantasia)} — ${esc(mesNome(ym))}</h2>
    <div class="kpis">
      <div class="kpi"><small>Arrecadação prevista</small><b>${brl(previsto)}</b></div>
      <div class="kpi ok"><small>Recebido</small><b>${brl(pago)}</b></div>
      <div class="kpi"><small>Em aberto</small><b>${brl(aberto)}</b></div>
      <div class="kpi ${Number(inad) > 5 ? 'erro' : ''}"><small>Inadimplência</small><b>${inad}%</b></div>
      <div class="kpi roxo"><small>Garantido (cedido)</small><b>${brl(cedido)}</b></div>
      <div class="kpi"><small>Unidades</small><b>${unid.length}</b></div>
    </div>
    <div class="grade2">
      <div class="card"><h3>Diligências abertas (${sols.length})</h3>
        ${sols.length ? `<ul class="lista">${sols.slice(0, 6).map((s) => `<li>${badge(s.status)} ${esc(s.titulo)} <small>${data(s.criado_em)}</small></li>`).join('')}</ul>
        <a href="#/gestao/solicitacoes">Ver todas →</a>` : '<p class="mini">Nada pendente. 🎉</p>'}
      </div>
      <div class="card"><h3>Próximas vistorias</h3>
        ${vist.length ? `<ul class="lista">${vist.map((v) => `<li><b>${dataHora(v.data_agendada)}</b> — ${esc(v.titulo)}</li>`).join('')}</ul>`
          : '<p class="mini">Nenhuma agendada.</p>'}
        <a href="#/gestao/vistorias">Agendar →</a>
      </div>
    </div>`;
}

// ================================================================ FATURAMENTO
export async function faturas(root) {
  const c = condAtual();
  const ym = root.dataset.mes || mesAtual();
  await sb.rpc('atualizar_atrasos');
  const [lista, vinc] = await Promise.all([
    q(sb.from('faturas').select('*, unidades(identificacao)').eq('condominio_id', c.id).eq('mes_referencia', ym + '-01')),
    q(sb.from('vinculos_unidade').select('unidade_id, tipo_vinculo, pessoas(nome_completo, telefone_whatsapp), unidades!inner(condominio_id)')
      .eq('unidades.condominio_id', c.id).eq('ativo', true)),
  ]);
  lista.sort((a, b) => (a.unidades?.identificacao || '').localeCompare(b.unidades?.identificacao || '', 'pt-BR', { numeric: true }));
  const contato = (uid) => {
    const vs = vinc.filter((v) => v.unidade_id === uid && v.pessoas);
    return vs.find((v) => v.tipo_vinculo === 'RESPONSAVEL_FINANCEIRO') || vs.find((v) => v.tipo_vinculo === 'PROPRIETARIO') || vs[0];
  };
  const venc = `${ym}-${String(c.dia_vencimento || 10).padStart(2, '0')}`;
  const total = (st) => lista.filter((f) => !st || st.includes(f.status)).reduce((s, f) => s + Number(f.valor_original), 0);

  root.innerHTML = `
    <div class="card filtros">
      <label>Mês de referência<input type="month" id="mes" value="${ym}"></label>
      <label>Vencimento<input type="date" id="venc" value="${venc}"></label>
      <button class="btn primario" id="gerar">Gerar faturas do mês</button>
      <button class="btn" id="csv">⬇️ CSV</button>
    </div>
    <div class="kpis">
      <div class="kpi"><small>Total</small><b>${brl(total())}</b></div>
      <div class="kpi ok"><small>Pago</small><b>${brl(total(['PAGO']))}</b></div>
      <div class="kpi"><small>Pendente</small><b>${brl(total(['PENDENTE']))}</b></div>
      <div class="kpi erro"><small>Atrasado</small><b>${brl(total(['ATRASADO', 'EM_COBRANCA']))}</b></div>
      <div class="kpi roxo"><small>Cedido</small><b>${brl(total(['CEDIDO']))}</b></div>
    </div>
    ${lista.length ? `<div class="card"><table class="tabela">
      <thead><tr><th>Unidade</th><th>Responsável</th><th class="num">Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${lista.map((f) => {
        const ct = contato(f.unidade_id);
        const aberta = ['PENDENTE', 'ATRASADO', 'EM_COBRANCA', 'CEDIDO'].includes(f.status);
        return `<tr>
          <td>${esc(f.unidades?.identificacao)}</td>
          <td>${esc(ct?.pessoas?.nome_completo || '—')}</td>
          <td class="num">${brl(f.valor_original)}</td>
          <td>${data(f.data_vencimento)}</td>
          <td>${badge(f.status)}</td>
          <td class="acoes-linha">
            ${aberta ? `<button class="btn mini-btn" data-pagar="${f.id}">✔ Baixa</button>` : ''}
            ${aberta && ct?.pessoas?.telefone_whatsapp ? `<button class="btn mini-btn" data-cobrar="${f.id}">📲 Cobrar</button>` : ''}
            ${f.status === 'PENDENTE' ? `<button class="btn mini-btn" data-editar="${f.id}">✏️</button>` : ''}
          </td></tr>`;
      }).join('')}</tbody></table></div>`
      : vazio('Nenhuma fatura neste mês. Clique em "Gerar faturas do mês" (usa o valor da taxa de cada unidade).')}`;

  const mesInput = root.querySelector('#mes');
  mesInput.onchange = () => { root.dataset.mes = mesInput.value; faturas(root); };

  root.querySelector('#gerar').onclick = async () => {
    const n = await q(sb.rpc('gerar_faturas', { p_condominio: c.id, p_mes: ym + '-01', p_vencimento: root.querySelector('#venc').value }));
    toast(n ? `${n} fatura(s) gerada(s).` : 'Nenhuma fatura nova (já existiam ou unidades sem valor de taxa).', n ? 'ok' : 'alerta');
    faturas(root);
  };

  root.querySelector('#csv').onclick = () => baixarCSV(`faturas-${ym}.csv`, [
    ['Unidade', 'Responsável', 'Valor', 'Vencimento', 'Status', 'Pix copia e cola'],
    ...lista.map((f) => [f.unidades?.identificacao, contato(f.unidade_id)?.pessoas?.nome_completo, String(f.valor_original).replace('.', ','),
      data(f.data_vencimento), f.status, pixDaFatura(f, c) || '']),
  ]);

  root.onclick = async (e) => {
    const b = e.target.closest('button[data-pagar],button[data-cobrar],button[data-editar]');
    if (!b) return;
    const f = lista.find((x) => x.id === (b.dataset.pagar || b.dataset.cobrar || b.dataset.editar));

    if (b.dataset.cobrar) {
      const ct = contato(f.unidade_id);
      const pix = pixDaFatura(f, c);
      const txt = `Olá, ${ct.pessoas.nome_completo.split(' ')[0]}! Aqui é a administração do ${c.nome_fantasia}.\n` +
        `A taxa condominial de ${mesNome(ym)} (${f.unidades.identificacao}) no valor de ${brl(f.valor_original)} ` +
        `vence/venceu em ${data(f.data_vencimento)}.` + (pix ? `\n\nPix copia e cola:\n${pix}` : '');
      window.open(waLink(ct.pessoas.telefone_whatsapp, txt), '_blank', 'noopener');
      return;
    }

    if (b.dataset.editar) {
      const m = modal('Editar fatura', `
        <form id="fe"><label>Valor<input name="valor" inputmode="decimal" value="${String(f.valor_original).replace('.', ',')}"></label>
        <label>Vencimento<input type="date" name="venc" value="${f.data_vencimento}"></label>
        <button class="btn primario">Salvar</button>
        <button class="btn perigo" type="button" id="del">Excluir fatura</button></form>`);
      m.el.querySelector('#fe').onsubmit = async (ev) => {
        ev.preventDefault();
        const d = dadosForm(ev.target);
        await q(sb.from('faturas').update({ valor_original: numBR(d.valor), data_vencimento: d.venc }).eq('id', f.id));
        m.fechar(); faturas(root);
      };
      m.el.querySelector('#del').onclick = async () => {
        if (!confirm('Excluir esta fatura?')) return;
        await q(sb.from('faturas').delete().eq('id', f.id));
        m.fechar(); faturas(root);
      };
      return;
    }

    const m = modal(`Dar baixa — ${f.unidades.identificacao}`, `
      <form id="fp">
        <label>Valor recebido<input name="valor" inputmode="decimal" required value="${String(f.valor_original).replace('.', ',')}"></label>
        <label>Forma<select name="metodo"><option>PIX</option><option>BOLETO</option><option>CARTAO</option><option>DINHEIRO</option><option>OUTRO</option></select></label>
        <label>ID da transação / E2E do Pix (opcional, evita baixa duplicada)<input name="tx"></label>
        ${f.status === 'CEDIDO' ? '<p class="mini">⚠️ Fatura cedida à garantidora: o valor pertence à fintech e a cessão será marcada como RECUPERADA.</p>' : ''}
        <button class="btn primario">Confirmar pagamento</button>
      </form>`);
    m.el.querySelector('#fp').onsubmit = async (ev) => {
      ev.preventDefault();
      const d = dadosForm(ev.target);
      await q(sb.rpc('registrar_pagamento', { p_fatura: f.id, p_valor: numBR(d.valor), p_metodo: d.metodo, p_id_transacao: d.tx.trim() || null }));
      toast('Pagamento registrado.');
      m.fechar(); faturas(root);
    };
  };
}

// ================================================================ UNIDADES
export async function unidades(root) {
  const c = condAtual();
  const [lista, vinc, conv] = await Promise.all([
    q(sb.from('unidades').select('*').eq('condominio_id', c.id)),
    q(sb.from('vinculos_unidade').select('id, unidade_id, tipo_vinculo, pessoas(nome_completo, email, telefone_whatsapp), unidades!inner(condominio_id)')
      .eq('unidades.condominio_id', c.id).eq('ativo', true)),
    q(sb.from('convites').select('id, email, unidade_id, tipo_vinculo, unidades!inner(condominio_id)').eq('unidades.condominio_id', c.id).is('usado_em', null)),
  ]);
  lista.sort((a, b) => a.identificacao.localeCompare(b.identificacao, 'pt-BR', { numeric: true }));

  root.innerHTML = `
    <div class="grade2">
      <form class="card" id="f-unid">
        <h3>Adicionar unidade</h3>
        <label>Identificação<input name="identificacao" required placeholder="Bloco A - Apto 101"></label>
        <label>Taxa condominial mensal (R$)<input name="valor" inputmode="decimal" required placeholder="850,00"></label>
        <label>Fração ideal (opcional)<input name="fracao" inputmode="decimal" placeholder="0,012500"></label>
        <button class="btn primario">Adicionar</button>
      </form>
      <div class="card">
        <h3>Importar planilha</h3>
        <p class="mini">Arquivo CSV com colunas: <code>identificacao;valor_taxa;fracao_ideal;email_morador</code>.
          Exporte do Excel/Google Planilhas como "CSV". A 1ª linha pode ser o cabeçalho.</p>
        <input type="file" id="csv" accept=".csv,text/csv">
        <button class="btn" id="modelo">⬇️ Baixar modelo</button>
      </div>
    </div>
    <h2 class="secao">${lista.length} unidade(s)</h2>
    ${lista.length ? `<div class="card"><table class="tabela">
      <thead><tr><th>Unidade</th><th class="num">Taxa</th><th>Moradores</th><th></th></tr></thead>
      <tbody>${lista.map((u) => {
        const vs = vinc.filter((v) => v.unidade_id === u.id);
        const cs = conv.filter((x) => x.unidade_id === u.id);
        return `<tr><td><b>${esc(u.identificacao)}</b></td><td class="num">${brl(u.valor_taxa_condominio)}</td>
          <td>${vs.map((v) => `${esc(v.pessoas?.nome_completo)} <small>(${esc(rotulo(v.tipo_vinculo))})</small>`).join('<br>')}
              ${cs.map((x) => `<br><small class="pendente">✉ ${esc(x.email)} — aguardando cadastro</small>`).join('')}</td>
          <td class="acoes-linha"><button class="btn mini-btn" data-gerir="${u.id}">Gerenciar</button></td></tr>`;
      }).join('')}</tbody></table></div>` : vazio('Nenhuma unidade cadastrada.')}`;

  root.querySelector('#f-unid').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    await q(sb.from('unidades').insert({ condominio_id: c.id, identificacao: f.identificacao.trim(),
      valor_taxa_condominio: numBR(f.valor), fracao_ideal: f.fracao ? numBR(f.fracao) : null }));
    toast('Unidade adicionada.');
    unidades(root);
  };

  root.querySelector('#modelo').onclick = () => baixarCSV('modelo-unidades.csv', [
    ['identificacao', 'valor_taxa', 'fracao_ideal', 'email_morador'],
    ['Bloco A - Apto 101', '850,00', '0,0125', 'morador101@email.com'],
    ['Bloco A - Apto 102', '850,00', '0,0125', ''],
  ]);

  root.querySelector('#csv').onchange = async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    let linhas = lerCSV(await arq.text());
    if (linhas[0] && /identifica/i.test(linhas[0][0])) linhas = linhas.slice(1);
    const registros = linhas.filter((l) => l[0]).map((l) => ({
      condominio_id: c.id, identificacao: l[0], valor_taxa_condominio: numBR(l[1]), fracao_ideal: l[2] ? numBR(l[2]) : null,
    }));
    if (!registros.length) return toast('Planilha vazia.', 'erro');
    if (!confirm(`Importar/atualizar ${registros.length} unidade(s)?`)) return;
    const salvas = await q(sb.from('unidades').upsert(registros, { onConflict: 'condominio_id,identificacao' }).select('id, identificacao'));
    let convites = 0;
    for (const l of linhas) {
      const email = (l[3] || '').trim();
      const u = salvas.find((s) => s.identificacao === l[0]);
      if (email && u) {
        await sb.rpc('convidar_morador', { p_unidade: u.id, p_email: email, p_tipo: 'PROPRIETARIO' });
        convites++;
      }
    }
    toast(`${salvas.length} unidade(s) importada(s)${convites ? `, ${convites} morador(es) convidado(s)` : ''}.`);
    unidades(root);
  };

  root.onclick = (e) => {
    const b = e.target.closest('[data-gerir]');
    if (!b) return;
    const u = lista.find((x) => x.id === b.dataset.gerir);
    const vs = vinc.filter((v) => v.unidade_id === u.id);
    const cs = conv.filter((x) => x.unidade_id === u.id);
    const m = modal(u.identificacao, `
      <form id="fu">
        <label>Identificação<input name="identificacao" value="${esc(u.identificacao)}" required></label>
        <label>Taxa mensal (R$)<input name="valor" inputmode="decimal" value="${String(u.valor_taxa_condominio ?? '').replace('.', ',')}"></label>
        <button class="btn primario">Salvar unidade</button>
      </form>
      <h4>Moradores</h4>
      ${vs.length ? vs.map((v) => `<div class="linha"><span>${esc(v.pessoas?.nome_completo)} · ${esc(v.pessoas?.email)} <small>(${esc(rotulo(v.tipo_vinculo))})</small></span>
          <button class="btn mini-btn" data-desv="${v.id}">Remover</button></div>`).join('') : '<p class="mini">Nenhum.</p>'}
      ${cs.map((x) => `<div class="linha"><span class="pendente">✉ ${esc(x.email)} — convite pendente</span>
          <button class="btn mini-btn" data-delconv="${x.id}">Cancelar</button></div>`).join('')}
      <form id="fc" class="borda">
        <label>Convidar morador por e-mail<input type="email" name="email" required placeholder="morador@email.com"></label>
        <label>Vínculo<select name="tipo"><option value="PROPRIETARIO">Proprietário</option><option value="INQUILINO">Inquilino</option>
          <option value="RESPONSAVEL_FINANCEIRO">Responsável financeiro</option></select></label>
        <button class="btn">Convidar</button>
        <p class="mini">Se a pessoa já tem conta, é vinculada na hora. Se não, será vinculada quando criar a conta com este e-mail.</p>
      </form>
      <button class="btn perigo" id="del-u">Excluir unidade</button>`);
    m.el.querySelector('#fu').onsubmit = async (ev) => {
      ev.preventDefault();
      const d = dadosForm(ev.target);
      await q(sb.from('unidades').update({ identificacao: d.identificacao.trim(), valor_taxa_condominio: numBR(d.valor) }).eq('id', u.id));
      m.fechar(); unidades(root);
    };
    m.el.querySelector('#fc').onsubmit = async (ev) => {
      ev.preventDefault();
      const d = dadosForm(ev.target);
      const r = await q(sb.rpc('convidar_morador', { p_unidade: u.id, p_email: d.email, p_tipo: d.tipo }));
      toast(r === 'VINCULADO' ? 'Morador vinculado!' : 'Convite registrado. Peça para ele criar a conta no app com esse e-mail.');
      m.fechar(); unidades(root);
    };
    m.el.onclick = async (ev) => {
      const x = ev.target.closest('[data-desv],[data-delconv]');
      if (x?.dataset.desv) {
        await q(sb.from('vinculos_unidade').update({ ativo: false, data_fim: hojeISO() }).eq('id', x.dataset.desv));
        m.fechar(); unidades(root);
      } else if (x?.dataset.delconv) {
        await q(sb.from('convites').delete().eq('id', x.dataset.delconv));
        m.fechar(); unidades(root);
      }
    };
    m.el.querySelector('#del-u').onclick = async () => {
      if (!confirm(`Excluir ${u.identificacao}? Isso apaga também as faturas dela.`)) return;
      await q(sb.from('unidades').delete().eq('id', u.id));
      m.fechar(); unidades(root);
    };
  };
}

// ================================================================ DESPESAS
const CATEGORIAS = ['PESSOAL', 'LIMPEZA', 'MANUTENCAO', 'AGUA', 'ENERGIA', 'GAS', 'SEGURANCA', 'ELEVADORES',
  'SEGUROS', 'ADMINISTRACAO', 'HONORARIOS_SINDICO', 'IMPOSTOS', 'FUNDO_RESERVA', 'OBRAS', 'OUTROS'];

export async function despesas(root) {
  const c = condAtual();
  const ym = root.dataset.mes || mesAtual();
  const lista = await q(sb.from('despesas').select('*').eq('condominio_id', c.id)
    .gte('data_competencia', ym + '-01').lt('data_competencia', fimDoMes(ym)).order('data_competencia'));
  const total = lista.reduce((s, d) => s + Number(d.valor), 0);

  root.innerHTML = `
    <form class="card" id="f-desp">
      <h3>Lançar despesa</h3>
      <div class="grade2">
        <label>Descrição<input name="descricao" required placeholder="Conta de energia - áreas comuns"></label>
        <label>Fornecedor<input name="fornecedor"></label>
        <label>Categoria<select name="categoria">${CATEGORIAS.map((k) => `<option value="${k}">${rotulo(k)}</option>`).join('')}</select></label>
        <label>Valor (R$)<input name="valor" inputmode="decimal" required></label>
        <label>Competência<input type="date" name="data_competencia" required value="${ym === mesAtual() ? hojeISO() : ym + '-01'}"></label>
        <label>Pago em<input type="date" name="data_pagamento"></label>
      </div>
      <label>Comprovante / nota fiscal (foto ou PDF)<input type="file" name="arquivo" accept="image/*,application/pdf"></label>
      <button class="btn primario">Salvar despesa</button>
    </form>
    <div class="card filtros">
      <label>Mês<input type="month" id="mes" value="${ym}"></label>
      <div class="kpi"><small>Total do mês</small><b>${brl(total)}</b></div>
    </div>
    ${lista.length ? `<div class="card"><table class="tabela">
      <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${lista.map((d) => `<tr><td>${data(d.data_competencia)}</td>
        <td>${esc(d.descricao)}${d.fornecedor ? `<br><small>${esc(d.fornecedor)}</small>` : ''}</td>
        <td>${esc(rotulo(d.categoria))}</td><td class="num">${brl(d.valor)}</td>
        <td class="acoes-linha">${d.comprovante_path ? `<button class="btn mini-btn" data-comp="${esc(d.comprovante_path)}">📎</button>` : ''}
          <button class="btn mini-btn" data-del="${d.id}">🗑</button></td></tr>`).join('')}</tbody></table></div>`
      : vazio('Nenhuma despesa lançada neste mês.')}`;

  const mesInput = root.querySelector('#mes');
  mesInput.onchange = () => { root.dataset.mes = mesInput.value; despesas(root); };

  root.querySelector('#f-desp').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const f = dadosForm(form);
    form.querySelector('button').disabled = true;
    try {
      let caminho = null;
      const arq = form.arquivo.files[0];
      if (arq) {
        if (arq.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB.');
        const nome = arq.name.normalize('NFD').replace(/[^\w.\-]/g, '_');
        caminho = `${c.id}/${Date.now()}-${nome}`;
        await q(sb.storage.from('comprovantes').upload(caminho, arq));
      }
      await q(sb.from('despesas').insert({
        condominio_id: c.id, descricao: f.descricao, fornecedor: f.fornecedor || null, categoria: f.categoria,
        valor: numBR(f.valor), data_competencia: f.data_competencia, data_pagamento: f.data_pagamento || null,
        comprovante_path: caminho, criado_por: state.user.id,
      }));
      toast('Despesa lançada.');
      root.dataset.mes = f.data_competencia.slice(0, 7);
      despesas(root);
    } catch (err) {
      if (err.message?.includes('10 MB')) toast(err.message, 'erro');
      form.querySelector('button').disabled = false;
    }
  };

  root.onclick = async (e) => {
    const comp = e.target.closest('[data-comp]');
    if (comp) return abrirComprovante(comp.dataset.comp);
    const del = e.target.closest('[data-del]');
    if (!del || !confirm('Excluir esta despesa?')) return;
    const d = lista.find((x) => x.id === del.dataset.del);
    if (d.comprovante_path) await sb.storage.from('comprovantes').remove([d.comprovante_path]);
    await q(sb.from('despesas').delete().eq('id', d.id));
    despesas(root);
  };
}

// ================================================================ BALANCETE
export async function balancete(root) {
  const c = condAtual();
  root.innerHTML = `
    <div class="card filtros nao-imprimir"><label>Mês<input type="month" id="mes" value="${mesAtual()}"></label>
      <p class="mini">Os moradores veem este mesmo balancete em "Prestação de contas".</p></div>
    <div id="bal"></div>`;
  const mes = root.querySelector('#mes');
  const desenhar = () => desenharBalancete(root.querySelector('#bal'), c.id, mes.value || mesAtual(), c.nome_fantasia);
  mes.onchange = desenhar;
  await desenhar();
}

// ================================================================ SOLICITAÇÕES / DILIGÊNCIAS
export async function solicitacoes(root) {
  const c = condAtual();
  const filtro = root.dataset.filtro || 'ABERTAS';
  let consulta = sb.from('solicitacoes').select('*, pessoas(nome_completo, telefone_whatsapp), unidades(identificacao)')
    .eq('condominio_id', c.id).order('criado_em', { ascending: false }).limit(100);
  if (filtro === 'ABERTAS') consulta = consulta.in('status', ['ABERTA', 'EM_ANDAMENTO']);
  const lista = await q(consulta);

  root.innerHTML = `
    <div class="card filtros">
      <label>Mostrar<select id="filtro"><option value="ABERTAS">Abertas / em andamento</option><option value="TODAS">Todas</option></select></label>
    </div>
    ${lista.length ? lista.map((s) => `
      <form class="card item" data-id="${s.id}">
        <div class="linha"><b>${esc(s.titulo)}</b>${badge(s.status)}</div>
        <small>${esc(s.pessoas?.nome_completo)} · ${esc(s.unidades?.identificacao || '')} · ${esc(s.categoria)} · ${dataHora(s.criado_em)}
          ${s.origem === 'WHATSAPP' ? ' · via WhatsApp' : ''}</small>
        ${s.descricao ? `<p>${esc(s.descricao)}</p>` : ''}
        <div class="grade2">
          <label>Status<select name="status">${['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA']
            .map((k) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${rotulo(k)}</option>`).join('')}</select></label>
          <label>Resposta ao morador<textarea name="resposta" rows="2">${esc(s.resposta || '')}</textarea></label>
        </div>
        <div class="acoes"><button class="btn primario mini-btn">Salvar</button>
          ${s.pessoas?.telefone_whatsapp ? `<a class="btn mini-btn" target="_blank" rel="noopener"
            href="${esc(waLink(s.pessoas.telefone_whatsapp, `Olá! Sobre sua solicitação "${s.titulo}": `))}">📲 WhatsApp</a>` : ''}
        </div>
      </form>`).join('') : vazio('Nenhuma solicitação.')}`;

  const sel = root.querySelector('#filtro');
  sel.value = filtro;
  sel.onchange = () => { root.dataset.filtro = sel.value; solicitacoes(root); };
  root.querySelectorAll('form[data-id]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const d = dadosForm(form);
      await q(sb.from('solicitacoes').update({ status: d.status, resposta: d.resposta || null, atualizado_em: new Date().toISOString() })
        .eq('id', form.dataset.id));
      toast('Solicitação atualizada.');
      solicitacoes(root);
    };
  });
}

// ================================================================ VISTORIAS
export async function vistorias(root) {
  const c = condAtual();
  const lista = await q(sb.from('vistorias').select('*').eq('condominio_id', c.id).order('data_agendada', { ascending: false }).limit(100));
  const futuras = lista.filter((v) => v.status === 'AGENDADA').reverse();
  const passadas = lista.filter((v) => v.status !== 'AGENDADA');

  const cartao = (v) => `
    <div class="card item">
      <div class="linha"><b>${esc(v.titulo)}</b>${badge(v.status)}</div>
      <small>${dataHora(v.data_agendada)} · ${esc(rotulo(v.tipo))}${v.responsavel ? ' · ' + esc(v.responsavel) : ''}
        ${v.recorrencia_dias ? ` · repete a cada ${v.recorrencia_dias} dias` : ''}</small>
      ${v.observacoes ? `<p>${esc(v.observacoes)}</p>` : ''}
      ${v.status === 'AGENDADA' ? `<div class="acoes">
        <button class="btn mini-btn primario" data-feita="${v.id}">✔ Realizada</button>
        <button class="btn mini-btn" data-cancel="${v.id}">Cancelar</button></div>` : ''}
    </div>`;

  root.innerHTML = `
    <form class="card" id="f-vist">
      <h3>Agendar vistoria / manutenção</h3>
      <div class="grade2">
        <label>Título<input name="titulo" required placeholder="Vistoria mensal das bombas"></label>
        <label>Tipo<select name="tipo">${['ROTINA', 'PREVENTIVA', 'ELEVADOR', 'INCENDIO', 'ELETRICA', 'HIDRAULICA', 'ESTRUTURAL', 'LIMPEZA_CAIXA_DAGUA', 'DEDETIZACAO']
          .map((k) => `<option value="${k}">${rotulo(k)}</option>`).join('')}</select></label>
        <label>Data e hora<input type="datetime-local" name="data" required></label>
        <label>Responsável / empresa<input name="responsavel"></label>
        <label>Repetir a cada (dias, opcional)<input type="number" name="rec" min="1" placeholder="30"></label>
        <label>Observações<input name="obs"></label>
      </div>
      <button class="btn primario">Agendar</button>
    </form>
    <h2 class="secao">Agendadas</h2>${futuras.length ? futuras.map(cartao).join('') : vazio('Nenhuma vistoria agendada.')}
    <h2 class="secao">Histórico</h2>${passadas.length ? passadas.map(cartao).join('') : vazio('Sem histórico.')}`;

  root.querySelector('#f-vist').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    await q(sb.from('vistorias').insert({
      condominio_id: c.id, titulo: f.titulo, tipo: f.tipo, data_agendada: new Date(f.data).toISOString(),
      responsavel: f.responsavel || null, observacoes: f.obs || null, recorrencia_dias: f.rec ? Number(f.rec) : null,
    }));
    toast('Vistoria agendada. Os moradores veem na Agenda.');
    vistorias(root);
  };

  root.onclick = async (e) => {
    const b = e.target.closest('[data-feita],[data-cancel]');
    if (!b) return;
    const v = lista.find((x) => x.id === (b.dataset.feita || b.dataset.cancel));
    if (b.dataset.cancel) {
      if (!confirm('Cancelar esta vistoria?')) return;
      await q(sb.from('vistorias').update({ status: 'CANCELADA' }).eq('id', v.id));
      return vistorias(root);
    }
    const obs = prompt('Observações da vistoria (o que foi verificado / problemas encontrados):', v.observacoes || '');
    if (obs === null) return;
    await q(sb.from('vistorias').update({ status: 'REALIZADA', observacoes: obs || null }).eq('id', v.id));
    if (v.recorrencia_dias) {
      const prox = new Date(new Date(v.data_agendada).getTime() + v.recorrencia_dias * 864e5);
      await q(sb.from('vistorias').insert({ condominio_id: c.id, titulo: v.titulo, tipo: v.tipo, data_agendada: prox.toISOString(),
        responsavel: v.responsavel, recorrencia_dias: v.recorrencia_dias }));
      toast(`Próxima agendada para ${dataHora(prox)}.`);
    }
    vistorias(root);
  };
}

// ================================================================ DADOS DO CONDOMÍNIO
export async function condominio(root) {
  const c = condAtual();
  root.innerHTML = `
    <form class="card" id="f-cond">
      <div class="grade2">
        <label>Nome<input name="nome_fantasia" required value="${esc(c.nome_fantasia)}"></label>
        <label>CNPJ<input name="cnpj" value="${esc(c.cnpj)}" ${ehAdmin() ? '' : 'disabled'}></label>
        <label>Endereço<input name="endereco_completo" value="${esc(c.endereco_completo || '')}"></label>
        <label>Cidade (vai no Pix)<input name="cidade" maxlength="60" value="${esc(c.cidade || '')}"></label>
        <label>Chave Pix que recebe as taxas<input name="chave_pix" value="${esc(c.chave_pix || '')}" placeholder="CNPJ, e-mail, telefone ou chave aleatória"></label>
        <label>Nome do titular da chave (até 25 letras)<input name="nome_recebedor_pix" maxlength="25" value="${esc(c.nome_recebedor_pix || '')}"></label>
        <label>WhatsApp do síndico<input name="whatsapp_sindico" inputmode="tel" value="${esc(c.whatsapp_sindico || '')}" placeholder="11999999999"></label>
        <label>Dia de vencimento<input type="number" min="1" max="28" name="dia_vencimento" value="${c.dia_vencimento || 10}"></label>
        ${ehAdmin() ? `<label>Taxa de garantia / deságio (%)<input name="taxa" inputmode="decimal" value="${String(c.taxa_garantia_percentual ?? '').replace('.', ',')}"></label>
        <label>Status do contrato<select name="status_assinatura">${['ATIVO', 'SUSPENSO', 'CANCELADO']
          .map((k) => `<option ${k === c.status_assinatura ? 'selected' : ''}>${k}</option>`).join('')}</select></label>` : ''}
      </div>
      <button class="btn primario">Salvar</button>
    </form>`;
  root.querySelector('#f-cond').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    const dados = {
      nome_fantasia: f.nome_fantasia.trim(), endereco_completo: f.endereco_completo || null, cidade: f.cidade || null,
      chave_pix: f.chave_pix.trim() || null, nome_recebedor_pix: f.nome_recebedor_pix || null,
      whatsapp_sindico: soDigitos(f.whatsapp_sindico) || null, dia_vencimento: Number(f.dia_vencimento) || 10,
    };
    if (ehAdmin()) {
      dados.cnpj = soDigitos(f.cnpj);
      dados.taxa_garantia_percentual = numBR(f.taxa);
      dados.status_assinatura = f.status_assinatura;
    }
    await q(sb.from('condominios').update(dados).eq('id', c.id));
    toast('Dados salvos.');
    recarregar();
  };
}
