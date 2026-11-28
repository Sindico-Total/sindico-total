import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const fragmento = new URLSearchParams(location.hash.slice(1));
const tipoLink = fragmento.get('type');
export const retornoSenha = ['invite', 'recovery'].includes(tipoLink) ? {
  tipo: tipoLink,
  access_token: fragmento.get('access_token'),
  refresh_token: fragmento.get('refresh_token'),
} : null;
export const erroRetornoAuth = fragmento.has('error_code') || new URLSearchParams(location.search).has('error_code');

export const configurado = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const sb = configurado
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !retornoSenha },
    })
  : null;
