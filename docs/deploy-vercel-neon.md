# Deploy de produção — Vercel + Neon

Runbook do primeiro deploy do SMV. **Não** rode `migrate reset` em produção. Migrations **não** entram no `npm run build` da Vercel: aplique-as manualmente (ou em CI separado) com `DIRECT_URL`.

## Pré-requisitos

- Conta Neon (Postgres) e projeto Vercel ligados ao repositório.
- Node.js ≥ 22.12 (Prisma 7).
- Código das Fases 1–6 e as três migrations versionadas em `prisma/migrations` já no branch que será deployado.

## Variáveis de ambiente (Vercel Project → Settings → Environment Variables)

| Nome | Valor | Onde |
| --- | --- | --- |
| `DATABASE_URL` | Neon **pooled** (`…-pooler…`, `sslmode=require`) | Production (e Preview se quiser banco separado) |
| `DIRECT_URL` | Neon **direct** (sem `-pooler`) | Só necessário na máquina/CI que roda `migrate` / `bootstrap` — pode ficar só no shell local, não precisa estar na Vercel se o build não migrar |
| `CRON_SECRET` | Segredo longo aleatório | Production (obrigatório para o cron) |
| `NODE_ENV` | definido pela Vercel como `production` | — |

Não coloquem `.env` no Git. O runtime da app usa só `DATABASE_URL` (pool serverless com `max: 1` em `src/server/db.ts`).

## Rate limit de login (escolhas)

Contadores **em memória** falham entre lambdas Vercel — descartado.

| Opção | Prós | Contras |
| --- | --- | --- |
| **Postgres (`LoginThrottle`)** — adotado | Zero dependência nova; já no Neon | Uma escrita extra em falhas de login |
| Upstash Redis / Vercel KV | Rápido, TTL nativo | Serviço e custo extras |
| WAF / Vercel Firewall | Bloqueio na borda | Configuração fora do app |

Implementação: `src/server/auth/login-throttle.ts` (8 falhas / usuário / 15 min; 40 / IP / 15 min; bloqueio 15 min).

## Passo a passo do primeiro deploy

### 1. Congelar o código

Faça commit (e push) de tudo que entra no MVP — inclusive:

- `prisma/migrations/20261005000000_init`
- `prisma/migrations/20261018210000_match_event_types`
- `prisma/migrations/20261019120000_login_throttle`

### 2. Criar o banco Neon

1. Crie um projeto Neon (região próxima dos usuários).
2. Em **Connect**, copie a URL **pooled** → será `DATABASE_URL`.
3. Copie a URL **direct** → será `DIRECT_URL` no shell local.

### 3. Aplicar migrations (uma vez, fora do build Vercel)

Na máquina local (ou job de release), com as URLs de **produção**:

```bash
# PowerShell / bash — não use o .env de desenvolvimento
set DATABASE_URL=postgresql://…-pooler…/neondb?sslmode=require
set DIRECT_URL=postgresql://…(sem pooler)…/neondb?sslmode=require

npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

`prisma.config.ts` usa `DIRECT_URL || DATABASE_URL` para o CLI. Confirme as **três** migrations aplicadas. **Não** use `migrate reset` / `db push` em produção.

### 4. Bootstrap do primeiro ADMIN (banco vazio)

```bash
npm run bootstrap -- --username seu.usuario --name "Seu Nome" --modality MONTHLY --allow-remote
```

- Só funciona se não houver `Group`/`User`.
- Imprime a senha temporária **uma vez** — guarde offline e troque no primeiro login.
- Use `DATABASE_URL` apontando ao Neon (direto ou pooled; preferível direto para o script).

### 5. Configurar a Vercel

1. Importe o repositório; Framework: Next.js; Build: `npm run build` (padrão; **sem** `migrate deploy`).
2. Defina `DATABASE_URL` (pooled) e `CRON_SECRET` em Production.
3. Deploy a partir do branch aprovado.
4. Abra `https://<dominio>/login`, entre com a senha temporária e troque a senha.

### 6. Cron (recomendado)

O arquivo `vercel.json` agenda `GET /api/cron/tick` (abertura de lista / sessões semanais). A Vercel envia `Authorization: Bearer $CRON_SECRET` automaticamente quando `CRON_SECRET` está definido.

Sem cron, as páginas ainda chamam `syncSessionsForRead` sob demanda — o tick é garantia extra.

### 7. Smoke test pós-deploy

- [ ] Login + troca de senha (`__Host-smv_session` em HTTPS)
- [ ] Lista / sorteio / apito de partida
- [ ] `/live` atualiza (poll; aba oculta para)
- [ ] `/stats` carrega
- [ ] Ferramentas “dev reset” **não** aparecem
- [ ] `GET /api/cron/tick` sem secret → 401; com secret → `{ ok: true, … }`

## Rollback (cuidados)

| Situação | Ação |
| --- | --- |
| Bug só de app | Redeploy do commit anterior na Vercel (DB intacto) |
| Migration já aplicada | **Não** apague o banco. Corrija com migration seguinte ou hotfix de app. Rollback de schema em Postgres exige migration reversa escrita à mão |
| Bootstrap errado em banco ainda vazio | Só antes de dados reais: dropar o projeto Neon / recriar branch e repetir migrate + bootstrap |
| Comprometimento de `CRON_SECRET` | Rotacione na Vercel; o tick antigo passa a 401 |

## O que este runbook **não** faz

- Não reseta Neon nem roda bootstrap automaticamente no deploy.
- Não coloca `prisma migrate deploy` no build da Vercel (evita corridas e surpresas em Preview).
- Não versiona senhas, `.env` ou client gerado (`src/generated/` no `.gitignore`; `postinstall` regenera).
