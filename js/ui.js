// Utilidades de interface (sem frameworks)

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function data(d) {
  if (!d) return '—';
  const dt = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d);
  return dt.toLocaleDateString('pt-BR');
}
export function dataHora(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const hojeISO = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local
export const mesAtual = () => hojeISO().slice(0, 7);                  // YYYY-MM
export const mesNome = (ym) => {
  const [a, m] = ym.split('-').map(Number);
  return new Date(a, m - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

export const soDigitos = (s) => String(s || '').replace(/\D/g, '');

export function waLink(fone, texto) {
  let f = soDigitos(fone);
  if (f && f.length <= 11) f = '55' + f; // assume Brasil
  return `https://wa.me/${f}?text=${encodeURIComponent(texto)}`;
}

const STATUS_COR = {
  PAGO: 'ok', CONCLUIDA: 'ok', REALIZADA: 'ok', RECUPERADO: 'ok', ATIVO: 'ok', CONCILIADO: 'ok',
  PENDENTE: 'info', ABERTA: 'info', AGENDADA: 'info', EM_ABERTO: 'info',
  EM_ANDAMENTO: 'alerta', EM_COBRANCA: 'alerta', NEGATIVADO: 'alerta', PROTESTO: 'alerta', DIVERGENTE: 'alerta', SUSPENSO: 'alerta',
  ATRASADO: 'erro', ACAO_JUDICIAL: 'erro', CANCELADA: 'neutro', CANCELADO: 'neutro', CEDIDO: 'roxo',
};
export const rotulo = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const badge = (s) => `<span class="badge ${(Object.hasOwn(STATUS_COR, s) && STATUS_COR[s]) || 'neutro'}">${esc(rotulo(s))}</span>`;

export function toast(msg, tipo = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 6000 : 3500);
}

export function modal(titulo, corpoHtml) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <header><h3>${esc(titulo)}</h3><button class="btn-x" aria-label="Fechar">×</button></header>
      <div class="modal-corpo">${corpoHtml}</div>
    </div>`;
  const fechar = () => fundo.remove();
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelector('.btn-x').onclick = fechar;
  document.body.append(fundo);
  return { el: fundo.querySelector('.modal-corpo'), fechar };
}

export const dadosForm = (form) => Object.fromEntries(new FormData(form).entries());

const TRADUCOES = [
  [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/Email not confirmed/i, 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).'],
  [/User already registered/i, 'Este e-mail já tem cadastro. Use "Entrar" ou "Esqueci a senha".'],
  [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/duplicate key.*cnpj/i, 'Já existe um condomínio com este CNPJ.'],
  [/duplicate key.*cpf/i, 'Este CPF/CNPJ já está cadastrado em outra conta.'],
  [/duplicate key.*identificacao|unidades_condominio_id_identificacao/i, 'Já existe uma unidade com essa identificação.'],
  [/duplicate key/i, 'Registro duplicado.'],
  [/row-level security|permission denied/i, 'Você não tem permissão para esta ação.'],
  [/Failed to fetch|NetworkError/i, 'Sem conexão com o servidor. Verifique a internet.'],
  [/rate limit/i, 'Muitas tentativas. Aguarde alguns minutos.'],
];
export function traduzErro(msg) {
  for (const [re, txt] of TRADUCOES) if (re.test(msg)) return txt;
  return msg;
}

/** Executa uma chamada do Supabase; mostra erro amigável e lança exceção. */
export async function q(promessa) {
  const { data: d, error } = await promessa;
  if (error) {
    toast(traduzErro(error.message), 'erro');
    throw error;
  }
  return d;
}

export function baixarCSV(nome, linhas) {
  const csv = linhas.map((linha) => linha.map((celula) => {
    let texto = String(celula ?? '');
    // Planilhas podem interpretar texto exportado como fórmula, mesmo entre aspas.
    if (typeof celula !== 'number' && (/^[\t\r\n]/u.test(texto) || /^\s*[=+\-@＝＋－＠]/u.test(texto))) {
      texto = "'" + texto;
    }
    return '"' + texto.replace(/"/g, '""') + '"';
  }).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function lerCSV(texto) {
  const sep = texto.includes(';') ? ';' : ',';
  return texto
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
}

export const numBR = (s) => {
  const t = String(s ?? '').trim();
  if (!t) return 0;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copiado!');
}

export const vazio = (txt) => `<div class="vazio">${esc(txt)}</div>`;

export function guardar(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* sem storage */ }
}
export function ler(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}
