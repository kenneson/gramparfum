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
| 50 | Vendedor | Caixa (só as próprias vendas) e **devolução** no Caixa, valores só do dia de hoje (fechamento de caixa), anular venda com usuário e senha do chefe, Ranking, Inventário → **só contagem**: vê a contagem anterior, a diferença ainda pendente de cada produto e, ao digitar, se bateu ou quanto faltou/sobrou (e corrige a própria, com justificativa) |
| 90 | Chefe de loja | + Gestão de equipe (**só cadastra vendedores**, que entram na loja dele; não edita pessoas nem escolhe lojas), valores só de hoje, editar/anular venda, trocar vendedor (venda paga e pedido não pago, só ativos), Inventário → **compra, amostra e contagem**. **Não faz devolução** |
| 100 | Admin. geral de lojas | + tudo das lojas dele: faturamento de qualquer período, doação/estragou, estoque, **Recuperados**, metas (da loja e individuais), produtos, perfis, **remover** (tirar pessoa da loja/empresa, desfazer lançamento de outros, devolução e recuperação), Histórico e auditoria |
| 200 | Admin. do sistema | tudo, todas as lojas, cria lojas |

**Faturamento só para Admin (>= 100).** Vendedor e chefe: valores só do dia de hoje (Detalhado e Fechamento do dia,
sem escolher data); em outros períodos (Combos/Produtos) só quantidades — sem nenhum valor.
Na aba **Combos**, vendedor e chefe veem os combos de **todos os vendedores da loja** (`relatorio_combos`, só quantidades).

## Arquitetura

- **Autorização no banco (RLS)**: toda tabela tem RLS; helpers em `private.*` (fora da API).
- **Vendas só por funções auditadas**: `finalizar_venda`, `editar_venda`, `anular_venda`, `trocar_vendedor` (atômicas,
  validam permissão, gravam `eventos`). Não há policy de escrita direta nas tabelas de venda.
- **Anulação** exige motivo e autorização de chefe+: chefe anula direto; vendedor anula com o chefe digitando usuário e
  senha (`relatorios/actions.ts` entra como o chefe numa sessão descartável). Grava quem autorizou, quando e o motivo
  (Histórico + lista de anuladas no Fechamento do dia); o estoque volta sozinho.
- **Lançamentos de estoque**: `editar_movimento` corrige, desfaz (quantidade 0) e refaz (`quantidade_anterior`);
  `desfazer_movimentos` desfaz um lançamento inteiro (botão "Desfazer" logo após confirmar). Contagem só se corrige.
- **Ranking e metas** em combos (não em R$, para não expor faturamento): `ranking_vendedores` + tabela `metas`
  (mínima ≤ média ≤ FULL, uma por vendedor e loja, editada por chefe+).
- **Valores de venda só por `relatorio_vendas`**: o cliente não tem SELECT nas colunas de valor (total, preço, pagamentos);
  a função corta o faturamento conforme o perfil. Leitura direta fica só com quantidades/datas (usada no inventário).
- **Amostras**: qualquer perfil abre (cada uma baixa 1 unidade); edição só por `editar_amostra`, que grava quem editou
  (`editado_por`) e um evento no Histórico. Inventário e entradas só para admin (policy `estoque_insert`).
- **Estoque** = último inventário + entradas − amostras − vendas não anuladas desde então (`estoque_loja(loja)`).
- **Lançamentos por perfil** (`private.pode_lancar`): vendedor só conta; chefe compra, abre amostra e conta; doação e
  estragou só admin. Corrigir/desfazer exige justificativa (`motivo_edicao`); abaixo do admin, só o que a pessoa lançou.
  Após a contagem, a tela mostra quantos faltaram/sobraram.
- **Devolução no Caixa** (`registrar_devolucao`, pelo número do ticket): escolhe na hora se o produto volta ao estoque e se
  o valor sai do caixa (e de qual forma). Com valor devolvido, os combos saem do ranking. Venda com devolução ativa não se
  anula nem se edita; só admin desfaz (`desfazer_devolucao`).
- **Recuperados** (admin): contagem com falta (`divergencias_loja`, contagens a partir de 14/11/2026) se resolve cobrando
  o valor da pessoa (entra no fechamento do dia pela forma), registrando que o produto voltou (volta ao estoque) ou
  aceitando a diferença. `relatorio_caixa` leva devoluções e recuperados ao Fechamento do dia.
- **Divergência de contagem pendente**: na contagem, todo perfil vê por produto o que ainda falta/sobra
  (`pendencias_produtos`, só unidades). Só a administração recebe o alerta ao entrar (`pendencias_estoque()`: faixa
  vermelha em todas as telas e ponto no menu Inventário; ocultar vale até fechar o navegador) e resolve em Recuperados.
- **Metas**: meta da loja (`metas_loja`) vale para todos; a individual (`metas`) vale por cima. Só admin define.
- **Histórico e auditoria** (admin): `eventos` com descrição legível + `auditoria` (trigger em lojas, pessoas, produtos,
  vendas, estoque, metas, devoluções, recuperações: quem, quando, antes/depois). A Gestão grava com a chave de serviço,
  então o autor vai num evento `gestao`.
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
