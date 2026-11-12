// SOMENTE DESENVOLVIMENTO: regressão pura de allocate() (prioridade / fila / LIFO / cota).
//
//   npm run check:allocate
import {
  allocate,
  comparePromotedLifo,
  compareQueue,
  countMonthlyExplicitAbsences,
  isEligible,
  orderWaitlist,
  type AllocationPhase,
  type QueueEntry,
} from "../src/domain/presence/allocate";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const t0 = new Date("2026-11-10T10:00:00.000Z");
const t1 = new Date("2026-11-10T10:01:00.000Z");
const t2 = new Date("2026-11-10T10:02:00.000Z");
const t3 = new Date("2026-11-10T10:03:00.000Z");
const p1 = new Date("2026-11-10T11:00:00.000Z");
const p2 = new Date("2026-11-10T11:05:00.000Z");

function entry(
  partial: Partial<QueueEntry> & Pick<QueueEntry, "id" | "status" | "priorityTier">,
): QueueEntry {
  return {
    queueSortAt: t0,
    promotedAt: null,
    manualOverride: false,
    ...partial,
  };
}

function domainChecks() {
  check(
    "PRIORITY: diarista NÃO elegível sem cota de ausência",
    !isEligible(entry({ id: "d", status: "WAITLISTED", priorityTier: "GENERAL" }), "PRIORITY"),
  );
  check(
    "PRIORITY: diarista elegível com cota de ausência",
    isEligible(entry({ id: "d", status: "WAITLISTED", priorityTier: "GENERAL" }), "PRIORITY", {
      priorityGeneralCap: 1,
    }),
  );
  check(
    "PRIORITY: mensalista elegível a vaga livre",
    isEligible(entry({ id: "m", status: "WAITLISTED", priorityTier: "MONTHLY_PRIORITY" }), "PRIORITY"),
  );
  check(
    "GENERAL: diarista elegível depois do prazo",
    isEligible(entry({ id: "d", status: "WAITLISTED", priorityTier: "GENERAL" }), "GENERAL"),
  );
  check(
    "countMonthlyExplicitAbsences: DECLINED+WITHDRAWN MONTHLY; ignora demais",
    countMonthlyExplicitAbsences([
      { status: "DECLINED", modalitySnapshot: "MONTHLY" },
      { status: "WITHDRAWN", modalitySnapshot: "MONTHLY" },
      { status: "DECLINED", modalitySnapshot: "DAILY" },
      { status: "PARTICIPANT", modalitySnapshot: "MONTHLY" },
      { status: "REMOVED", modalitySnapshot: "MONTHLY" },
    ]) === 2,
  );

  // --- Free seats before deadline: no absences → GENERAL stays waitlisted ---
  {
    const joao = entry({
      id: "joao",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t0,
    });
    const pedro = entry({
      id: "pedro",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t1,
    });
    const seated = entry({
      id: "m1",
      status: "PARTICIPANT",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t0,
    });
    const result = allocate([seated, joao, pedro], 3, "PRIORITY", { priorityGeneralCap: 0 });
    check(
      "PRIORITY: vagas livres sem ausência NÃO promovem diaristas",
      result.promote.length === 0 && result.demote.length === 0,
    );
  }

  // --- One absence → one GENERAL promotion FIFO ---
  {
    const joao = entry({
      id: "joao",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t0,
    });
    const pedro = entry({
      id: "pedro",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t1,
    });
    const seated = entry({
      id: "m1",
      status: "PARTICIPANT",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t0,
    });
    const result = allocate([seated, joao, pedro], 3, "PRIORITY", { priorityGeneralCap: 1 });
    check(
      "PRIORITY: 1 ausência promove só o 1º diarista FIFO",
      result.promote.join(",") === "joao" && result.demote.length === 0,
    );
  }

  // --- Two absences → two GENERAL promotions ---
  {
    const waiters = [t0, t1, t2].map((queueSortAt, index) =>
      entry({
        id: `w${index}`,
        status: "WAITLISTED",
        priorityTier: "GENERAL",
        queueSortAt,
      }),
    );
    const result = allocate(waiters, 5, "PRIORITY", { priorityGeneralCap: 2 });
    check("PRIORITY: 2 ausências → 2 promoções FIFO", result.promote.join(",") === "w0,w1");
  }

  // --- Cap already consumed → no extra GENERAL ---
  {
    const seatedDaily = entry({
      id: "d-seat",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const waiter = entry({
      id: "d-wait",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t1,
    });
    const result = allocate([seatedDaily, waiter], 5, "PRIORITY", { priorityGeneralCap: 1 });
    check(
      "PRIORITY: cota consumida não promove outro diarista",
      result.promote.length === 0 && result.demote.length === 0,
    );
  }

  // --- After deadline: FIFO promotion of GENERAL into free seats ---
  {
    const joao = entry({
      id: "joao",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t0,
    });
    const pedro = entry({
      id: "pedro",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t1,
    });
    const seated = entry({
      id: "m1",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
    });
    const result = allocate([seated, joao, pedro], 3, "GENERAL");
    check(
      "GENERAL: vagas livres promovem FIFO diaristas",
      result.promote.join(",") === "joao,pedro" && result.demote.length === 0,
    );
  }

  // --- Vacancy-first reclaim with valid remaining allowance ---
  {
    const monthly = entry({
      id: "m-back",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t3,
    });
    const diarista = entry({
      id: "d1",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const result = allocate([diarista, monthly], 2, "PRIORITY", { priorityGeneralCap: 1 });
    check(
      "PRIORITY: mensalista reassumindo com vaga não desloca diarista (cota ainda válida)",
      result.promote.join(",") === "m-back" && result.demote.length === 0,
    );
  }

  // --- Allowance reconciled when cap drops (mensalista returned) ---
  {
    const monthly = entry({
      id: "m-back",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t3,
    });
    const diarista = entry({
      id: "d1",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const result = allocate([diarista, monthly], 2, "PRIORITY", { priorityGeneralCap: 0 });
    check(
      "PRIORITY: cota 0 demove diarista e promove mensalista reassumindo",
      result.promote.join(",") === "m-back" && result.demote.join(",") === "d1",
    );
  }

  // --- LIFO displacement when full ---
  {
    const mKeep = entry({
      id: "m-keep",
      status: "PARTICIPANT",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t0,
    });
    const joao = entry({
      id: "joao",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const pedro = entry({
      id: "pedro",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t1,
      promotedAt: p2,
    });
    const carlos = entry({
      id: "carlos",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t2,
    });
    const returning = entry({
      id: "m-return",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t3,
    });
    const first = allocate([mKeep, joao, pedro, carlos, returning], 3, "PRIORITY", {
      priorityGeneralCap: 2,
    });
    check(
      "PRIORITY: 1º reassumir desloca Pedro (LIFO promotedAt)",
      first.demote.join(",") === "pedro" && first.promote.join(",") === "m-return",
    );

    const pedroWait = { ...pedro, status: "WAITLISTED" as const, promotedAt: null };
    const mReturnSeated = {
      ...returning,
      status: "PARTICIPANT" as const,
      promotedAt: null,
    };
    const returning2 = entry({
      id: "m-return-2",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: new Date(t3.getTime() + 60_000),
    });
    const second = allocate([mKeep, joao, mReturnSeated, pedroWait, carlos, returning2], 3, "PRIORITY", {
      priorityGeneralCap: 1,
    });
    check(
      "PRIORITY: 2º reassumir desloca João; espera João→Pedro→Carlos",
      second.demote.join(",") === "joao" && second.promote.join(",") === "m-return-2",
    );
    const waitOrder = orderWaitlist(
      [
        { ...joao, status: "WAITLISTED", promotedAt: null },
        pedroWait,
        carlos,
      ],
      "PRIORITY",
      { priorityGeneralCap: 1 },
    )
      .map((e) => e.id)
      .join(",");
    check("ordem original da espera restaurada João→Pedro→Carlos", waitOrder === "joao,pedro,carlos");
  }

  // --- After deadline: no displacement ---
  {
    const diarista = entry({
      id: "d1",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const lateMonthly = entry({
      id: "m-late",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t3,
    });
    const result = allocate([diarista, lateMonthly], 1, "GENERAL");
    check(
      "GENERAL: mensalista tardio não desloca; fica na espera",
      result.promote.length === 0 && result.demote.length === 0,
    );
  }

  // --- Capacity clamp ---
  {
    const waiters = [t0, t1, t2].map((queueSortAt, index) =>
      entry({
        id: `w${index}`,
        status: "WAITLISTED",
        priorityTier: "GENERAL",
        queueSortAt,
      }),
    );
    const priority = allocate(waiters, 2, "PRIORITY", { priorityGeneralCap: 0 });
    check("PRIORITY: só GENERAL na espera sem cota → ninguém sobe", priority.promote.length === 0);
    const general = allocate(waiters, 2, "GENERAL");
    check("nunca promove além da capacidade", general.promote.join(",") === "w0,w1");
  }

  // --- Empty session before deadline: DAILY waitlisted stays out ---
  {
    const daily = entry({
      id: "d-empty",
      status: "WAITLISTED",
      priorityTier: "GENERAL",
      queueSortAt: t0,
    });
    const result = allocate([daily], 20, "PRIORITY", { priorityGeneralCap: 0 });
    check("PRIORITY: sessão vazia não promove diarista", result.promote.length === 0);
  }

  // --- Excess capacity demotion prefers GENERAL LIFO ---
  {
    const m1 = entry({
      id: "m1",
      status: "PARTICIPANT",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t0,
    });
    const dOld = entry({
      id: "d-old",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const dNew = entry({
      id: "d-new",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t1,
      promotedAt: p2,
    });
    const result = allocate([m1, dOld, dNew], 2, "PRIORITY", { priorityGeneralCap: 2 });
    check("excesso de capacidade demove diarista mais recente", result.demote.join(",") === "d-new");
  }

  check(
    "comparePromotedLifo: mais recente primeiro",
    comparePromotedLifo(
      entry({ id: "a", status: "PARTICIPANT", priorityTier: "GENERAL", promotedAt: p1 }),
      entry({ id: "b", status: "PARTICIPANT", priorityTier: "GENERAL", promotedAt: p2 }),
    ) > 0,
  );
  check(
    "comparePromotedLifo: promotedAt vence null (confirmação direta)",
    comparePromotedLifo(
      entry({ id: "direct", status: "PARTICIPANT", priorityTier: "GENERAL", promotedAt: null, queueSortAt: t3 }),
      entry({ id: "promoted", status: "PARTICIPANT", priorityTier: "GENERAL", promotedAt: p1, queueSortAt: t0 }),
    ) > 0,
  );
  check(
    "compareQueue: MONTHLY antes de GENERAL",
    compareQueue(
      entry({ id: "m", status: "WAITLISTED", priorityTier: "MONTHLY_PRIORITY", queueSortAt: t2 }),
      entry({ id: "d", status: "WAITLISTED", priorityTier: "GENERAL", queueSortAt: t0 }),
    ) < 0,
  );

  // --- Mixed promoted + direct: reclaim prefers waitlist-promoted ---
  {
    const mKeep = entry({
      id: "m-keep",
      status: "PARTICIPANT",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t0,
    });
    const direct = entry({
      id: "direct",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t2,
      promotedAt: null,
    });
    const promoted = entry({
      id: "promoted",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const returning = entry({
      id: "m-return",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t3,
    });
    const result = allocate([mKeep, direct, promoted, returning], 3, "PRIORITY", {
      priorityGeneralCap: 2,
    });
    check(
      "PRIORITY: desloca promovido da espera antes do direto",
      result.demote.join(",") === "promoted" && result.promote.join(",") === "m-return",
    );
  }

  // --- Only directs: newest queueSortAt first ---
  {
    const olderDirect = entry({
      id: "d-old",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: null,
    });
    const newerDirect = entry({
      id: "d-new",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t2,
      promotedAt: null,
    });
    const returning = entry({
      id: "m-return",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t3,
    });
    const result = allocate([olderDirect, newerDirect, returning], 2, "PRIORITY", {
      priorityGeneralCap: 2,
    });
    check(
      "PRIORITY: só diretos → desloca queueSortAt mais recente",
      result.demote.join(",") === "d-new" && result.promote.join(",") === "m-return",
    );
  }

  // --- manualOverride GENERAL never auto-demoted; mensalista stays waitlisted ---
  {
    const protectedDiarista = entry({
      id: "admin-d",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
      manualOverride: true,
    });
    const monthlySeated = entry({
      id: "m-seat",
      status: "PARTICIPANT",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t0,
    });
    const returning = entry({
      id: "m-return",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t3,
    });
    const result = allocate([protectedDiarista, monthlySeated, returning], 2, "PRIORITY", {
      priorityGeneralCap: 0,
    });
    check(
      "PRIORITY: manualOverride bloqueia deslocamento; mensalista fica na espera",
      result.demote.length === 0 && result.promote.length === 0,
    );
  }

  // --- Repeated promote/demote cycle keeps FIFO queueSortAt ---
  {
    const joao = entry({
      id: "joao",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t0,
      promotedAt: p1,
    });
    const pedro = entry({
      id: "pedro",
      status: "PARTICIPANT",
      priorityTier: "GENERAL",
      queueSortAt: t1,
      promotedAt: p2,
    });
    const returning = entry({
      id: "m1",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: t3,
    });
    const first = allocate([joao, pedro, returning], 2, "PRIORITY", { priorityGeneralCap: 2 });
    check("ciclo 1: demove pedro", first.demote.join(",") === "pedro" && first.promote.join(",") === "m1");

    const pedroWait = { ...pedro, status: "WAITLISTED" as const, promotedAt: null };
    const m1Seated = { ...returning, status: "PARTICIPANT" as const, promotedAt: null };
    const returning2 = entry({
      id: "m2",
      status: "WAITLISTED",
      priorityTier: "MONTHLY_PRIORITY",
      queueSortAt: new Date(t3.getTime() + 60_000),
    });
    const second = allocate([joao, m1Seated, pedroWait, returning2], 2, "PRIORITY", {
      priorityGeneralCap: 1,
    });
    check("ciclo 2: demove joão; pedro permanece na posição FIFO", second.demote.join(",") === "joao");
    const waitOrder = orderWaitlist(
      [
        { ...joao, status: "WAITLISTED", promotedAt: null },
        pedroWait,
      ],
      "PRIORITY",
      { priorityGeneralCap: 1 },
    )
      .map((e) => e.id)
      .join(",");
    check("ciclo: ordem FIFO joao→pedro preservada após demotions", waitOrder === "joao,pedro");
  }

  void (["PRIORITY", "GENERAL"] as AllocationPhase[]);
}

domainChecks();

for (const result of results) {
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
  );
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
