/**
 * SMV dark-only design system.
 * Navy surfaces + gold primary actions + cream text. Semantic colors stay for status.
 */

/* ——— Surfaces ——— */
export const darkHeroShell =
  "overflow-hidden rounded-3xl bg-smv-navy text-smv-cream shadow-lg shadow-smv-navy/20 ring-1 ring-white/10";

export const darkHeroGradient =
  "radial-gradient(ellipse at top right, rgba(201,162,39,0.18), transparent 55%), linear-gradient(145deg, #132a40 0%, #0b1c2c 48%, #061018 100%)";

export const darkCard =
  "rounded-2xl border border-white/10 bg-smv-navy-card text-smv-cream shadow-sm";

export const darkCardPad = `${darkCard} p-4`;

export const darkInset = "rounded-2xl bg-black/25 p-3 ring-1 ring-white/10";

export const darkPanel = "rounded-xl bg-white/8 ring-1 ring-white/10";

export const darkStat =
  "rounded-xl bg-white/8 px-2 py-2.5 text-center ring-1 ring-white/10";

export const darkEmpty =
  "rounded-xl border border-dashed border-white/20 bg-smv-navy-card/80 px-4 py-6 text-center text-sm text-white/55";

export const darkEmptyCompact =
  "rounded-xl border border-dashed border-white/20 bg-smv-navy-card/80 px-4 py-3 text-sm text-white/55";

export const darkList =
  "overflow-hidden rounded-2xl border border-white/10 bg-smv-navy-card divide-y divide-white/8";

export const darkListRow =
  "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors active:bg-white/5";

export const darkLinkCard =
  "flex min-h-14 items-center justify-between gap-3 rounded-xl border border-white/10 bg-smv-navy-card px-4 py-3 transition-colors active:bg-smv-navy-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold";

/* ——— Typography ——— */
export const darkSectionLabel =
  "text-xs font-semibold uppercase tracking-[0.14em] text-smv-gold";

export const darkTitle = "text-2xl font-semibold text-smv-cream";
export const darkTitleMd = "text-lg font-semibold text-white";
export const darkBody = "text-sm text-white/75";
export const darkMuted = "text-sm text-white/55";
export const darkMutedXs = "text-xs text-white/50";
export const darkBackLink = "text-sm text-white/55 hover:text-smv-cream";
export const darkInlineLink = "underline text-smv-gold-bright hover:text-smv-cream";

/* ——— Badges ——— */
export const darkBadge =
  "rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white/70 ring-1 ring-white/10";

export const darkBadgeGold =
  "rounded-full bg-smv-gold/15 px-2 py-0.5 text-xs font-medium text-smv-gold-bright ring-1 ring-smv-gold/30";

export const darkBadgeSuccess =
  "rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-300/30";

export const darkBadgeWarn =
  "rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-medium text-amber-100 ring-1 ring-amber-300/30";

export const darkBadgeDanger =
  "rounded-full bg-red-400/15 px-2 py-0.5 text-xs font-medium text-red-200 ring-1 ring-red-300/30";

export const darkBadgeInfo =
  "rounded-full bg-sky-400/15 px-2 py-0.5 text-xs font-medium text-sky-100 ring-1 ring-sky-300/30";

/* ——— Controls ——— */
export const darkControl =
  "min-h-12 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-base font-normal text-smv-cream outline-none placeholder:text-white/35 focus:border-smv-gold/60 focus:ring-2 focus:ring-smv-gold/25 disabled:opacity-50";

export const darkLabel = "flex flex-col gap-1 text-sm font-medium text-white/75";

export const darkHint = "text-xs font-normal text-white/45";

/* ——— Buttons ——— */
export const darkBtnBase =
  "inline-flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold focus-visible:ring-offset-2 focus-visible:ring-offset-smv-navy";

export const darkBtnPrimary = `${darkBtnBase} bg-smv-gold text-smv-navy active:bg-smv-gold-bright`;

export const darkBtnSecondary = `${darkBtnBase} border border-white/25 bg-transparent text-smv-cream active:bg-white/8`;

export const darkBtnDanger = `${darkBtnBase} border border-red-300/40 bg-transparent text-red-200 active:bg-red-500/15`;

export const darkBtnGhost =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-white/65 transition-colors hover:bg-white/8 hover:text-smv-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold";

/* ——— Feedback ——— */
export const darkAlertError =
  "rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100 ring-1 ring-red-300/40";

export const darkAlertSuccess =
  "rounded-lg bg-emerald-400/15 px-3 py-2 text-sm text-emerald-100 ring-1 ring-emerald-300/30";

export const darkAlertWarn =
  "rounded-lg bg-amber-400/15 px-3 py-2 text-sm text-amber-100 ring-1 ring-amber-300/30";

export const darkAlertInfo =
  "rounded-lg bg-sky-400/15 px-3 py-2 text-sm text-sky-100 ring-1 ring-sky-300/30";

/* ——— Tables ——— */
export const darkTableWrap =
  "overflow-x-auto rounded-2xl border border-white/10 bg-smv-navy-card";

export const darkTableHead =
  "border-b border-white/10 text-xs uppercase tracking-wide text-white/50";

export const darkTableCell = "px-3 py-2 text-sm text-white/80";
