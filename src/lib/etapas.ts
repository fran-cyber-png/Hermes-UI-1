/**
 * Las etapas del embudo, canónicas para TODA la app (Dashboard, cola, kanban,
 * recibo de venta). La identidad visual de una etapa es fija: ningún filtro ni
 * vista la re-pinta.
 */

export const ETAPAS = ['interesado', 'contactado', 'cotizado', 'cierre', 'perdido'] as const;

/**
 * ══ «SIN RESPUESTA» — DERIVADA, NUNCA DECLARABLE ═══════════════════════════
 *
 * Le escribimos y la persona nunca contestó (server: `cola/etapaEfectivaSql.ts`).
 * Medido el 8-ago-2026: **2.580 de 3.973 conversaciones (65 %)**, que hasta hoy
 * caían en Contactados y Cotizados e inflaban las dos — 2.252 de los 3.050
 * Cotizados nunca habían dicho una palabra.
 *
 * 🔴 **Queda AFUERA de `ETAPAS` a propósito**, y no es un olvido: esa lista es la
 * que iteran el embudo del Dashboard y el recibo de venta, y ahí este valor sería
 * un segmento clavado en cero (el Dashboard solo cuenta conversaciones con un
 * primer entrante, así que por construcción nunca lo devuelve). Está en el TIPO
 * —porque el tablero sí lo recibe y lo pinta— y no en la lista que se enumera.
 * Tampoco se puede declarar: no hay botón ni arrastre que lleve acá, se deriva de
 * un hecho y deja de ser cierto solo, en cuanto la persona escribe.
 */
export const SIN_RESPUESTA = 'sin_respuesta';

export type Etapa = (typeof ETAPAS)[number] | typeof SIN_RESPUESTA;

/**
 * ══ CÓMO SE LLAMA CADA ETAPA — UNA SOLA VEZ, PARA TODA LA APP ══════════════
 *
 * Hasta acá los rótulos vivían en CINCO lugares y ninguno era canónico:
 * `vistas/tablero.ts` (plural), `gestion/BarraGestion.tsx` (singular y sin
 * `perdido`), **dos `ETAPA_LABEL` privados e idénticos** en
 * `venta/FormularioVenta.tsx` y `gestion/RegistrarGestion.tsx`, y el Dashboard,
 * que no tenía ninguno: pintaba **el identificador crudo** con un `capitalize`
 * de CSS. Con ids de una palabra eso se veía bien de casualidad — y por eso
 * nadie lo vio.
 *
 * 🔴 **Es #37 otra vez, y el rename lo iba a destapar**: al cambiar el rótulo
 * del tablero, el Dashboard habría seguido diciendo «Cotizado» sobre la misma
 * conversación que el Pipeline llama «Saben el precio». Dos nombres para el
 * mismo hecho es peor que un nombre feo.
 *
 * ── POR QUÉ EL VALOR ES UN PAR Y NO UN STRING ────────────────────────────
 * Una COLUMNA es un montón y una FICHA es una persona: «Saben el precio» y
 * «Sabe el precio» son la misma etapa en dos números gramaticales, no dos
 * etapas. Con un solo string, cada consumidor volvía a conjugar por su cuenta —
 * que es exactamente cómo nacieron las cinco copias.
 *
 * ── EL CRITERIO DE LOS NOMBRES (investigación 10-ago-2026) ───────────────
 * Pipedrive («Contact Made», «Proposal Made») y HubSpot («Contract sent») nombran
 * sus etapas como un **hecho en pasado**, y las guías de pipeline nombran
 * *«Interested»* y *«Qualified»* como los ejemplos de lo que NO hay que hacer,
 * por interpretativos. Es la misma regla que ADR 0044 dedujo midiendo: **la
 * etapa se define por una acción observable del COMPRADOR, no por lo que el
 * vendedor cree**. Acá el nombre dice el hecho que el `CASE` de
 * `cola/etapaEfectivaSql.ts` ya evalúa, y nada más.
 *
 * ⚠️ **Los IDENTIFICADORES no se tocan.** `sin_respuesta`, `cotizado` y compañía
 * viven en `gestiones`, en el SQL, en `?etapa=` y en el caché de IndexedDB
 * (ADR 0007): acá se cambia **lo que se lee**, nunca lo que se guarda.
 */
export const ETAPA_ROTULO: Record<string, { uno: string; varios: string }> = {
  // Derivada, nunca declarable: le escribimos y nunca dijo una palabra.
  sin_respuesta: { uno: 'Nunca contestó', varios: 'Nunca contestaron' },
  /**
   * La BANDEJA: escribieron y todavía nadie les contestó — la pelota es NUESTRA.
   *
   * ⚠️ **El nombre NO se inventó acá: se adoptó el que `BandejaDeuda` ya usaba.**
   * Esa tira decía «Te esperan» desde #87 y era el rótulo más claro que había en
   * toda la pantalla — del lado del comprador, sin jerga. Ponerle otro habría
   * dejado la bandeja diciendo una cosa y el chip de la ficha otra, que es el
   * defecto que este mapa viene a cerrar.
   *
   * 🔴 Y es el que más importa que NO se parezca a `sin_respuesta`: son cosas
   * opuestas —deuda NUESTRA vs. deuda del lead— y con nombres como «Sin
   * contestar» / «Sin respuesta» sonaban casi igual. Con «Te esperan» ya ni
   * empiezan con la misma palabra. El test prohíbe que dos etapas compartan
   * rótulo justamente por esto.
   */
  interesado: { uno: 'Te espera', varios: 'Te esperan' },
  contactado: { uno: 'Contestó', varios: 'Contestaron' },
  cotizado: { uno: 'Sabe el precio', varios: 'Saben el precio' },
  cierre: { uno: 'Compró', varios: 'Compraron' },
  // Terminal humano. Se llama por lo que la persona dijo, y así queda a la vista
  // por qué en toda la historia hay CERO: nadie dice que no, se callan.
  perdido: { uno: 'Dijo que no', varios: 'Dijeron que no' },
};

/**
 * El rótulo de una etapa. **Degrada, no tumba**: una etapa que no está en el
 * mapa se devuelve tal cual, igual que `rotuloDeTipo` con un tipo de evento
 * desconocido (ADR 0037). El server puede empezar a devolver un peldaño nuevo
 * antes de que el front lo conozca —N4 y N5 se despliegan por separado— y ahí
 * mostrar el id crudo es feo, pero es cierto; tirar sería una pantalla en blanco.
 */
export function rotuloEtapa(etapa: string, numero: 'uno' | 'varios' = 'uno'): string {
  return ETAPA_ROTULO[etapa]?.[numero] ?? etapa;
}

/** Chip de etapa (fondo + tinta). */
export const ETAPA_CHIP: Record<string, string> = {
  // Tinta apagada y sin borde: es un estado de espera, no un peldaño ganado.
  // Sin oro — acá no hay ningún plazo corriendo, hay silencio.
  sin_respuesta: 'bg-muted text-muted-foreground',
  interesado: 'bg-primary/10 text-primary',
  contactado: 'bg-secondary text-secondary-foreground',
  cotizado: 'bg-navy text-white',
  cierre: 'bg-success/10 text-success',
  perdido: 'bg-destructive/10 text-destructive',
};

/** Color de segmento para la barra del embudo (índice = posición en ETAPAS). */
export function colorSegmento(etapa: string, i: number): string {
  if (etapa === 'cierre') return 'bg-success';
  if (etapa === 'perdido') return 'bg-muted-foreground/30';
  return ['bg-navy/40', 'bg-navy/60', 'bg-navy'][i] ?? 'bg-navy';
}
