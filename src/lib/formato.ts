/**
 * La voz de imprenta: helpers de formato compartidos entre vistas.
 *
 * tempClass/tempBorde son EL contrato único de la rampa de temperatura: tiñen
 * solo tinta de marcas de tiempo (y el filete de 2px del kanban) — jamás fondos
 * ni bordes en masa. El oro NO vive acá: la ventana de 20-24h la maneja quien
 * conoce la ventana, no esta rampa.
 */

/** Horas transcurridas desde una fecha hasta ahora. Acepta ISO, epoch ms o Date. */
export function horasDesde(fecha: string | number | Date): number {
  const t = typeof fecha === 'number' ? fecha : new Date(fecha).getTime();
  return (Date.now() - t) / 3_600_000;
}

/** Tinta para el "hace X" según la edad del dato. Fresco y tibio callan. */
export function tempClass(fecha: string | Date): string {
  const h = horasDesde(fecha);
  if (h < 72) return 'text-muted-foreground';
  if (h < 336) return 'text-temp-frio';
  return 'text-temp-helado';
}

/** Filete izquierdo (border-l) de temperatura para tarjetas del kanban. */
export function tempBorde(fecha: string | Date): string {
  const h = horasDesde(fecha);
  if (h < 24) return 'border-l-temp-fresco';
  if (h < 72) return 'border-l-temp-tibio';
  if (h < 336) return 'border-l-temp-frio';
  return 'border-l-temp-helado';
}

/** '51986394450' → '51 986 394 450' (código de país + tríos). */
export function formatoTelefono(t: string): string {
  const digitos = t.replace(/\D/g, '');
  if (digitos.length < 8) return t;
  const cc = digitos.length > 9 ? digitos.slice(0, digitos.length - 9) : '';
  const resto = digitos.slice(cc.length);
  const grupos = resto.match(/.{1,3}/g) ?? [resto];
  return [cc, ...grupos].filter(Boolean).join(' ');
}

/** '2026-03-12…' → '12 mar 2026'. Si no parsea, devuelve el crudo tal cual. */
export function fechaCorta(f: string): string {
  const ms = Date.parse(f);
  if (Number.isNaN(ms)) return f;
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * «recién» / «hace 40 min» / «hace 2 h» / «hace 3 días» — a partir de una fecha
 * ISO. Compartida (antes vivía copiada en `VistaCorreos.tsx` y de nuevo en
 * `PanelNotas.tsx`; una tercera copia fue la señal de sacarla para acá).
 * Distinta de `datos/frescura.ts#hace`, que recibe HORAS ya calculadas (esa
 * vive aparte porque su reloj es inyectable — la usa el sello de "caché
 * viejo" con `Date.now()` como parámetro, no como global).
 */
export function hace(fecha: string): string {
  const ms = Date.now() - new Date(fecha).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
