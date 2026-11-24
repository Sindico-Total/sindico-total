import { sb, configurado } from './supabase.js';
import { NOME_APP } from './config.js';
import { esc, q, toast, guardar, ler } from './ui.js';
import { telaLogin, telaNovaSenha, telaConfig } from './views/auth.js';
import * as morador from './views/morador.js';
import * as gestao from './views/gestao.js';
import * as admin from './views/admin.js';
import { botaoInstalar } from './install.js';

// Estado global simples
export const state = {
  user: null,
  perfil: null,        // linha da tabela pessoas
  unidades: [],        // vínculos do usuário: [{tipo_vinculo, unidades:{..., condominios:{...}}}]
  gerenciados: [],     // condomínios que o usuário administra
  condId: null,        // condomínio selecionado na área de gestão
};

export const ehAdmin = () => state.perfil?.tipo_usuario === 'ADMINISTRADOR';
export const ehGestor = () => ehAdmin() || state.gerenciados.length > 0 || state.perfil?.tipo_usuario === 'SINDICO_PROFISSIONAL';
export const condAtual = () => state.gerenciados.find((c) => c.id === state.condId) || null;

const ROTAS = {
  inicio:              { tela: morador.inicio,          titulo: 'Minhas faturas' },
  solicitacoes:        { tela: morador.solicitacoes,    titulo: 'Solicitações' },
  agenda:              { tela: morador.agenda,          titulo: 'Agenda do condomínio' },
  contas:              { tela: morador.prestacaoContas, titulo: 'Prestação de contas' },
  perfil:              { tela: morador.perfil,          titulo: 'Meu perfil' },
  'gestao/painel':       { tela: gestao.painel,       titulo: 'Painel',               gestor: true },
  'gestao/faturas':      { tela: gestao.faturas,      titulo: 'Faturamento',          gestor: true },
  'gestao/unidades':     { tela: gestao.unidades,     titulo: 'Unidades e moradores', gestor: true },
  'gestao/despesas':     { tela: gestao.despesas,     titulo: 'Despesas',             gestor: true },
  'gestao/balancete':    { tela: gestao.balancete,    titulo: 'Balancete',            gestor: true },
  'gestao/solicitacoes': { tela: gestao.solicitacoes, titulo: 'Diligências',          gestor: true },
  'gestao/vistorias':    { tela: gestao.vistorias,    titulo: 'Vistorias',            gestor: true },
  'gestao/condominio':   { tela: gestao.condominio,   titulo: 'Dados do condomínio',  gestor: true },
  'admin/carteira':      { tela: admin.carteira,      titulo: 'Carteira de garantia', admin: true },
  'admin/condominios':   { tela: admin.condominios,   titulo: 'Condomínios',          admin: true },
  'admin/usuarios':      { tela: admin.usuarios,      titulo: 'Usuários',             admin: true },
};

const app = document.getElementById('app');

export async function carregarContexto() {
  const uid = state.user.id;
  state.perfil = await q(sb.from('pessoas').select('*').eq('id', uid).maybeSingle());
  state.unidades = await q(
    sb.from('vinculos_unidade')
      .select('id, tipo_vinculo, unidades(id, identificacao, valor_taxa_condominio, condominio_id, condominios(*))')
      .eq('pessoa_id', uid).eq('ativo', true)
  );
  if (ehAdmin()) {
    state.gerenciados = await q(sb.from('condominios').select('*').order('nome_fantasia'));
  } else {
    const g = await q(sb.from('condominio_gestores').select('condominios(*)').eq('pessoa_id', uid));
    state.gerenciados = g.map((x) => x.condominios).filter(Boolean)
      .sort((a, b) => a.nome_fantasia.localeCompare(b.nome_fantasia));
  }
  const salvo = ler('st_cond');
  state.condId = state.gerenciados.some((c) => c.id === salvo) ? salvo : state.gerenciados[0]?.id || null;
}

function rotaPadrao() {
  if (ehAdmin() && !state.gerenciados.length) return 'admin/condominios';
  if (ehGestor() && state.gerenciados.length) return 'gestao/painel';
  return 'inicio';
}

function link(rota, txt, icone) {
  return `<a href="#/${rota}" data-rota="${rota}"><span class="ico">${icone}</span><span>${esc(txt)}</span></a>`;
}

function montarLayout() {
  const temUnidade = state.unidades.length > 0;
  const menuMorador = `
    <div class="menu-grupo"><small>Minha unidade</small>
      ${link('inicio', 'Faturas', '💳')}
      ${link('solicitacoes', 'Solicitações', '📝')}
      ${link('agenda', 'Agenda', '📅')}
      ${link('contas', 'Prestação de contas', '📊')}
    </div>`;
  const seletor = state.gerenciados.length
    ? `<select id="sel-cond" aria-label="Condomínio">${state.gerenciados
        .map((c) => `<option value="${c.id}" ${c.id === state.condId ? 'selected' : ''}>${esc(c.nome_fantasia)}</option>`)
        .join('')}</select>`
    : '<p class="mini">Nenhum condomínio atribuído.</p>';
  const menuGestao = ehGestor()
    ? `<div class="menu-grupo"><small>Gestão (síndico)</small>
        ${seletor}
        ${link('gestao/painel', 'Painel', '🏠')}
        ${link('gestao/faturas', 'Faturamento', '💰')}
        ${link('gestao/unidades', 'Unidades', '🚪')}
        ${link('gestao/despesas', 'Despesas', '🧾')}
        ${link('gestao/balancete', 'Balancete', '📈')}
        ${link('gestao/solicitacoes', 'Diligências', '🛠️')}
        ${link('gestao/vistorias', 'Vistorias', '🔍')}
        ${link('gestao/condominio', 'Dados do condomínio', '⚙️')}
      </div>`
    : '';
  const menuAdmin = ehAdmin()
    ? `<div class="menu-grupo"><small>Fintech (garantidora)</small>
        ${link('admin/carteira', 'Carteira de garantia', '🏦')}
        ${link('admin/condominios', 'Condomínios', '🏢')}
        ${link('admin/usuarios', 'Usuários', '👥')}
      </div>`
    : '';

  app.innerHTML = `
    <div class="layout">
      <aside id="menu">
        <div class="marca"><img src="icons/icon.svg" alt=""><b>${esc(NOME_APP)}</b></div>
        ${temUnidade || !ehGestor() ? menuMorador : ''}
        ${menuGestao}
        ${menuAdmin}
        <div class="menu-grupo">
          ${link('perfil', state.perfil?.nome_completo?.split(' ')[0] || 'Perfil', '👤')}
          <div id="menu-instalar"></div>
          <a href="#" id="btn-sair"><span class="ico">🚪</span><span>Sair</span></a>
        </div>
      </aside>
      <div class="principal">
        <header class="topo">
          <button id="btn-menu" aria-label="Menu">☰</button>
          <h1 id="titulo"></h1>
        </header>
        <main id="conteudo"></main>
      </div>
    </div>`;

  document.getElementById('menu-instalar').append(botaoInstalar('menu-inst'));
  document.getElementById('btn-menu').onclick = () => document.body.classList.toggle('menu-aberto');
  document.getElementById('menu').addEventListener('click', (e) => {
    if (e.target.closest('a')) document.body.classList.remove('menu-aberto');
  });
  document.getElementById('btn-sair').onclick = async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
  };
  const sel = document.getElementById('sel-cond');
  if (sel) {
    sel.onchange = () => {
      state.condId = sel.value;
      guardar('st_cond', sel.value);
      if (!location.hash.startsWith('#/gestao')) location.hash = '#/gestao/painel';
      else rotear();
    };
  }
}

export async function rotear() {
  if (!state.user) return;
  let rota = location.hash.replace(/^#\/?/, '').split('?')[0];
  const def = ROTAS[rota];
  if (!def || (def.admin && !ehAdmin()) || (def.gestor && !ehGestor())) {
    rota = rotaPadrao();
    if (location.hash !== '#/' + rota) { location.hash = '#/' + rota; return; }
  }
  const { tela, titulo, gestor } = ROTAS[rota];
  document.getElementById('titulo').textContent = titulo;
  document.title = `${titulo} · ${NOME_APP}`;
  document.querySelectorAll('#menu a[data-rota]').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === rota));

  document.querySelectorAll('.modal-fundo').forEach((m) => m.remove());
  const main = document.getElementById('conteudo');
  main.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'tela';
  main.append(root);

  if (gestor && !condAtual()) {
    root.innerHTML = `<div class="card">Nenhum condomínio selecionado. ${
      ehAdmin() ? 'Cadastre um em <a href="#/admin/condominios">Condomínios</a>.' : 'Peça ao administrador para vincular você a um condomínio.'}</div>`;
    return;
  }
  root.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    await tela(root);
  } catch (err) {
    console.error(err);
    if (!root.querySelector('.card')) root.innerHTML = `<div class="card erro">Não foi possível carregar esta tela.<br><small>${esc(err.message || err)}</small></div>`;
  }
}

/** Recarrega dados do usuário e redesenha o menu (após cadastrar condomínio, etc.) */
export async function recarregar() {
  await carregarContexto();
  montarLayout();
  await rotear();
}

async function entrou(user) {
  state.user = user;
  try {
    await carregarContexto();
  } catch (e) {
    app.innerHTML = `<div class="centro"><div class="card erro">Erro ao carregar seus dados. Confira se o arquivo <b>supabase/schema.sql</b> foi executado no Supabase.<br><small>${esc(e.message)}</small></div></div>`;
    return;
  }
  if (!state.perfil) {
    app.innerHTML = `<div class="centro"><div class="card erro">Sua conta existe, mas o perfil não foi criado. Rode o <b>schema.sql</b> no Supabase <i>antes</i> de criar contas e cadastre-se novamente.</div></div>`;
    return;
  }
  montarLayout();
  rotear();
}

async function iniciar() {
  if (!configurado) return telaConfig(app);

  let recuperandoSenha = false;
  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'PASSWORD_RECOVERY') {
      recuperandoSenha = true;
      return telaNovaSenha(app);
    }
    if (evento === 'SIGNED_OUT') {
      state.user = null;
      telaLogin(app);
    }
    if (evento === 'SIGNED_IN' && sessao && !recuperandoSenha && state.user?.id !== sessao.user.id) {
      // setTimeout evita travar o cliente do Supabase dentro do callback
      setTimeout(() => entrou(sessao.user), 0);
    }
  });

  const { data } = await sb.auth.getSession();
  if (data.session && !recuperandoSenha) {
    if (!state.user) await entrou(data.session.user);
  } else if (!recuperandoSenha) {
    telaLogin(app);
  }
  window.addEventListener('hashchange', rotear);
}

iniciar().catch((e) => {
  console.error(e);
  toast('Erro ao iniciar o app: ' + e.message, 'erro');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
