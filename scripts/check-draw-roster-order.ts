// Regressão pura da ordem de exibição do elenco no sorteio.
//
//   npm run check:draw-roster-order
import { sortDrawRosterPlayers } from "../src/domain/draw/roster-order";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const sample = [
  { memberId: "m-b", name: "Bruno", strength: 4 },
  { memberId: "m-a", name: "Ana", strength: 5 },
  { memberId: "m-c", name: "Carlos", strength: 4 },
  { memberId: "m-d", name: "Diana", strength: 3 },
  { memberId: "m-e", name: "Ana", strength: 4 },
];

const original = sample.map((row) => ({ ...row }));
const sorted = sortDrawRosterPlayers(sample);

check(
  "não muta o array original",
  sample.every((row, index) => row.memberId === original[index]!.memberId && row.strength === original[index]!.strength),
);

check(
  "força descendente",
  sorted.map((row) => row.strength).join(",") === "5,4,4,4,3",
);

check(
  "empate de força: nome alfabético",
  sorted.filter((row) => row.strength === 4).map((row) => row.name).join(",") === "Ana,Bruno,Carlos",
);

check(
  "empate nome+força: memberId estável",
  sortDrawRosterPlayers([
    { memberId: "z", name: "Ana", strength: 4 },
    { memberId: "a", name: "Ana", strength: 4 },
  ])
    .map((row) => row.memberId)
    .join(",") === "a,z",
);

check(
  "null strength fica por último",
  sortDrawRosterPlayers([
    { memberId: "n", name: "Nulo", strength: null },
    { memberId: "a", name: "Alto", strength: 2 },
  ])
    .map((row) => row.memberId)
    .join(",") === "a,n",
);

for (const result of results) {
  console.log(
    `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
  );
}
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
if (failed > 0) process.exit(1);
