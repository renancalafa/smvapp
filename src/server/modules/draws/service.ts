import "server-only";
import { randomBytes } from "node:crypto";
import {
  DRAW_ALGORITHM_VERSION,
  DrawGenerationError,
  generateDrawOptions,
  planDraw,
  type DrawPlayer,
} from "@/domain/draw/balance";
import { createRng } from "@/domain/draw/random";
import { playerStrength } from "@/domain/draw/strength";
import { isAwaitingKickoff } from "@/domain/match/kickoff";
import type { DrawDecisionMethod, OverflowMode, Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import {
  assertListChangesAllowed,
  LOCKED_SESSION_SELECT,
  participantsFrozen,
  rebalanceLockedSession,
  type LockedSession,
} from "@/server/modules/sessions/engine";
import { withLockedSession } from "@/server/modules/sessions/service";

// Sorteio e votação (PROJECT.md, seções 12 a 17). Todo comando roda com a linha da
// GameSession travada, a mesma trava das inscrições e do início de partida; o índice
// parcial Draw_active_per_session_key garante no banco um único sorteio ativo.
// O sistema gera as opções e abre a votação no mesmo passo (o Draw nasce em VOTING):
// o ADMIN não escolhe opções, e cada refação é uma invalidação com reason no AuditLog.

type Tx = Prisma.TransactionClient;

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

/** Criar, votar, decidir ou invalidar: sessão viva e nenhuma partida iniciada. */
async function assertDrawCommandsAllowed(tx: Tx, session: LockedSession, now: Date): Promise<void> {
  if (session.status === "CANCELLED") throw new UserFacingError("Esta sessão foi cancelada.");
  if (session.status === "FINISHED" || now >= session.endsAt) throw new UserFacingError("Esta sessão já terminou.");
  if (await participantsFrozen(tx, session.id)) {
    throw new UserFacingError("As partidas já começaram: o sorteio não pode mais mudar.");
  }
}

function findActiveDraw(tx: Tx, sessionId: string) {
  return tx.draw.findFirst({
    where: { gameSessionId: sessionId, invalidatedAt: null },
    select: { id: true, status: true, sequence: true, winningOptionId: true, decisionMethod: true },
  });
}

/** Participantes atuais (para o plano do sorteio e para a cópia dos times). */
function loadParticipants(tx: Tx, sessionId: string) {
  return tx.sessionRegistration.findMany({
    where: { gameSessionId: sessionId, status: "PARTICIPANT" },
    select: { id: true, memberId: true, isRotating: true, member: { select: { baseRating: true } } },
  });
}

/** Votam só mensalistas participantes que não foram marcados ausentes (seção 16). */
async function eligibleVoterIds(tx: Tx, sessionId: string): Promise<Set<string>> {
  const rows = await tx.sessionRegistration.findMany({
    where: {
      gameSessionId: sessionId,
      status: "PARTICIPANT",
      modalitySnapshot: "MONTHLY",
      OR: [{ attendance: null }, { attendance: { not: "ABSENT" } }],
    },
    select: { memberId: true },
  });
  return new Set(rows.map((row) => row.memberId));
}

async function createDrawLocked(
  tx: Tx,
  session: LockedSession,
  now: Date,
  input: { actorUserId: string; replacesDrawId: string | null },
): Promise<{ drawId: string; status: "VOTING" | "DECIDED" }> {
  if (!session.priorityClosedAt) {
    throw new UserFacingError("O sorteio só pode ser feito depois do prazo dos mensalistas.");
  }
  const config = await tx.gameSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { drawOptionsCount: true, drawMinOptionDifference: true, birthdayDraft: { select: { status: true } } },
  });
  if (config.birthdayDraft && config.birthdayDraft.status !== "CANCELLED") {
    throw new UserFacingError("Sessões com Panela de Aniversário ainda não têm sorteio automático.");
  }
  if (config.drawOptionsCount > OPTION_LABELS.length) {
    throw new UserFacingError(`No máximo ${OPTION_LABELS.length} opções de sorteio são suportadas.`);
  }

  const participants = await loadParticipants(tx, session.id);
  const plan = planDraw({
    participants: participants.length,
    teamSize: session.teamSize,
    overflowMode: session.overflowMode,
  });
  if (!plan.ok) throw new UserFacingError(plan.error);
  const rotators = plan.rotatorsRequired > 0 ? participants.filter((registration) => registration.isRotating) : [];
  if (rotators.length !== plan.rotatorsRequired) {
    throw new UserFacingError(
      `Marque exatamente ${plan.rotatorsRequired} rotativo(s) antes do sorteio (marcados: ${rotators.length}).`,
    );
  }
  const rotatorIds = new Set(rotators.map((registration) => registration.memberId));
  const toPlayer = (registration: (typeof participants)[number]): DrawPlayer => ({
    id: registration.memberId,
    strength: playerStrength(registration.member),
  });

  const seed = randomBytes(16).toString("hex");
  let generated;
  try {
    generated = generateDrawOptions({
      players: participants.filter((registration) => !rotatorIds.has(registration.memberId)).map(toPlayer),
      teamCount: plan.teamCount,
      teamSize: session.teamSize,
      optionsCount: config.drawOptionsCount,
      minDifference: config.drawMinOptionDifference,
      rng: createRng(seed),
    });
  } catch (error) {
    if (error instanceof DrawGenerationError) throw new UserFacingError(error.message);
    throw error;
  }

  const rotationPool = rotators.map(toPlayer);
  const total = (players: DrawPlayer[]) => players.reduce((sum, player) => sum + player.strength, 0);
  const teamRows = (players: DrawPlayer[]) =>
    players.map((player) => ({ memberId: player.id, strengthSnapshot: player.strength }));

  const last = await tx.draw.findFirst({
    where: { gameSessionId: session.id },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const single = generated.options.length === 1;
  const draw = await tx.draw.create({
    data: {
      gameSessionId: session.id,
      sequence: (last?.sequence ?? 0) + 1,
      status: "VOTING",
      seed,
      algorithmVersion: DRAW_ALGORITHM_VERSION,
      minOptionDifference: config.drawMinOptionDifference,
      optionDistance: generated.optionDistance,
      createdByUserId: input.actorUserId,
      replacesDrawId: input.replacesDrawId,
      options: {
        create: generated.options.map((option, optionIndex) => ({
          label: OPTION_LABELS[optionIndex],
          balanceScore: option.balanceScore,
          teams: {
            create: [
              ...option.teams.map((team, teamIndex) => ({
                position: teamIndex + 1,
                name: `Time ${teamIndex + 1}`,
                kind: "REGULAR" as const,
                strengthTotal: total(team),
                players: { create: teamRows(team) },
              })),
              ...(rotationPool.length > 0
                ? [
                    {
                      position: option.teams.length + 1,
                      name: "Rotativos",
                      kind: "ROTATION_POOL" as const,
                      strengthTotal: total(rotationPool),
                      players: { create: teamRows(rotationPool) },
                    },
                  ]
                : []),
            ],
          },
        })),
      },
    },
    select: { id: true, sequence: true, options: { select: { id: true } } },
  });

  await writeAuditLog(tx, {
    groupId: session.groupId,
    actorUserId: input.actorUserId,
    action: "DRAW_GENERATED",
    entityType: "Draw",
    entityId: draw.id,
    gameSessionId: session.id,
    after: {
      sequence: draw.sequence,
      options: generated.options.length,
      teamCount: plan.teamCount,
      rotators: rotationPool.length,
      optionDistance: generated.optionDistance,
      minOptionDifference: config.drawMinOptionDifference,
      algorithmVersion: DRAW_ALGORITHM_VERSION,
      seed,
      replacesDrawId: input.replacesDrawId,
    },
  });

  if (single) {
    await decideLocked(tx, session, now, {
      drawId: draw.id,
      optionId: draw.options[0].id,
      method: "SINGLE_OPTION",
      actorUserId: input.actorUserId,
    });
    return { drawId: draw.id, status: "DECIDED" };
  }
  return { drawId: draw.id, status: "VOTING" };
}

/**
 * Torna o Draw oficial e cria os times da sessão a partir da opção vencedora. Só quem
 * ainda é PARTICIPANT entra em SessionTeamPlayer; o Draw em si nunca é reescrito.
 */
async function decideLocked(
  tx: Tx,
  session: LockedSession,
  now: Date,
  input: {
    drawId: string;
    optionId: string;
    method: DrawDecisionMethod;
    actorUserId: string;
    reason?: string;
    tally?: Record<string, number>;
  },
): Promise<void> {
  const updated = await tx.draw.updateMany({
    where: { id: input.drawId, invalidatedAt: null, status: { in: ["VOTING", "TIED"] } },
    data: {
      status: "DECIDED",
      winningOptionId: input.optionId,
      decisionMethod: input.method,
      decidedAt: now,
      decidedByUserId: input.actorUserId,
    },
  });
  if (updated.count !== 1) throw new UserFacingError("O sorteio mudou enquanto você decidia. Atualize a página.");
  await tx.draw.updateMany({ where: { id: input.drawId, votingClosedAt: null }, data: { votingClosedAt: now } });

  if ((await tx.sessionTeam.count({ where: { gameSessionId: session.id } })) > 0) {
    throw new UserFacingError("A sessão já tem times definidos. Refaça o sorteio para substituí-los.");
  }
  const participants = new Set((await loadParticipants(tx, session.id)).map((registration) => registration.memberId));
  const teams = await tx.drawTeam.findMany({
    where: { drawOptionId: input.optionId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, name: true, color: true, kind: true, players: { select: { memberId: true } } },
  });
  let skipped = 0;
  for (const team of teams) {
    const members = team.players.map((player) => player.memberId).filter((memberId) => participants.has(memberId));
    skipped += team.players.length - members.length;
    await tx.sessionTeam.create({
      data: {
        gameSessionId: session.id,
        sourceDrawTeamId: team.id,
        origin: "DRAW",
        kind: team.kind,
        name: team.name,
        color: team.color,
        initialQueuePosition: team.kind === "REGULAR" ? team.position : null,
        players: { create: members.map((memberId) => ({ memberId })) },
      },
    });
  }

  const option = await tx.drawOption.findUniqueOrThrow({ where: { id: input.optionId }, select: { label: true } });
  await writeAuditLog(tx, {
    groupId: session.groupId,
    actorUserId: input.actorUserId,
    action: "DRAW_DECIDED",
    entityType: "Draw",
    entityId: input.drawId,
    gameSessionId: session.id,
    after: { status: "DECIDED", winningOption: option.label, decisionMethod: input.method },
    reason: input.reason,
    metadata: { tally: input.tally ?? null, sessionTeams: teams.length, playersNoLongerParticipants: skipped },
  });
}

// ---------------------------------------------------------------------------
// Formação: times fixos x rotativos (16 a 19 participantes)
// ---------------------------------------------------------------------------

async function assertNoActiveDraw(tx: Tx, sessionId: string): Promise<void> {
  if (await findActiveDraw(tx, sessionId)) {
    throw new UserFacingError("Já existe um sorteio ativo. Para mudar a formação, invalide-o antes.");
  }
}

export async function setOverflowMode(viewer: Viewer, sessionId: string, mode: OverflowMode): Promise<void> {
  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertListChangesAllowed(tx, session, now);
    await assertNoActiveDraw(tx, session.id);
    if (!session.priorityClosedAt) {
      throw new UserFacingError("A formação só é escolhida depois do prazo dos mensalistas.");
    }
    if (session.overflowMode === mode) return;
    const participants = await tx.sessionRegistration.count({
      where: { gameSessionId: session.id, status: "PARTICIPANT" },
    });
    const three = session.teamSize * 3;
    const four = session.teamSize * 4;
    if (!session.overflowMode && (participants <= three || participants >= four)) {
      throw new UserFacingError(`A escolha só se aplica com ${three + 1} a ${four - 1} participantes.`);
    }
    const updated = await tx.gameSession.update({
      where: { id: session.id },
      data: { overflowMode: mode, overflowDecidedAt: now, overflowDecidedByUserId: viewer.user.id },
      select: LOCKED_SESSION_SELECT,
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "SESSION_OVERFLOW_MODE_SET",
      entityType: "GameSession",
      entityId: session.id,
      gameSessionId: session.id,
      before: { overflowMode: session.overflowMode },
      after: { overflowMode: mode },
      metadata: { participants },
    });
    // FIXED_TEAMS reduz a capacidade (excedentes voltam à fila); FLEXIBLE a restaura.
    await rebalanceLockedSession(tx, updated, now);
  });
}

export async function setRotating(
  viewer: Viewer,
  sessionId: string,
  registrationId: string,
  rotating: boolean,
): Promise<void> {
  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertListChangesAllowed(tx, session, now);
    await assertNoActiveDraw(tx, session.id);
    if (session.overflowMode !== "FLEXIBLE_ROTATION") {
      throw new UserFacingError("Rotativos só existem na formação com rotativos.");
    }
    const registration = await tx.sessionRegistration.findFirst({
      where: { id: registrationId, gameSessionId: session.id },
      select: { id: true, status: true, isRotating: true },
    });
    if (!registration || registration.status !== "PARTICIPANT") {
      throw new UserFacingError("Só participantes podem ser rotativos.");
    }
    if (registration.isRotating === rotating) return;
    await tx.sessionRegistration.update({
      where: { id: registration.id },
      data: { isRotating: rotating, rotatingSetByUserId: viewer.user.id, rotatingSetAt: now },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "REGISTRATION_ROTATING_SET",
      entityType: "SessionRegistration",
      entityId: registration.id,
      gameSessionId: session.id,
      before: { isRotating: registration.isRotating },
      after: { isRotating: rotating },
    });
  });
}

// ---------------------------------------------------------------------------
// Sorteio
// ---------------------------------------------------------------------------

export async function generateDraw(viewer: Viewer, sessionId: string): Promise<{ status: "VOTING" | "DECIDED" }> {
  return withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertDrawCommandsAllowed(tx, session, now);
    if (await findActiveDraw(tx, session.id)) {
      throw new UserFacingError("Já existe um sorteio ativo. Para refazê-lo, invalide-o com um motivo.");
    }
    // Um sorteio invalidado sem substituto imediato é referenciado pelo próximo.
    const pending = await tx.draw.findFirst({
      where: { gameSessionId: session.id, status: "INVALIDATED", replacedBy: null },
      orderBy: { sequence: "desc" },
      select: { id: true },
    });
    const result = await createDrawLocked(tx, session, now, {
      actorUserId: viewer.user.id,
      replacesDrawId: pending?.id ?? null,
    });
    return { status: result.status };
  });
}

/** Voto único por mensalista participante; pode ser trocado enquanto a votação está aberta. */
export async function castVote(viewer: Viewer, sessionId: string, drawId: string, optionId: string): Promise<void> {
  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertDrawCommandsAllowed(tx, session, now);
    const draw = await findActiveDraw(tx, session.id);
    if (!draw || draw.id !== drawId) throw new UserFacingError("Este sorteio não está mais ativo. Atualize a página.");
    if (draw.status !== "VOTING") throw new UserFacingError("A votação deste sorteio já foi encerrada.");
    const option = await tx.drawOption.findFirst({ where: { id: optionId, drawId }, select: { id: true, label: true } });
    if (!option) throw new UserFacingError("Opção inválida.");
    if (viewer.member.status !== "ACTIVE" || !(await eligibleVoterIds(tx, session.id)).has(viewer.member.id)) {
      throw new UserFacingError("Só mensalistas confirmados nesta sessão podem votar.");
    }

    const existing = await tx.drawVote.findUnique({
      where: { drawId_voterMemberId: { drawId, voterMemberId: viewer.member.id } },
      select: { id: true, drawOptionId: true, drawOption: { select: { label: true } } },
    });
    if (existing?.drawOptionId === option.id) return;
    const vote = existing
      ? await tx.drawVote.update({ where: { id: existing.id }, data: { drawOptionId: option.id }, select: { id: true } })
      : await tx.drawVote.create({
          data: { drawId, drawOptionId: option.id, voterMemberId: viewer.member.id },
          select: { id: true },
        });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "DRAW_VOTE_CAST",
      entityType: "DrawVote",
      entityId: vote.id,
      gameSessionId: session.id,
      before: existing ? { option: existing.drawOption.label } : undefined,
      after: { option: option.label },
    });
  });
}

/**
 * Encerra a votação. Contam os votos de quem ainda é elegível. Maioria simples decide;
 * empate (inclusive sem votos) fica TIED, sem desempate automático.
 */
export async function closeVoting(viewer: Viewer, sessionId: string, drawId: string): Promise<"DECIDED" | "TIED"> {
  return withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertDrawCommandsAllowed(tx, session, now);
    const draw = await findActiveDraw(tx, session.id);
    if (!draw || draw.id !== drawId) throw new UserFacingError("Este sorteio não está mais ativo. Atualize a página.");
    if (draw.status !== "VOTING") throw new UserFacingError("A votação deste sorteio já foi encerrada.");

    const eligible = await eligibleVoterIds(tx, session.id);
    const options = await tx.drawOption.findMany({
      where: { drawId },
      orderBy: { label: "asc" },
      select: { id: true, label: true, votes: { select: { voterMemberId: true } } },
    });
    const tally = Object.fromEntries(
      options.map((option) => [option.label, option.votes.filter((vote) => eligible.has(vote.voterMemberId)).length]),
    );
    const max = Math.max(...Object.values(tally));
    const leaders = options.filter((option) => tally[option.label] === max);

    if (leaders.length === 1 && max > 0) {
      await decideLocked(tx, session, now, {
        drawId,
        optionId: leaders[0].id,
        method: "VOTE",
        actorUserId: viewer.user.id,
        tally,
      });
      return "DECIDED";
    }
    await tx.draw.update({ where: { id: drawId }, data: { status: "TIED", votingClosedAt: now } });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "DRAW_VOTING_CLOSED",
      entityType: "Draw",
      entityId: drawId,
      gameSessionId: session.id,
      before: { status: "VOTING" },
      after: { status: "TIED" },
      metadata: { tally, eligibleVoters: eligible.size },
    });
    return "TIED";
  });
}

/** Empate resolvido fora do sistema; o ADMIN registra a opção escolhida e o motivo. */
export async function resolveTie(
  viewer: Viewer,
  sessionId: string,
  input: { drawId: string; optionId: string; reason: string },
): Promise<void> {
  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertDrawCommandsAllowed(tx, session, now);
    const draw = await findActiveDraw(tx, session.id);
    if (!draw || draw.id !== input.drawId) throw new UserFacingError("Este sorteio não está mais ativo. Atualize a página.");
    if (draw.status !== "TIED") throw new UserFacingError("Só um sorteio empatado é resolvido pelo administrador.");
    const option = await tx.drawOption.findFirst({ where: { id: input.optionId, drawId: draw.id }, select: { id: true } });
    if (!option) throw new UserFacingError("Opção inválida.");
    await decideLocked(tx, session, now, {
      drawId: draw.id,
      optionId: option.id,
      method: "ADMIN_RESOLUTION",
      actorUserId: viewer.user.id,
      reason: input.reason,
    });
  });
}

/**
 * Refação manual (seção 17): invalida o sorteio ativo, preservando opções, times e
 * votos, e apaga os times da sessão (ainda não usados por nenhuma partida). Vagas livres
 * voltam a ser preenchidas pela fila antes do novo sorteio. Com `regenerate`, cria o novo
 * sorteio na mesma transação; se a geração falhar, nada muda.
 */
export async function invalidateDraw(
  viewer: Viewer,
  sessionId: string,
  input: { drawId: string; reason: string; regenerate: boolean },
): Promise<{ newStatus: "VOTING" | "DECIDED" | null }> {
  return withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertDrawCommandsAllowed(tx, session, now);
    const draw = await findActiveDraw(tx, session.id);
    if (!draw || draw.id !== input.drawId) throw new UserFacingError("Este sorteio não está mais ativo. Atualize a página.");

    const sessionTeams = await tx.sessionTeam.findMany({
      where: { gameSessionId: session.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, kind: true, origin: true, players: { select: { memberId: true } } },
    });
    // Partidas só com times confirmados (cronômetro ainda não ligado) podem ser
    // descartadas para liberar os SessionTeam; partidas já apitadas bloqueiam via
    // participantsFrozen acima.
    const awaiting = await tx.match.findMany({
      where: { gameSessionId: session.id, status: "IN_PROGRESS" },
      select: { id: true, status: true, startedAt: true, pausedAt: true, pausedTotalMs: true },
    });
    for (const match of awaiting) {
      if (!isAwaitingKickoff(match)) continue;
      await tx.matchEvent.deleteMany({ where: { matchId: match.id } });
      await tx.matchPlayer.deleteMany({ where: { matchId: match.id } });
      await tx.match.delete({ where: { id: match.id } });
    }
    await tx.sessionTeamPlayer.deleteMany({ where: { gameSessionId: session.id } });
    await tx.sessionTeam.deleteMany({ where: { gameSessionId: session.id } });

    const invalidated = await tx.draw.updateMany({
      where: { id: draw.id, invalidatedAt: null },
      data: {
        status: "INVALIDATED",
        invalidatedAt: now,
        invalidatedByUserId: viewer.user.id,
        invalidationReason: input.reason,
      },
    });
    if (invalidated.count !== 1) throw new UserFacingError("O sorteio mudou enquanto você agia. Atualize a página.");
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "DRAW_INVALIDATED",
      entityType: "Draw",
      entityId: draw.id,
      gameSessionId: session.id,
      before: {
        status: draw.status,
        sequence: draw.sequence,
        winningOptionId: draw.winningOptionId,
        decisionMethod: draw.decisionMethod,
        sessionTeams: sessionTeams.map((team) => ({
          name: team.name,
          kind: team.kind,
          origin: team.origin,
          memberIds: team.players.map((player) => player.memberId),
        })),
      },
      after: { status: "INVALIDATED" },
      reason: input.reason,
      metadata: { regenerate: input.regenerate },
    });
    // Sem sorteio ativo, a fila volta a promover sozinha (seção 11); com `regenerate`, o
    // novo sorteio já inclui quem foi promovido e volta a travar a lista.
    await rebalanceLockedSession(tx, session, now);

    if (!input.regenerate) return { newStatus: null };
    const created = await createDrawLocked(tx, session, now, {
      actorUserId: viewer.user.id,
      replacesDrawId: draw.id,
    });
    return { newStatus: created.status };
  });
}
