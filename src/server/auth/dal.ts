import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { MemberRole, MemberStatus, PlayerModality } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getCurrentGroup } from "@/server/group";
import { readSessionToken, validateSessionToken } from "./session";

export type Viewer = {
  sessionId: string;
  user: { id: string; username: string; name: string; mustChangePassword: boolean };
  group: { id: string; name: string; timezone: string };
  member: { id: string; role: MemberRole; modality: PlayerModality; status: MemberStatus };
};

/**
 * Usuário da requisição, ou null. Exige sessão válida e vínculo com o Group atual
 * (qualquer status: membro INACTIVE ainda entra). Memoizado por requisição.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  const session = await validateSessionToken(token);
  if (!session) return null;
  const group = await getCurrentGroup();
  if (!group) return null;
  const member = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId: session.user.id } },
    select: { id: true, role: true, modality: true, status: true },
  });
  if (!member) return null;
  return {
    sessionId: session.sessionId,
    user: session.user,
    group: { id: group.id, name: group.name, timezone: group.timezone },
    member,
  };
});

/** Para a tela de troca de senha: exige login, mas aceita senha temporária. */
export async function requireViewerAllowingPasswordChange(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/**
 * Exigido em toda página e Server Action protegida (o layout sozinho não basta).
 * Senha temporária leva à troca obrigatória.
 */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await requireViewerAllowingPasswordChange();
  if (viewer.user.mustChangePassword) redirect("/change-password");
  return viewer;
}

/** Páginas de ADMIN: para os demais, a rota não existe. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.member.role !== "ADMIN") notFound();
  return viewer;
}

/** Server Actions de ADMIN: falha explícita em vez de 404. */
export async function requireAdminAction(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.member.role !== "ADMIN") throw new Error("Acesso restrito a administradores.");
  return viewer;
}
