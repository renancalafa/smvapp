// SOMENTE DESENVOLVIMENTO: regressão da avaliação unificada Admin.
//
//   npx tsx scripts/check-member-evaluation.ts
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
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
    sessionId: "check-member-evaluation",
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
  const evaluation = await import("../src/server/modules/ratings/apply-evaluation");
  const proposals = await import("../src/server/modules/ratings/proposals");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, evaluation, proposals, UserFacingError);
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
  evaluationMod: typeof import("../src/server/modules/ratings/apply-evaluation"),
  proposalsMod: typeof import("../src/server/modules/ratings/proposals"),
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
  if (!admin) throw new SetupError("Admin mensalista ausente.");

  const players = await tx.groupMember.findMany({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE", modality: "MONTHLY" },
    take: 2,
    orderBy: { user: { username: "asc" } },
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
  if (players.length < 2) throw new SetupError("Precisa de 2 mensalistas.");

  const target = players[0]!;
  const proposer = players[1]!;
  const adminViewer = viewerOf(group, admin);
  const proposerViewer = viewerOf(group, proposer);

  const snap = () => ({
    overall: target.baseRating,
    attack: target.attackRating,
    defense: target.defenseRating,
    physical: target.physicalRating,
    preferredRole: target.preferredRole,
  });

  // Reload helper after mutations inside the same tx
  async function reloadTarget() {
    const row = await tx.groupMember.findUniqueOrThrow({
      where: { id: target.id },
      select: {
        baseRating: true,
        attackRating: true,
        defenseRating: true,
        physicalRating: true,
        preferredRole: true,
      },
    });
    target.baseRating = row.baseRating;
    target.attackRating = row.attackRating;
    target.defenseRating = row.defenseRating;
    target.physicalRating = row.physicalRating;
    target.preferredRole = row.preferredRole;
    return row;
  }

  // Unchanged
  {
    const expected = snap();
    const result = await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: expected,
      reason: "não deve gravar",
    });
    check("unchanged retorna unchanged", result.unchanged === true);
  }

  // Missing reason when changing
  try {
    const expected = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: { ...expected, overall: expected.overall === 5 ? 4 : expected.overall + 1 },
      reason: "   ",
    });
    check("exige motivo", false);
  } catch (error) {
    check(
      "exige motivo",
      error instanceof UserFacingError && error.message.toLowerCase().includes("motivo"),
    );
  }

  // Invalid overall
  try {
    const expected = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: { ...expected, overall: 0 },
      reason: "inválido",
    });
    check("rejeita overall inválido", false);
  } catch (error) {
    check(
      "rejeita overall inválido",
      error instanceof UserFacingError && error.message.toLowerCase().includes("geral"),
    );
  }

  // Multi-attribute update + role (force physical set then clear in same op path)
  {
    const prep = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected: prep,
      next: { ...prep, physical: 2 },
      reason: "prep physical",
    });
    await reloadTarget();

    const expected = snap();
    const nextOverall = expected.overall === 5 ? 4 : expected.overall + 1;
    const result = await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: {
        overall: nextOverall,
        attack: 4,
        defense: 3,
        physical: null,
        preferredRole: "ATTACKER",
      },
      reason: "avaliação unificada multi",
    });
    await reloadTarget();
    check("multi: não unchanged", result.unchanged === false);
    check(
      "multi: ratings aplicados",
      target.baseRating === nextOverall &&
        target.attackRating === 4 &&
        target.defenseRating === 3 &&
        target.physicalRating === null &&
        target.preferredRole === "ATTACKER",
    );
    check(
      "multi: history por atributo",
      result.ratingChanges.filter((c) => !c.result.unchanged).length >= 2,
    );

    const histories = await tx.memberRatingHistory.findMany({
      where: { memberId: target.id, reason: "avaliação unificada multi" },
      select: { attribute: true, previousValue: true, newValue: true },
    });
    check(
      "multi: history inclui physical→null",
      histories.some((h) => h.attribute === "PHYSICAL" && h.previousValue === 2 && h.newValue === null),
    );
    const audits = await tx.auditLog.count({
      where: {
        entityId: target.id,
        action: { in: ["MEMBER_RATING_CHANGED", "MEMBER_PREFERRED_ROLE_CHANGED"] },
        reason: "avaliação unificada multi",
      },
    });
    check("multi: audits criados", audits >= 2);
  }

  // Single attribute only
  {
    const expected = snap();
    const nextAttack = expected.attack === 5 ? 4 : (expected.attack ?? 2) === 2 ? 3 : 2;
    const result = await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: { ...expected, attack: nextAttack },
      reason: "só ataque",
    });
    await reloadTarget();
    check(
      "single attr",
      result.unchanged === false &&
        result.ratingChanges.length === 1 &&
        result.ratingChanges[0]!.attribute === "ATTACK" &&
        target.attackRating === nextAttack,
    );
  }

  // Clear optional
  {
    const expected = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: { ...expected, defense: 2 },
      reason: "prep clear",
    });
    await reloadTarget();
    const expected2 = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected: expected2,
      next: { ...expected2, defense: null },
      reason: "limpar defesa",
    });
    await reloadTarget();
    check("clear defense", target.defenseRating === null);
  }

  // Preferred role only
  {
    const expected = snap();
    const nextRole = expected.preferredRole === "DEFENDER" ? "VERSATILE" : "DEFENDER";
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: { ...expected, preferredRole: nextRole },
      reason: "só papel",
    });
    await reloadTarget();
    check("role only", target.preferredRole === nextRole);
  }

  // Concurrent / stale expected
  try {
    const expected = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected: { ...expected, overall: expected.overall === 5 ? 1 : 5 },
      next: { ...expected, overall: expected.overall === 5 ? 4 : expected.overall + 1 },
      reason: "stale",
    });
    check("stale expected rejeitado", false);
  } catch (error) {
    check(
      "stale expected rejeitado",
      error instanceof UserFacingError && error.message.toLowerCase().includes("outra pessoa"),
    );
  }

  // Supersede only conflicting attribute proposals
  {
    await reloadTarget();
    await tx.ratingChangeProposal.updateMany({
      where: {
        groupId: group.id,
        targetMemberId: target.id,
        status: { in: ["PENDING_ADMIN_REVIEW", "OPEN_FOR_VOTING", "VOTING_CLOSED"] },
      },
      data: {
        status: "SUPERSEDED_STALE",
        blocksDuplicate: false,
        finalDecisionReason: "check-member-evaluation cleanup",
        finalDecidedAt: new Date(),
      },
    });
    // Ensure attack has a value so proposal fromValue is meaningful
    const expected = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected,
      next: {
        ...expected,
        attack: expected.attack ?? 3,
        defense: expected.defense ?? 3,
      },
      reason: "prep proposals",
    });
    await reloadTarget();

    const attackProposal = await proposalsMod.createRatingProposal(proposerViewer, {
      targetMemberId: target.id,
      attribute: "ATTACK",
      toValue: 5,
      reason: "proposta ataque check-eval",
    });
    const defenseProposal = await proposalsMod.createRatingProposal(proposerViewer, {
      targetMemberId: target.id,
      attribute: "DEFENSE",
      toValue: 5,
      reason: "proposta defesa check-eval",
    });

    const expected2 = snap();
    await evaluationMod.applyMemberEvaluation(adminViewer, {
      memberId: target.id,
      expected: expected2,
      next: { ...expected2, attack: expected2.attack === 5 ? 4 : 5 },
      reason: "supersede só ataque",
    });

    const attackAfter = await tx.ratingChangeProposal.findUniqueOrThrow({
      where: { id: attackProposal.proposalId },
      select: { status: true },
    });
    const defenseAfter = await tx.ratingChangeProposal.findUniqueOrThrow({
      where: { id: defenseProposal.proposalId },
      select: { status: true },
    });
    check("supersede attack", attackAfter.status === "SUPERSEDED_STALE");
    check(
      "preserve defense proposal",
      defenseAfter.status === "PENDING_ADMIN_REVIEW" ||
        defenseAfter.status === "OPEN_FOR_VOTING",
    );
  }

  // Rollback proof: force failure after first change by invalid nested call is hard;
  // instead verify transaction wrapper rolls back via outer Rollback at end — and a
  // mid-flight UserFacingError leaves no partials when stale is thrown before writes.
  {
    const before = await reloadTarget();
    try {
      await evaluationMod.applyMemberEvaluation(adminViewer, {
        memberId: target.id,
        expected: {
          overall: before.baseRating,
          attack: before.attackRating,
          defense: before.defenseRating,
          physical: before.physicalRating,
          preferredRole: before.preferredRole,
        },
        next: {
          overall: 0,
          attack: 1,
          defense: 1,
          physical: 1,
          preferredRole: "ATTACKER",
        },
        reason: "deve falhar validação",
      });
      check("rollback on validation", false);
    } catch (error) {
      const after = await reloadTarget();
      check(
        "rollback on validation",
        error instanceof UserFacingError &&
          after.baseRating === before.baseRating &&
          after.attackRating === before.attackRating &&
          after.defenseRating === before.defenseRating &&
          after.physicalRating === before.physicalRating &&
          after.preferredRole === before.preferredRole,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
