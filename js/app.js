import { sb, configurado, retornoSenha, erroRetornoAuth } from './supabase.js';
import { NOME_APP } from './config.js';
import { esc, q, toast, guardar, ler } from './ui.js';
import { telaLogin, telaNovaSenha, telaConfig } from './views/auth.js';
import * as morador from './views/morador.js';
import * as gestao from './views/gestao.js';
import * as admin from './views/admin.js';
import * as modulos from './views/modulos.js';
import { botaoInstalar } from './install.js';

// Estado global simples
export const state = {
  user: null,
  perfil: null,        // linha da tabela pessoas
  unidades: [],        // vínculos do usuário: [{tipo_vinculo, unidades:{..., condominios:{...}}}]
  gerenciados: [],     // condomínios que o usuário administra
  modulos: [],
  condId: null,        // condomínio selecionado na área de gestão
};

export const ehAdmin = () => state.perfil?.tipo_usuario === 'ADMINISTRADOR';
export const ehGestor = () => ehAdmin() || state.gerenciados.length > 0 || state.perfil?.tipo_usuario === 'SINDICO_PROFISSIONAL';
export const condAtual = () => state.gerenciados.find((c) => c.id === state.condId) || null;

const ROTAS = {
  'admin/modulos': { tela: modulos.configuracao, titulo: 'Gestão de módulos', admin: true },
  ...Object.fromEntries(Object.entries(modulos.catalogo).flatMap(([m,t])=>[[m,{tela:modulos.tela(m),titulo:t}],[`gestao/${m}`,{tela:modulos.tela(m,true),titulo:t,gestor:true}]])),
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
  'admin/usuarios':      { tela: admin.usuarios,      titulo: 'Contas',             admin: true },
};

const app = document.getElementById('app');

export async function carregarContexto() {
  const usuario = state.user;
  if (!usuario) return false;
  const uid = usuario.id;
  const [perfil, unidades] = await Promise.all([
    q(sb.from('pessoas').select('*').eq('id', uid).maybeSingle()),
    q(sb.from('vinculos_unidade')
      .select('id, tipo_vinculo, unidades(id, identificacao, valor_taxa_condominio, condominio_id, condominios(*))')
      .eq('pessoa_id', uid).eq('ativo', true)),
  ]);
  let gerenciados;
  if (perfil?.tipo_usuario === 'ADMINISTRADOR') {
    gerenciados = await q(sb.from('condominios').select('*').order('nome_fantasia'));
  } else {
    const g = await q(sb.from('condominio_gestores').select('condominios(*)').eq('pessoa_id', uid));
    gerenciados = g.map((x) => x.condominios).filter(Boolean)
      .sort((a, b) => a.nome_fantasia.localeCompare(b.nome_fantasia));
  }
  if (state.user !== usuario) return false;
  const salvo = ler('st_cond');
  const condId = gerenciados.some((c) => c.id === salvo) ? salvo : gerenciados[0]?.id || null;
  const ids=[...new Set([...gerenciados.map(c=>c.id),...unidades.map(v=>v.unidades?.condominio_id).filter(Boolean)])];
  const listaModulos=ids.length?await q(sb.from('condominio_modulos').select('condominio_id,modulo,habilitado').in('condominio_id',ids)):[];
  if(state.user!==usuario)return false;
  Object.assign(state, { perfil, unidades, gerenciados, condId, modulos:listaModulos });
  return true;
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
  const linksModulos=(gestor)=>Object.entries(modulos.catalogo).filter(([m])=>state.modulos.some(r=>r.modulo===m&&r.habilitado&&(gestor?r.condominio_id===state.condId:state.unidades.some(v=>v.unidades?.condominio_id===r.condominio_id)))).map(([m,t])=>link(gestor?'gestao/'+m:m,t,'📌')).join('');
  const temUnidade = state.unidades.length > 0;
  const menuMorador = `
    <div class="menu-grupo"><small>Minha unidade</small>
      ${link('inicio', 'Faturas', '💳')}
      ${link('solicitacoes', 'Solicitações', '📝')}
      ${link('agenda', 'Agenda', '📅')}
      ${link('contas', 'Prestação de contas', '📊')}
      ${linksModulos(false)}
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
        ${linksModulos(true)}
      </div>`
    : '';
  const menuAdmin = ehAdmin()
    ? `<div class="menu-grupo"><small>Fintech (garantidora)</small>
        ${link('admin/carteira', 'Carteira de garantia', '🏦')}
        ${link('admin/condominios', 'Condomínios', '🏢')}
        ${link('admin/usuarios', 'Contas', '👥')}
        ${link('admin/modulos', 'Gestão de módulos', '🧩')}
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
          <button type="button" class="btn mini-btn" id="btn-atualizar">Atualizar</button>
        </header>
        <main id="conteudo"></main>
      </div>
    </div>`;

  document.getElementById('menu-instalar').append(botaoInstalar('menu-inst'));
  document.getElementById('btn-menu').onclick = () => document.body.classList.toggle('menu-aberto');
  document.getElementById('menu').addEventListener('click', (e) => {
    if (e.target.closest('a')) document.body.classList.remove('menu-aberto');
  });
  document.getElementById('btn-atualizar').onclick = atualizarPortal;
  document.getElementById('btn-sair').onclick = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signOut();
    if (error) toast('Não foi possível sair. Tente novamente.', 'erro');
  };
  const sel = document.getElementById('sel-cond');
  if (sel) {
    sel.onchange = () => {
      state.condId = sel.value;
      guardar('st_cond', sel.value);
      montarLayout();
      if (location.hash === '#/admin/modulos') rotear();
      else if (!location.hash.startsWith('#/gestao')) location.hash = '#/gestao/painel';
      else rotear();
    };
  }
}

async function atualizarPortal(e) {
  const botao = e.currentTarget;
  botao.disabled = true;
  botao.textContent = 'Atualizando…';
  try {
    // O parâmetro mantém a verificação fora do cache offline do aplicativo.
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('verificar-atualizacao', Date.now());
    const resposta = await fetch(url, { cache: 'no-store' });
    if (!resposta.ok) throw new Error('Portal indisponível');

    const registro = await navigator.serviceWorker?.getRegistration();
    if (registro) {
      await registro.update();
      const worker = registro.installing || registro.waiting;
      if (worker) await aguardarAtivacao(worker);
    }
    location.reload();
  } catch {
    toast('Não foi possível atualizar agora. Verifique sua conexão e tente novamente.', 'erro');
    botao.disabled = false;
    botao.textContent = 'Atualizar';
  }
}

function aguardarAtivacao(worker) {
  return new Promise((resolve, reject) => {
    const encerrar = (erro) => {
      clearTimeout(limite);
      worker.removeEventListener('statechange', conferir);
      if (erro) reject(erro);
      else resolve();
    };
    const conferir = () => {
      if (worker.state === 'activated') encerrar();
      if (worker.state === 'redundant') encerrar(new Error('Atualização indisponível'));
    };
    const limite = setTimeout(() => encerrar(new Error('A atualização demorou demais')), 10000);
    worker.addEventListener('statechange', conferir);
    conferir();
  });
}

export async function rotear() {
  if (!state.user || !state.perfil || !document.getElementById('conteudo')) return;
  let rota = location.hash.replace(/^#\/?/, '').split('?')[0];
  const def = Object.hasOwn(ROTAS, rota) ? ROTAS[rota] : null;
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
  if (!(await carregarContexto())) return;
  montarLayout();
  await rotear();
}

async function entrou(user) {
  state.user = user;
  try {
    if (!(await carregarContexto())) return;
  } catch (e) {
    if (state.user !== user) return;
    app.innerHTML = `<div class="centro"><div class="card erro">Erro ao carregar seus dados. Confira se o arquivo <b>supabase/schema.sql</b> foi executado no Supabase.<br><small>${esc(e.message)}</small></div></div>`;
    return;
  }
  if (!state.perfil) {
    app.innerHTML = `<div class="centro"><div class="card erro">O perfil da sua conta está indisponível. Procure o administrador do portal.</div></div>`;
    return;
  }
  montarLayout();
  rotear();
}

async function iniciar() {
  if (!configurado) return telaConfig(app);

  let fluxoSenha = null;
  let ultimoUsuario = null;
  const mostrarSenha = (tipo) => {
    fluxoSenha = tipo;
    telaNovaSenha(app, tipo, async (salvou) => {
      const { error } = await sb.auth.signOut();
      if (error) {
        toast(salvou ? 'Senha salva. Use Voltar para entrar para encerrar a sessão.'
          : 'Não foi possível encerrar a sessão. Tente novamente.', 'erro');
        return;
      }
      if (salvou) toast('Senha salva. Entre com a nova senha.');
    });
  };

  async function abrirSessao(usuario) {
    if (fluxoSenha || ultimoUsuario === usuario.id) return;
    ultimoUsuario = usuario.id;
    const { data: precisaSenha, error } = await sb.rpc('conta_precisa_definir_senha');
    if (ultimoUsuario !== usuario.id) return;
    if (error) {
      ultimoUsuario = null;
      telaLogin(app);
      return toast('Não foi possível verificar sua conta. Tente entrar novamente.', 'erro');
    }
    if (precisaSenha) return mostrarSenha('invite');
    await entrou(usuario);
  }

  if (retornoSenha) {
    const { tipo, access_token, refresh_token } = retornoSenha;
    history.replaceState(null, '', location.pathname);
    if (access_token && refresh_token) {
      const { data, error } = await sb.auth.setSession({ access_token, refresh_token });
      if (!error && data.session) mostrarSenha(tipo);
    }
  }
  if (erroRetornoAuth) history.replaceState(null, '', location.pathname);

  sb.auth.onAuthStateChange((evento, sessao) => {
    if (evento === 'PASSWORD_RECOVERY') return mostrarSenha('recovery');
    if (evento === 'SIGNED_OUT') {
      fluxoSenha = null;
      ultimoUsuario = null;
      Object.assign(state, { user: null, perfil: null, unidades: [], gerenciados: [], modulos: [], condId: null });
      document.querySelectorAll('.modal-fundo, #toasts').forEach((elemento) => elemento.remove());
      document.body.classList.remove('menu-aberto');
      document.title = NOME_APP;
      telaLogin(app);
    }
    if (evento === 'SIGNED_IN' && sessao && !fluxoSenha) {
      setTimeout(() => abrirSessao(sessao.user).catch(() => telaLogin(app)), 0);
    }
  });

  if (!fluxoSenha) {
    const { data } = await sb.auth.getSession();
    if ((retornoSenha || erroRetornoAuth) && !data.session) {
      telaLogin(app, 'recuperar');
      toast('Este link expirou ou já foi usado. Solicite um novo link.', 'erro');
    } else if (data.session) {
      await abrirSessao(data.session.user);
    } else {
      telaLogin(app);
    }
  }
  window.addEventListener('hashchange', rotear);
}

iniciar().catch((e) => {
  console.error(e);
  toast('Erro ao iniciar o app: ' + e.message, 'erro');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
