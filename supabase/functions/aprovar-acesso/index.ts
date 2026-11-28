import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const portal = new URL(Deno.env.get('PORTAL_URL') || 'https://sindico-total.github.io/sindico-total/');
const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const auth = { autoRefreshToken: false, persistSession: false };
const admin = createClient(url, serviceKey, { auth });
const cors = {
  'Access-Control-Allow-Origin': portal.origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function responder(status: number, mensagem: string) {
  return Response.json({ mensagem }, { status, headers: cors });
}

Deno.serve(async (req) => {
  if (req.headers.get('origin') && req.headers.get('origin') !== portal.origin) {
    return responder(403, 'Origem não autorizada.');
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return responder(405, 'Método não permitido.');

  const token = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '')?.[1];
  if (!token) return responder(401, 'Entre novamente para continuar.');
  const usuario = createClient(url, anonKey, { auth, global: { headers: { Authorization: 'Bearer ' + token } } });
  const { data: { user }, error: erroUsuario } = await usuario.auth.getUser(token);
  if (erroUsuario || !user) return responder(401, 'Entre novamente para continuar.');

  const corpo = await req.json().catch(() => null);
  if (typeof corpo?.pedido !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(corpo.pedido)) {
    return responder(400, 'Solicitação inválida.');
  }
  const { data: envio, error: reserva } = await usuario
    .rpc('reservar_convite_acesso', { p_pedido: corpo.pedido }).maybeSingle();
  if (reserva) return responder(reserva.code === '42501' ? 403 : 500, 'Não foi possível autorizar a solicitação.');
  if (!envio) return responder(409, 'Já existe uma conta, o convite está sendo processado ou o pedido foi decidido. Atualize a lista.');

  const { error: erroConvite } = await admin.auth.admin.inviteUserByEmail(envio.email, {
    data: { nome_completo: envio.nome },
    redirectTo: portal.href,
  });
  const { data: finalizado, error: erroRegistro } = await admin.rpc('finalizar_convite_acesso', {
    p_envio: envio.id_envio,
    p_sucesso: !erroConvite,
    p_admin: user.id,
  });

  if (erroRegistro || !finalizado) return responder(503, 'Não foi possível atualizar o pedido. Aguarde dois minutos e confira a lista.');
  if (erroConvite) {
    console.error('Falha no envio do convite', erroConvite.code || erroConvite.status);
    return responder(502, 'O Supabase não conseguiu enviar o convite. Verifique a configuração de e-mail e tente novamente.');
  }
  return responder(200, 'Convite enviado por e-mail.');
});
