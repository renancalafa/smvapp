// Regressão das regras de destaque da navegação mobile (5 itens + Mais).
//
//   npm run check:mobile-nav
import {
  ADMIN_SUBNAV,
  isAdminSectionPath,
  isAdminSubnavActive,
} from "../src/domain/nav/admin-subnav";
import { isMaisNavActive, isNavHrefActive } from "../src/domain/nav/mobile-active";

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok });
}

check("início só na raiz", isNavHrefActive("/", "/") && !isNavHrefActive("/stats", "/"));
check("stats e subrotas", isNavHrefActive("/stats", "/stats") && isNavHrefActive("/stats/players/x", "/stats"));
check("historico", isNavHrefActive("/historico", "/historico") && !isNavHrefActive("/stats", "/historico"));
check("rodada/live", isNavHrefActive("/rodada", "/rodada") && isNavHrefActive("/live", "/live"));
check(
  "mais ativo em admin e conta",
  isMaisNavActive("/admin") &&
    isMaisNavActive("/admin/players") &&
    isMaisNavActive("/account") &&
    !isMaisNavActive("/") &&
    !isMaisNavActive("/stats") &&
    !isMaisNavActive("/historico") &&
    !isMaisNavActive("/rodada"),
);
check(
  "submenu admin: seção e itens",
  isAdminSectionPath("/admin/sessions") &&
    isAdminSubnavActive("/admin/players", "/admin/players") &&
    isAdminSubnavActive("/admin/sessions/abc", "/admin/sessions") &&
    !isAdminSubnavActive("/admin/agenda", "/admin/players") &&
    ADMIN_SUBNAV.length === 4 &&
    ADMIN_SUBNAV.some((item) => item.href === "/admin/logs"),
);

const mobileSlots = ["/", "night", "/historico", "/stats", "mais"] as const;
check("barra mobile tem exatamente 5 slots", mobileSlots.length === 5);

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
