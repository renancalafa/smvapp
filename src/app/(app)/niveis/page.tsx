import type { Metadata } from "next";
import {
  darkAlertWarn,
  darkMuted,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { shellSubtext } from "@/lib/ui/shell-text";
import { requireViewer } from "@/server/auth/dal";
import { getRatingsBoard } from "@/server/modules/ratings/queries";
import { NiveisSummary } from "./niveis-summary";
import { PlayerProposalSection } from "./player-cards";
import { SuggestRatingForm } from "./suggest-form";

export const metadata: Metadata = { title: "Níveis dos jogadores" };
export const dynamic = "force-dynamic";

function countProposals(
  cards: Array<{ proposals: unknown[] }>,
): number {
  return cards.reduce((sum, card) => sum + card.proposals.length, 0);
}

export default async function NiveisPage() {
  // requireViewer + layout already redirect payment_restricted away from /niveis.
  const viewer = await requireViewer();
  const board = await getRatingsBoard(viewer);

  if (!board.enabled) {
    return (
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
        <header>
          <h1 className={darkTitle}>Níveis dos jogadores</h1>
          <p className={`mt-1 ${shellSubtext}`}>
            Sugestões e votação comunitária de notas (geral, ataque, defesa e físico).
          </p>
        </header>
        <div className={darkAlertWarn} role="status">
          <p className="font-semibold text-amber-50">Recurso ainda não habilitado</p>
          <p className="mt-1 text-sm text-amber-100/90">
            A votação de níveis está desligada neste grupo (`ratingVotingEnabled`). Em
            desenvolvimento local, use{" "}
            <code className="rounded bg-black/30 px-1">npm run rating-voting:local -- --enable</code>.
          </p>
        </div>
      </section>
    );
  }

  if (!board.canParticipate && !board.isAdmin) {
    return (
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
        <header>
          <h1 className={darkTitle}>Níveis dos jogadores</h1>
          <p className={`mt-1 ${shellSubtext}`}>
            Sugestões e votação comunitária de notas.
          </p>
        </header>
        <div className={darkAlertWarn} role="status">
          <p className="font-semibold text-amber-50">Acesso para mensalistas ativos</p>
          <p className="mt-1 text-sm text-amber-100/90">
            Só mensalistas ativos podem sugerir e votar alterações de nota.
          </p>
        </div>
      </section>
    );
  }

  const openCount = countProposals(board.openVoting);
  const pendingCount = countProposals(board.pendingReview);
  const awaitingCount = countProposals(board.awaitingFinal);
  const historyCount = countProposals(board.history);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className={darkTitle}>Níveis dos jogadores</h1>
          <p className={`mt-1 ${shellSubtext}`}>
            Sugestões da comunidade para ajustar notas. A nota só muda depois da
            confirmação final do administrador.
          </p>
        </div>
        {board.canParticipate ? (
          <div className="shrink-0 sm:pt-1">
            <SuggestRatingForm targets={board.suggestTargets} />
          </div>
        ) : null}
      </header>

      <NiveisSummary
        openVoting={openCount}
        pendingReview={pendingCount}
        awaitingFinal={awaitingCount}
        history={historyCount}
      />

      <p className={darkMuted}>
        {openCount + pendingCount + awaitingCount} em andamento
        {historyCount > 0 ? ` · ${historyCount} no histórico` : ""}
      </p>

      <PlayerProposalSection
        title="Em votação"
        empty="Nenhuma proposta aberta para voto."
        cards={board.openVoting}
        isAdmin={board.isAdmin}
        canVote={board.canParticipate}
        viewerMemberId={board.viewerMemberId}
      />

      <PlayerProposalSection
        title="Aguardando Admin"
        empty="Nenhuma sugestão pendente de revisão."
        cards={board.pendingReview}
        isAdmin={board.isAdmin}
        canVote={false}
        viewerMemberId={board.viewerMemberId}
      />

      <PlayerProposalSection
        title="Aguardando decisão final"
        empty="Nenhuma votação encerrada aguardando confirmação."
        cards={board.awaitingFinal}
        isAdmin={board.isAdmin}
        canVote={false}
        viewerMemberId={board.viewerMemberId}
      />

      <PlayerProposalSection
        title="Histórico"
        empty="Ainda não há propostas finalizadas."
        cards={board.history}
        isAdmin={board.isAdmin}
        canVote={false}
        viewerMemberId={board.viewerMemberId}
      />
    </section>
  );
}
