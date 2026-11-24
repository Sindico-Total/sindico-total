// Botão "Instalar o app": usa o instalador do navegador quando existe
// (Chrome/Edge no computador e Android) e mostra o passo a passo no iPhone.
import { modal } from './ui.js';

let convite = null;               // evento guardado do navegador
const avisos = new Set();         // botões que precisam se atualizar

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  convite = e;
  avisos.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  convite = null;
  avisos.forEach((f) => f());
});

export const jaInstalado = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const ehIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ehSafari = () => /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|chrome|android/i.test(navigator.userAgent);
const ehAndroid = () => /android/i.test(navigator.userAgent);

function instrucoes() {
  let corpo;
  if (ehIOS()) {
    corpo = ehSafari()
      ? `<ol class="passos">
           <li>Toque no botão <b>Compartilhar</b> <span class="ico-share">⬆︎</span> na barra do Safari.</li>
           <li>Role e toque em <b>Adicionar à Tela de Início</b>.</li>
           <li>Toque em <b>Adicionar</b>. O ícone do Síndico Total aparece na sua tela.</li>
         </ol>`
      : `<p>No iPhone, a instalação só funciona pelo <b>Safari</b>.</p>
         <ol class="passos">
           <li>Copie o endereço desta página.</li>
           <li>Abra o <b>Safari</b> e cole o endereço.</li>
           <li>Toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</li>
         </ol>`;
  } else if (ehAndroid()) {
    corpo = `<ol class="passos">
        <li>Abra esta página no <b>Chrome</b>.</li>
        <li>Toque no menu <b>⋮</b> (canto superior direito).</li>
        <li>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li>
      </ol>`;
  } else {
    corpo = `<ol class="passos">
        <li>Use o <b>Google Chrome</b> ou o <b>Microsoft Edge</b>.</li>
        <li>Na barra de endereço, clique no ícone <b>Instalar</b> (computador com seta), à direita.</li>
        <li>Se não aparecer: menu <b>⋮</b> → <b>Instalar Síndico Total</b> (ou <b>Transmitir, salvar e compartilhar → Instalar</b>).</li>
      </ol>`;
  }
  modal('Instalar o Síndico Total', `${corpo}
    <p class="mini">Depois de instalado, o app abre direto pelo ícone, em tela cheia, e se atualiza sozinho.</p>`);
}

export async function instalar() {
  if (convite) {
    convite.prompt();
    await convite.userChoice.catch(() => null);
    convite = null;
    avisos.forEach((f) => f());
    return;
  }
  instrucoes();
}

/** Cria o botão; some sozinho quando o app já está instalado. */
export function botaoInstalar(classe = 'btn instalar') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = classe;
  b.innerHTML = '<span aria-hidden="true">📲</span> <span>Instalar o app</span>';
  b.onclick = instalar;
  const atualizar = () => { b.hidden = jaInstalado(); };
  avisos.add(atualizar);
  atualizar();
  return b;
}
