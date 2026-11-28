import { sb } from '../supabase.js';
import { NOME_APP } from '../config.js';
import { esc, toast, traduzErro, dadosForm } from '../ui.js';
import { botaoInstalar } from '../install.js';

const urlRetorno = () => location.origin + location.pathname;

export function telaConfig(app) {
  app.innerHTML = `
    <div class="centro"><div class="card largo">
      <h2>⚙️ Falta configurar o ${esc(NOME_APP)}</h2>
      <p>Abra o arquivo <code>js/config.js</code> no GitHub e preencha:</p>
      <ul>
        <li><code>SUPABASE_URL</code> — a "Project URL" do seu projeto no Supabase</li>
        <li><code>SUPABASE_ANON_KEY</code> — a chave <b>anon / publishable</b></li>
      </ul>
      <p>Ambas ficam em <b>Supabase → Project Settings → API</b>. Veja o passo a passo no README.</p>
    </div></div>`;
}

export function telaLogin(app, aba = 'entrar') {
  app.innerHTML = `
    <div class="centro">
      <div class="card login">
        <div class="marca grande"><img src="icons/icon.svg" alt=""><b>${esc(NOME_APP)}</b></div>
        <div id="area-instalar"></div>
        <div class="abas" aria-label="Acesso ao portal">
          <button type="button" data-aba="entrar">Entrar</button>
          <button type="button" data-aba="solicitar">Solicitar acesso</button>
        </div>

        <form id="f-entrar" class="aba" data-painel="entrar">
          <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
          <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
          <button class="btn primario" type="submit">Entrar</button>
          <button class="btn link" type="button" id="esqueci">Esqueci minha senha</button>
        </form>

        <form id="f-recuperar" class="aba" data-painel="recuperar">
          <h2>Redefinir senha</h2>
          <label>E-mail da conta<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
          <button class="btn primario" type="submit">Enviar link de redefinição</button>
          <p class="mini" role="status"></p>
        </form>

        <form id="f-solicitar" class="aba" data-painel="solicitar">
          <h2>Solicitar acesso</h2>
          <label>Nome completo<input name="nome" minlength="2" maxlength="120" required autocomplete="name"></label>
          <label>E-mail<input name="email" type="email" maxlength="254" required autocomplete="email"></label>
          <label>Condomínio e unidade (opcional)<input name="referencia" maxlength="160"></label>
          <button class="btn primario" type="submit">Enviar solicitação</button>
          <p class="mini" role="status"></p>
        </form>
      </div>
    </div>`;

  app.querySelector('#area-instalar').append(botaoInstalar('btn instalar destaque'));
  const abas = app.querySelector('.abas');
  const trocar = (a) => {
    abas.querySelectorAll('button').forEach((b) => {
      const ativa = b.dataset.aba === a;
      b.classList.toggle('ativo', ativa);
      b.setAttribute('aria-pressed', String(ativa));
    });
    app.querySelectorAll('form.aba').forEach((f) => (f.hidden = f.dataset.painel !== a));
  };
  abas.querySelectorAll('button').forEach((b) => (b.onclick = () => trocar(b.dataset.aba)));
  trocar(aba);

  const entrar = app.querySelector('#f-entrar');
  const recuperar = app.querySelector('#f-recuperar');
  entrar.querySelector('#esqueci').onclick = () => {
    if (!recuperar.elements.email.value) recuperar.elements.email.value = entrar.elements.email.value;
    trocar('recuperar');
    recuperar.elements.email.focus();
  };

  entrar.onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(entrar);
    const botao = e.submitter;
    botao.disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.senha });
      if (error) toast(traduzErro(error.message), 'erro');
    } catch {
      toast('Não foi possível entrar agora. Tente novamente.', 'erro');
    } finally {
      botao.disabled = false;
    }
  };

  recuperar.onsubmit = async (e) => {
    e.preventDefault();
    const botao = e.submitter;
    const status = recuperar.querySelector('[role=status]');
    botao.disabled = true;
    status.textContent = '';
    try {
      const { error } = await sb.auth.resetPasswordForEmail(recuperar.elements.email.value.trim(), {
        redirectTo: urlRetorno(),
      });
      if (error && (error.name === 'AuthRetryableFetchError')) throw error;
      status.textContent = 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.';
    } catch {
      status.textContent = 'O envio está indisponível agora. Tente novamente em alguns minutos.';
    } finally {
      botao.disabled = false;
    }
  };

  const solicitar = app.querySelector('#f-solicitar');
  solicitar.onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(solicitar);
    const botao = e.submitter;
    const status = solicitar.querySelector('[role=status]');
    botao.disabled = true;
    status.textContent = '';
    try {
      const { error } = await sb.rpc('solicitar_acesso', {
        p_nome: f.nome.trim(), p_email: f.email.trim(), p_referencia: f.referencia.trim() || null,
      });
      if (error) throw error;
      solicitar.reset();
      status.textContent = 'Solicitação recebida. Se o acesso for aprovado, você receberá o convite por e-mail.';
    } catch (error) {
      status.textContent = error.code === '22023'
        ? 'Confira o nome e o e-mail informados.'
        : 'Não foi possível enviar a solicitação. Tente novamente.';
    } finally {
      botao.disabled = false;
    }
  };
}

export function telaNovaSenha(app, tipo, voltar) {
  app.innerHTML = `
    <div class="centro"><div class="card login">
      <h2>${tipo === 'invite' ? 'Crie sua senha' : 'Redefina sua senha'}</h2>
      <form id="f-nova">
        <label>Nova senha<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Confirme a nova senha<input name="confirmacao" type="password" minlength="8" required autocomplete="new-password"></label>
        <p class="mini">Use pelo menos 8 caracteres.</p>
        <button class="btn primario">Salvar senha</button>
        <button class="btn link" id="voltar-entrar" type="button">Voltar para entrar</button>
      </form>
    </div></div>`;
  const form = app.querySelector('#f-nova');
  form.querySelector('#voltar-entrar').onclick = () => voltar(false);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { senha, confirmacao } = dadosForm(form);
    if (senha !== confirmacao) return toast('As senhas precisam ser iguais.', 'erro');
    const botao = e.submitter;
    botao.disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) return toast(traduzErro(error.message), 'erro');
      await voltar(true);
    } catch {
      toast('Não foi possível salvar a senha. Tente novamente.', 'erro');
    } finally {
      botao.disabled = false;
    }
  };
}
