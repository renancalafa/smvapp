// Guardas de destino de banco: identidade sem credenciais; falha fechada para CLI/scripts.
// Não abre conexão. Não registre nem devolva senhas ou connection strings completas.

import {
  readDatabaseIdentity,
  sameDatabaseIdentity,
  type DatabaseIdentity,
} from "../push/database-identity";

export type { DatabaseIdentity };
export { readDatabaseIdentity, sameDatabaseIdentity };

/** Hosts considerados loopback para desenvolvimento local. */
export const LOCAL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Nome obrigatório do banco de desenvolvimento local. */
export const LOCAL_DEV_DATABASE_NAME = "pelada_dev";

export const SMV_DB_TARGET_ENV = "SMV_DB_TARGET";
export const SMV_ALLOW_PRODUCTION_MIGRATE_ENV = "SMV_ALLOW_PRODUCTION_MIGRATE";
export const SMV_ALLOW_REMOTE_BOOTSTRAP_ENV = "SMV_ALLOW_REMOTE_BOOTSTRAP";

/** Aprovação explícita (não é fronteira de segurança; só freio operacional). */
export const PRODUCTION_WRITE_APPROVAL = "I_UNDERSTAND";

export type DbTarget = "local" | "production";

/** Env bag for tests/scripts — evita exigir NODE_ENV de ProcessEnv. */
export type EnvBag = Record<string, string | undefined>;

export class DatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseSafetyError";
  }
}

export function isLoopbackHost(host: string): boolean {
  return LOCAL_LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function isLocalDevIdentity(identity: DatabaseIdentity): boolean {
  return isLoopbackHost(identity.host) && identity.database === LOCAL_DEV_DATABASE_NAME;
}

/** Formata host/database para logs e erros — nunca a URL completa. */
export function formatDatabaseIdentity(identity: DatabaseIdentity): string {
  return `${identity.host}/${identity.database}`;
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readDbTarget(env: EnvBag = process.env): DbTarget | null {
  const raw = nonEmptyEnv(env[SMV_DB_TARGET_ENV])?.toLowerCase();
  if (raw === "local" || raw === "production") return raw;
  return null;
}

export function assertLocalDevConnectionString(
  connectionString: string,
  label: string,
): DatabaseIdentity {
  const identity = readDatabaseIdentity(connectionString);
  if (!identity) {
    throw new DatabaseSafetyError(`${label} inválida ou incompleta (host/database ausentes).`);
  }
  if (!isLocalDevIdentity(identity)) {
    throw new DatabaseSafetyError(
      `${label} recusada para desenvolvimento local. Esperado loopback/${LOCAL_DEV_DATABASE_NAME}; recebido ${formatDatabaseIdentity(identity)}. ` +
        `Hostname sozinho não basta: use credenciais isoladas do Postgres local pelada_dev.`,
    );
  }
  return identity;
}

/**
 * Scripts/testes locais: exige DATABASE_URL = loopback/pelada_dev.
 * Devolve a string original só para conectar (não logar).
 */
export function requireLocalDatabaseUrl(
  connectionString: string | undefined,
  label = "DATABASE_URL",
): string {
  if (!connectionString?.trim()) {
    throw new DatabaseSafetyError(`${label} não definida. Use o Postgres local pelada_dev (.env.example).`);
  }
  assertLocalDevConnectionString(connectionString, label);
  return connectionString;
}

/**
 * Migração local: SMV_DB_TARGET=local, DATABASE_URL local/pelada_dev,
 * e se DIRECT_URL existir também tem de ser local/pelada_dev (sem fallback silencioso).
 */
export function resolveLocalMigrateUrl(env: EnvBag = process.env): {
  url: string;
  identity: DatabaseIdentity;
} {
  const target = readDbTarget(env);
  if (target !== "local") {
    throw new DatabaseSafetyError(
      `Migração local exige ${SMV_DB_TARGET_ENV}=local (recebido: ${target ?? "ausente"}). Use: npm run db:migrate:local`,
    );
  }

  const databaseUrl = nonEmptyEnv(env.DATABASE_URL);
  if (!databaseUrl) {
    throw new DatabaseSafetyError("DATABASE_URL é obrigatória para migração local.");
  }
  const databaseIdentity = assertLocalDevConnectionString(databaseUrl, "DATABASE_URL");

  const directUrl = nonEmptyEnv(env.DIRECT_URL);
  if (directUrl) {
    // Ambos já passaram isLocalDevIdentity (loopback + pelada_dev).
    // localhost vs 127.0.0.1 contam como o mesmo alvo local seguro.
    const directIdentity = assertLocalDevConnectionString(directUrl, "DIRECT_URL");
    return { url: directUrl, identity: directIdentity };
  }

  return { url: databaseUrl, identity: databaseIdentity };
}

/**
 * Migração de produção: alvo explícito + segunda flag de aprovação.
 * Flags de ambiente NÃO são fronteira de segurança — só evitam acidentes operacionais.
 */
export function resolveProductionMigrateUrl(env: EnvBag = process.env): {
  url: string;
  identity: DatabaseIdentity;
} {
  const target = readDbTarget(env);
  if (target !== "production") {
    throw new DatabaseSafetyError(
      `Migração de produção exige ${SMV_DB_TARGET_ENV}=production (recebido: ${target ?? "ausente"}).`,
    );
  }
  if (nonEmptyEnv(env[SMV_ALLOW_PRODUCTION_MIGRATE_ENV]) !== PRODUCTION_WRITE_APPROVAL) {
    throw new DatabaseSafetyError(
      `Migração de produção exige ${SMV_ALLOW_PRODUCTION_MIGRATE_ENV}=${PRODUCTION_WRITE_APPROVAL}. ` +
        `Flags de ambiente não são uma fronteira de segurança; use credenciais e procedimento humanos aprovados (docs/deploy-vercel-neon.md).`,
    );
  }

  const directUrl = nonEmptyEnv(env.DIRECT_URL);
  const databaseUrl = nonEmptyEnv(env.DATABASE_URL);
  const chosen = directUrl ?? databaseUrl;
  if (!chosen) {
    throw new DatabaseSafetyError("DIRECT_URL (preferível) ou DATABASE_URL é obrigatória para migração de produção.");
  }

  const identity = readDatabaseIdentity(chosen);
  if (!identity) {
    throw new DatabaseSafetyError("URL de migração de produção inválida ou incompleta.");
  }
  if (isLoopbackHost(identity.host)) {
    throw new DatabaseSafetyError(
      `Migração de produção recusou loopback (${formatDatabaseIdentity(identity)}). Use o banco de produção aprovado.`,
    );
  }
  if (directUrl && databaseUrl) {
    const databaseIdentity = readDatabaseIdentity(databaseUrl);
    if (!databaseIdentity) {
      throw new DatabaseSafetyError("DATABASE_URL de produção inválida.");
    }
    // Pooler vs direct podem diferir no hostname (-pooler); o nome do database deve bater.
    if (databaseIdentity.database !== identity.database) {
      throw new DatabaseSafetyError(
        `DATABASE_URL e DIRECT_URL discordam no nome do banco (${databaseIdentity.database} vs ${identity.database}).`,
      );
    }
  }

  return { url: chosen, identity };
}

export function resolveMigrateUrl(env: EnvBag = process.env): {
  url: string;
  identity: DatabaseIdentity;
  target: DbTarget;
} {
  const target = readDbTarget(env);
  if (target === "local") {
    const resolved = resolveLocalMigrateUrl(env);
    return { ...resolved, target };
  }
  if (target === "production") {
    const resolved = resolveProductionMigrateUrl(env);
    return { ...resolved, target };
  }
  throw new DatabaseSafetyError(
    `${SMV_DB_TARGET_ENV} ausente ou inválido. ` +
      `Para desenvolvimento: npm run db:migrate:local. ` +
      `Para produção: procedimento humano em docs/deploy-vercel-neon.md (nunca pelo wrapper local).`,
  );
}

/** Subcomandos Prisma que abrem o datasource e podem alterar schema/dados. */
export function prismaCommandNeedsDatasourceGuard(argv: readonly string[] = process.argv): boolean {
  const args = argv.map((part) => part.toLowerCase());
  const has = (...tokens: string[]) => {
    for (let index = 0; index < args.length; index += 1) {
      if (tokens.every((token, offset) => args[index + offset] === token)) return true;
    }
    return false;
  };
  return (
    has("migrate", "deploy") ||
    has("migrate", "dev") ||
    has("migrate", "reset") ||
    has("migrate", "resolve") ||
    has("migrate", "status") ||
    has("db", "push") ||
    has("db", "execute") ||
    has("db", "seed") ||
    has("db", "pull")
  );
}

/**
 * URL do datasource no prisma.config.ts.
 * generate/validate: não exige SMV_DB_TARGET (Vercel build).
 * migrate/db *: fail-closed via resolveMigrateUrl.
 */
export function resolvePrismaCliDatasourceUrl(
  env: EnvBag = process.env,
  argv: readonly string[] = process.argv,
): string {
  if (!prismaCommandNeedsDatasourceGuard(argv)) {
    return (
      nonEmptyEnv(env.DATABASE_URL) ??
      nonEmptyEnv(env.DIRECT_URL) ??
      `postgresql://pelada_dev:pelada_dev@127.0.0.1:5432/${LOCAL_DEV_DATABASE_NAME}`
    );
  }
  return resolveMigrateUrl(env).url;
}

/** Bootstrap remoto: --allow-remote + SMV_ALLOW_REMOTE_BOOTSTRAP=I_UNDERSTAND. */
export function assertRemoteBootstrapApproved(env: EnvBag = process.env): void {
  if (nonEmptyEnv(env[SMV_ALLOW_REMOTE_BOOTSTRAP_ENV]) !== PRODUCTION_WRITE_APPROVAL) {
    throw new DatabaseSafetyError(
      `Bootstrap remoto exige ${SMV_ALLOW_REMOTE_BOOTSTRAP_ENV}=${PRODUCTION_WRITE_APPROVAL} além de --allow-remote. ` +
        `Flags não substituem isolamento de credenciais.`,
    );
  }
}
