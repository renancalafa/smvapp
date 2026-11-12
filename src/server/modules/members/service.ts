import "server-only";
import type { MemberRole, MemberStatus, PlayerModality } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import { releaseMemberFromUpcomingSessions } from "@/server/modules/sessions/service";
import { getMonthlyJoinPolicy } from "./queries";
import type { CreatePlayerInput, OwnProfileInput } from "./validation";

const LAST_ADMIN_MESSAGE =
  "Não é possível rebaixar o último administrador ativo do grupo. Promova outro jogador a ADMIN antes.";

const DUPLICATE_USERNAME = "Já existe uma conta com esse usuário.";
const DUPLICATE_EMAIL = "Já existe uma conta com esse email.";

export type CreatedPlayer = {
  memberId: string;
  name: string;
  username: string;
  temporaryPassword: string;
};

/** Cria User + GroupMember PLAYER com senha temporária (troca obrigatória no 1º login). */
export async function createPlayer(viewer: Viewer, input: CreatePlayerInput): Promise<CreatedPlayer> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    return await db.$transaction(async (tx) => {
      if (input.modality === "MONTHLY") {
        const policy = await getMonthlyJoinPolicy(tx, viewer.group);
        if (!policy.allowed) throw new UserFacingError(policy.reason);
      }
      const existing = await tx.user.findUnique({ where: { username: input.username }, select: { id: true } });
      if (existing) throw new UserFacingError(DUPLICATE_USERNAME);

      const user = await tx.user.create({
        data: {
          username: input.username,
          name: input.name,
          birthDate: input.birthDate,
          passwordHash,
          mustChangePassword: true,
          createdByUserId: viewer.user.id,
        },
        select: { id: true },
      });
      const member = await tx.groupMember.create({
        data: {
          groupId: viewer.group.id,
          userId: user.id,
          role: "PLAYER",
          modality: input.modality,
          baseRating: input.baseRating,
          nickname: input.nickname,
        },
        select: { id: true },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MEMBER_CREATED",
        entityType: "GroupMember",
        entityId: member.id,
        after: {
          userId: user.id,
          username: input.username,
          name: input.name,
          nickname: input.nickname,
          birthDate: input.birthDate?.toISOString().slice(0, 10) ?? null,
          role: "PLAYER",
          modality: input.modality,
          baseRating: input.baseRating,
          status: "ACTIVE",
        },
      });
      return { memberId: member.id, name: input.name, username: input.username, temporaryPassword };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserFacingError(DUPLICATE_USERNAME);
    }
    throw error;
  }
}

/** Só PLAYER do próprio grupo: contas ADMIN não são alteradas por estas ações. */
async function findManagedPlayer(tx: Prisma.TransactionClient, viewer: Viewer, memberId: string) {
  const member = await tx.groupMember.findFirst({
    where: { id: memberId, groupId: viewer.group.id },
    select: { id: true, role: true, status: true, modality: true, userId: true },
  });
  if (!member) throw new UserFacingError("Jogador não encontrado.");
  if (member.role !== "PLAYER") throw new UserFacingError("Contas de administrador não são alteradas aqui.");
  return member;
}

/**
 * Ativa ou desativa a participação do jogador no grupo. O login continua permitido
 * (conta desativada é outro conceito: User.disabledAt).
 * - Desativar tira o jogador das sessões futuras ainda abertas a mudanças.
 * - Reativar mensalista segue a mesma janela de entrada de novos mensalistas.
 */
export async function setMemberStatus(
  viewer: Viewer,
  memberId: string,
  status: MemberStatus,
): Promise<{ changed: boolean; releasedSessions: number }> {
  return db.$transaction(async (tx) => {
    const member = await findManagedPlayer(tx, viewer, memberId);
    if (member.status === status) return { changed: false, releasedSessions: 0 };

    if (status === "ACTIVE" && member.modality === "MONTHLY") {
      const policy = await getMonthlyJoinPolicy(tx, viewer.group);
      if (!policy.allowed) throw new UserFacingError(policy.reason);
    }

    const updated = await tx.groupMember.updateMany({
      where: { id: member.id, status: member.status },
      data: { status },
    });
    if (updated.count !== 1) throw new UserFacingError("O jogador foi alterado por outra pessoa. Recarregue a página.");

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: status === "INACTIVE" ? "MEMBER_DEACTIVATED" : "MEMBER_REACTIVATED",
      entityType: "GroupMember",
      entityId: member.id,
      before: { status: member.status },
      after: { status },
    });

    const releasedSessions =
      status === "INACTIVE"
        ? await releaseMemberFromUpcomingSessions(tx, {
            groupId: viewer.group.id,
            memberId: member.id,
            actorUserId: viewer.user.id,
            reason: "Jogador desativado",
          })
        : 0;
    return { changed: true, releasedSessions };
  });
}

/**
 * Promove PLAYER → ADMIN ou rebaixa ADMIN → PLAYER.
 * Não altera modalidade, nota, status, presença, financeiro nem histórico.
 * O papel é lido do banco a cada request (DAL): a mudança vale no próximo request autenticado.
 * Rebaixar o último ADMIN ativo é bloqueado com trava FOR UPDATE + contagem na mesma transação.
 */
export async function changeMemberRole(
  viewer: Viewer,
  memberId: string,
  newRole: MemberRole,
): Promise<{ previousRole: MemberRole; newRole: MemberRole }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (newRole !== "ADMIN" && newRole !== "PLAYER") {
    throw new UserFacingError("Papel inválido.");
  }

  return db.$transaction(
    async (tx) => {
      const member = await tx.groupMember.findFirst({
        where: { id: memberId, groupId: viewer.group.id },
        select: {
          id: true,
          role: true,
          status: true,
          userId: true,
          user: { select: { username: true, name: true } },
        },
      });
      if (!member) throw new UserFacingError("Jogador não encontrado.");
      if (member.role === newRole) {
        return { previousRole: member.role, newRole };
      }

      if (newRole === "PLAYER" && member.role === "ADMIN") {
        // Serializa demotions concorrentes: trava todas as linhas ADMIN do grupo.
        await tx.$queryRaw`
          SELECT "id" FROM "GroupMember"
          WHERE "groupId" = ${viewer.group.id}::uuid AND role = 'ADMIN'
          FOR UPDATE`;

        if (member.status === "ACTIVE") {
          const otherActiveAdmins = await tx.groupMember.count({
            where: {
              groupId: viewer.group.id,
              role: "ADMIN",
              status: "ACTIVE",
              id: { not: member.id },
            },
          });
          if (otherActiveAdmins < 1) throw new UserFacingError(LAST_ADMIN_MESSAGE);
        }
      }

      const updated = await tx.groupMember.updateMany({
        where: { id: member.id, role: member.role },
        data: { role: newRole },
      });
      if (updated.count !== 1) {
        throw new UserFacingError("O jogador foi alterado por outra pessoa. Recarregue a página.");
      }

      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MEMBER_ROLE_CHANGED",
        entityType: "GroupMember",
        entityId: member.id,
        before: { role: member.role },
        after: { role: newRole },
        metadata: {
          targetUserId: member.userId,
          targetUsername: member.user.username,
          targetName: member.user.name,
          actorUsername: viewer.user.username,
        },
      });

      return { previousRole: member.role, newRole };
    },
    { isolationLevel: "Serializable" },
  );
}

/**
 * Promove diarista ACTIVE → mensalista (DAILY → MONTHLY).
 * Não altera papel, isenção, sessões existentes (snapshots/priorityTier/fila) nem financeiro.
 * Confirmações futuras leem GroupMember.modality e aplicam prioridade de mensalista.
 * Reusa getMonthlyJoinPolicy (bloqueio pós-implantação até existir LATE_JOIN).
 */
export async function promoteMemberToMonthly(
  viewer: Viewer,
  memberId: string,
): Promise<{ previousModality: PlayerModality; newModality: PlayerModality }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }

  return db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "GroupMember"
        WHERE "id" = ${memberId}::uuid AND "groupId" = ${viewer.group.id}::uuid
        FOR UPDATE`;
      if (locked.length === 0) throw new UserFacingError("Jogador não encontrado.");

      const member = await tx.groupMember.findUniqueOrThrow({
        where: { id: memberId },
        select: {
          id: true,
          modality: true,
          status: true,
          role: true,
          feeExempt: true,
          userId: true,
          user: { select: { username: true, name: true } },
        },
      });

      if (member.modality === "MONTHLY") {
        throw new UserFacingError("Este jogador já é mensalista.");
      }
      if (member.status !== "ACTIVE") {
        throw new UserFacingError("Só é possível promover diaristas ativos.");
      }
      if (member.modality !== "DAILY") {
        throw new UserFacingError("Só diaristas podem ser promovidos a mensalista.");
      }

      const policy = await getMonthlyJoinPolicy(tx, viewer.group);
      if (!policy.allowed) throw new UserFacingError(policy.reason);

      const updated = await tx.groupMember.updateMany({
        where: { id: member.id, modality: "DAILY", status: "ACTIVE" },
        data: { modality: "MONTHLY" },
      });
      if (updated.count !== 1) {
        throw new UserFacingError("O jogador foi alterado por outra pessoa. Recarregue a página.");
      }

      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MEMBER_MODALITY_CHANGED",
        entityType: "GroupMember",
        entityId: member.id,
        before: { modality: "DAILY" },
        after: { modality: "MONTHLY" },
        metadata: {
          targetUserId: member.userId,
          targetUsername: member.user.username,
          targetName: member.user.name,
          actorUsername: viewer.user.username,
          role: member.role,
          status: member.status,
          feeExempt: member.feeExempt,
        },
      });

      return { previousModality: "DAILY", newModality: "MONTHLY" };
    },
    { isolationLevel: "Serializable" },
  );
}

/**
 * Altera a nota base (1–5) de qualquer membro do grupo.
 * Só ADMIN; não recalcula sorteios/times existentes (eles usam strengthSnapshot).
 * Sorteios futuros leem GroupMember.baseRating no momento da geração.
 */
export async function changeMemberRating(
  viewer: Viewer,
  memberId: string,
  newRating: number,
): Promise<{ previousRating: number; newRating: number }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (!Number.isInteger(newRating) || newRating < 1 || newRating > 5) {
    throw new UserFacingError("A nota base deve ser um inteiro de 1 a 5.");
  }

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "GroupMember"
      WHERE "id" = ${memberId}::uuid AND "groupId" = ${viewer.group.id}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw new UserFacingError("Jogador não encontrado.");

    const member = await tx.groupMember.findUniqueOrThrow({
      where: { id: memberId },
      select: {
        id: true,
        baseRating: true,
        role: true,
        modality: true,
        status: true,
        userId: true,
        user: { select: { username: true, name: true } },
      },
    });

    if (member.baseRating === newRating) {
      return { previousRating: member.baseRating, newRating };
    }

    const updated = await tx.groupMember.updateMany({
      where: { id: member.id, baseRating: member.baseRating },
      data: { baseRating: newRating },
    });
    if (updated.count !== 1) {
      throw new UserFacingError("O jogador foi alterado por outra pessoa. Recarregue a página.");
    }

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "MEMBER_RATING_CHANGED",
      entityType: "GroupMember",
      entityId: member.id,
      before: { baseRating: member.baseRating },
      after: { baseRating: newRating },
      metadata: {
        targetUserId: member.userId,
        targetUsername: member.user.username,
        targetName: member.user.name,
        actorUsername: viewer.user.username,
        role: member.role,
        modality: member.modality,
        status: member.status,
      },
    });

    return { previousRating: member.baseRating, newRating };
  });
}

/**
 * Atualiza só nome (User), apelido (GroupMember atual) e email (User) do próprio viewer.
 * Não altera username, papel, modalidade, nota, status, financeiro nem sessões de login.
 */
export async function updateOwnProfile(viewer: Viewer, input: OwnProfileInput): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      const member = await tx.groupMember.findFirst({
        where: { id: viewer.member.id, groupId: viewer.group.id, userId: viewer.user.id },
        select: {
          id: true,
          nickname: true,
          role: true,
          modality: true,
          status: true,
          baseRating: true,
          user: { select: { id: true, name: true, email: true, username: true } },
        },
      });
      if (!member) throw new UserFacingError("Conta não encontrada.");

      const before = {
        name: member.user.name,
        nickname: member.nickname,
        email: member.user.email,
      };
      const after = {
        name: input.name,
        nickname: input.nickname,
        email: input.email,
      };
      if (
        before.name === after.name &&
        before.nickname === after.nickname &&
        before.email === after.email
      ) {
        return;
      }

      await tx.user.update({
        where: { id: member.user.id },
        data: { name: input.name, email: input.email },
      });
      await tx.groupMember.update({
        where: { id: member.id },
        data: { nickname: input.nickname },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "USER_PROFILE_UPDATED",
        entityType: "User",
        entityId: member.user.id,
        before,
        after,
        metadata: {
          memberId: member.id,
          username: member.user.username,
          role: member.role,
          modality: member.modality,
          status: member.status,
          baseRating: member.baseRating,
        },
      });
    });
  } catch (error) {
    // Só email é único e mutável neste comando; P2002 aqui é quase sempre email.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserFacingError(DUPLICATE_EMAIL);
    }
    throw error;
  }
}

/** Nova senha temporária, troca obrigatória e revogação de todas as sessões (seção 2). */
export async function resetPlayerPassword(viewer: Viewer, memberId: string): Promise<string> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await db.$transaction(async (tx) => {
    const member = await findManagedPlayer(tx, viewer, memberId);
    await tx.user.update({
      where: { id: member.userId },
      data: { passwordHash, mustChangePassword: true },
    });
    const revoked = await tx.authSession.updateMany({
      where: { userId: member.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "PASSWORD_RESET",
      entityType: "User",
      entityId: member.userId,
      metadata: { memberId: member.id, revokedSessions: revoked.count },
    });
  });
  return temporaryPassword;
}
