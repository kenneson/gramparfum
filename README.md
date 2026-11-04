# GamParfum — Next.js + Supabase

Sistema de vendas (POS multi-loja) migrado do PHP/MySQL legado.

## Setup

1. Aplique o schema no projeto Supabase: `npx supabase link --project-ref <ref>` e depois `npx supabase db push --remote` (CLI v3: sem `--remote` vai para o Docker local)
   (ou cole `supabase/migrations/*.sql` no SQL Editor).
2. Copie `.env.example` para `.env.local` e preencha URL, publishable key e secret key.
3. `npm install` e depois `node --env-file=.env.local scripts/criar-admin.mjs admin <senha> "Seu Nome"`
4. `npm run dev`, entre com `admin` e crie as lojas em **Gestão → Lojas**.

Importar o sistema antigo: dump do phpMyAdmin em `supabase/legacy/banco.sql` (fora do git), depois
`node --env-file=.env.local scripts/importar-legado.mjs --seco` para simular e sem `--seco` para gravar.
Os usuários entram com a senha antiga; no primeiro login ela é convertida para o Supabase Auth.

Testes: `node --test lib/pagamento.test.ts` (regra de pagamento) e `node scripts/testar-sql.mjs`
(roda as migrations num Postgres local em WASM e testa venda, edição, estoque e relatório por perfil).

## Perfis (iguais ao legado)

| role | perfil | acesso |
|---|---|---|
| 50 | Vendedor | Caixa (só as próprias vendas), relatórios das próprias vendas |
| 90 | Chefe de loja | + Gestão de equipe, Inventário, Histórico, editar/anular venda, trocar vendedor |
| 100 | Admin. geral de lojas | + faturamento, cria/edita produtos, altera perfis, vê estoque no caixa |
| 200 | Admin. do sistema | tudo, todas as lojas, cria lojas |

**Faturamento só para Admin (>= 100).** Vendedor e chefe: relatório detalhado de um dia por vez; em vários dias
(Combos/Produtos) só aparecem quantidades, combos e o recebido em dinheiro — sem total de vendas nem outras formas.

## Arquitetura

- **Autorização no banco (RLS)**: toda tabela tem RLS; helpers em `private.*` (fora da API).
- **Vendas só por funções auditadas**: `finalizar_venda`, `editar_venda`, `anular_venda`, `trocar_vendedor` (atômicas,
  validam permissão, gravam `eventos`). Não há policy de escrita direta nas tabelas de venda.
- **Valores de venda só por `relatorio_vendas`**: o cliente não tem SELECT nas colunas de valor (total, preço, pagamentos);
  a função corta o faturamento conforme o perfil. Leitura direta fica só com quantidades/datas (usada no inventário).
- **Estoque** = último inventário + entradas − amostras − vendas não anuladas desde então (`estoque_loja(loja)`).
- **Gestão de usuários** em Server Actions com a secret key (`app/(app)/gestao/actions.ts`), com checagem hierárquica.
  Login por usuário → e-mail sintético `usuario@gamparfum.local` no Supabase Auth. Acesso desabilitado = usuário banido no Auth.

## Deploy (Hostinger)

A Hostinger implanta direto a `main` (preset Next.js, `npm run build` + `npm start`). O servidor dela tem glibc antiga:
o SWC nativo do Next não carrega e ele cai no SWC em WASM. Por isso o projeto foi ajustado para compilar assim:

- `next build --webpack` (o Turbopack exige binário nativo; no `npm run dev` local ele continua sendo usado)
- `next.config.mjs` em vez de `.ts` (o WASM não compila config em TypeScript)
- Tailwind via `postcss.config.mjs` (`@tailwindcss/postcss`; o binário dele exige só glibc 2.14)
- `images.unoptimized` (sem `sharp`, outro binário nativo)

Simular o build da Hostinger localmente: `NEXT_TEST_WASM=1 npm run build && NEXT_TEST_WASM=1 npm start`.

Variáveis no painel: `SUPABASE_SECRET_KEY` (a URL e a chave publishable vêm do `.env.production`, que é público).
