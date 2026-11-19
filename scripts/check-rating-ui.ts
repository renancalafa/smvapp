// Regressão UI/board de níveis (agrupamento + nav + restrição financeira).
//
//   npm run check:rating-ui
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { isPathAllowedWhenPaymentRestricted } from "../src/domain/finance/accessPolicy";
import { groupProposalsByTargetMember } from "../src/domain/ratings/proposalState";
import { isMaisNavActive } from "../src/domain/nav/mobile-active";
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
    sessionId: "check-rating-ui",
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
  check(
    "um card por jogador (múltiplos atributos)",
    (() => {
      const grouped = groupProposalsByTargetMember([
        { targetMemberId: "heitor", proposedAt: new Date("2026-01-03"), attribute: "DEFENSE" },
        { targetMemberId: "heitor", proposedAt: new Date("2026-01-02"), attribute: "ATTACK" },
        { targetMemberId: "guiga", proposedAt: new Date("2026-01-04"), attribute: "PHYSICAL" },
        { targetMemberId: "heitor", proposedAt: new Date("2026-01-01"), attribute: "PHYSICAL" },
      ]);
      return (
        grouped.length === 2 &&
        grouped[0]!.targetMemberId === "guiga" &&
        grouped[1]!.targetMemberId === "heitor" &&
        grouped[1]!.proposals.length === 3
      );
    })(),
  );

  check("mais ativo em /niveis", isMaisNavActive("/niveis") && !isMaisNavActive("/stats"));
  check(
    "/niveis bloqueado sob payment_restricted",
    !isPathAllowedWhenPaymentRestricted("/niveis"),
  );
  check(
    "/pagamentos permitido sob payment_restricted",
    isPathAllowedWhenPaymentRestricted("/pagamentos"),
  );

  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const queries = await import("../src/server/modules/ratings/queries");
  const proposals = await import("../src/server/modules/ratings/proposals");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            const group = await tx.group.findFirst({
              orderBy: { createdAt: "asc" },
              select: { id: true, name: true, timezone: true },
            });
            if (!group) throw new SetupError("Nenhum Group.");
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
                user: { select: { id: true, username: true, name: true } },
              },
            });
            if (players.length < 2) throw new SetupError("Precisa de 2 mensalistas.");

            await tx.groupSettings.update({
              where: { groupId: group.id },
              data: { ratingVotingEnabled: false },
            });
            const off = await queries.getRatingsBoard(viewerOf(group, admin));
            check("board disabled sem flag", off.enabled === false && off.openVoting.length === 0);

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

            const proposer = viewerOf(group, players[1]!);
            const target = players[0]!;
            await proposals.createRatingProposal(proposer, {
              targetMemberId: target.id,
              attribute: "ATTACK",
              toValue: 3,
              reason: "ui-check ataque",
            });
            await proposals.createRatingProposal(proposer, {
              targetMemberId: target.id,
              attribute: "DEFENSE",
              toValue: 4,
              reason: "ui-check defesa",
            });

            const board = await queries.getRatingsBoard(viewerOf(group, admin));
            check("board enabled", board.enabled === true);
            check(
              "pending: um card com 2 propostas",
              board.pendingReview.length === 1 &&
                board.pendingReview[0]!.targetMemberId === target.id &&
                board.pendingReview[0]!.proposals.length === 2,
            );

            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 120_000 },
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
  console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
