// Componentes usados tanto pelo morador quanto pelo síndico
import { sb } from '../supabase.js';
import { esc, brl, data, q, modal, copiar, toast, mesNome, baixarCSV, rotulo, waLink } from '../ui.js';
import { gerarPixCopiaECola, qrSvg } from '../pix.js';

export function pixDaFatura(fatura, cond) {
  if (!cond?.chave_pix) return null;
  return gerarPixCopiaECola({
    chave: cond.chave_pix,
    nome: cond.nome_recebedor_pix || cond.nome_fantasia,
    cidade: cond.cidade || 'BRASIL',
    valor: fatura.valor_original,
    txid: fatura.txid_pix || String(fatura.id).replace(/-/g, '').slice(0, 25),
  });
}

export function abrirPix(fatura, cond, unidadeTxt) {
  const codigo = pixDaFatura(fatura, cond);
  if (!codigo) {
    return toast('O condomínio ainda não cadastrou a chave Pix. Fale com o síndico.', 'erro');
  }
  const msgSindico = `Olá! Paguei via Pix a fatura de ${mesNome(fatura.mes_referencia.slice(0, 7))} ` +
    `(${unidadeTxt || ''}) no valor de ${brl(fatura.valor_original)}. Segue o comprovante.`;
  const { el } = modal('Pagar com Pix', `
    <p class="centro-txt"><b>${brl(fatura.valor_original)}</b> · vence ${data(fatura.data_vencimento)}</p>
    <div class="qr">${qrSvg(codigo)}</div>
    <label>Pix Copia e Cola<textarea readonly rows="4">${esc(codigo)}</textarea></label>
    <button class="btn primario" id="copiar-pix">Copiar código Pix</button>
    <p class="mini">Abra o app do seu banco → Pix → "Pix Copia e Cola" (ou leia o QR Code).
      Depois envie o comprovante ao síndico para a baixa.</p>
    ${cond.whatsapp_sindico ? `<a class="btn" target="_blank" rel="noopener"
       href="${esc(waLink(cond.whatsapp_sindico, msgSindico))}">
       📲 Enviar comprovante no WhatsApp</a>` : ''}`);
  el.querySelector('#copiar-pix').onclick = () => copiar(codigo);
}

/** Desenha o balancete de um mês dentro de `alvo` */
export async function desenharBalancete(alvo, condId, ym, nomeCond) {
  const linhas = await q(sb.rpc('balancete', { p_condominio: condId, p_mes: ym + '-01' }));
  const receitas = linhas.filter((l) => l.grupo === 'RECEITA');
  const despesas = linhas.filter((l) => l.grupo === 'DESPESA');
  const totR = receitas.reduce((s, l) => s + Number(l.valor), 0);
  const totD = despesas.reduce((s, l) => s + Number(l.valor), 0);
  const saldo = totR - totD;

  const fat = await q(sb.from('faturas').select('valor_original,status').eq('condominio_id', condId).eq('mes_referencia', ym + '-01'));
  const previsto = fat.reduce((s, f) => s + Number(f.valor_original), 0);
  const emAberto = fat.filter((f) => ['PENDENTE', 'ATRASADO', 'EM_COBRANCA'].includes(f.status))
    .reduce((s, f) => s + Number(f.valor_original), 0);

  alvo.innerHTML = `
    <div class="card imprimir">
      <h3>Balancete — ${esc(nomeCond)} — ${esc(mesNome(ym))}</h3>
      <table class="tabela">
        <thead><tr><th>Receitas (regime de caixa)</th><th class="num">Valor</th></tr></thead>
        <tbody>${receitas.map((l) => `<tr><td>${esc(l.item)}</td><td class="num">${brl(l.valor)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th>Total de receitas</th><th class="num">${brl(totR)}</th></tr></tfoot>
      </table>
      <table class="tabela">
        <thead><tr><th>Despesas por categoria</th><th class="num">Valor</th></tr></thead>
        <tbody>${despesas.length ? despesas.map((l) => `<tr><td>${esc(rotulo(l.item))}</td><td class="num">${brl(l.valor)}</td></tr>`).join('')
          : '<tr><td colspan="2" class="mini">Nenhuma despesa lançada.</td></tr>'}</tbody>
        <tfoot><tr><th>Total de despesas</th><th class="num">${brl(totD)}</th></tr></tfoot>
      </table>
      <div class="kpis">
        <div class="kpi ${saldo >= 0 ? 'ok' : 'erro'}"><small>Resultado do mês</small><b>${brl(saldo)}</b></div>
        <div class="kpi"><small>Arrecadação prevista</small><b>${brl(previsto)}</b></div>
        <div class="kpi"><small>Em aberto (inadimplência)</small><b>${brl(emAberto)}</b></div>
      </div>
      <div class="acoes nao-imprimir">
        <button class="btn" id="b-print">🖨️ Imprimir / salvar PDF</button>
        <button class="btn" id="b-csv">⬇️ Baixar planilha (CSV)</button>
      </div>
    </div>`;
  alvo.querySelector('#b-print').onclick = () => window.print();
  alvo.querySelector('#b-csv').onclick = () =>
    baixarCSV(`balancete-${ym}.csv`, [
      ['Grupo', 'Item', 'Valor'],
      ...linhas.map((l) => [l.grupo, l.item, String(l.valor).replace('.', ',')]),
      ['RESULTADO', '', String(saldo.toFixed(2)).replace('.', ',')],
    ]);
}

export async function listarDespesasPublicas(alvo, condId, ym) {
  const [a, m] = ym.split('-').map(Number);
  const fim = new Date(a, m, 1).toLocaleDateString('sv-SE');
  const desp = await q(sb.from('despesas').select('*').eq('condominio_id', condId)
    .gte('data_competencia', ym + '-01').lt('data_competencia', fim).order('data_competencia'));
  alvo.innerHTML = desp.length ? `
    <div class="card"><h3>Despesas detalhadas</h3>
      <table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${desp.map((d) => `<tr>
        <td>${data(d.data_competencia)}</td><td>${esc(d.descricao)}${d.fornecedor ? `<br><small>${esc(d.fornecedor)}</small>` : ''}</td>
        <td>${esc(rotulo(d.categoria))}</td><td class="num">${brl(d.valor)}</td>
        <td>${d.comprovante_path ? `<button class="btn mini-btn" data-comp="${esc(d.comprovante_path)}">📎</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '';
  alvo.onclick = (e) => {
    const b = e.target.closest('[data-comp]');
    if (b) abrirComprovante(b.dataset.comp);
  };
}

export async function abrirComprovante(caminho) {
  const { data: d, error } = await sb.storage.from('comprovantes').createSignedUrl(caminho, 300);
  if (error) return toast('Não foi possível abrir o comprovante.', 'erro');
  window.open(d.signedUrl, '_blank', 'noopener');
}
