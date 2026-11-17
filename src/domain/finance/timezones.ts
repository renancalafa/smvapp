/** Opções de fuso exibidas na UI Admin. Valor = IANA; label = legível. */

export const GROUP_TIMEZONE_OPTIONS = [
  { value: "America/Recife", label: "Recife — UTC−3" },
  { value: "America/Sao_Paulo", label: "São Paulo — UTC−3" },
  { value: "America/Fortaleza", label: "Fortaleza — UTC−3" },
  { value: "America/Belem", label: "Belém — UTC−3" },
  { value: "America/Bahia", label: "Bahia — UTC−3" },
  { value: "America/Manaus", label: "Manaus — UTC−4" },
  { value: "America/Cuiaba", label: "Cuiabá — UTC−4" },
  { value: "America/Porto_Velho", label: "Porto Velho — UTC−4" },
  { value: "America/Rio_Branco", label: "Rio Branco — UTC−5" },
  { value: "America/Noronha", label: "Fernando de Noronha — UTC−2" },
] as const;

export function timezoneSelectOptions(current: string): { value: string; label: string }[] {
  const known = GROUP_TIMEZONE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  if (known.some((o) => o.value === current)) return known;
  return [{ value: current, label: `${current} (atual)` }, ...known];
}

export function timezoneDisplayLabel(iana: string): string {
  return GROUP_TIMEZONE_OPTIONS.find((o) => o.value === iana)?.label ?? iana;
}
