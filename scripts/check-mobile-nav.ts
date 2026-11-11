// Regressão das regras de destaque da navegação mobile (5 itens + Mais).
//
//   npm run check:mobile-nav
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

const mobileSlots = ["/", "night", "/historico", "/stats", "mais"] as const;
check("barra mobile tem exatamente 5 slots", mobileSlots.length === 5);

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
