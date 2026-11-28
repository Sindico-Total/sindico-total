import { Webhook } from 'npm:standardwebhooks@1.0.0';

const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')?.replace(/^v1,whsec_/, '');
const apiKey = Deno.env.get('RESEND_API_KEY');
const remetente = Deno.env.get('AUTH_EMAIL_FROM');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const portalUrl = Deno.env.get('PORTAL_URL') || 'https://sindico-total.github.io/sindico-total/';

type Evento = {
  user?: { email?: string; new_email?: string };
  email_data?: { email_action_type?: string; token?: string; token_hash?: string; token_hash_new?: string };
};
type Mensagem = { to: string[]; subject: string; text: string };

const titulos = {
  signup: 'Confirme seu e-mail',
  invite: 'Crie sua senha',
  magiclink: 'Entre no portal',
  recovery: 'Redefina sua senha',
  email_change: 'Confirme a mudança de e-mail',
  email: 'Confirme seu e-mail',
} as const;

function compor(evento: Evento): Mensagem[] {
  const atual = evento.user?.email;
  const dados = evento.email_data;
  const tipo = dados?.email_action_type;
  if (!atual || !dados || !tipo) return [];
  if (tipo === 'reauthentication' && dados.token) {
    return [{ to: [atual], subject: 'Seu código de confirmação · Síndico Total', text: `Seu código de confirmação é ${dados.token}.` }];
  }
  if (!Object.hasOwn(titulos, tipo)) return [];
  const titulo = titulos[tipo as keyof typeof titulos];
  const destinos = tipo === 'email_change'
    ? [[evento.user?.new_email, dados.token_hash], [atual, dados.token_hash_new]]
    : [[atual, dados.token_hash]];
  return destinos.flatMap(([email, token]) => {
    if (!email || !token) return [];
    const link = new URL('/auth/v1/verify', supabaseUrl);
    link.search = new URLSearchParams({ token, type: tipo, redirect_to: portalUrl }).toString();
    return [{
      to: [email],
      subject: `${titulo} · Síndico Total`,
      text: `${titulo} no Síndico Total:\n\n${link.href}\n\nSe você não esperava esta mensagem, ignore este e-mail.`,
    }];
  });
}

function falha(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return falha(405, 'Método não permitido');
  if (!secret || !apiKey || !remetente || !supabaseUrl) return falha(503, 'Envio de e-mail indisponível');

  let evento: Evento;
  try {
    const corpo = await req.text();
    evento = new Webhook(secret).verify(corpo, Object.fromEntries(req.headers)) as Evento;
  } catch {
    return falha(401, 'Assinatura inválida');
  }

  const mensagens = compor(evento);
  if (!mensagens.length) return falha(400, 'Evento de e-mail inválido');
  const id = req.headers.get('webhook-id');
  try {
    const resultados = await Promise.all(mensagens.map((mensagem, posicao) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': `supabase-auth/${id}/${posicao}`,
      },
      body: JSON.stringify({ from: remetente, ...mensagem }),
      signal: AbortSignal.timeout(3500),
    })));
    if (resultados.some((r) => !r.ok)) return falha(502, 'O provedor não aceitou o e-mail');
    return Response.json({});
  } catch {
    return falha(502, 'Falha de comunicação com o provedor de e-mail');
  }
});
