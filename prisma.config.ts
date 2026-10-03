import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations precisam de conexão direta; a URL com pooling fica só para o runtime.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
