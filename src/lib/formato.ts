/**
 * La voz de imprenta: helpers de formato compartidos entre vistas.
 *
 * tempClass/tempBorde son EL contrato único de la rampa de temperatura: tiñen
 * solo tinta de marcas de tiempo (y el filete de 2px del kanban) — jamás fondos
 * ni bordes en masa. El oro NO vive acá: la ventana de 20-24h la maneja quien
 * conoce la ventana, no esta rampa.
 */

/** Tinta para el "hace X" según la edad del dato. Fresco y tibio callan. */
export function tempClass(fecha: string | Date): string {
  const h = (Date.now() - new Date(fecha).getTime()) / 3_600_000;
  if (h < 72) return 'text-muted-foreground';
  if (h < 336) return 'text-temp-frio';
  return 'text-temp-helado';
}

/** Filete izquierdo (border-l) de temperatura para tarjetas del kanban. */
export function tempBorde(fecha: string | Date): string {
  const h = (Date.now() - new Date(fecha).getTime()) / 3_600_000;
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
