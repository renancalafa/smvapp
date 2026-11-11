import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolvePrismaCliDatasourceUrl } from "./src/domain/db/database-safety";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // generate/validate: URL local de fallback (sem conectar).
    // migrate/db *: exige SMV_DB_TARGET e identidade validada (fail-closed).
    url: resolvePrismaCliDatasourceUrl(),
  },
});
