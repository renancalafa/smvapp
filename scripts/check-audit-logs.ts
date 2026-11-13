// SOMENTE DESENVOLVIMENTO: catálogo de audit + Logs admin + falha fora do rollback.
//
//   npm run check:audit-logs
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  categorizeAuditAction,
  redactAuditJson,
  resolveAuditOutcome,
  resolveAuditSeverity,
} from "../src/domain/audit/catalog";
import { auditActionLabel } from "../src/domain/audit/labels";
import { PrismaClient } from "../src/generated/prisma/client";

type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;

class SetupError extends Error {}
class Rollback extends Error {}

const emptyModule = pathToFileURL(path.resolve("node_modules/next/dist/compiled/server-only/empty.js")).href;
(nodeModule as unknown as { registerHooks(hooks: { resolve: ResolveHook }): void }).registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: emptyModule, shortCircuit: true } : nextResolve(specifier, context),
});

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function domainChecks() {
  check("MATCH_PAUSED → MATCH", categorizeAuditAction("MATCH_PAUSED") === "MATCH");
  check(
    "REGISTRATION_PROMOTED → ATTENDANCE",
    categorizeAuditAction("REGISTRATION_PROMOTED") === "ATTENDANCE",
  );
  check("SESSION_SCOUT_REVOKED → SCOUT", categorizeAuditAction("SESSION_SCOUT_REVOKED") === "SCOUT");
  check("AUTHZ_DENIED → AUTH", categorizeAuditAction("AUTHZ_DENIED") === "AUTH");
  check("legado null outcome → SUCCESS", resolveAuditOutcome(null) === "SUCCESS");
  check("DENIED severity default WARN", resolveAuditSeverity(null, "DENIED") === "WARN");
  check(
    "redact password",
    (redactAuditJson({ password: "segredo", ok: 1 }) as { password: string; ok: number }).password ===
      "[redacted]" &&
      (redactAuditJson({ password: "segredo", ok: 1 }) as { password: string; ok: number }).ok === 1,
  );
  check(
    "redact token aninhado",
    (redactAuditJson({ nested: { accessToken: "x" } }) as { nested: { accessToken: string } }).nested
      .accessToken === "[redacted]",
  );
  check("rótulo PT MATCH_PAUSED", auditActionLabel("MATCH_PAUSED") === "Partida pausada");
  check(
    "rótulo desconhecido não inventa",
    auditActionLabel("FOO_BAR_UNKNOWN").includes("foo"),
  );
}

async function main() {
  domainChecks();

  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  (globalThis as { prisma?: unknown }).prisma = prisma;

  const { writeAuditLog, writeAuditLogCommitted } = await import("../src/server/audit");
  const { listAuditLogs, parseAuditDateTimeBound, summarizeAuditLogs } = await import(
    "../src/server/modules/audit-logs/queries"
  );

  const fromDate = parseAuditDateTimeBound("2026-11-13", "America/Sao_Paulo", "from");
  const fromTime = parseAuditDateTimeBound("2026-11-13T18:30", "America/Sao_Paulo", "from");
  const toTime = parseAuditDateTimeBound("2026-11-13T18:30", "America/Sao_Paulo", "to");
  check("filtro só data → início do dia", !!fromDate);
  check(
    "filtro data+hora from < to do mesmo minuto",
    !!fromTime && !!toTime && fromTime.getTime() < toTime.getTime(),
  );

  const group = await prisma.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");

  const marker = `check-audit-logs:${randomUUID()}`;
  const legacyId = randomUUID();
  const failureId = randomUUID();

  try {
    // Legado sem outcome (simula histórico).
    await prisma.auditLog.create({
      data: {
        id: legacyId,
        groupId: group.id,
        actorType: "SYSTEM",
        actorUserId: null,
        action: "SYSTEM_BOOTSTRAPPED",
        entityType: "GroupSettings",
        entityId: group.id,
        reason: marker,
        outcome: null,
        severity: null,
      },
    });

    const listed = await listAuditLogs(group.id, { q: marker, order: "oldest", page: 1 });
    check("legado aparece nos Logs", listed.items.some((row) => row.id === legacyId));
    check(
      "legado outcome tratado como SUCCESS",
      listed.items.find((row) => row.id === legacyId)?.outcome === "SUCCESS",
    );

    const newest = await listAuditLogs(group.id, { order: "newest", page: 1 });
    const oldest = await listAuditLogs(group.id, { order: "oldest", page: 1 });
    check("paginação retorna pageSize", newest.items.length <= newest.pageSize);
    check(
      "ordenação newest ≠ oldest (ou lista curta)",
      newest.total < 2 || newest.items[0]?.id !== oldest.items[0]?.id || newest.total === 1,
    );

    // Sucesso na TX revertida não persiste.
    const rolledMarker = `${marker}:rolled`;
    try {
      await prisma.$transaction(async (tx) => {
        await writeAuditLog(tx, {
          groupId: group.id,
          actorUserId: null,
          action: "OPERATION_FAILED",
          entityType: "GameSession",
          entityId: group.id,
          reason: rolledMarker,
          outcome: "SUCCESS",
        });
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    const rolled = await prisma.auditLog.count({ where: { groupId: group.id, reason: rolledMarker } });
    check("sucesso na TX revertida não persiste", rolled === 0);

    // Falha committed sobrevive.
    await writeAuditLogCommitted({
      groupId: group.id,
      actorUserId: null,
      action: "MATCH_PAUSED",
      entityType: "Match",
      entityId: failureId,
      reason: `${marker}:failure`,
      outcome: "FAILURE",
      severity: "ERROR",
      correlationId: failureId,
      durationMs: 12,
      metadata: { password: "não-deve-aparecer", expectedVersion: 1 },
    });
    const failed = await prisma.auditLog.findFirst({
      where: { groupId: group.id, reason: `${marker}:failure` },
      select: { id: true, outcome: true, metadata: true, correlationId: true },
    });
    check("falha committed persiste", !!failed && failed.outcome === "FAILURE");
    check(
      "metadata redigida sem password",
      !!failed &&
        typeof failed.metadata === "object" &&
        failed.metadata !== null &&
        (failed.metadata as { password?: string }).password === "[redacted]",
    );

    const byOutcome = await listAuditLogs(group.id, {
      outcome: "FAILURE",
      q: marker,
      page: 1,
    });
    check(
      "filtro outcome FAILURE",
      byOutcome.items.some((row) => row.reason === `${marker}:failure`),
    );

    const byCategory = await listAuditLogs(group.id, {
      category: "MATCH",
      q: marker,
      page: 1,
    });
    check(
      "filtro category MATCH",
      byCategory.items.some((row) => row.action === "MATCH_PAUSED"),
    );

    const summary = await summarizeAuditLogs(group.id, { q: marker }, "America/Sao_Paulo");
    check("resumo total ≥ falhas", summary.total >= summary.failures);
    check("resumo conta FAILURE", summary.failures >= 1);
    check(
      "resumo ignora filtro outcome na base",
      (await summarizeAuditLogs(group.id, { q: marker, outcome: "SUCCESS" }, "America/Sao_Paulo"))
        .failures >= 1,
    );
  } finally {
    await prisma.auditLog.deleteMany({ where: { groupId: group.id, reason: { startsWith: marker } } });
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(
        `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
      );
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
