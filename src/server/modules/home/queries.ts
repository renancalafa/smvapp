import "server-only";
import { getNightNavMode } from "@/server/modules/nav/night-mode";
import { getRodadaRecap, type RodadaRecap } from "@/server/modules/rodada/queries";
import { getPlayerProfileStats } from "@/server/modules/stats/queries";
import { db } from "@/server/db";
import { selectLatestFinishedSession } from "@/domain/nav/night-mode";

export type HomePlayerSummary = {
  memberId: string;
  name: string;
  nickname: string | null;
  modality: "MONTHLY" | "DAILY";
  role: "ADMIN" | "PLAYER";
  /** Sessões FINISHED em que o jogador foi PARTICIPANT. */
  presencas: number;
  goals: number;
  assists: number;
};

export type HomeDashboard = {
  player: HomePlayerSummary;
  lastSession: RodadaRecap | null;
};

async function latestFinishedSessionId(groupId: string): Promise<string | null> {
  const mode = await getNightNavMode(groupId);
  if (mode.kind === "rodada") return mode.finishedSessionId;

  // Em Ao Vivo, ainda mostramos a última pelada encerrada (se houver).
  const sessions = await db.gameSession.findMany({
    where: { groupId },
    select: { id: true, status: true, startsAt: true, finishedAt: true },
  });
  const latest = selectLatestFinishedSession(
    sessions.map((session) => ({
      id: session.id,
      status: session.status,
      startsAtMs: session.startsAt.getTime(),
      finishedAtMs: session.finishedAt?.getTime() ?? null,
    })),
  );
  return latest?.id ?? null;
}

/** Dados compactos da home: resumo do jogador + preview da última pelada. */
export async function getHomeDashboard(input: {
  groupId: string;
  memberId: string;
  timeZone: string;
  modality: "MONTHLY" | "DAILY";
  role: "ADMIN" | "PLAYER";
}): Promise<HomeDashboard> {
  const [profile, presencas, finishedSessionId] = await Promise.all([
    getPlayerProfileStats(input.groupId, input.memberId, input.timeZone, { kind: "all" }),
    db.sessionRegistration.count({
      where: {
        memberId: input.memberId,
        status: "PARTICIPANT",
        gameSession: { groupId: input.groupId, status: "FINISHED" },
      },
    }),
    latestFinishedSessionId(input.groupId),
  ]);

  const lastSession =
    finishedSessionId != null ? await getRodadaRecap(input.groupId, finishedSessionId) : null;

  return {
    player: {
      memberId: input.memberId,
      name: profile?.player.name ?? "",
      nickname: profile?.player.nickname ?? null,
      modality: input.modality,
      role: input.role,
      presencas,
      goals: profile?.totals.goals ?? 0,
      assists: profile?.totals.assists ?? 0,
    },
    lastSession,
  };
}
