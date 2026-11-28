# 🏢 Síndico Total — MVP gratuito

App que une **síndico profissional + administradora + garantidora** em um só lugar, montado a partir do documento *Base_APP*.
Roda 100% em serviços com plano grátis: **GitHub Pages** (o site/app) + **Supabase** (banco PostgreSQL, login e arquivos).
Funciona no navegador e pode ser **instalado no celular** como app (PWA), sem loja de aplicativos.

## O que o app já faz

| Quem | Funcionalidades |
|---|---|
| **Morador** | Vê faturas e paga com **Pix Copia e Cola + QR Code** (gerado no próprio app, sem banco intermediário) · envia comprovante ao síndico pelo WhatsApp · abre **solicitações/diligências** · vê a **agenda de vistorias** · vê a **prestação de contas** (balancete + despesas com comprovantes) |
| **Síndico profissional** | Painel com arrecadação e inadimplência · **gera as faturas do mês** · dá baixa em pagamentos (com proteção contra baixa duplicada) · **cobra pelo WhatsApp** com 1 clique (mensagem pronta com o Pix) · cadastra unidades (ou **importa planilha CSV**) e convida moradores por e-mail · lança **despesas com foto da nota** · **balancete** mensal (imprimir/PDF/CSV) · responde diligências · agenda **vistorias periódicas** (com recorrência) |
| **Fintech / garantidora (administrador)** | Cadastra condomínios-clientes e define a taxa de garantia · vincula síndicos · **cessão de crédito**: compra as faturas vencidas pagando "face − deságio" · acompanha a **carteira** (em aberto, negativado, protesto, ação judicial, recuperado) e a taxa de recuperação · gerencia usuários |
| **Segurança** | Cada pessoa só enxerga o que é dela (Row Level Security no banco) · ninguém se autopromove a administrador · log de **auditoria imutável** de faturas, pagamentos, cessões e despesas · aceite LGPD no cadastro |

> O "Síndico de Bolso" (agente de IA no WhatsApp) está pronto em `supabase/functions/whatsapp-bot`, mas é **opcional** — veja a seção 8, porque a API oficial do WhatsApp tem custo por mensagem.

---

## Passo a passo para colocar no ar (≈ 30 min, sem programar)

### 1) Criar o repositório no GitHub
1. Crie uma conta em <https://github.com> (grátis).
2. Clique em **New repository** → nome: `sindico-total` → marque **Public** → **Create repository**.
   *(O GitHub Pages grátis exige repositório público. O código fica visível, mas os **dados** ficam protegidos no Supabase.)*
3. Na página do repositório: **Add file → Upload files** → arraste **todo o conteúdo** desta pasta (as pastas `css`, `js`, `icons`, `supabase`, `.github`… e os arquivos soltos) → **Commit changes**.
   - Dica: se a pasta `.github` não subir pelo navegador (pastas que começam com ponto às vezes ficam ocultas), tudo bem — ela é opcional.

### 2) Criar o banco de dados no Supabase
1. Crie uma conta em <https://supabase.com> (pode entrar com o próprio GitHub) → **New project**.
   - Região: **South America (São Paulo)**. Anote a senha do banco.
2. No menu do projeto: **SQL Editor → New query** → abra o arquivo `supabase/schema.sql`, copie **tudo**, cole e clique **Run**. Em outra consulta, execute cada arquivo de `supabase/migrations/` em ordem de nome. Para um banco existente, aplique somente as migrações ainda pendentes.

### 3) Configurar o login
Em **Authentication → URL Configuration**:
- **Site URL**: `https://SEU-USUARIO.github.io/sindico-total/`
- **Redirect URLs**: adicione o mesmo endereço.

Em **Authentication → Sign In / Providers → Email**: mantenha **Confirm email** ligado. O acesso por convite depende da confirmação do endereço. Configure um SMTP em **Authentication → Emails → SMTP** para entregar mensagens de cadastro e recuperação em produção.

### 4) Ligar o app ao seu Supabase
1. No Supabase: **Project Settings → API** (ou botão **Connect**). Copie a **Project URL** e a chave **anon / publishable**.
2. No GitHub, abra `js/config.js` → ícone de lápis ✏️ → preencha:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   → **Commit changes**.
   ⚠️ Use **somente** a chave *anon/publishable*. **Nunca** coloque a *service_role/secret* no site.

### 5) Publicar no GitHub Pages
**Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
Em 1–2 minutos o app estará em `https://SEU-USUARIO.github.io/sindico-total/`.

### 6) Primeiro uso
1. Abra o app, crie a conta da fintech e confirme o e-mail. Todo cadastro começa como **Morador**. Para habilitar o primeiro administrador, use o **SQL Editor** do Supabase com o UUID da conta confirmada em **Authentication → Users**.
   ```sql
   update public.pessoas p
   set tipo_usuario = 'ADMINISTRADOR'
   from auth.users a
   where a.id = p.id
     and a.email_confirmed_at is not null
     and a.id = 'UUID-DA-CONTA-CONFIRMADA';
   ```
2. **Condomínios** → cadastre o primeiro condomínio → **+ Síndico** → vincule você mesmo (ou o síndico).
3. Como administrador, preencha a **chave Pix** e o titular em **Dados do condomínio**. O síndico pode cadastrar o WhatsApp de atendimento e editar os demais dados operacionais.
4. **Unidades** → cadastre ou **importe a planilha** (baixe o modelo no próprio app). A coluna de e-mail já convida os moradores.
5. **Faturamento** → **Gerar faturas do mês**.
6. Os moradores criam conta com o **mesmo e-mail** do convite e acessam as faturas após confirmar o endereço.
7. Para outro síndico: ele cria conta → em **Usuários** mude para "Síndico profissional" → em **Condomínios** clique **+ Síndico**.

### 7) Instalar no celular
- **Android (Chrome):** abra o endereço → menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.
- **iPhone (Safari):** abra o endereço → botão Compartilhar → **Adicionar à Tela de Início**.

### 8) (Opcional) Síndico de Bolso no WhatsApp
O app já usa o WhatsApp **de graça** por links `wa.me` (cobrar morador, falar com o síndico, enviar comprovante). O robô automático usa a **WhatsApp Cloud API** da Meta, que **tem custo**: desde 1º/out/2026 a Meta passou a cobrar por mensagem também as respostas dentro da janela de 24h (há uma faixa mensal gratuita de mensagens de serviço — confira a tabela atual da Meta antes de ativar).

Para ativar, use contas com telefone verificado pelo Supabase Auth e teste a integração em um ambiente separado. A função exige assinatura da Meta e valida o ID do número destinatário.

1. Em <https://developers.facebook.com> crie um app do tipo *Business* → adicione **WhatsApp** → anote *Phone number ID* e gere um *token permanente* (usuário do sistema).
2. Instale o Supabase CLI e publique a função:
   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_VERIFY_TOKEN=uma-senha-qualquer WHATSAPP_APP_SECRET=...
   npx supabase functions deploy whatsapp-bot --no-verify-jwt
   ```
3. Na Meta, em **WhatsApp → Configuration → Webhook**: URL `https://SEU_PROJECT_REF.supabase.co/functions/v1/whatsapp-bot`, *verify token* = o mesmo `WHATSAPP_VERIFY_TOKEN`; assine o campo **messages**.
4. (Opcional) IA: crie uma chave grátis no **Google AI Studio** e rode `npx supabase secrets set GEMINI_API_KEY=...`. Sem ela, o robô funciona por palavras-chave. Atenção LGPD: no nível gratuito o Google pode usar o conteúdo enviado para melhorar seus produtos — a função envia **só o texto da mensagem**, nunca CPF ou dados de cadastro.

O telefone de contato preenchido em **Meu perfil** é usado para comunicação. O robô só vincula o remetente à conta pelo número confirmado no Auth. Comandos: `1` consulta faturas/Pix, `2 descrição` abre uma diligência para quem tem uma única unidade e `3` lista vistorias.

### 9) Manter o Supabase grátis ativo
O plano grátis **pausa o projeto após 1 semana sem uso**. Com o app em uso isso não acontece. Para garantir, o robô `.github/workflows/manter-supabase-ativo.yml` faz uma consulta a cada 3 dias: em **Settings → Secrets and variables → Actions** crie os segredos `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
O plano grátis também **não tem backup automático**: exporte os dados periodicamente (Table Editor → Export CSV, ou `npx supabase db dump`).

---

## Custos e limites (plano grátis)

| Serviço | Uso | Limite relevante |
|---|---|---|
| GitHub Pages | Hospeda o app | Repositório público; uso pessoal/MVP |
| Supabase Free | Banco, login, arquivos | 500 MB de banco, 1 GB de arquivos, 2 projetos, pausa após 1 semana parado |
| Pix Copia e Cola | Recebimento | Grátis (código gerado no app); a baixa é manual e exige o valor integral |
| WhatsApp `wa.me` | Cobrança/contato | Grátis (o síndico envia pelo próprio WhatsApp) |
| WhatsApp Cloud API + Gemini | Robô (opcional) | Pago por mensagem na Meta; Gemini com cota grátis |

## O que fica para depois (precisa de contrato/custo)
- **Baixa automática do Pix / Pix Automático / boleto registrado**: exige conta PJ em banco ou PSP com API (webhook de confirmação). A função `registrar_pagamento` já está pronta para receber o `id_transacao_gateway` e impedir duplicidade.
- **Lembretes automáticos de vencimento** pelo WhatsApp: são mensagens *template* (pagas).
- **Estrutura regulatória** (SCD ou FIDC), contrato-padrão de cessão de crédito, assinatura ICP-Brasil, política de privacidade/LGPD — conforme o roteiro do documento.
- App nas lojas (Play Store/App Store) — o PWA atual pode ser empacotado depois.

## Estrutura dos arquivos
```
index.html, manifest.webmanifest, sw.js   → casca do app (PWA instalável)
css/style.css                              → visual
js/config.js                               → ⚙️ SUA URL e chave do Supabase
js/app.js                                  → login, menu e rotas
js/pix.js                                  → gerador do Pix Copia e Cola (padrão Banco Central)
js/views/morador.js | gestao.js | admin.js → telas de cada perfil
supabase/schema.sql                        → banco completo (tabelas, regras, segurança)
supabase/reset.sql                         → apaga tudo (só para testes)
supabase/functions/whatsapp-bot/index.ts   → Síndico de Bolso (opcional)
tests/                                     → testes automáticos (rodam no GitHub Actions)
```

## Testar no computador (opcional)
Com Node.js instalado: `npm run dev` e abra o endereço mostrado. `npm test` roda os testes do Pix.

## Relação com o roteiro do documento
| Sprint do documento | Situação |
|---|---|
| 0 – Fundação (repositório, CI, banco) | ✅ GitHub + Actions + `schema.sql` |
| 1 – Cadastros + portal + autenticação | ✅ Condomínios, unidades, pessoas, papéis (RBAC) |
| 2 – Faturamento e Pix | ✅ Faturas mensais, planilha, Pix QR/copia e cola, baixa (webhook bancário fica para depois) |
| 3 – Cessão e cobrança | ✅ Cessão de vencidas, carteira, status de cobrança |
| 4 – WhatsApp e IA | ✅ Links grátis no app + robô opcional com 3 intenções |
