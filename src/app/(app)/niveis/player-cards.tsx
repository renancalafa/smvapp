import {
  darkCard,
  darkEmpty,
  darkMutedXs,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";
import type { PlayerProposalCard } from "@/server/modules/ratings/queries";
import { ProposalRow } from "./proposal-row";

export function PlayerProposalSection({
  title,
  empty,
  cards,
  isAdmin,
  canVote,
  viewerMemberId,
}: {
  title: string;
  empty: string;
  cards: PlayerProposalCard[];
  isAdmin: boolean;
  canVote: boolean;
  viewerMemberId: string;
}) {
  const proposalCount = cards.reduce((sum, card) => sum + card.proposals.length, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={darkSectionLabel}>{title}</h2>
        <p className={darkMutedXs}>
          {cards.length === 0
            ? "0 jogadores"
            : `${cards.length} jogador${cards.length === 1 ? "" : "es"} · ${proposalCount} proposta${proposalCount === 1 ? "" : "s"}`}
        </p>
      </div>

      {cards.length === 0 ? (
        <p className={darkEmpty}>{empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <article
              key={card.targetMemberId}
              className={`${darkCard} flex flex-col gap-3 overflow-hidden p-0`}
            >
              <header className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-smv-gold/15 text-sm font-semibold text-smv-gold-bright"
                  aria-hidden
                >
                  {card.targetName.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-smv-cream">
                    {card.targetName}
                  </h3>
                  <p className={darkMutedXs}>@{card.targetUsername}</p>
                </div>
                <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-white/55 ring-1 ring-white/10">
                  {card.proposals.length}{" "}
                  {card.proposals.length === 1 ? "proposta" : "propostas"}
                </span>
              </header>

              <div className="flex flex-col gap-3 px-3 pb-3">
                {card.proposals.map((proposal) => (
                  <ProposalRow
                    key={proposal.id}
                    proposal={proposal}
                    isAdmin={isAdmin}
                    canVote={canVote}
                    viewerMemberId={viewerMemberId}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
