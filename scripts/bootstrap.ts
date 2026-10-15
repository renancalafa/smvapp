// Cria o Group, o GroupSettings (valores do seed) e o primeiro ADMIN, com senha temporária.
// Só roda em banco vazio; recusa hosts não locais sem --allow-remote.
//
//   npm run bootstrap -- --username renan --name "Renan" --modality MONTHLY
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type PlayerModality } from "../src/generated/prisma/client";
import { generateTemporaryPassword, hashPassword } from "../src/server/auth/password";
import { isValidUsername, normalizeUsername } from "../src/server/auth/validation";

const USAGE = `Uso:
  npm run bootstrap -- --username <usuario> --name "<nome>" --modality MONTHLY|DAILY
                       [--rating 1-5] [--group-name "Pelada"] [--group-slug pelada]
                       [--timezone America/Sao_Paulo] [--allow-remote]`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

class UsageError extends Error {}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      username: { type: "string" },
      name: { type: "string" },
      modality: { type: "string" },
      rating: { type: "string", default: "3" },
      "group-name": { type: "string", default: "Pelada" },
      "group-slug": { type: "string", default: "pelada" },
      timezone: { type: "string", default: "America/Sao_Paulo" },
      "allow-remote": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const username = normalizeUsername(values.username ?? "");
  if (!isValidUsername(username)) {
    throw new UsageError("--username: 3 a 32 caracteres entre a-z, 0-9, ponto, hífen e sublinhado.");
  }
  const name = (values.name ?? "").trim();
  if (!name || name.length > 80) throw new UsageError("--name: obrigatório, até 80 caracteres.");
  const modality = values.modality?.toUpperCase();
  if (modality !== "MONTHLY" && modality !== "DAILY") {
    throw new UsageError("--modality: MONTHLY ou DAILY.");
  }
  const rating = Number(values.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new UsageError("--rating: inteiro de 1 a 5.");
  }
  const groupName = values["group-name"].trim();
  if (!groupName || groupName.length > 80) throw new UsageError("--group-name: até 80 caracteres.");
  const groupSlug = values["group-slug"];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(groupSlug) || groupSlug.length > 40) {
    throw new UsageError("--group-slug: minúsculas, números e hífens, até 40 caracteres.");
  }
  const timezone = values.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new UsageError(`--timezone: fuso IANA inválido (${timezone}).`);
  }

  return {
    username,
    name,
    modality: modality as PlayerModality,
    rating,
    groupName,
    groupSlug,
    timezone,
    allowRemote: values["allow-remote"],
  };
}

function databaseHost(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    throw new UsageError("DATABASE_URL inválida.");
  }
}

async function main() {
  const options = parseOptions();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new UsageError("DATABASE_URL não definida (veja .env.example).");
  const host = databaseHost(connectionString);
  if (!LOCAL_HOSTS.has(host) && !options.allowRemote) {
    throw new UsageError(`Banco em host não local (${host}). Use --allow-remote se for intencional.`);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const admin = await prisma.$transaction(
      async (tx) => {
        const [groups, users] = await Promise.all([tx.group.count(), tx.user.count()]);
        if (groups > 0 || users > 0) {
          throw new UsageError("O banco já tem Group ou User: o bootstrap só roda em banco vazio.");
        }

        const group = await tx.group.create({
          data: {
            name: options.groupName,
            slug: options.groupSlug,
            timezone: options.timezone,
            settings: {
              create: {
                sessionWeekday: "THURSDAY",
                sessionStartMinute: 21 * 60,
                sessionEndMinute: 22 * 60 + 30,
                maxExtraMinutes: 30,
                registrationOpensDaysBefore: 3,
                registrationOpensMinute: 8 * 60,
                priorityDeadlineDaysBefore: 0,
                priorityDeadlineMinute: 15 * 60,
                sessionAutoCreateLeadDays: 7,
                maxPlayers: 20,
                teamSize: 5,
                matchDurationSec: 7 * 60,
                drawOptionsCount: 2,
                drawMinOptionDifference: 3,
                dailyFeeCents: 1500,
                monthlyFieldCostCents: 90000,
                fieldPaymentDueDay: 10,
                monthlyFeeDueDay: 7,
                currency: "BRL",
              },
            },
          },
        });

        const user = await tx.user.create({
          data: {
            username: options.username,
            name: options.name,
            passwordHash,
            mustChangePassword: true,
          },
        });

        const member = await tx.groupMember.create({
          data: {
            groupId: group.id,
            userId: user.id,
            role: "ADMIN",
            modality: options.modality,
            baseRating: options.rating,
          },
        });

        await tx.auditLog.create({
          data: {
            groupId: group.id,
            actorType: "SYSTEM",
            action: "SYSTEM_BOOTSTRAPPED",
            entityType: "GroupMember",
            entityId: member.id,
            after: {
              groupSlug: group.slug,
              username: user.username,
              role: member.role,
              modality: member.modality,
            },
            metadata: { source: "scripts/bootstrap.ts" },
          },
        });

        return { group, user };
      },
      { isolationLevel: "Serializable" },
    );

    console.log(`Group "${admin.group.name}" (${admin.group.slug}) criado.`);
    console.log(`ADMIN: ${admin.user.username}`);
    console.log(`Senha temporária (exibida só agora): ${temporaryPassword}`);
    console.log("No primeiro login, a troca de senha é obrigatória.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`Erro: ${error.message}\n\n${USAGE}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
