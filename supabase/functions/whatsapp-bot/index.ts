// =====================================================================
//  "Síndico de Bolso" — agente de WhatsApp (OPCIONAL)
//  Supabase Edge Function (Deno). Recebe o webhook da WhatsApp Cloud API
//  (Meta), identifica o morador pelo número e responde:
//    1) Consultar faturas  2) Pagar com Pix  3) Falar com o síndico
//  (abre uma diligência)  + próximas vistorias.
//  A IA (Google Gemini) é opcional: sem GEMINI_API_KEY usa palavras-chave.
//
//  Segredos (Supabase > Edge Functions > Secrets):
//    WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN
//    WHATSAPP_APP_SECRET (recomendado: valida a assinatura da Meta)
//    GEMINI_API_KEY e GEMINI_MODEL (opcionais)
//  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são fornecidos pelo Supabase.
//  Publicar:  supabase functions deploy whatsapp-bot --no-verify-jwt
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY') || env('SB_SECRET_KEY'));

// ---------------------------------------------------------------- Pix (BR Code)
const campo = (id: string, v: string) => id + String(v.length).padStart(2, '0') + v;
const limpa = (t: string, max: number) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').toUpperCase().trim().slice(0, max);
function crc16(p: string) {
  let c = 0xffff;
  for (let i = 0; i < p.length; i++) {
    c ^= p.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) c = (c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
function pix(chave: string, nome: string, cidade: string, valor: number, txid: string) {
  const p = campo('00', '01') + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave.trim())) +
    campo('52', '0000') + campo('53', '986') + campo('54', Number(valor).toFixed(2)) + campo('58', 'BR') +
    campo('59', limpa(nome, 25) || 'RECEBEDOR') + campo('60', limpa(cidade, 15) || 'BRASIL') +
    campo('62', campo('05', (txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***')) + '6304';
  return p + crc16(p);
}

// ---------------------------------------------------------------- utilidades
const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d: string) => new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function candidatosFone(from: string) {
  const d = from.replace(/\D/g, '');
  const semPais = d.startsWith('55') ? d.slice(2) : d;
  const set = new Set([d, semPais]);
  // WhatsApp às vezes entrega celular BR sem o 9º dígito (DDD + 8 dígitos)
  if (semPais.length === 10) set.add(semPais.slice(0, 2) + '9' + semPais.slice(2));
  if (semPais.length === 11) set.add(semPais.slice(0, 2) + semPais.slice(3));
  [...set].forEach((n) => set.add('55' + n));
  return [...set];
}

async function enviar(para: string, texto: string) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto.slice(0, 4000) } }),
  });
  if (!r.ok) console.error('Erro ao enviar WhatsApp', r.status, await r.text());
}

async function assinaturaValida(req: Request, corpo: string) {
  const segredo = env('WHATSAPP_APP_SECRET');
  if (!segredo) return true; // sem segredo configurado, não valida (não recomendado em produção)
  const recebida = req.headers.get('x-hub-signature-256')?.replace('sha256=', '') ?? '';
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === recebida;
}

type Intencao = 'FATURA' | 'SOLICITACAO' | 'VISTORIA' | 'MENU';

async function classificar(texto: string): Promise<Intencao> {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (/^(1|fatura|boleto|pix|pagar|2a via|segunda via|debito|taxa)\b/.test(t)) return 'FATURA';
  if (/^(3|vistoria|agenda|manutencao programada)\b/.test(t)) return 'VISTORIA';
  if (/^(2|sindico|solicita)/.test(t) && t.length < 20) return 'MENU'; // pediu o síndico mas não descreveu
  if (/^(oi|ola|bom dia|boa tarde|boa noite|menu|ajuda|inicio)\b/.test(t) && t.length < 25) return 'MENU';

  const chaveIA = env('GEMINI_API_KEY');
  if (chaveIA) {
    try {
      const modelo = env('GEMINI_MODEL') || 'gemini-flash-latest';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${chaveIA}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text:
            'Você classifica mensagens de moradores de condomínio enviadas ao síndico. Responda só JSON {"intencao": X} ' +
            'onde X é FATURA (quer ver/pagar taxa, boleto, pix), SOLICITACAO (relata problema, pede serviço, reclamação, ' +
            'reserva, pede falar com síndico), VISTORIA (pergunta de agenda/manutenção programada) ou MENU (saudação/dúvida vaga).\n' +
            'Mensagem: ' + texto.slice(0, 800) }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      });
      const j = await r.json();
      const out = JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
      if (['FATURA', 'SOLICITACAO', 'VISTORIA', 'MENU'].includes(out.intencao)) return out.intencao;
    } catch (e) {
      console.error('Gemini indisponível, usando palavras-chave', e);
    }
  }
  if (/fatura|boleto|pix|pagar|taxa|condominio do mes|valor/.test(t)) return 'FATURA';
  return t.length >= 15 ? 'SOLICITACAO' : 'MENU';
}

const MENU = (nome: string) =>
  `Olá, ${nome}! 👋 Sou o Síndico de Bolso.\n\n` +
  `*1* – Ver minhas faturas e o Pix para pagar\n` +
  `*2* – Falar com o síndico: descreva o problema numa mensagem (ex.: "Lâmpada queimada no hall do 3º andar")\n` +
  `*3* – Próximas vistorias e manutenções`;

// ---------------------------------------------------------------- atendimento
async function atender(from: string, texto: string) {
  const { data: pessoas } = await db.from('pessoas').select('id, nome_completo').in('telefone_whatsapp', candidatosFone(from)).limit(1);
  const pessoa = pessoas?.[0];
  if (!pessoa) {
    return enviar(from, 'Não encontrei seu número no Síndico Total. Abra o app, vá em *Meu perfil* e cadastre este WhatsApp.');
  }
  const nome = pessoa.nome_completo.split(' ')[0];
  const { data: vinc } = await db.from('vinculos_unidade')
    .select('unidades(id, identificacao, condominio_id, condominios(*))').eq('pessoa_id', pessoa.id).eq('ativo', true);
  const unidades = (vinc ?? []).map((v: any) => v.unidades).filter(Boolean);
  if (!unidades.length) return enviar(from, `${nome}, sua conta ainda não está ligada a uma unidade. Fale com o síndico.`);

  const intencao = await classificar(texto);

  if (intencao === 'FATURA') {
    const { data: fats } = await db.from('faturas').select('*').in('unidade_id', unidades.map((u: any) => u.id))
      .in('status', ['PENDENTE', 'ATRASADO', 'EM_COBRANCA', 'CEDIDO']).order('data_vencimento').limit(3);
    if (!fats?.length) return enviar(from, `✅ ${nome}, você não tem faturas em aberto. Obrigado!`);
    for (const f of fats) {
      const u = unidades.find((x: any) => x.id === f.unidade_id);
      const c = u.condominios;
      let msg = `🧾 *${c.nome_fantasia} – ${u.identificacao}*\nReferência: ${f.mes_referencia.slice(5, 7)}/${f.mes_referencia.slice(0, 4)}\n` +
        `Valor: *${brl(f.valor_original)}* – vence ${dataBR(f.data_vencimento)}`;
      if (c.chave_pix) {
        await enviar(from, msg + '\n\nCopie o código abaixo e use "Pix Copia e Cola" no app do seu banco 👇');
        await enviar(from, pix(c.chave_pix, c.nome_recebedor_pix || c.nome_fantasia, c.cidade || 'BRASIL', f.valor_original, f.txid_pix || f.id));
      } else {
        await enviar(from, msg + '\n\n(O condomínio ainda não cadastrou a chave Pix.)');
      }
    }
    return;
  }

  if (intencao === 'VISTORIA') {
    const { data: vs } = await db.from('vistorias').select('titulo, data_agendada, condominio_id')
      .in('condominio_id', unidades.map((u: any) => u.condominio_id)).eq('status', 'AGENDADA')
      .gte('data_agendada', new Date().toISOString()).order('data_agendada').limit(5);
    if (!vs?.length) return enviar(from, 'Não há vistorias agendadas no momento.');
    return enviar(from, '📅 *Próximas vistorias*\n' + vs.map((v: any) =>
      `• ${new Date(v.data_agendada).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} – ${v.titulo}`).join('\n'));
  }

  if (intencao === 'SOLICITACAO') {
    const u = unidades[0];
    const { error } = await db.from('solicitacoes').insert({
      condominio_id: u.condominio_id, unidade_id: u.id, pessoa_id: pessoa.id,
      titulo: texto.slice(0, 140), descricao: texto, categoria: 'GERAL', origem: 'WHATSAPP',
    });
    if (error) return enviar(from, 'Não consegui registrar sua solicitação agora. Tente pelo app.');
    return enviar(from, `📝 Pronto, ${nome}! Registrei sua solicitação para o síndico do ${u.condominios.nome_fantasia}. ` +
      'Você acompanha a resposta pelo app em *Solicitações*.');
  }

  return enviar(from, MENU(nome));
}

// ---------------------------------------------------------------- servidor
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação do webhook pela Meta
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN')) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const corpo = await req.text();
  if (!(await assinaturaValida(req, corpo))) return new Response('Invalid signature', { status: 401 });

  try {
    const body = JSON.parse(corpo);
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.type === 'text' && msg.text?.body) {
      await atender(msg.from, msg.text.body);
    } else if (msg?.from) {
      await enviar(msg.from, 'Por enquanto só entendo mensagens de texto. Digite *menu* para ver as opções.');
    }
  } catch (e) {
    console.error(e);
  }
  // Sempre 200 para a Meta não reenviar o evento
  return new Response('ok', { status: 200 });
});
