// Regressão do sistema global de toast/confirmação e feedback de restrição financeira.
//
//   npm run check:app-feedback
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  clearToasts,
  dismissToast,
  getToasts,
  pushToast,
} from "../src/components/toast/store";
import {
  PAYMENT_RESTRICTED_FLASH,
  paymentRestrictedRedirectPath,
  SMV_FLASH_COOKIE,
  SMV_FLASH_PAYMENT_RESTRICTED,
  SMV_FLASH_QUERY,
  TOAST_DEFAULT_DURATION_MS,
} from "../src/components/toast/types";
import {
  isPostLoginSoftNavPath,
  resolvePostAuthPath,
} from "../src/domain/auth/post-auth-path";
import {
  isPathAllowedWhenPaymentRestricted,
  PAYMENT_RESTRICTED_ALLOWED_PREFIXES,
} from "../src/domain/finance/accessPolicy";
import {
  restrictedDesktopNavItems,
  restrictedMobileNavItems,
  shouldUseRestrictedNav,
} from "../src/domain/nav/restricted-nav";

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok });
}

function readSrc(rel: string): string {
  return readFileSync(path.resolve(rel), "utf8");
}

function walkHasNativeDialog(relDir: string): boolean {
  const entries = readdirSync(path.resolve(relDir), { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      if (walkHasNativeDialog(full)) return true;
      continue;
    }
    if (!/\.(tsx|ts|jsx|js)$/.test(entry.name)) continue;
    const text = readFileSync(path.resolve(full), "utf8");
    if (/\bwindow\.(alert|confirm)\s*\(/.test(text)) return true;
  }
  return false;
}

clearToasts();
pushToast({ tone: "success", title: "Ok", description: "sucesso", id: "t-success" });
pushToast({ tone: "error", title: "Erro", description: "falhou", id: "t-error" });
pushToast({ tone: "warning", title: "Aviso", description: "cuidado", id: "t-warning" });
pushToast({ tone: "info", title: "Info", description: "dica", id: "t-info" });
const tones = new Set(getToasts().map((t) => t.tone));
check(
  "toast store renderiza success/error/warning/info",
  tones.has("success") && tones.has("error") && tones.has("warning") && tones.has("info"),
);
check(
  "erros ficam visíveis mais tempo que sucesso",
  TOAST_DEFAULT_DURATION_MS.error > TOAST_DEFAULT_DURATION_MS.success &&
    TOAST_DEFAULT_DURATION_MS.warning > TOAST_DEFAULT_DURATION_MS.success,
);

clearToasts();
pushToast({ tone: "warning", title: "A", description: "1", id: "same" });
pushToast({ tone: "warning", title: "A", description: "2", id: "same" });
check("dedupe não empilha o mesmo id", getToasts().length === 1 && getToasts()[0]?.description === "2");

dismissToast("same");
check("dismiss remove toast", getToasts().length === 0);

check(
  "flash de restrição usa wording canônico",
  PAYMENT_RESTRICTED_FLASH.title === "Acesso temporariamente restrito" &&
    PAYMENT_RESTRICTED_FLASH.description?.includes("pagamento pendente") === true &&
    PAYMENT_RESTRICTED_FLASH.tone === "warning" &&
    PAYMENT_RESTRICTED_FLASH.id === "payment-restricted",
);
check("cookie flash sem detalhes financeiros na URL", SMV_FLASH_COOKIE === "smv_flash");
check(
  "redirect RSC usa aviso opaco (sem valores/ids)",
  paymentRestrictedRedirectPath() === `/pagamentos?${SMV_FLASH_QUERY}=${SMV_FLASH_PAYMENT_RESTRICTED}` &&
    !paymentRestrictedRedirectPath().includes("cent") &&
    !paymentRestrictedRedirectPath().includes("charge"),
);

check(
  "post-auth path: admin/full → /",
  resolvePostAuthPath(false, "full") === "/" && resolvePostAuthPath(false, "full") !== "/pagamentos",
);
check(
  "post-auth path: restricted → pagamentos (mesmo query do toast)",
  resolvePostAuthPath(false, "payment_restricted") === paymentRestrictedRedirectPath(),
);
check(
  "post-auth path: mustChangePassword tem prioridade",
  resolvePostAuthPath(true, "payment_restricted") === "/change-password",
);
check(
  "soft-nav pós-login detecta /login e pathname vazio",
  isPostLoginSoftNavPath("") &&
    isPostLoginSoftNavPath("/login") &&
    isPostLoginSoftNavPath("/login?x=1") &&
    !isPostLoginSoftNavPath("/") &&
    !isPostLoginSoftNavPath("/pagamentos"),
);

const proxyTs = readSrc("src/proxy.ts");
check(
  "proxy propaga x-smv-pathname também em /login",
  proxyTs.includes('requestHeaders.set("x-smv-pathname"') &&
    proxyTs.includes("PUBLIC_PATHS.has") &&
    proxyTs.indexOf('requestHeaders.set("x-smv-pathname"') <
      proxyTs.indexOf("PUBLIC_PATHS.has"),
);

const authActions = readSrc("src/server/auth/actions.ts");
check(
  "login resolve destino pós-auth (sem só redirect /)",
  authActions.includes("redirectAfterSessionIssued") &&
    authActions.includes("resolvePostAuthPath") &&
    authActions.includes('revalidatePath("/", "layout")'),
);

const accessTsLogin = readSrc("src/server/modules/finance/access.ts");
{
  const enforceStart = accessTsLogin.indexOf(
    "export async function enforceFinancialAccessOrRedirect",
  );
  const assertStart = accessTsLogin.indexOf("export async function assertNotPaymentRestricted");
  const enforceBody = accessTsLogin.slice(enforceStart, assertStart);
  check(
    "restrição em soft-nav pós-login redireciona (não throw)",
    enforceStart >= 0 &&
      assertStart > enforceStart &&
      enforceBody.includes("isPostLoginSoftNavPath") &&
      enforceBody.includes("paymentRestrictedRedirectPath") &&
      !enforceBody.includes("UserFacingError"),
  );
}

check(
  "paths permitidos em restrição",
  isPathAllowedWhenPaymentRestricted("/pagamentos") &&
    isPathAllowedWhenPaymentRestricted("/pagamentos/") &&
    isPathAllowedWhenPaymentRestricted("/financeiro") &&
    isPathAllowedWhenPaymentRestricted("/account") &&
    isPathAllowedWhenPaymentRestricted("/api/finance/receipts/x") &&
    !isPathAllowedWhenPaymentRestricted("/stats") &&
    !isPathAllowedWhenPaymentRestricted("/admin") &&
    !isPathAllowedWhenPaymentRestricted("/rodada") &&
    PAYMENT_RESTRICTED_ALLOWED_PREFIXES.includes("/pagamentos") &&
    PAYMENT_RESTRICTED_ALLOWED_PREFIXES.includes("/financeiro"),
);

check("shouldUseRestrictedNav só em payment_restricted", shouldUseRestrictedNav("payment_restricted"));
check("shouldUseRestrictedNav false em full", !shouldUseRestrictedNav("full"));

const desktop = restrictedDesktopNavItems([
  { href: "/" },
  { href: "/pagamentos" },
  { href: "/financeiro" },
  { href: "/account" },
  { href: "/stats" },
]);
check(
  "nav desktop restrita: pagamentos+financeiro+conta",
  desktop.length === 3 &&
    desktop.every(
      (item) =>
        item.href === "/pagamentos" || item.href === "/financeiro" || item.href === "/account",
    ),
);

const mobile = restrictedMobileNavItems(
  [
    { href: "/", label: "Início" },
    { href: "/historico", label: "Histórico" },
  ],
  { href: "/pagamentos", label: "Pagamentos" },
  { href: "/financeiro", label: "Financeiro" },
);
check(
  "nav mobile restrita: pagamentos+financeiro",
  mobile.length === 2 &&
    mobile[0]?.href === "/pagamentos" &&
    mobile[1]?.href === "/financeiro",
);

const accessTs = readSrc("src/server/modules/finance/access.ts");
check(
  "redirect de restrição usa path helper (sem cookie em RSC)",
  accessTs.includes("paymentRestrictedRedirectPath") &&
    !accessTs.includes("setPaymentRestrictedFlash"),
);

const pagamentos = readSrc("src/app/(app)/pagamentos/page.tsx");
check(
  "banner persistente em /pagamentos",
  pagamentos.includes("Acesso temporariamente restrito") &&
    pagamentos.includes("pagamento pendente") &&
    pagamentos.includes('role="status"'),
);

const viewport = readSrc("src/components/toast/toast-viewport.tsx");
check(
  "toast viewport acessível (live region + dismiss)",
  viewport.includes('aria-live="polite"') &&
    viewport.includes('aria-label="Fechar notificação"') &&
    viewport.includes('role={toast.tone === "error" || toast.tone === "warning" ? "alert" : "status"}') &&
    viewport.includes("safe-area-inset-top") &&
    viewport.includes("md:right-4"),
);

const rootLayout = readSrc("src/app/layout.tsx");
check("AppFeedback no root layout", rootLayout.includes("AppFeedback"));

const confirmDialog = readSrc("src/components/confirm-dialog.tsx");
check(
  "confirm dialog modal acessível",
  confirmDialog.includes('role="dialog"') &&
    confirmDialog.includes("aria-modal") &&
    confirmDialog.includes("useConfirmSubmit"),
);

check(
  "nenhum window.alert/confirm em src/app e src/components",
  !walkHasNativeDialog("src/app") && !walkHasNativeDialog("src/components"),
);

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
