"use client";

import { useActionState, type FormEvent } from "react";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import { useConfirm } from "@/components/confirm-dialog";
import { ActionToast } from "@/components/toast/action-toast";
import {
  darkBtnGhost,
  darkBtnPrimary,
  darkBtnSecondary,
  darkInset,
  darkMuted,
  darkMutedXs,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";
import type { ProposalBoardItem, ProposalVoteRow } from "@/server/modules/ratings/queries";
import {
  castRatingVoteAction,
  closeRatingVotingAction,
  finalizeRatingProposalAction,
  reviewRatingProposalAction,
  withdrawRatingVoteAction,
  type RatingsActionState,
} from "@/server/modules/ratings/actions";
import { STATUS_LABEL, statusAccentBorder, statusBadgeClass } from "./format";
import { RatingComparison } from "./rating-comparison";

function LockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0 opacity-80"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 1.5A2.5 2.5 0 0 0 5.5 4v2h5V4A2.5 2.5 0 0 0 8 1.5ZM4.5 6V4a3.5 3.5 0 1 1 7 0v2h.5A1.5 1.5 0 0 1 13.5 7.5v5A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4 6h.5Z" />
    </svg>
  );
}

function VoterChips({
  label,
  tone,
  voters,
}: {
  label: string;
  tone: "for" | "against";
  voters: ProposalVoteRow[];
}) {
  const chip =
    tone === "for"
      ? "bg-emerald-400/12 text-emerald-100 ring-emerald-300/25"
      : "bg-rose-400/12 text-rose-100 ring-rose-300/25";
  const adminChip =
    tone === "for"
      ? "bg-smv-gold/15 text-smv-gold-bright ring-smv-gold/30"
      : "bg-smv-gold/12 text-smv-gold-bright ring-smv-gold/25";
  return (
    <div className="flex flex-col gap-1.5">
      <p className={darkMutedXs}>
        {label} · {voters.length}
      </p>
      {voters.length === 0 ? (
        <p className="text-xs text-white/35">Ninguém ainda</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {voters.map((v) => (
            <li
              key={`${v.voterMemberId}-${v.choice}`}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                v.voterRole === "ADMIN" && !v.isFixedProposer ? adminChip : chip
              }`}
              title={
                v.isFixedProposer
                  ? `Proponente · @${v.voterUsername}`
                  : v.voterRole === "ADMIN"
                    ? `Admin · @${v.voterUsername}`
                    : `@${v.voterUsername}`
              }
            >
              {v.isFixedProposer ? <LockIcon /> : null}
              <span>{v.voterName}</span>
              {v.isFixedProposer ? (
                <span className="rounded bg-emerald-300/20 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-100">
                  Proponente
                </span>
              ) : v.voterRole === "ADMIN" ? (
                <span className="rounded bg-smv-gold/20 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-smv-gold-bright">
                  Admin
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfirmSubmitForm({
  action,
  children,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  submitLabel,
  submitVariant = "primary",
}: {
  action: (prev: RatingsActionState, formData: FormData) => Promise<RatingsActionState>;
  children?: React.ReactNode;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  submitLabel: string;
  submitVariant?: "primary" | "secondary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const confirm = useConfirm();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (form.dataset.bypassConfirm === "1") {
      delete form.dataset.bypassConfirm;
      return;
    }
    event.preventDefault();
    const ok = await confirm({
      title: confirmTitle,
      description: confirmDescription,
      confirmLabel,
      tone: submitVariant === "danger" ? "danger" : "default",
    });
    if (!ok) return;
    form.dataset.bypassConfirm = "1";
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-2">
      <ActionToast state={state} successTitle="Atualizado" errorTitle="Falha" />
      {children}
      <SubmitButton
        pending={pending}
        label={submitLabel}
        pendingLabel="Processando…"
        variant={submitVariant}
      />
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </form>
  );
}

function ScoreBar({
  forCount,
  againstCount,
}: {
  forCount: number;
  againstCount: number;
}) {
  const total = forCount + againstCount;
  const forPct = total === 0 ? 50 : Math.round((forCount / total) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-smv-cream">
          <span className="font-semibold tabular-nums text-emerald-300">{forCount}</span>
          <span className="text-white/40"> a favor</span>
          <span className="mx-1.5 text-white/25">·</span>
          <span className="font-semibold tabular-nums text-rose-300">{againstCount}</span>
          <span className="text-white/40"> contra</span>
        </p>
        {total > 0 ? (
          <span className={darkMutedXs}>{forPct}% a favor</span>
        ) : (
          <span className={darkMutedXs}>Sem votos</span>
        )}
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-white/10"
        role="img"
        aria-label={`${forCount} a favor, ${againstCount} contra`}
      >
        <span
          className="bg-emerald-400/80 transition-[width]"
          style={{ width: `${total === 0 ? 50 : forPct}%` }}
        />
        <span className="flex-1 bg-rose-400/70" />
      </div>
    </div>
  );
}

export function ProposalRow({
  proposal,
  isAdmin,
  canVote,
  viewerMemberId,
}: {
  proposal: ProposalBoardItem;
  isAdmin: boolean;
  canVote: boolean;
  viewerMemberId: string;
}) {
  const isTarget = proposal.targetMemberId === viewerMemberId;
  const isProposer = proposal.isViewerProposer;
  // Proposer never gets mutable voting controls; eligibility still drives Admin/others.
  const votingOpen =
    proposal.status === "OPEN_FOR_VOTING" && canVote && !isTarget && !isProposer;
  const showScore =
    proposal.status === "OPEN_FOR_VOTING" || proposal.status === "VOTING_CLOSED";
  const [voteState, voteAction, votePending] = useActionState(castRatingVoteAction, undefined);
  const [withdrawState, withdrawAction, withdrawPending] = useActionState(
    withdrawRatingVoteAction,
    undefined,
  );

  return (
    <article
      className={`flex flex-col gap-3 border-l-2 ${statusAccentBorder(proposal.status)} ${darkInset}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold text-smv-cream">{proposal.attributeLabel}</p>
        <span className={statusBadgeClass(proposal.status)}>
          {STATUS_LABEL[proposal.status] ?? proposal.status}
        </span>
      </div>

      <RatingComparison fromValue={proposal.fromValue} toValue={proposal.toValue} />

      <p className={`text-sm leading-relaxed ${darkMuted}`}>“{proposal.reason}”</p>
      <p className={darkMutedXs}>
        Sugerido por {proposal.proposedByName}
        <span className="text-white/35"> · @{proposal.proposedByUsername}</span>
      </p>

      {showScore ? (
        <div className="flex flex-col gap-3">
          <ScoreBar forCount={proposal.liveForCount} againstCount={proposal.liveAgainstCount} />
          {proposal.status === "VOTING_CLOSED" ? (
            <p className={darkMutedXs}>
              Recomendação da votação:{" "}
              <span className="font-medium text-smv-cream">
                {proposal.advisory === "PASS"
                  ? "aprovar"
                  : proposal.advisory === "REJECT"
                    ? "rejeitar"
                    : "empate"}
              </span>
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <VoterChips label="A favor" tone="for" voters={proposal.votesFor} />
            <VoterChips label="Contra" tone="against" voters={proposal.votesAgainst} />
          </div>
          {isProposer && proposal.status === "OPEN_FOR_VOTING" ? (
            <p className="text-xs font-medium text-smv-gold-bright">
              Seu voto a favor foi registrado automaticamente e não pode ser alterado.
            </p>
          ) : proposal.myChoice ? (
            <p className="text-xs font-medium text-smv-gold-bright">
              Seu voto: {proposal.myChoice === "FOR" ? "a favor" : "contra"}
            </p>
          ) : null}
        </div>
      ) : null}

      {votingOpen ? (
        <div className="flex flex-col gap-2">
          <ActionToast state={voteState} successTitle="Voto" errorTitle="Falha no voto" />
          <ActionToast state={withdrawState} successTitle="Voto" errorTitle="Falha" />
          <div className="flex flex-wrap gap-2">
            <form action={voteAction}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="choice" value="FOR" />
              <button
                type="submit"
                disabled={votePending || proposal.myChoice === "FOR"}
                className={`${darkBtnPrimary} min-h-11 px-4 text-sm disabled:opacity-50`}
              >
                A favor
              </button>
            </form>
            <form action={voteAction}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="choice" value="AGAINST" />
              <button
                type="submit"
                disabled={votePending || proposal.myChoice === "AGAINST"}
                className={`${darkBtnSecondary} min-h-11 px-4 text-sm disabled:opacity-50`}
              >
                Contra
              </button>
            </form>
            {proposal.myChoice ? (
              <form action={withdrawAction}>
                <input type="hidden" name="proposalId" value={proposal.id} />
                <button
                  type="submit"
                  disabled={withdrawPending}
                  className={darkBtnGhost}
                >
                  Retirar voto
                </button>
              </form>
            ) : null}
          </div>
          <FormError
            message={
              voteState?.status === "error"
                ? voteState.error
                : withdrawState?.status === "error"
                  ? withdrawState.error
                  : undefined
            }
          />
        </div>
      ) : null}

      {isTarget && proposal.status === "OPEN_FOR_VOTING" ? (
        <p className={darkMutedXs}>Você não pode votar em proposta sobre a própria nota.</p>
      ) : null}

      {isAdmin && proposal.status === "PENDING_ADMIN_REVIEW" ? (
        <div className="flex flex-col gap-3 border-t border-white/10 pt-3">
          <p className={darkSectionLabel}>Moderação</p>
          <ConfirmSubmitForm
            action={reviewRatingProposalAction}
            confirmTitle="Aprovar para votação?"
            confirmDescription="A comunidade poderá votar a favor ou contra esta sugestão. O proponente recebe um voto a favor fixo."
            confirmLabel="Abrir votação"
            submitLabel="Aprovar para votação"
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="hidden" name="decision" value="APPROVE" />
          </ConfirmSubmitForm>
          <ConfirmSubmitForm
            action={reviewRatingProposalAction}
            confirmTitle="Rejeitar sugestão?"
            confirmDescription="A proposta permanece no histórico. Informe o motivo."
            confirmLabel="Rejeitar"
            submitLabel="Rejeitar sugestão"
            submitVariant="danger"
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="hidden" name="decision" value="REJECT" />
            <TextField label="Motivo da rejeição" name="reason" required maxLength={500} />
          </ConfirmSubmitForm>
        </div>
      ) : null}

      {isAdmin && proposal.status === "OPEN_FOR_VOTING" ? (
        <div className="border-t border-white/10 pt-3">
          <p className={`${darkSectionLabel} mb-2`}>Moderação</p>
          <ConfirmSubmitForm
            action={closeRatingVotingAction}
            confirmTitle="Encerrar votação?"
            confirmDescription="Os totais serão congelados. Depois você aplica ou rejeita a nota."
            confirmLabel="Encerrar"
            submitLabel="Encerrar votação"
            submitVariant="secondary"
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
          </ConfirmSubmitForm>
        </div>
      ) : null}

      {isAdmin && proposal.status === "VOTING_CLOSED" ? (
        <div className="flex flex-col gap-3 border-t border-white/10 pt-3">
          <p className={darkSectionLabel}>Decisão final</p>
          <ConfirmSubmitForm
            action={finalizeRatingProposalAction}
            confirmTitle="Aplicar alteração de nota?"
            confirmDescription={`Isso altera ${proposal.attributeLabel} de ${proposal.fromValue ?? "sem nota"} para ${proposal.toValue}. Sorteios já feitos não mudam.`}
            confirmLabel="Aplicar nota"
            submitLabel="Aplicar nota"
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="hidden" name="decision" value="APPLY" />
            <TextField
              label="Motivo da decisão final"
              name="reason"
              required
              maxLength={500}
              placeholder={
                proposal.advisory === "PASS"
                  ? "Confirmar resultado da votação…"
                  : "Justifique o override / decisão…"
              }
            />
          </ConfirmSubmitForm>
          <ConfirmSubmitForm
            action={finalizeRatingProposalAction}
            confirmTitle="Rejeitar na decisão final?"
            confirmDescription="A nota não muda. Motivo obrigatório (inclusive para override da maioria)."
            confirmLabel="Rejeitar"
            submitLabel="Rejeitar proposta"
            submitVariant="danger"
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="hidden" name="decision" value="REJECT" />
            <TextField label="Motivo" name="reason" required maxLength={500} />
          </ConfirmSubmitForm>
        </div>
      ) : null}

      {proposal.initialReviewReason ? (
        <p className={darkMutedXs}>Revisão inicial: {proposal.initialReviewReason}</p>
      ) : null}
      {proposal.finalDecisionReason ? (
        <p className={darkMutedXs}>Decisão final: {proposal.finalDecisionReason}</p>
      ) : null}
    </article>
  );
}
