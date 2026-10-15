// SOMENTE DESENVOLVIMENTO: cria jogadores de teste com senha conhecida e, com --confirm,
// confirma-os na próxima sessão com a lista aberta. Recusa bancos fora de localhost.
// Pode ser executado de novo: usuários existentes são ignorados.
//
//   npm run seed:test-players
//   npm run seed:test-players -- --count 20 --monthly 12 --confirm
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { allocate, type QueueEntry } from "../src/domain/presence/allocate";
import { PrismaClient, type PlayerModality } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { isValidUsername, normalizeUsername, PASSWORD_MIN_LENGTH } from "../src/server/auth/validation";

const USAGE = `Uso:
  npm run seed:test-players -- [--count 20] [--monthly 12] [--prefix teste]
                               [--password teste1234] [--confirm]`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SOURCE = "scripts/seed-test-players.ts";
// Notas variadas (1 a 5) para o sorteio ter o que equilibrar.
const RATINGS = [3, 4, 2, 5, 3, 1, 4, 3, 2, 5, 3, 4, 1, 3, 2, 4, 5, 3, 2, 3];

class UsageError extends Error {}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      count: { type: "string", default: "20" },
      monthly: { type: "string", default: "12" },
      prefix: { type: "string", default: "teste" },
      password: { type: "string", default: "teste1234" },
      confirm: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new UsageError("--count: inteiro de 1 a 99.");
  const monthly = Number(values.monthly);
  if (!Number.isInteger(monthly) || monthly < 0 || monthly > count) {
    throw new UsageError("--monthly: inteiro de 0 até --count.");
  }
  const prefix = normalizeUsername(values.prefix);
  if (!isValidUsername(`${prefix}00`)) throw new UsageError("--prefix: letras minúsculas, números, ponto, hífen ou sublinhado.");
  if (values.password.length < PASSWORD_MIN_LENGTH) {
    throw new UsageError(`--password: pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  return { count, monthly, prefix, password: values.password, confirm: values.confirm };
}

type Prisma = PrismaClient;

async function createPlayers(prisma: Prisma, groupId: string, options: ReturnType<typeof parseOptions>) {
  const passwordHash = await hashPassword(options.password);
  const memberIds: string[] = [];
  let created = 0;
  for (let i = 1; i <= options.count; i++) {
    const number = String(i).padStart(2, "0");
    const username = `${options.prefix}${number}`;
    const existing = await prisma.user.findUnique({
      where: { username },
      select: { memberships: { where: { groupId }, select: { id: true } } },
    });
    if (existing) {
      if (existing.memberships[0]) memberIds.push(existing.memberships[0].id);
      continue;
    }
    const modality: PlayerModality = i <= options.monthly ? "MONTHLY" : "DAILY";
    const baseRating = RATINGS[(i - 1) % RATINGS.length];
    const memberId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { username, name: `Teste ${number}`, passwordHash, mustChangePassword: false },
        select: { id: true },
      });
      const member = await tx.groupMember.create({
        data: { groupId, userId: user.id, role: "PLAYER", modality, baseRating },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          groupId,
          actorType: "SYSTEM",
          action: "MEMBER_CREATED",
          entityType: "GroupMember",
          entityId: member.id,
          after: { userId: user.id, username, role: "PLAYER", modality, baseRating, status: "ACTIVE" },
          metadata: { source: SOURCE },
        },
      });
      return member.id;
    });
    memberIds.push(memberId);
    created++;
  }
  return { memberIds, created };
}

/**
 * Confirma os jogadores na próxima sessão com a lista aberta, na ordem do número, com as
 * mesmas regras do app: prioridade dos mensalistas até o prazo, capacidade efetiva e
 * lista de espera (função allocate), com a linha da sessão travada.
 */
async function confirmPlayers(prisma: Prisma, groupId: string, memberIds: string[]) {
  const now = new Date();
  const session = await prisma.gameSession.findFirst({
    where: { groupId, status: { notIn: ["CANCELLED", "FINISHED"] }, endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: { id: true, registrationOpensAt: true },
  });
  if (!session) throw new UsageError("Nenhuma sessão futura. Abra o app uma vez para criá-la.");
  if (session.registrationOpensAt > now) {
    throw new UsageError(
      "A lista da próxima sessão ainda não abriu. Coloque registrationOpensAt no passado (Prisma Studio) e abra o app.",
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "GameSession" WHERE "id" = ${session.id}::uuid FOR UPDATE`;
    const locked = await tx.gameSession.findUniqueOrThrow({
      where: { id: session.id },
      select: {
        status: true,
        maxPlayers: true,
        teamSize: true,
        overflowMode: true,
        priorityDeadlineAt: true,
        priorityClosedAt: true,
        _count: { select: { matches: true } },
      },
    });
    if (locked.status === "SCHEDULED") {
      throw new UsageError("A sessão ainda está SCHEDULED. Abra o app uma vez para a lista abrir.");
    }
    if (locked._count.matches > 0) throw new UsageError("A sessão já tem partidas: a lista está congelada.");
    const phase = locked.priorityClosedAt || now >= locked.priorityDeadlineAt ? "GENERAL" : "PRIORITY";
    const capacity = locked.overflowMode === "FIXED_TEAMS" ? locked.teamSize * 3 : locked.maxPlayers;

    const members = await tx.groupMember.findMany({
      where: { id: { in: memberIds }, status: "ACTIVE" },
      select: { id: true, modality: true },
    });
    const modalityOf = new Map(members.map((member) => [member.id, member.modality]));
    const registered = new Set(
      (
        await tx.sessionRegistration.findMany({
          where: { gameSessionId: session.id, memberId: { in: memberIds } },
          select: { memberId: true },
        })
      ).map((registration) => registration.memberId),
    );

    let added = 0;
    for (const [index, memberId] of memberIds.entries()) {
      const modality = modalityOf.get(memberId);
      if (!modality || registered.has(memberId)) continue;
      const queuedAt = new Date(now.getTime() + index);
      const priorityTier = modality === "MONTHLY" && phase === "PRIORITY" ? "MONTHLY_PRIORITY" : "GENERAL";
      const registration = await tx.sessionRegistration.create({
        data: {
          gameSessionId: session.id,
          memberId,
          status: "WAITLISTED",
          queuedAt,
          queueSortAt: queuedAt,
          priorityTier,
          modalitySnapshot: modality,
          source: "SYSTEM",
          respondedAt: queuedAt,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          groupId,
          actorType: "SYSTEM",
          action: "REGISTRATION_CONFIRMED",
          entityType: "SessionRegistration",
          entityId: registration.id,
          gameSessionId: session.id,
          after: { priorityTier, queuedAt: queuedAt.toISOString() },
          metadata: { source: SOURCE },
        },
      });
      added++;
    }

    const queued = await tx.sessionRegistration.findMany({
      where: { gameSessionId: session.id, status: { in: ["PARTICIPANT", "WAITLISTED"] } },
      select: { id: true, status: true, priorityTier: true, queueSortAt: true, manualOverrideAt: true },
    });
    const entries: QueueEntry[] = queued.map((registration) => ({
      id: registration.id,
      status: registration.status as QueueEntry["status"],
      priorityTier: registration.priorityTier ?? "GENERAL",
      queueSortAt: registration.queueSortAt ?? now,
      manualOverride: registration.manualOverrideAt !== null,
    }));
    const { promote, demote } = allocate(entries, capacity, phase);
    if (promote.length > 0) {
      await tx.sessionRegistration.updateMany({ where: { id: { in: promote } }, data: { status: "PARTICIPANT" } });
    }
    if (demote.length > 0) {
      await tx.sessionRegistration.updateMany({ where: { id: { in: demote } }, data: { status: "WAITLISTED" } });
    }
    const participants = await tx.sessionRegistration.count({
      where: { gameSessionId: session.id, status: "PARTICIPANT" },
    });
    const waitlisted = await tx.sessionRegistration.count({
      where: { gameSessionId: session.id, status: "WAITLISTED" },
    });
    return { added, participants, waitlisted, capacity, phase };
  });
}

async function main() {
  const options = parseOptions();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new UsageError("DATABASE_URL não definida (veja .env.example).");
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new UsageError("DATABASE_URL inválida.");
  }
  if (!LOCAL_HOSTS.has(host)) throw new UsageError(`Recusado: banco em host não local (${host}). Só para desenvolvimento.`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const group = await prisma.group.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
    if (!group) throw new UsageError("Nenhum Group. Rode o bootstrap primeiro.");

    const { memberIds, created } = await createPlayers(prisma, group.id, options);
    console.log(`Group "${group.name}": ${created} jogador(es) criado(s), ${memberIds.length - created} já existia(m).`);
    console.log(
      `Login: ${options.prefix}01 … ${options.prefix}${String(options.count).padStart(2, "0")} · senha: ${options.password}`,
    );
    console.log(`Mensalistas: ${options.prefix}01 … ${options.prefix}${String(options.monthly).padStart(2, "0")}; os demais são diaristas.`);

    if (options.confirm) {
      const result = await confirmPlayers(prisma, group.id, memberIds);
      console.log(
        `Próxima sessão (${result.phase === "PRIORITY" ? "prioridade dos mensalistas" : "lista geral"}): ` +
          `${result.added} confirmado(s) agora · ${result.participants}/${result.capacity} participantes · ` +
          `${result.waitlisted} na espera.`,
      );
    }
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
