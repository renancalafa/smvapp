import "server-only";
import type { MemberRole, MemberStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import { releaseMemberFromUpcomingSessions } from "@/server/modules/sessions/service";
import { getMonthlyJoinPolicy } from "./queries";
import type { CreatePlayerInput } from "./validation";

const LAST_ADMIN_MESSAGE =
  "Não é possível rebaixar o último administrador ativo do grupo. Promova outro jogador a ADMIN antes.";

const DUPLICATE_USERNAME = "Já existe uma conta com esse usuário.";

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
