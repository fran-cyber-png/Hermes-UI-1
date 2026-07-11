/**
 * Clases compartidas entre features. Viven aquí y no dentro de un feature para
 * que `leads` no tenga que importar de `campaigns` solo para pintar una tarjeta.
 */
export const sectionLabel = 'text-xs font-bold uppercase tracking-wide text-muted-foreground';
export const fieldClass = 'rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground';
export const cardClass = 'rounded-2xl border border-border bg-card shadow-sm overflow-hidden';
export const cardHeaderClass = 'bg-navy px-5 py-3 text-sm font-bold text-white';
