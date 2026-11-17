import type { Metadata } from "next";
import { formatCentsBRL } from "@/lib/money";
import {
  darkAlertWarn,
  darkBadge,
  darkBadgeGold,
  darkCardPad,
  darkMuted,
  darkMutedXs,
  darkTitle,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { requireViewerForPayments } from "@/server/auth/dal";
import { getPlayerPaymentsPage } from "@/server/modules/finance/player-queries";
import { isDeclarationWithoutReceipt } from "@/domain/finance/receiptUpload";
import { CopyPixButton } from "./copy-pix-button";
import {
  AttachReceiptForm,
  PaymentDeclareForm,
  PendingDeclarationStatus,
} from "./receipt-upload-form";

export const metadata: Metadata = { title: "Pagamentos" };
export const dynamic = "force-dynamic";

export default async function PagamentosPage() {
  const viewer = await requireViewerForPayments();
  const data = await getPlayerPaymentsPage(viewer);

  if (!data.financeInitialized) {
    return (
      <section className="flex flex-col gap-4 pb-8">
        <div>
          <h1 className={darkTitle}>Pagamentos</h1>
          <p className={darkMuted}>{data.playerName}</p>
        </div>
        <div className={darkAlertWarn} role="status">
          <p className="font-semibold text-amber-50">Financeiro ainda não configurado</p>
          <p className="mt-1 text-sm text-amber-100/90">
            O módulo financeiro do grupo ainda não foi implantado. Quando um administrador
            concluir a configuração, suas cobranças e opções de pagamento aparecerão aqui.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 pb-8">
      <div>
        <h1 className={darkTitle}>Pagamentos</h1>
        <p className={darkMuted}>{data.playerName}</p>
      </div>

      {data.access.mode === "payment_restricted" ? (
        <div className={darkAlertWarn} role="status">
          <p className="font-semibold text-amber-50">Acesso temporariamente restrito</p>
          <p className="mt-1 text-sm text-amber-100/90">
            Você possui um pagamento pendente. Regularize sua situação para continuar utilizando o
            SMV. Envie o comprovante abaixo — a liberação ocorre após a aprovação de um
            administrador.
          </p>
        </div>
      ) : null}

      <div className={darkCardPad}>
        <p className={darkMutedXs}>Total em aberto</p>
        <p className="text-2xl font-semibold text-smv-gold-bright">
          {formatCentsBRL(data.outstandingCents)}
        </p>
        {data.access.reason === "exceptional_access" && (
          <p className={`${darkMuted} mt-2`}>Acesso liberado excepcionalmente enquanto houver dívida.</p>
        )}
      </div>

      <div className={darkCardPad}>
        <h2 className={darkTitleMd}>PIX</h2>
        {data.pix.key ? (
          <>
            <p className="text-sm text-white">
              {data.pix.beneficiary ? `Beneficiário: ${data.pix.beneficiary}` : "Beneficiário não informado"}
            </p>
            {data.pix.keyType && <p className={darkMutedXs}>Tipo: {data.pix.keyType}</p>}
            <p className="mt-2 break-all font-mono text-sm text-smv-gold-bright">{data.pix.key}</p>
            <div className="mt-3">
              <CopyPixButton value={data.pix.key} />
            </div>
          </>
        ) : (
          <p className={darkMuted}>PIX ainda não configurado. Peça a chave a um administrador.</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <p className={darkMutedXs}>Cobranças (mais antigas primeiro)</p>
        {data.charges.length === 0 ? (
          <p className={darkMuted}>Nenhuma cobrança registrada.</p>
        ) : (
          data.charges.map((c) => (
            <article key={c.id} className={darkCardPad}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={c.remainingCents > 0 ? darkBadgeGold : darkBadge}>
                  {c.uiStatusLabel}
                </span>
                <span className={darkBadge}>{c.type === "MONTHLY_FEE" ? "Mensalidade" : "Diária"}</span>
              </div>
              <p className="mt-2 font-medium text-white">{c.periodLabel}</p>
              <p className={darkMutedXs}>
                {formatCentsBRL(c.paidCents)} pagos de {formatCentsBRL(c.amountCents)} · aberto{" "}
                {formatCentsBRL(c.remainingCents)}
              </p>

              {c.receipts.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {c.receipts.map((r) => {
                    const noFile = isDeclarationWithoutReceipt(r);
                    return (
                      <li key={r.id} className={darkMutedXs}>
                        {r.status === "PENDING_REVIEW" &&
                          (noFile
                            ? "Informado — aguardando aprovação"
                            : "Informado com comprovante — aguardando aprovação")}
                        {r.status === "APPROVED" && "Aprovado"}
                        {r.status === "REJECTED" &&
                          `Rejeitado: ${r.rejectionReason ?? "sem motivo"}`}
                        {r.status === "SUPERSEDED" && "Substituído por envio mais recente"}
                        {r.claimedAmountCents != null
                          ? ` · ${formatCentsBRL(r.claimedAmountCents)}`
                          : ""}
                        {" · "}
                        {r.createdAt.toLocaleString("pt-BR")}
                      </li>
                    );
                  })}
                </ul>
              )}

              {c.remainingCents > 0 && (
                <div className="mt-3">
                  {(() => {
                    const pending = c.receipts.find((r) => r.status === "PENDING_REVIEW");
                    if (!pending) {
                      return (
                        <PaymentDeclareForm
                          chargeId={c.id}
                          remainingCents={c.remainingCents}
                        />
                      );
                    }
                    const hasReceipt = !isDeclarationWithoutReceipt(pending);
                    if (hasReceipt) {
                      return <PendingDeclarationStatus hasReceipt />;
                    }
                    return (
                      <>
                        <PendingDeclarationStatus hasReceipt={false} />
                        <div className="mt-3">
                          <AttachReceiptForm
                            receiptId={pending.id}
                            claimedAmountCents={pending.claimedAmountCents}
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
