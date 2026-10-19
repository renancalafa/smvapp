# Pelada

Sistema de Gestão da Pelada. Regras de negócio: [`PROJECT.md`](PROJECT.md). Arquitetura: [`docs/architecture.md`](docs/architecture.md).

Stack: Next.js 16 (App Router), TypeScript, Prisma 7 + PostgreSQL, Tailwind CSS 4.

## Ambiente local (Windows, CMD)

Requisitos: Node.js 24 e um PostgreSQL local **descartável** (nunca o de produção).

### 1. PostgreSQL local

Opção A, instalador nativo (pede a senha do usuário `postgres` durante a instalação):

```bat
winget install --id PostgreSQL.PostgreSQL.17 -e
```

Crie um usuário e um banco só para desenvolvimento:

```bat
set PSQL="C:\Program Files\PostgreSQL\17\bin\psql.exe"
%PSQL% -h localhost -U postgres -c "CREATE ROLE pelada_dev LOGIN PASSWORD 'pelada_dev' CREATEDB;"
%PSQL% -h localhost -U postgres -c "CREATE DATABASE pelada_dev OWNER pelada_dev;"
```

Opção B, Docker:

```bat
docker run --name pelada-dev-pg -e POSTGRES_USER=pelada_dev -e POSTGRES_PASSWORD=pelada_dev -e POSTGRES_DB=pelada_dev -p 5432:5432 -d postgres:17
```

### 2. Variáveis de ambiente

```bat
copy .env.example .env
```

Em `.env`, aponte para o banco local:

```
DATABASE_URL="postgresql://pelada_dev:pelada_dev@localhost:5432/pelada_dev"
DIRECT_URL=""
```

**Produção (Neon):** use a URL **pooled** (`-pooler` no host) em `DATABASE_URL` (runtime Vercel) e a URL **direct** em `DIRECT_URL` (só CLI: `migrate deploy` / bootstrap). Detalhes e placeholders sem credenciais: [`.env.example`](.env.example). Runbook completo: [`docs/deploy-vercel-neon.md`](docs/deploy-vercel-neon.md). O build da Vercel **não** aplica migrations automaticamente.

### 3. Dependências e migration

```bat
npm install
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
```

`migrate deploy` aplica as migrations versionadas em `prisma/migrations` sem gerar novas. Para recomeçar do zero **no banco local descartável**: `npx prisma migrate reset` (apaga todos os dados).

### 4. Primeiro ADMIN

```bat
npm run bootstrap -- --username seu.usuario --name "Seu Nome" --modality MONTHLY
```

Cria o grupo, as configurações iniciais e o ADMIN, e imprime uma senha temporária uma única vez. Só roda em banco vazio e recusa hosts que não sejam `localhost` (para um banco remoto intencional, use `--allow-remote`). Opções: `npm run bootstrap -- --help`.

### 5. Rodar

```bat
npm run dev
```

Abra http://localhost:3000, entre com a senha temporária e defina a senha nova.

## PWA

O service worker só é registrado no build de produção (`npm run build` e `npm start`); em `npm run dev` ele é removido de propósito. Instalação e service worker exigem HTTPS, com exceção de `localhost`. Um IP da rede local (http://192.168...) não serve: o navegador não registra o service worker e, em produção, o cookie de sessão (`Secure`) não é gravado.

- **Desktop**: `npm run build` e `npm start`, abra http://localhost:3000 no Chrome ou Edge e use o ícone de instalar na barra de endereço.
- **Android**: com o celular no cabo USB e a depuração USB ativada, abra `chrome://inspect/#devices` no Chrome do PC, ative "Port forwarding" de `3000` para `localhost:3000` e abra http://localhost:3000 no Chrome do celular.
- **iPhone**: precisa de HTTPS de verdade: um deploy de preview ou um túnel HTTPS para o `npm start` local (por exemplo `cloudflared tunnel --url http://localhost:3000`). Se o login pelo túnel falhar por origem diferente, inclua o domínio do túnel em `experimental.serverActions.allowedOrigins` no `next.config.ts`, só localmente.

Ícones: `npm run icons` regenera `public/icons/*` e `src/app/favicon.ico`.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e servidor de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run bootstrap -- ...` | Cria o grupo e o primeiro ADMIN |
| `npm run icons` | Regenera os ícones do PWA |
| `npm run seed:test-players -- ...` | Só desenvolvimento: cria jogadores de teste (`teste01`…, senha `teste1234`); com `--confirm`, confirma-os na próxima sessão |
| `npm run check:attendance-lock` | Só desenvolvimento: teste de regressão do travamento da lista pela votação (tudo em transação desfeita) |
| `npm run check:match-flow` | Só desenvolvimento: Rei da Mesa + fluxo de partidas (funções puras + rollback no banco) |
| `npm run check:stats` | Só desenvolvimento: estatísticas / classificação (rollback) |
| `npm run check:live-poll` | Só desenvolvimento: polling Ao Vivo / revisão / 304 (rollback) |
| `npm run check:login-throttle` | Só desenvolvimento: rate limit de login no Postgres (rollback) |
| `npm run check:dev-reset` | Só desenvolvimento: reset de teste bloqueado fora de `development` |
| `npm run check:member-role` | Só desenvolvimento: promoção/rebaixamento ADMIN e último ADMIN (rollback + concorrência) |

O Prisma Client é gerado em `src/generated/prisma` no `npm install` (`postinstall`); após mudar o schema, rode `npx prisma generate`. Deploy: [`docs/deploy-vercel-neon.md`](docs/deploy-vercel-neon.md).
