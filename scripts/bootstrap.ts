// Cria o Group, o GroupSettings (valores do seed) e o primeiro ADMIN, com senha temporária.
// Só roda em banco vazio. Local: exige loopback/pelada_dev.
// Remoto: --allow-remote + SMV_ALLOW_REMOTE_BOOTSTRAP=I_UNDERSTAND (não é fronteira de segurança).
//
//   npm run bootstrap -- --username renan --name "Renan" --modality MONTHLY
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  DatabaseSafetyError,
  assertRemoteBootstrapApproved,
  formatDatabaseIdentity,
  isLoopbackHost,
  readDatabaseIdentity,
  requireLocalDatabaseUrl,
} from "../src/domain/db/database-safety";
import { PrismaClient, type PlayerModality } from "../src/generated/prisma/client";
import { generateTemporaryPassword, hashPassword } from "../src/server/auth/password";
import { isValidUsername, normalizeUsername } from "../src/server/auth/validation";

const USAGE = `Uso:
  npm run bootstrap -- --username <usuario> --name "<nome>" --modality MONTHLY|DAILY
                       [--rating 1-5] [--group-name "Pelada"] [--group-slug pelada]
                       [--timezone America/Sao_Paulo] [--allow-remote]
  Remoto também exige SMV_ALLOW_REMOTE_BOOTSTRAP=I_UNDERSTAND no ambiente.`;

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

async function main() {
  const options = parseOptions();

  let connectionString: string;
  if (options.allowRemote) {
    assertRemoteBootstrapApproved(process.env);
    const raw = process.env.DATABASE_URL;
    if (!raw?.trim()) throw new UsageError("DATABASE_URL não definida (veja .env.example).");
    const identity = readDatabaseIdentity(raw);
    if (!identity) throw new UsageError("DATABASE_URL inválida.");
    if (isLoopbackHost(identity.host)) {
      throw new UsageError(
        `--allow-remote com banco loopback (${formatDatabaseIdentity(identity)}). Omita --allow-remote para local pelada_dev.`,
      );
    }
    connectionString = raw;
    console.log(`Bootstrap remoto em ${formatDatabaseIdentity(identity)} (aprovação explícita).`);
  } else {
    connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
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
                priorityDeadlineMinute: 14 * 60,
                priorityReminderDaysBefore: 0,
                priorityReminderMinute: 13 * 60,
                priorityReminderEnabled: true,
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
  if (error instanceof UsageError || error instanceof DatabaseSafetyError) {
    console.error(`Erro: ${error.message}\n\n${USAGE}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
