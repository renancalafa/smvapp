// Regressão pura das guardas de banco (sem conectar).
//
//   npm run check:db-safety
import {
  DatabaseSafetyError,
  LOCAL_DEV_DATABASE_NAME,
  PRODUCTION_WRITE_APPROVAL,
  SMV_ALLOW_PRODUCTION_MIGRATE_ENV,
  SMV_ALLOW_REMOTE_BOOTSTRAP_ENV,
  SMV_DB_TARGET_ENV,
  assertRemoteBootstrapApproved,
  prismaCommandNeedsDatasourceGuard,
  requireLocalDatabaseUrl,
  resolveLocalMigrateUrl,
  resolvePrismaCliDatasourceUrl,
  resolveProductionMigrateUrl,
  resolveMigrateUrl,
} from "../src/domain/db/database-safety";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function expectThrow(name: string, run: () => unknown, messageIncludes?: string) {
  try {
    run();
    check(name, false, "esperava erro");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isSafety = error instanceof DatabaseSafetyError;
    const hasHint = messageIncludes ? message.includes(messageIncludes) : true;
    // Identidade host/database é permitida; connection string / user:pass / senha literal não.
    const leakedSecret =
      /postgresql:\/\//i.test(message) ||
      /:\/\/[^\s]+:[^\s]+@/i.test(message) ||
      message.includes("secret") ||
      /\bpassword=/i.test(message);
    check(name, isSafety && hasHint && !leakedSecret, leakedSecret ? "vazou credencial/URL" : message);
  }
}

const localUrl = `postgresql://pelada_dev:pelada_dev@127.0.0.1:5432/${LOCAL_DEV_DATABASE_NAME}`;
const localUrlLocalhost = `postgresql://pelada_dev:pelada_dev@localhost:5432/${LOCAL_DEV_DATABASE_NAME}`;
const wrongName = "postgresql://pelada_dev:pelada_dev@127.0.0.1:5432/postgres";
const neonDirect = "postgresql://user:secret@ep-example.sa-east-1.aws.neon.tech/neondb?sslmode=require";
const neonPooler =
  "postgresql://user:secret@ep-example-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require";

{
  const resolved = resolveLocalMigrateUrl({
    [SMV_DB_TARGET_ENV]: "local",
    DATABASE_URL: localUrl,
    DIRECT_URL: "",
  });
  check(
    "local válido pelada_dev via DATABASE_URL",
    resolved.identity.host === "127.0.0.1" && resolved.identity.database === LOCAL_DEV_DATABASE_NAME,
  );
}

{
  const resolved = resolveLocalMigrateUrl({
    [SMV_DB_TARGET_ENV]: "local",
    DATABASE_URL: localUrlLocalhost,
    DIRECT_URL: localUrl,
  });
  check(
    "local válido com DIRECT_URL também local (localhost≈127.0.0.1)",
    resolved.url === localUrl && resolved.identity.database === LOCAL_DEV_DATABASE_NAME,
  );
}

expectThrow(
  "Neon rejeitado em modo local",
  () =>
    resolveLocalMigrateUrl({
      [SMV_DB_TARGET_ENV]: "local",
      DATABASE_URL: neonDirect,
    }),
  LOCAL_DEV_DATABASE_NAME,
);

expectThrow(
  "DATABASE_URL local + DIRECT_URL produção rejeitado",
  () =>
    resolveLocalMigrateUrl({
      [SMV_DB_TARGET_ENV]: "local",
      DATABASE_URL: localUrl,
      DIRECT_URL: neonDirect,
    }),
  "DIRECT_URL",
);

expectThrow(
  "nome de banco errado rejeitado",
  () =>
    resolveLocalMigrateUrl({
      [SMV_DB_TARGET_ENV]: "local",
      DATABASE_URL: wrongName,
    }),
  LOCAL_DEV_DATABASE_NAME,
);

expectThrow("alvo ausente rejeitado", () => resolveMigrateUrl({ DATABASE_URL: localUrl }), SMV_DB_TARGET_ENV);

expectThrow(
  "produção sem segunda flag rejeitada",
  () =>
    resolveProductionMigrateUrl({
      [SMV_DB_TARGET_ENV]: "production",
      DIRECT_URL: neonDirect,
      DATABASE_URL: neonPooler,
    }),
  SMV_ALLOW_PRODUCTION_MIGRATE_ENV,
);

{
  const resolved = resolveProductionMigrateUrl({
    [SMV_DB_TARGET_ENV]: "production",
    [SMV_ALLOW_PRODUCTION_MIGRATE_ENV]: PRODUCTION_WRITE_APPROVAL,
    DIRECT_URL: neonDirect,
    DATABASE_URL: neonPooler,
  });
  check("produção autorizada aceita Neon", resolved.identity.database === "neondb");
}

expectThrow(
  "produção autorizada recusa loopback",
  () =>
    resolveProductionMigrateUrl({
      [SMV_DB_TARGET_ENV]: "production",
      [SMV_ALLOW_PRODUCTION_MIGRATE_ENV]: PRODUCTION_WRITE_APPROVAL,
      DIRECT_URL: localUrl,
    }),
  "loopback",
);

expectThrow(
  "requireLocalDatabaseUrl rejeita Neon",
  () => requireLocalDatabaseUrl(neonDirect),
  LOCAL_DEV_DATABASE_NAME,
);

check("requireLocalDatabaseUrl aceita pelada_dev", requireLocalDatabaseUrl(localUrl) === localUrl);

expectThrow(
  "bootstrap remoto sem flag rejeitado",
  () => assertRemoteBootstrapApproved({}),
  SMV_ALLOW_REMOTE_BOOTSTRAP_ENV,
);

assertRemoteBootstrapApproved({ [SMV_ALLOW_REMOTE_BOOTSTRAP_ENV]: PRODUCTION_WRITE_APPROVAL });
check("bootstrap remoto com aprovação explícita", true);

check(
  "prisma generate não exige SMV_DB_TARGET",
  resolvePrismaCliDatasourceUrl({ DATABASE_URL: localUrl }, ["node", "prisma", "generate"]).includes(
    LOCAL_DEV_DATABASE_NAME,
  ),
);

expectThrow(
  "prisma migrate deploy sem alvo falha",
  () => resolvePrismaCliDatasourceUrl({ DATABASE_URL: localUrl }, ["node", "prisma", "migrate", "deploy"]),
  SMV_DB_TARGET_ENV,
);

check(
  "guard detecta migrate deploy",
  prismaCommandNeedsDatasourceGuard(["node", "prisma", "migrate", "deploy"]),
);
check(
  "guard ignora generate",
  !prismaCommandNeedsDatasourceGuard(["node", "prisma", "generate"]),
);

for (const result of results) {
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
  );
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
