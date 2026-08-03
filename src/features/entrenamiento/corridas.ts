/**
 * LO QUE LA PANTALLA DE CORRIDAS DECIDE, sin JSX y con test (#257).
 */

export interface Corrida {
  id: number;
  rotulo: string;
  lanzadaPor: string;
  estado: string;
  motivo: string | null;
  pedidas: number;
  corridas: number;
  tokensEntrada: number;
  tokensSalida: number;
  contexto: Record<string, unknown>;
  creadaEn: string;
  terminadaEn: string | null;
}

export interface RespuestaDeCorrida {
  id: number;
  clave: string;
  textoOriginal: string | null;
  estadoOriginal: string | null;
  texto: string | null;
  estado: string;
  motivo: string | null;
  acciones: unknown[];
}

/** Cómo cambió una respuesta entre lo que se dijo y lo que se diría. */
export type Cambio = 'igual' | 'cambio' | 'ahora-calla' | 'antes-callaba' | 'sin-datos';

/**
 * El veredicto por conversación.
 *
 * Los dos casos del medio son los que importan y los que un `===` a secas
 * escondería: que el bot **deje de hablar** donde antes hablaba es un hallazgo,
 * y no el mismo que el inverso. Mezclarlos en «cambió» haría que una regla nueva
 * que enmudece al bot se vea igual que una que lo mejora.
 */
export function compararRespuesta(r: {
  textoOriginal: string | null;
  texto: string | null;
}): Cambio {
  const antes = (r.textoOriginal ?? '').trim();
  const ahora = (r.texto ?? '').trim();

  if (antes === '' && ahora === '') return 'sin-datos';
  if (antes !== '' && ahora === '') return 'ahora-calla';
  if (antes === '' && ahora !== '') return 'antes-callaba';
  return antes === ahora ? 'igual' : 'cambio';
}

export const LECTURA_CAMBIO: Record<Cambio, string> = {
  igual: 'Diría lo mismo',
  cambio: 'Diría otra cosa',
  'ahora-calla': 'Antes hablaba, ahora no',
  'antes-callaba': 'Antes no hablaba, ahora sí',
  'sin-datos': 'No habló ni antes ni ahora',
};

export type ClaveRegla =
  | 'identidad'
  | 'pregunta_pais'
  | 'anuncia_otra_persona'
  | 'cifra_de_precio'
  | 'dice_ser_bot'
  | 'sede_inexistente';

export interface Violacion {
  regla: ClaveRegla;
  lectura: string;
  fragmento: string;
}

export const ROTULO_REGLA: Record<ClaveRegla, string> = {
  identidad: 'Se presentó con otro nombre',
  pregunta_pais: 'Preguntó el país',
  anuncia_otra_persona: 'Anunció que otra persona contactaría',
  cifra_de_precio: 'Escribió una cifra de precio',
  dice_ser_bot: 'Dijo ser un bot',
  sede_inexistente: 'Nombró una sede que no existe',
};

export interface ConteoReglas {
  antes: Record<ClaveRegla, number>;
  ahora: Record<ClaveRegla, number>;
}

export interface CambioDeRegla {
  regla: ClaveRegla;
  antes: number;
  ahora: number;
  delta: number;
}

/**
 * El veredicto de una Corrida sobre las reglas.
 *
 * Ordena por **lo que empeoró primero**, y después por magnitud del cambio — no
 * alfabéticamente ni por cantidad. Una regla que EMPEORÓ tiene que saltar a la
 * vista aunque sea por poco: es la que puede estar diciendo que el cambio hizo
 * daño, y enterrarla debajo de una que mejoró mucho es cómo se aprueba una
 * regresión sin verla.
 */
export function compararReglas(conteo: ConteoReglas): CambioDeRegla[] {
  const claves = Object.keys(conteo.ahora) as ClaveRegla[];
  return claves
    .map((regla) => {
      const antes = conteo.antes[regla] ?? 0;
      const ahora = conteo.ahora[regla] ?? 0;
      return { regla, antes, ahora, delta: ahora - antes };
    })
    .filter((c) => c.antes > 0 || c.ahora > 0)
    .sort((a, b) => {
      const aEmpeoro = a.delta > 0;
      const bEmpeoro = b.delta > 0;
      if (aEmpeoro !== bEmpeoro) return aEmpeoro ? -1 : 1;
      return Math.abs(b.delta) - Math.abs(a.delta);
    });
}

/** El resumen de una Corrida, para leerla de un vistazo. */
export function resumirCorrida(respuestas: RespuestaDeCorrida[]): Record<Cambio, number> {
  const cuenta: Record<Cambio, number> = {
    igual: 0,
    cambio: 0,
    'ahora-calla': 0,
    'antes-callaba': 0,
    'sin-datos': 0,
  };
  for (const r of respuestas) cuenta[compararRespuesta(r)] += 1;
  return cuenta;
}

/**
 * El costo de una Corrida en dólares, aproximado.
 *
 * Se muestra porque decide cuántas más se pueden correr, y **se dice que es
 * aproximado**: los precios cambian y esto no consulta ninguna tarifa. Un número
 * presentado como exacto invitaría a usarlo para presupuestar.
 */
export function costoAproximado(tokensEntrada: number, tokensSalida: number): number {
  // Haiku 4.5, orden de magnitud: ~1 USD por millón de entrada, ~5 por millón de salida.
  return (tokensEntrada / 1_000_000) * 1 + (tokensSalida / 1_000_000) * 5;
}
