import type { DrawView } from "@/server/modules/draws/queries";
import { OptionCard } from "./option-card";
import { VoteButton } from "./vote-button";

export function drawStatusText(draw: DrawView): string {
  const winner = draw.options.find((option) => option.id === draw.winningOptionId);
  switch (draw.status) {
    case "VOTING":
      return "Votação aberta: os mensalistas confirmados escolhem a opção de times.";
    case "TIED":
      return "A votação terminou empatada. Os administradores vão decidir.";
    case "DECIDED":
      if (draw.decisionMethod === "SINGLE_OPTION") return `Sorteio oficial: opção ${winner?.label} (opção única).`;
      if (draw.decisionMethod === "ADMIN_RESOLUTION") {
        return `Sorteio oficial: opção ${winner?.label}, decidida pelos administradores após empate.`;
      }
      return `Sorteio oficial: opção ${winner?.label}, escolhida na votação.`;
    case "INVALIDATED":
      return "Sorteio invalidado.";
  }
}

/** Sorteio na tela do jogador: composição dos times e votos, nunca força. */
export function DrawSection({ draw, sessionId, canVote }: { draw: DrawView; sessionId: string; canVote: boolean }) {
  const voting = draw.status === "VOTING";
  const totalVotes = draw.options.reduce((sum, option) => sum + option.votes, 0);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Sorteio dos times</h2>
        <p className="text-sm text-zinc-600">{drawStatusText(draw)}</p>
        {voting && (
          <p className="mt-1 text-sm text-zinc-500">
            {totalVotes} de {draw.eligibleVoters} mensalistas votaram.
            {canVote
              ? draw.myVoteOptionId
                ? " Você pode trocar o voto até o encerramento."
                : ""
              : " Só mensalistas confirmados nesta sessão votam."}
          </p>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {draw.options.map((option) => (
          <OptionCard
            key={option.id}
            option={option}
            official={option.id === draw.winningOptionId}
            mine={option.id === draw.myVoteOptionId}
            footer={
              voting && canVote ? (
                <VoteButton
                  sessionId={sessionId}
                  drawId={draw.id}
                  optionId={option.id}
                  label={option.label}
                  chosen={option.id === draw.myVoteOptionId}
                />
              ) : null
            }
          />
        ))}
      </div>
    </section>
  );
}
