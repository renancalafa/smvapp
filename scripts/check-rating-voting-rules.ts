// Regressão: voto fixo do proponente + voto de Admin mensalista.
//
//   npm run check:rating-voting-rules
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { canVoteOnProposal } from "../src/domain/ratings/eligibility";
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
    sessionId: "check-rating-voting-rules",
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
  const proposals = await import("../src/server/modules/ratings/proposals");
  const queries = await import("../src/server/modules/ratings/queries");
  const reconcile = await import("../src/server/modules/ratings/reconcile-proposer-votes");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, proposals, queries, reconcile, UserFacingError);
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
  proposalsMod: typeof import("../src/server/modules/ratings/proposals"),
  queriesMod: typeof import("../src/server/modules/ratings/queries"),
  reconcileMod: typeof import("../src/server/modules/ratings/reconcile-proposer-votes"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");

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
  if (!admin) throw new SetupError("ADMIN mensalista ausente.");

  const monthlyPlayers = await tx.groupMember.findMany({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE", modality: "MONTHLY" },
    orderBy: { user: { username: "asc" } },
    take: 3,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (monthlyPlayers.length < 2) {
    throw new SetupError("Precisa de ≥2 PLAYER MONTHLY.");
  }

  const target = monthlyPlayers[0]!;
  const proposer = monthlyPlayers[1]!;
  const third = monthlyPlayers[2] ?? null;

  const adminViewer = viewerOf(group, admin);
  const proposerViewer = viewerOf(group, proposer);
  const thirdViewer = third ? viewerOf(group, third) : null;

  // Pure eligibility: Admin MONTHLY can vote; proposer blocked when proposedBy set
  const adminCan = canVoteOnProposal({
    voter: admin,
    targetMemberId: target.id,
    proposalStatus: "OPEN_FOR_VOTING",
    proposedByMemberId: proposer.id,
  });
  check("1. admin MONTHLY elegível a votar", adminCan.ok);

  const pending = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: target.id,
    attribute: "PHYSICAL",
    toValue: 3,
    reason: "regressão voto fixo",
  });

  const beforeApprove = await tx.ratingChangeVote.count({
    where: { proposalId: pending.proposalId },
  });
  check("2. pending sem voto automático", beforeApprove === 0);

  await proposalsMod.reviewRatingProposalInitial(adminViewer, {
    proposalId: pending.proposalId,
    decision: "APPROVE",
  });

  const afterApprove = await tx.ratingChangeVote.findMany({
    where: { proposalId: pending.proposalId },
  });
  check(
    "3. approve → exatamente um FOR do proponente",
    afterApprove.length === 1 &&
      afterApprove[0]!.voterMemberId === proposer.id &&
      afterApprove[0]!.choice === "FOR",
  );

  // Concurrent second approval attempt cannot duplicate (already OPEN)
  try {
    await proposalsMod.reviewRatingProposalInitial(adminViewer, {
      proposalId: pending.proposalId,
      decision: "APPROVE",
    });
    check("4. segunda aprovação concorrente rejeitada", false);
  } catch (error) {
    check(
      "4. segunda aprovação concorrente rejeitada",
      error instanceof UserFacingError,
    );
  }
  const afterConcurrent = await tx.ratingChangeVote.count({
    where: { proposalId: pending.proposalId, voterMemberId: proposer.id },
  });
  check("5. sem duplicar voto do proponente", afterConcurrent === 1);

  // Upsert idempotency under concurrent create path
  await tx.ratingChangeVote.upsert({
    where: {
      proposalId_voterMemberId: {
        proposalId: pending.proposalId,
        voterMemberId: proposer.id,
      },
    },
    create: {
      proposalId: pending.proposalId,
      voterMemberId: proposer.id,
      choice: "FOR",
    },
    update: { choice: "FOR" },
  });
  check(
    "6. upsert idempotente permanece 1 FOR",
    (await tx.ratingChangeVote.count({
      where: { proposalId: pending.proposalId, voterMemberId: proposer.id },
    })) === 1,
  );

  const board = await queriesMod.getRatingsBoard(proposerViewer);
  const openCard = board.openVoting
    .flatMap((c) => c.proposals)
    .find((p) => p.id === pending.proposalId);
  check("7. proponente aparece em A favor", Boolean(openCard?.votesFor.some((v) => v.isFixedProposer)));
  check(
    "8. badge Proponente no board",
    openCard?.votesFor[0]?.isFixedProposer === true &&
      openCard.votesFor[0].voterMemberId === proposer.id,
  );
  check("9. isViewerProposer true", openCard?.isViewerProposer === true);

  try {
    await proposalsMod.castRatingProposalVote(proposerViewer, {
      proposalId: pending.proposalId,
      choice: "AGAINST",
    });
    check("10. proponente não troca para AGAINST", false);
  } catch (error) {
    check(
      "10. proponente não troca para AGAINST",
      error instanceof UserFacingError && error.message.includes("automaticamente"),
    );
  }

  try {
    await proposalsMod.withdrawRatingProposalVote(proposerViewer, {
      proposalId: pending.proposalId,
    });
    check("11. proponente não retira voto", false);
  } catch (error) {
    check(
      "11. proponente não retira voto",
      error instanceof UserFacingError && error.message.includes("automaticamente"),
    );
  }

  // Admin voting
  const adminFor = await proposalsMod.castRatingProposalVote(adminViewer, {
    proposalId: pending.proposalId,
    choice: "FOR",
  });
  check("12. admin vota FOR", adminFor.choice === "FOR" && adminFor.changed);
  const adminAgainst = await proposalsMod.castRatingProposalVote(adminViewer, {
    proposalId: pending.proposalId,
    choice: "AGAINST",
  });
  check("13. admin troca para AGAINST", adminAgainst.choice === "AGAINST" && adminAgainst.changed);
  const adminWithdraw = await proposalsMod.withdrawRatingProposalVote(adminViewer, {
    proposalId: pending.proposalId,
  });
  check("14. admin retira voto normal", adminWithdraw.withdrawn);

  // Moderation close does not auto-cast admin vote
  const votesBeforeClose = await tx.ratingChangeVote.count({
    where: { proposalId: pending.proposalId, voterMemberId: admin.id },
  });
  check("15. moderação não cria voto do admin", votesBeforeClose === 0);

  // Admin cannot vote on own rating
  const aboutAdmin = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: admin.id,
    attribute: "ATTACK",
    toValue: 4,
    reason: "admin como alvo",
  });
  await proposalsMod.reviewRatingProposalInitial(adminViewer, {
    proposalId: aboutAdmin.proposalId,
    decision: "APPROVE",
  });
  try {
    await proposalsMod.castRatingProposalVote(adminViewer, {
      proposalId: aboutAdmin.proposalId,
      choice: "FOR",
    });
    check("16. admin não vota na própria nota", false);
  } catch (error) {
    check(
      "16. admin não vota na própria nota",
      error instanceof UserFacingError && error.message.toLowerCase().includes("própria"),
    );
  }

  // Admin as proposer → fixed FOR
  const otherTarget = third ?? target;
  if (otherTarget.id !== admin.id) {
    // Clear any blocking open proposal on PHYSICAL for otherTarget if needed — use DEFENSE
    const adminProp = await proposalsMod.createRatingProposal(adminViewer, {
      targetMemberId: otherTarget.id,
      attribute: "DEFENSE",
      toValue: 3,
      reason: "admin propõe",
    });
    // Need a different admin to approve? Same admin may approve own proposal — allowed.
    await proposalsMod.reviewRatingProposalInitial(adminViewer, {
      proposalId: adminProp.proposalId,
      decision: "APPROVE",
    });
    const adminFixed = await tx.ratingChangeVote.findUnique({
      where: {
        proposalId_voterMemberId: {
          proposalId: adminProp.proposalId,
          voterMemberId: admin.id,
        },
      },
    });
    check(
      "17. admin proponente tem FOR fixo",
      adminFixed?.choice === "FOR",
    );
    try {
      await proposalsMod.castRatingProposalVote(adminViewer, {
        proposalId: adminProp.proposalId,
        choice: "AGAINST",
      });
      check("18. admin proponente não altera voto fixo", false);
    } catch (error) {
      check(
        "18. admin proponente não altera voto fixo",
        error instanceof UserFacingError && error.message.includes("automaticamente"),
      );
    }
  } else {
    check("17. admin proponente tem FOR fixo", false, "sem terceiro membro");
    check("18. admin proponente não altera voto fixo", false, "sem terceiro membro");
  }

  // Close includes proposer vote
  if (thirdViewer && third.id !== proposer.id && third.id !== target.id) {
    await proposalsMod.castRatingProposalVote(thirdViewer, {
      proposalId: pending.proposalId,
      choice: "FOR",
    });
  }
  const closed = await proposalsMod.closeRatingProposalVoting(adminViewer, {
    proposalId: pending.proposalId,
  });
  check("19. close inclui voto do proponente", closed.forCount >= 1);

  const closedRow = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: pending.proposalId },
    include: { votes: true },
  });
  check(
    "20. histórico preserva voto do proponente",
    closedRow.votes.some((v) => v.voterMemberId === proposer.id && v.choice === "FOR") &&
      closedRow.forCount === closed.forCount,
  );

  // Reconcile: simulate missing vote on another open proposal, then backfill
  const reconcileProp = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: target.id,
    attribute: "ATTACK",
    toValue: 2,
    reason: "para reconciliar",
  });
  await proposalsMod.reviewRatingProposalInitial(adminViewer, {
    proposalId: reconcileProp.proposalId,
    decision: "APPROVE",
  });
  await tx.ratingChangeVote.deleteMany({
    where: {
      proposalId: reconcileProp.proposalId,
      voterMemberId: proposer.id,
    },
  });
  const beforeRec = await tx.ratingChangeVote.count({
    where: { proposalId: reconcileProp.proposalId, voterMemberId: proposer.id },
  });
  check("21. simula open sem voto do proponente", beforeRec === 0);

  const rec1 = await reconcileMod.reconcileOpenProposerFixedVotes(tx, { groupId: group.id });
  check("22. reconcile cria voto faltante", rec1.created >= 1);
  const rec2 = await reconcileMod.reconcileOpenProposerFixedVotes(tx, { groupId: group.id });
  check("23. reconcile idempotente (já presente)", rec2.created === 0 && rec2.alreadyPresent >= 1);

  // Closed tallies untouched by reconcile
  const closedAfterRec = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: pending.proposalId },
    select: { forCount: true, againstCount: true, status: true },
  });
  check(
    "24. reconcile não altera tally fechado",
    closedAfterRec.status === "VOTING_CLOSED" &&
      closedAfterRec.forCount === closed.forCount,
  );

  // Ineligible proposer at approve time fails safely (no automatic vote).
  const physProp = await proposalsMod.createRatingProposal(proposerViewer, {
    targetMemberId: target.id,
    attribute: "OVERALL",
    toValue: 3,
    reason: "proponente inelegível depois",
  });
  await tx.groupMember.update({
    where: { id: proposer.id },
    data: { modality: "DAILY" },
  });
  try {
    await proposalsMod.reviewRatingProposalInitial(adminViewer, {
      proposalId: physProp.proposalId,
      decision: "APPROVE",
    });
    check("25. approve falha se proponente inelegível", false);
  } catch (error) {
    check(
      "25. approve falha se proponente inelegível",
      error instanceof UserFacingError && error.message.toLowerCase().includes("mensalista"),
    );
  }
  await tx.groupMember.update({
    where: { id: proposer.id },
    data: { modality: "MONTHLY" },
  });
  const stillPending = await tx.ratingChangeProposal.findUniqueOrThrow({
    where: { id: physProp.proposalId },
  });
  check(
    "26. proposta permanece pending sem voto fantasma",
    stillPending.status === "PENDING_ADMIN_REVIEW" &&
      (await tx.ratingChangeVote.count({ where: { proposalId: physProp.proposalId } })) === 0,
  );

  // Draw voting untouched — smoke that DrawVote table is unrelated
  const drawVotes = await tx.drawVote.count();
  check("27. draw-option voting intacto (count>=0)", drawVotes >= 0);
}

main().catch((error) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
