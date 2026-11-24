import { sb } from '../supabase.js';
import { NOME_APP } from '../config.js';
import { esc, toast, traduzErro, dadosForm, soDigitos } from '../ui.js';
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
        <p class="sub">Síndico, administração e garantia em um só lugar.</p>
        <div id="area-instalar"></div>
        <div class="abas">
          <button data-aba="entrar">Entrar</button>
          <button data-aba="criar">Criar conta</button>
        </div>

        <form id="f-entrar" class="aba" data-aba="entrar">
          <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
          <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
          <button class="btn primario" type="submit">Entrar</button>
          <button class="btn link" type="button" id="esqueci">Esqueci minha senha</button>
        </form>

        <form id="f-criar" class="aba" data-aba="criar">
          <label>Nome completo<input name="nome" required></label>
          <label>CPF<input name="cpf" inputmode="numeric" required placeholder="000.000.000-00"></label>
          <label>WhatsApp<input name="fone" inputmode="tel" placeholder="(11) 99999-9999"></label>
          <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
          <label>Senha<input name="senha" type="password" required minlength="6" autocomplete="new-password"></label>
          <label class="check"><input type="checkbox" required> Li e aceito o uso dos meus dados para a gestão do condomínio (LGPD).</label>
          <button class="btn primario" type="submit">Criar conta</button>
        </form>
      </div>
    </div>`;

  app.querySelector('#area-instalar').append(botaoInstalar('btn instalar destaque'));

  const trocar = (a) => {
    app.querySelectorAll('.abas button').forEach((b) => b.classList.toggle('ativo', b.dataset.aba === a));
    app.querySelectorAll('form.aba').forEach((f) => (f.hidden = f.dataset.aba !== a));
  };
  app.querySelectorAll('.abas button').forEach((b) => (b.onclick = () => trocar(b.dataset.aba)));
  trocar(aba);

  const ocupado = (form, sim) => form.querySelectorAll('button').forEach((b) => (b.disabled = sim));

  app.querySelector('#f-entrar').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    ocupado(e.target, true);
    const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.senha });
    ocupado(e.target, false);
    if (error) toast(traduzErro(error.message), 'erro');
  };

  app.querySelector('#esqueci').onclick = async () => {
    const email = app.querySelector('#f-entrar [name=email]').value.trim();
    if (!email) return toast('Digite seu e-mail no campo acima.', 'erro');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: urlRetorno() });
    if (error) return toast(traduzErro(error.message), 'erro');
    toast('Enviamos um link para redefinir a senha no seu e-mail.');
  };

  app.querySelector('#f-criar').onsubmit = async (e) => {
    e.preventDefault();
    const f = dadosForm(e.target);
    const cpf = soDigitos(f.cpf);
    if (cpf.length !== 11 && cpf.length !== 14) return toast('CPF/CNPJ inválido.', 'erro');
    ocupado(e.target, true);
    const { data, error } = await sb.auth.signUp({
      email: f.email.trim(),
      password: f.senha,
      options: {
        emailRedirectTo: urlRetorno(),
        data: { nome_completo: f.nome.trim(), cpf_cnpj: cpf, telefone_whatsapp: soDigitos(f.fone) },
      },
    });
    ocupado(e.target, false);
    if (error) return toast(traduzErro(error.message), 'erro');
    if (!data.session) {
      app.querySelector('.login').innerHTML = `
        <h2>📧 Confirme seu e-mail</h2>
        <p>Enviamos um link de confirmação para <b>${esc(f.email)}</b>. Abra-o neste aparelho para entrar.</p>
        <button class="btn" onclick="location.reload()">Voltar</button>`;
    }
  };
}

export function telaNovaSenha(app) {
  app.innerHTML = `
    <div class="centro"><div class="card login">
      <h2>Definir nova senha</h2>
      <form id="f-nova">
        <label>Nova senha<input name="senha" type="password" minlength="6" required autocomplete="new-password"></label>
        <button class="btn primario">Salvar</button>
      </form>
    </div></div>`;
  app.querySelector('#f-nova').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: dadosForm(e.target).senha });
    if (error) return toast(traduzErro(error.message), 'erro');
    toast('Senha alterada!');
    setTimeout(() => (location.href = urlRetorno()), 800);
  };
}
