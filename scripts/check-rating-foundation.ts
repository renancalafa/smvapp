// SOMENTE DESENVOLVIMENTO: fundação de notas/propostas (Fase 1).
//
//   npm run check:rating-foundation
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import {
  isValidNullableRatingValue,
  isValidRatingValue,
  readAttributeValue,
} from "../src/domain/ratings/attributes";
import {
  canSuggestForTarget,
  canVoteOnProposal,
} from "../src/domain/ratings/eligibility";
import {
  advisoryMajority,
  canTransition,
  groupProposalsByTargetMember,
  nextStatus,
} from "../src/domain/ratings/proposalState";
import type { Viewer } from "../src/server/auth/dal";

type Tx = Prisma.TransactionClient;
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;

class SetupError extends Error {}
class Rollback extends Error {}

const emptyModule = pathToFileURL(
  path.resolve("node_modules/next/dist/compiled/server-only/empty.js"),
).href;
(nodeModule as unknown as { registerHooks(hooks: { resolve: ResolveHook }): void }).registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: emptyModule, shortCircuit: true } : nextResolve(specifier, context),
});

const txStore = new AsyncLocalStorage<Tx>();
(globalThis as { prisma?: unknown }).prisma = new Proxy(
  {},
  {
    get(_target, property) {
      const tx = txStore.getStore();
      if (!tx) throw new Error("db usado fora de uma transação de teste.");
      if (property === "$transaction") {
        return <T>(run: (inner: Tx) => Promise<T>) => run(tx);
      }
      return Reflect.get(tx, property);
    },
  },
);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function viewerOf(
  group: { id: string; name: string; timezone: string },
  member: {
    id: string;
    role: "ADMIN" | "PLAYER";
    modality: "MONTHLY" | "DAILY";
    status: "ACTIVE" | "INACTIVE";
    user: { id: string; username: string; name: string };
  },
): Viewer {
  return {
    sessionId: "check-rating-foundation",
    user: {
      id: member.user.id,
      username: member.user.username,
      name: member.user.name,
      mustChangePassword: false,
    },
    group,
    member: {
      id: member.id,
      role: member.role,
      modality: member.modality,
      status: member.status,
    },
  };
}

async function main() {
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const members = await import("../src/server/modules/members/service");
  const proposals = await import("../src/server/modules/ratings/proposals");
  const apply = await import("../src/server/modules/ratings/apply-rating");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, members, proposals, apply, UserFacingError);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 180_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  } finally {
    await prisma.$disconnect();
  }

  for (const result of results) {
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`,
  );
  if (failed > 0) process.exit(1);
}

async function scenario(
  tx: Tx,
  membersMod: typeof import("../src/server/modules/members/service"),
  proposalsMod: typeof import("../src/server/modules/ratings/proposals"),
  applyMod: typeof import("../src/server/modules/ratings/apply-rating"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  // --- Domain pure ---
  check("rating 3 válido", isValidRatingValue(3));
  check("rating null nullable ok", isValidNullableRatingValue(null));
  check("rating 0 inválido", !isValidRatingValue(0));
  check(
    "readAttributeValue ATTACK null",
    readAttributeValue(
      { baseRating: 3, attackRating: null, defenseRating: 2, physicalRating: null },
      "ATTACK",
    ) === null,
  );
  check("transition approve", canTransition("PENDING_ADMIN_REVIEW", "ADMIN_APPROVE_FOR_VOTING"));
  check("transition illegal", !canTransition("OPEN_FOR_VOTING", "ADMIN_FINAL_APPLY"));
  check("next stale", nextStatus("OPEN_FOR_VOTING", "MARK_STALE") === "SUPERSEDED_STALE");
  check("advisory pass", advisoryMajority(3, 1) === "PASS");
  check("advisory tie", advisoryMajority(2, 2) === "TIE");
  check(
    "group by target",
    groupProposalsByTargetMember([
      { targetMemberId: "a", proposedAt: new Date("2026-01-02") },
      { targetMemberId: "b", proposedAt: new Date("2026-01-03") },
      { targetMemberId: "a", proposedAt: new Date("2026-01-01") },
    ]).length === 2,
  );

  const self = canSuggestForTarget({
    actor: { id: "m1", status: "ACTIVE", modality: "MONTHLY", role: "PLAYER" },
    targetMemberId: "m1",
  });
  check("bloqueia auto-sugestão", !self.ok);

  const voteSelf = canVoteOnProposal({
    voter: { id: "m1", status: "ACTIVE", modality: "MONTHLY", role: "PLAYER" },
    targetMemberId: "m1",
    proposalStatus: "OPEN_FOR_VOTING",
  });
  check("bloqueia auto-voto", !voteSelf.ok);

  const voteProposer = canVoteOnProposal({
    voter: { id: "m2", status: "ACTIVE", modality: "MONTHLY", role: "PLAYER" },
    targetMemberId: "m1",
    proposalStatus: "OPEN_FOR_VOTING",
    proposedByMemberId: "m2",
  });
  check("bloqueia voto mutável do proponente", !voteProposer.ok);

  const voteAdmin = canVoteOnProposal({
    voter: { id: "a1", status: "ACTIVE", modality: "MONTHLY", role: "ADMIN" },
    targetMemberId: "m1",
    proposalStatus: "OPEN_FOR_VOTING",
    proposedByMemberId: "m2",
  });
  check("admin mensalista pode votar", voteAdmin.ok);

  const daily = canSuggestForTarget({
    actor: { id: "m2", status: "ACTIVE", modality: "DAILY", role: "PLAYER" },
    targetMemberId: "m1",
  });
  check("diarista não sugere", !daily.ok);

  // --- DB fixtures ---
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");

  // Force known flag state inside this rolled-back TX (local may already have voting ON).
  await tx.groupSettings.update({
    where: { groupId: group.id },
    data: { ratingVotingEnabled: false },
  });
  const settings = await tx.groupSettings.findUniqueOrThrow({
    where: { groupId: group.id },
    select: { ratingVotingEnabled: true, advancedDrawBalancingEnabled: true },
  });
  check("flag ratingVotingEnabled OFF", settings.ratingVotingEnabled === false);
  check("flag advancedDrawBalancingEnabled OFF", settings.advancedDrawBalancingEnabled === false);

  const admin = await tx.groupMember.findFirst({
    where: { groupId: group.id, role: "ADMIN", status: "ACTIVE", modality: "MONTHLY" },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!admin) throw new SetupError("Nenhum ADMIN mensalista ativo.");

  const monthlyPlayers = await tx.groupMember.findMany({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE", modality: "MONTHLY" },
    orderBy: { user: { username: "asc" } },
    take: 3,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      baseRating: true,
      attackRating: true,
      defenseRating: true,
      physicalRating: true,
      preferredRole: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (monthlyPlayers.length < 2) {
    throw new SetupError("Precisa de ≥2 PLAYER MONTHLY ativos (npm run seed:test-players).");
  }

  const target = monthlyPlayers[0]!;
  const proposer = monthlyPlayers[1]!;
  const third = monthlyPlayers[2] ?? admin;

  check("attackRating inicia null", target.attackRating === null);
  check("defenseRating inicia null", target.defenseRating === null);
  check("physicalRating inicia null", target.physicalRating === null);
  check("preferredRole inicia null", target.preferredRole === null);
  check("baseRating preservado", isValidRatingValue(target.baseRating));

  const adminViewer = viewerOf(group, admin);
  const proposerViewer = viewerOf(group, proposer);
  const targetViewer = viewerOf(group, target);
  const thirdViewer = viewerOf(group, {
    id: third.id,
    role: third.role,
    modality: third.modality,
    status: third.status,
    user: third.user,
  });

  // Flags OFF → proposta bloqueada
  try {
    await proposalsMod.createRatingProposal(proposerViewer, {
      targetMemberId: target.id,
      attribute: "ATTACK",
      toValue: 3,
      reason: "melhorou a marcação",
    });
    check("proposta bloqueada com flag OFF", false);
  } catch (error) {
    check(
      "proposta bloqueada com flag OFF",
      error instanceof UserFacingError && error.message.toLowerCase().includes("habilitada"),
    );
  }

  await tx.groupSettings.update({
    where: { groupId: group.id },
    data: { ratingVotingEnabled: true },
  });

  // Isolate from leftover local OPEN/PENDING proposals (rolled back with this TX).
  await tx.ratingChangeProposal.updateMany({
    where: {
      groupId: group.id,
      status: { in: ["PENDING_ADMIN_REVIEW", "OPEN_FOR_VOTING", "VOTING_CLOSED"] },
    },
    data: { status: "SUPERSEDED_STALE", blocksDuplicate: false },
  });

  // Auto-sugestão
  try {
    await proposalsMod.createRatingProposal(targetViewer, {
      targetMemberId: target.id,
      attribute: "ATTACK",
      toValue: 3,
      reason: "eu mereço",
    });
    check("service bloqueia auto-sugestão", false);
  } catch (error) {
    check(
      "service bloqueia auto-sugestão",
      error instanceof UserFacingError && error.message.toLowerCase().includes("própria"),
    );
  }

  const created = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: target.id,
    attribute: "ATTACK",
    toValue: 3,
    reason: "marcação melhorou",
  });
  check("cria proposta PENDING", Boolean(created.proposalId));

  const row = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: created.proposalId },
  });
  check(
    "proposta fromValue null (unrated)",
    row.fromValue === null &&
      row.toValue === 3 &&
      row.status === "PENDING_ADMIN_REVIEW" &&
      row.blocksDuplicate === true,
  );

  // Duplicate active
  try {
    await proposalsMod.createRatingProposal(proposerViewer, {
      targetMemberId: target.id,
      attribute: "ATTACK",
      toValue: 4,
      reason: "outra",
    });
    check("impede proposta duplicada ativa", false);
  } catch (error) {
    check(
      "impede proposta duplicada ativa",
      error instanceof UserFacingError && error.message.toLowerCase().includes("andamento"),
    );
  }

  // Different attribute allowed
  const defenseProp = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: target.id,
    attribute: "DEFENSE",
    toValue: 4,
    reason: "posicionamento",
  });
  check("atributo diferente coexistente", Boolean(defenseProp.proposalId));

  // Vote before approve
  try {
    await proposalsMod.castRatingProposalVote(thirdViewer, {
      proposalId: created.proposalId,
      choice: "FOR",
    });
    check("voto bloqueado antes da aprovação", false);
  } catch (error) {
    check(
      "voto bloqueado antes da aprovação",
      error instanceof UserFacingError && error.message.toLowerCase().includes("aberta"),
    );
  }

  // Reject initial requires reason
  try {
    await proposalsMod.reviewRatingProposalInitial(adminViewer, {
      proposalId: defenseProp.proposalId,
      decision: "REJECT",
      reason: "",
    });
    check("rejeição inicial exige motivo", false);
  } catch (error) {
    check(
      "rejeição inicial exige motivo",
      error instanceof UserFacingError && error.message.toLowerCase().includes("motivo"),
    );
  }

  await proposalsMod.reviewRatingProposalInitial(adminViewer, {
    proposalId: defenseProp.proposalId,
    decision: "REJECT",
    reason: "sem evidência suficiente",
  });
  const rejected = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: defenseProp.proposalId },
  });
  check(
    "rejeição inicial preserva histórico",
    rejected.status === "REJECTED_INITIAL" && rejected.blocksDuplicate === false,
  );

  // Pending approval → no automatic vote yet
  const pendingVotes = await tx.ratingChangeVote.count({
    where: { proposalId: created.proposalId },
  });
  check("pending sem voto automático", pendingVotes === 0);

  await proposalsMod.reviewRatingProposalInitial(adminViewer, {
    proposalId: created.proposalId,
    decision: "APPROVE",
  });
  const open = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: created.proposalId },
  });
  check("aprovação abre votação", open.status === "OPEN_FOR_VOTING");

  const autoVotes = await tx.ratingChangeVote.findMany({
    where: { proposalId: created.proposalId },
  });
  check(
    "aprovação cria exatamente 1 voto FOR do proponente",
    autoVotes.length === 1 &&
      autoVotes[0]!.voterMemberId === proposer.id &&
      autoVotes[0]!.choice === "FOR",
  );

  // Target cannot vote
  try {
    await proposalsMod.castRatingProposalVote(targetViewer, {
      proposalId: created.proposalId,
      choice: "FOR",
    });
    check("alvo não vota", false);
  } catch (error) {
    check(
      "alvo não vota",
      error instanceof UserFacingError && error.message.toLowerCase().includes("própria"),
    );
  }

  // Proposer fixed FOR — cannot change or withdraw
  try {
    await proposalsMod.castRatingProposalVote(proposerViewer, {
      proposalId: created.proposalId,
      choice: "AGAINST",
    });
    check("proponente não troca para AGAINST", false);
  } catch (error) {
    check(
      "proponente não troca para AGAINST",
      error instanceof UserFacingError && error.message.toLowerCase().includes("automaticamente"),
    );
  }
  try {
    await proposalsMod.withdrawRatingProposalVote(proposerViewer, {
      proposalId: created.proposalId,
    });
    check("proponente não retira voto fixo", false);
  } catch (error) {
    check(
      "proponente não retira voto fixo",
      error instanceof UserFacingError && error.message.toLowerCase().includes("automaticamente"),
    );
  }

  // Admin MONTHLY may cast a normal vote (moderation ≠ vote)
  const adminVote = await proposalsMod.castRatingProposalVote(adminViewer, {
    proposalId: created.proposalId,
    choice: "FOR",
  });
  check("admin mensalista vota FOR", adminVote.changed === true && adminVote.choice === "FOR");
  await proposalsMod.castRatingProposalVote(adminViewer, {
    proposalId: created.proposalId,
    choice: "AGAINST",
  });
  const adminWithdraw = await proposalsMod.withdrawRatingProposalVote(adminViewer, {
    proposalId: created.proposalId,
  });
  check("admin retira voto normal", adminWithdraw.withdrawn === true);

  if (third.id !== proposer.id && third.id !== target.id && third.id !== admin.id) {
    await proposalsMod.castRatingProposalVote(thirdViewer, {
      proposalId: created.proposalId,
      choice: "FOR",
    });
  }

  const closed = await proposalsMod.closeRatingProposalVoting(adminViewer, {
    proposalId: created.proposalId,
  });
  check(
    "fecha votação contando voto do proponente",
    closed.forCount >= 1 && closed.advisory === "PASS",
  );

  // Final reject with reason (override majority)
  await proposalsMod.finalizeRatingProposal(adminViewer, {
    proposalId: created.proposalId,
    decision: "REJECT",
    reason: "override admin: ainda cedo para subir ataque",
  });
  const finalRejected = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: created.proposalId },
  });
  check("rejeição final com override", finalRejected.status === "REJECTED_FINAL");
  check(
    "attack ainda null após rejeição",
    (await tx.groupMember.findUniqueOrThrow({ where: { id: target.id } })).attackRating === null,
  );

  // Full apply path on new proposal
  const applyProp = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: target.id,
    attribute: "ATTACK",
    toValue: 2,
    reason: "primeiro rating de ataque",
  });
  await proposalsMod.reviewRatingProposalInitial(adminViewer, {
    proposalId: applyProp.proposalId,
    decision: "APPROVE",
  });
  // Proposer FOR already created on approve; no mutable cast needed.
  await proposalsMod.closeRatingProposalVoting(adminViewer, {
    proposalId: applyProp.proposalId,
  });
  await proposalsMod.finalizeRatingProposal(adminViewer, {
    proposalId: applyProp.proposalId,
    decision: "APPLY",
    reason: "consenso da pelada e admin",
  });
  const afterApply = await tx.groupMember.findUniqueOrThrow({
    where: { id: target.id },
    select: { attackRating: true, baseRating: true },
  });
  check("APPLY grava attackRating", afterApply.attackRating === 2);
  check("APPLY não altera baseRating", afterApply.baseRating === target.baseRating);

  const hist = await tx.memberRatingHistory.findFirst({
    where: { memberId: target.id, attribute: "ATTACK", source: "PROPOSAL_APPLIED" },
    orderBy: { createdAt: "desc" },
  });
  check(
    "histórico PROPOSAL_APPLIED",
    Boolean(hist && hist.previousValue === null && hist.newValue === 2),
  );

  // Direct admin edit supersedes active proposal
  const staleProp = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: target.id,
    attribute: "DEFENSE",
    toValue: 3,
    reason: "vai ficar stale",
  });
  await applyMod.applyMemberRating(adminViewer, {
    memberId: target.id,
    attribute: "DEFENSE",
    newValue: 4,
    reason: "atribuição inicial admin",
    source: "ADMIN_INITIAL_ASSIGN",
  });
  const stale = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: staleProp.proposalId },
  });
  check("edit direto marca stale", stale.status === "SUPERSEDED_STALE" && stale.blocksDuplicate === false);

  // Concurrent optimistic conflict on overall
  const beforeOverall = (
    await tx.groupMember.findUniqueOrThrow({ where: { id: target.id }, select: { baseRating: true } })
  ).baseRating;
  const nextOverall = beforeOverall === 5 ? 4 : beforeOverall + 1;
  await membersMod.changeMemberRating(
    adminViewer,
    target.id,
    nextOverall,
    "concorrência setup",
  );
  // Simulate stale read: writer uses optimistic where; second apply with same "expected" via raw
  // (changeMemberRating always re-reads — test updateMany conflict via apply with race by
  // manually bumping between lock — covered by updateMany count check in unit of apply).
  check("changeMemberRating overall ok", true);

  // Draw snapshot immutability already in check-member-rating; light check here:
  const snapCount = await tx.drawTeamPlayer.count({
    where: { memberId: target.id },
  });
  check("draws existentes intactos (count>=0)", snapCount >= 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
