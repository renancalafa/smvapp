import "server-only";
import {
  actionsForCategory,
  categorizeAuditAction,
  resolveAuditOutcome,
  resolveAuditSeverity,
  type AuditCategory,
  type AuditOutcome,
} from "@/domain/audit/catalog";
import { AUDIT_SLOW_MS } from "@/domain/audit/labels";
import { zonedInstant } from "@/domain/time/zoned";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

export const AUDIT_LOG_PAGE_SIZE = 40;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `YYYY-MM-DD` ou `YYYY-MM-DDTHH:mm` / `YYYY-MM-DDTHH:mm:ss` (datetime-local). */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

export type AuditLogFilters = {
  q?: string;
  category?: AuditCategory | "";
  outcome?: AuditOutcome | "";
  sessionId?: string;
  actorUserId?: string;
  /** Data ou data+hora no fuso do grupo. */
  from?: string;
  to?: string;
  order?: "newest" | "oldest";
  page?: number;
};

export type AuditLogListItem = {
  id: string;
  createdAt: string;
  action: string;
  category: AuditCategory;
  entityType: string;
  entityId: string;
  outcome: AuditOutcome;
  severity: string;
  actorType: "USER" | "SYSTEM";
  actorUserId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  gameSessionId: string | null;
  sessionLabel: string | null;
  reason: string | null;
  correlationId: string | null;
  operationId: string | null;
  durationMs: number | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
};

export type AuditLogListResult = {
  items: AuditLogListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type AuditLogSummary = {
  total: number;
  failures: number;
  denials: number;
  slow: number;
  slowThresholdMs: number;
};

/**
 * Interpreta bound de filtro no fuso do grupo.
 * Só data → início do dia (from) ou fim do dia (to).
 * Data+hora → instante exato (to inclui o minuto completo se sem segundos).
 */
export function parseAuditDateTimeBound(
  raw: string | undefined,
  timeZone: string,
  bound: "from" | "to",
): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const dateOnly = DATE_ONLY_RE.exec(trimmed);
  if (dateOnly) {
    const civil = {
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
    };
    if (bound === "from") return zonedInstant(civil, 0, timeZone);
    const next = zonedInstant(civil, 24 * 60, timeZone);
    return new Date(next.getTime() - 1);
  }
  const dateTime = DATETIME_RE.exec(trimmed);
  if (!dateTime) return null;
  const civil = {
    year: Number(dateTime[1]),
    month: Number(dateTime[2]),
    day: Number(dateTime[3]),
  };
  const hour = Number(dateTime[4]);
  const minute = Number(dateTime[5]);
  const second = dateTime[6] !== undefined ? Number(dateTime[6]) : bound === "to" ? 59 : 0;
  const minuteOfDay = hour * 60 + minute;
  const base = zonedInstant(civil, minuteOfDay, timeZone);
  return new Date(base.getTime() + second * 1000 + (bound === "to" && dateTime[6] === undefined ? 999 : 0));
}

const AUDIT_CATEGORIES_FLAT = [
  ...actionsForCategory("MATCH"),
  ...actionsForCategory("ATTENDANCE"),
  ...actionsForCategory("DRAW"),
  ...actionsForCategory("SCOUT"),
  ...actionsForCategory("ADMIN"),
  ...actionsForCategory("AUTH"),
  ...actionsForCategory("SYSTEM"),
];

/** Where compartilhado entre lista e resumo. `omitOutcome` ignora filtro de resultado (cards do dashboard). */
export function buildAuditLogWhere(
  groupId: string,
  filters: AuditLogFilters,
  timeZone: string,
  options?: { omitOutcome?: boolean },
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = { groupId };

  if (filters.sessionId) where.gameSessionId = filters.sessionId;
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;

  if (!options?.omitOutcome) {
    if (filters.outcome === "SUCCESS") {
      where.OR = [{ outcome: "SUCCESS" }, { outcome: null }];
    } else if (filters.outcome === "FAILURE" || filters.outcome === "DENIED") {
      where.outcome = filters.outcome;
    }
  }

  if (filters.category && filters.category !== "OTHER") {
    where.action = { in: [...actionsForCategory(filters.category)] };
  } else if (filters.category === "OTHER") {
    where.action = { notIn: AUDIT_CATEGORIES_FLAT };
  }

  const from = parseAuditDateTimeBound(filters.from, timeZone, "from");
  const to = parseAuditDateTimeBound(filters.to, timeZone, "to");
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const q = filters.q?.trim();
  if (q) {
    const search: Prisma.AuditLogWhereInput[] = [
      { action: { contains: q, mode: "insensitive" } },
      { entityType: { contains: q, mode: "insensitive" } },
      { reason: { contains: q, mode: "insensitive" } },
      {
        actor: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { username: { contains: q, mode: "insensitive" } },
          ],
        },
      },
    ];
    if (UUID_RE.test(q)) {
      search.push({ entityId: q });
      search.push({ operationId: q });
      search.push({ correlationId: q });
      search.push({ gameSessionId: q });
    } else {
      search.push({ correlationId: { contains: q, mode: "insensitive" } });
    }
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: search }];
  }

  return where;
}

export async function summarizeAuditLogs(
  groupId: string,
  filters: AuditLogFilters,
  timeZone = "America/Sao_Paulo",
): Promise<AuditLogSummary> {
  // Resumo ignora outcome para mostrar o breakdown real do conjunto filtrado.
  const base = buildAuditLogWhere(groupId, filters, timeZone, { omitOutcome: true });
  const [total, failures, denials, slow] = await Promise.all([
    db.auditLog.count({ where: base }),
    db.auditLog.count({ where: { AND: [base, { outcome: "FAILURE" }] } }),
    db.auditLog.count({ where: { AND: [base, { outcome: "DENIED" }] } }),
    db.auditLog.count({
      where: { AND: [base, { durationMs: { gte: AUDIT_SLOW_MS } }] },
    }),
  ]);
  return { total, failures, denials, slow, slowThresholdMs: AUDIT_SLOW_MS };
}

export async function listAuditLogs(
  groupId: string,
  filters: AuditLogFilters,
  timeZone = "America/Sao_Paulo",
): Promise<AuditLogListResult> {
  const pageSize = AUDIT_LOG_PAGE_SIZE;
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const order: "newest" | "oldest" = filters.order === "oldest" ? "oldest" : "newest";
  const where = buildAuditLogWhere(groupId, filters, timeZone);

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: order === "oldest" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        outcome: true,
        severity: true,
        actorType: true,
        actorUserId: true,
        reason: true,
        correlationId: true,
        operationId: true,
        durationMs: true,
        before: true,
        after: true,
        metadata: true,
        gameSessionId: true,
        actor: { select: { name: true, username: true } },
        gameSession: {
          select: {
            scheduledFor: true,
            startsAt: true,
            origin: true,
            venueName: true,
          },
        },
      },
    }),
  ]);

  const items: AuditLogListItem[] = rows.map((row) => {
    const outcome = resolveAuditOutcome(row.outcome);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      category: categorizeAuditAction(row.action),
      entityType: row.entityType,
      entityId: row.entityId,
      outcome,
      severity: resolveAuditSeverity(row.severity, outcome),
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      actorName: row.actor?.name ?? null,
      actorUsername: row.actor?.username ?? null,
      gameSessionId: row.gameSessionId,
      sessionLabel: row.gameSession
        ? [
            row.gameSession.origin === "EXTRAORDINARY" ? "Extraordinária" : "Semanal",
            row.gameSession.venueName,
            row.gameSession.startsAt.toISOString().slice(0, 16).replace("T", " "),
          ]
            .filter(Boolean)
            .join(" · ")
        : null,
      reason: row.reason,
      correlationId: row.correlationId,
      operationId: row.operationId,
      durationMs: row.durationMs,
      before: row.before,
      after: row.after,
      metadata: row.metadata,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listAuditFilterOptions(groupId: string) {
  const [actors, sessions] = await Promise.all([
    db.auditLog.findMany({
      where: { groupId, actorUserId: { not: null } },
      distinct: ["actorUserId"],
      select: {
        actorUserId: true,
        actor: { select: { name: true, username: true } },
      },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    db.gameSession.findMany({
      where: { groupId },
      orderBy: { startsAt: "desc" },
      take: 80,
      select: {
        id: true,
        startsAt: true,
        origin: true,
        venueName: true,
        status: true,
      },
    }),
  ]);

  return {
    actors: actors
      .filter((row) => row.actorUserId && row.actor)
      .map((row) => ({
        id: row.actorUserId!,
        label: `${row.actor!.name} · @${row.actor!.username}`,
      })),
    sessions: sessions.map((session) => ({
      id: session.id,
      label: `${session.startsAt.toISOString().slice(0, 16).replace("T", " ")}${
        session.origin === "EXTRAORDINARY" ? " · Extra" : ""
      }${session.venueName ? ` · ${session.venueName}` : ""} · ${session.status}`,
    })),
  };
}
