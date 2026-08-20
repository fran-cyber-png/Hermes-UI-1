/**
 * Clases compartidas entre features — la fábrica canónica.
 * Regla dura: sombra O borde, nunca ambos. cardClass lleva borde (la elección
 * institucional sobre #F5F7FB); quien necesite flotar usa shadow-panel SIN borde.
 * El kicker uppercase NO es el default: sectionLabel es sentence-case; `kicker`
 * existe aparte y se usa como máximo UNA vez por vista (cintillo ganado).
 */
export const sectionLabel = 'text-xs font-semibold text-muted-foreground';
export const kicker = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
export const fieldClass = 'rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground';
export const cardClass = 'rounded-2xl border border-border bg-card overflow-hidden';
export const cardHeaderClass = 'flex items-center justify-between border-b border-border px-5 py-3 font-heading text-sm font-bold text-navy-ink';
