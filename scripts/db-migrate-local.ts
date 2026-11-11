// Aplica migrations só no Postgres local pelada_dev.
// Nunca use este script contra produção.
//
//   npm run db:migrate:local
import "dotenv/config";
import { spawnSync } from "node:child_process";
import {
  LOCAL_DEV_DATABASE_NAME,
  SMV_DB_TARGET_ENV,
  formatDatabaseIdentity,
  resolveLocalMigrateUrl,
} from "../src/domain/db/database-safety";

process.env[SMV_DB_TARGET_ENV] = "local";

const resolved = resolveLocalMigrateUrl(process.env);
console.log(`Migrando banco local ${formatDatabaseIdentity(resolved.identity)} (${LOCAL_DEV_DATABASE_NAME}).`);

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, [SMV_DB_TARGET_ENV]: "local" },
  shell: true,
});

process.exit(result.status ?? 1);
