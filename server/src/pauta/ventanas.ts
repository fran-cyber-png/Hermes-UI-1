/**
 * EL TROCEADOR — por qué el backfill no puede pedirle a Meta los 37 meses de una.
 *
 * ── Lo que se midió contra la API real (2026-07-16, cuenta 766149544161385) ──
 *
 *   nivel=ad                          nivel=campaign
 *   14 días → ✓   125 filas ·  1,0 s   14 días → ✓  23 filas · 0,5 s
 *    1 mes  → ✓    96 filas ·  0,6 s    1 mes  → ✓  29 filas · 0,6 s
 *    3 meses→ ✓   447 filas ·  2,6 s    3 meses→ ✓ 142 filas · 1,1 s
 *    6 meses→ ✓ 1.039 filas · 13,9 s    6 meses→ ✓ 385 filas · 1,9 s
 *   37 meses→ ✗ HTTP 400               37 meses→ ✗ HTTP 500
 *
 * No es rate limit: Meta reportaba `call_count=1%` en la cabecera
 * `x-business-use-case-usage`. No son permisos: la misma cuenta y el mismo nivel funcionan con
 * ventanas chicas. Es el TAMAÑO de la consulta — Meta revienta internamente y devuelve un 500
 * genérico que no dice nada.
 *
 * Un HTTP 500 de la Graph API casi nunca es "Meta está caído": es "la consulta es muy grande".
 *
 * 3 meses es el punto dulce: 2,6 s y una sola página a nivel anuncio. A 6 meses ya son 13,9 s y
 * tres páginas — funciona, pero se acerca al borde donde Meta corta.
 *
 * Este módulo es puro: no habla con Meta ni con la base. Solo decide qué pedir.
 */

/** Los 37 meses que Meta retiene. Más atrás: `ERROR(3018)`, verificado. */
export const RETENCION_META_MESES = 37;

/**
 * El tamaño de trozo. Medido, no elegido: ver la tabla de arriba.
 *
 * Bajarlo es seguro (más llamadas, más chicas). Subirlo es apostar contra un 500 que no avisa.
 */
export const TROZO_MESES = 3;

export type Ventana = { since: string; until: string };

const DIA_MS = 86_400_000;

/** `2026-07-16`. Meta pide fechas así; un ISO completo con hora lo rechaza. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Trocea [desde, hasta] en ventanas de `TROZO_MESES`, sin huecos ni solapes.
 *
 * Sin huecos: cada trozo arranca el día siguiente al fin del anterior. Un hueco de un día sería
 * un día de gasto que no existe para el sistema, y nadie lo notaría.
 *
 * Sin solapes: dos trozos con el mismo día traerían la misma fila dos veces. El `UNIQUE` de
 * `pauta_serie` lo perdonaría, pero estaríamos pagándole a Meta dos veces por el mismo dato.
 */
export function trocear(desde: Date, hasta: Date, mesesPorTrozo = TROZO_MESES): Ventana[] {
  if (desde > hasta) return [];

  const trozos: Ventana[] = [];
  let inicio = new Date(desde);

  // Guarda contra un `mesesPorTrozo` de 0 o negativo: sin esto el loop no termina nunca.
  const paso = Math.max(1, Math.floor(mesesPorTrozo));

  while (inicio <= hasta) {
    const fin = new Date(inicio);
    fin.setMonth(fin.getMonth() + paso);
    // `setMonth` desborda solo (31 de enero + 1 mes = 3 de marzo). No se corrige: acá solo importa
    // que los trozos cubran todo sin solaparse, y el desborde no rompe ninguna de las dos cosas.
    fin.setTime(fin.getTime() - DIA_MS); // el trozo cierra el día ANTERIOR: sin solape.

    trozos.push({ since: iso(inicio), until: iso(fin > hasta ? hasta : fin) });
    inicio = new Date(fin.getTime() + DIA_MS); // el siguiente arranca al otro día: sin hueco.
  }

  return trozos;
}

/**
 * El colchón contra el borde de los 37 meses.
 *
 * Meta mide su límite desde HOY, y no dice desde qué huso horario. Un backfill tarda minutos: si
 * arranca cerca de la medianoche de ese huso, el límite se corre bajo los pies y el primer trozo
 * —el más viejo— muere con `ERROR(3018)` cuando ya se trajo todo lo demás.
 *
 * Dos días de colchón cuestan dos días de historia de hace tres años. El error cuesta la corrida.
 */
const MARGEN_DIAS = 2;

/**
 * La ventana máxima que Meta acepta hoy, terminando ayer.
 *
 * Termina AYER y no hoy: el día en curso está incompleto y su gasto sube durante el día. Guardar
 * un día parcial como si fuera cerrado hace que "ayer" valga menos que "anteayer" por un
 * artefacto del reloj, no del negocio. El día de hoy lo trae el reloj cada 6 h, que es su trabajo.
 *
 * Los 37 meses se cuentan desde AHORA, no desde ayer. Contarlos desde ayer ponía el inicio un día
 * MÁS ATRÁS del límite — justo del lado en el que Meta rechaza. Lo agarró `ventanas.test.ts`.
 */
export function ventanaMaxima(ahora: Date): Ventana {
  const ayer = new Date(ahora.getTime() - DIA_MS);
  const desde = new Date(ahora);
  desde.setMonth(desde.getMonth() - RETENCION_META_MESES);
  desde.setTime(desde.getTime() + MARGEN_DIAS * DIA_MS);
  return { since: iso(desde), until: iso(ayer) };
}
