import { ESCALA_ETAPAS } from "../cola/etapaEfectivaSql.js";
import { normalizarEtapa } from "../gestiones/registrarGestion.js";
import type { Procedencia } from "../procedencia/pieza.js";

/**
 * LO QUE PASÓ DESPUÉS DE UN ENVÍO — derivado, nunca guardado (épica #169).
 *
 * ══ EL NOMBRE ES EL PUNTO ════════════════════════════════════════════════════
 *
 * Esto **no** se llama «efectividad», ni «conversión», ni «rendimiento», y no
 * es una elección estética. Lo único que este módulo sabe es **qué ocurrió
 * después en el tiempo**. Que una venta siga a un mensaje no dice que la haya
 * causado: la gente que ya iba a comprar también recibe mensajes, y la pieza que
 * más se manda a conversaciones calientes va a «ganar» siempre. Un nombre causal
 * convertiría esa correlación en una orden («escribí más de esto»), y estos
 * números van a decidir qué se escribe después. Así que dicen lo que vieron:
 * `huboRespuesta`, `huboAvanceDeEtapa`, `huboVentaDespues`.
 *
 * ══ POR QUÉ SE DERIVA Y NO SE GUARDA ═════════════════════════════════════════
 *
 * Misma decisión que la etapa efectiva (ADR 0013), las señales (0015) y
 * `no_leido` (0014): no hay fila, no hay job. Un job que escriba el resultado
 * es una SEGUNDA escritura de la misma verdad, y dos escrituras divergen — la
 * lección de #37, que ya costó una cola ordenada de dos maneras distintas.
 *
 * Y acá divergir sería peor que en la cola: un veredicto viejo no se ve viejo.
 * «Esta pieza cerró 40 ventas» calculado con la regla del mes pasado se lee
 * exactamente igual que uno correcto.
 *
 * ══ DÓNDE VIVE LA REGLA ══════════════════════════════════════════════════════
 *
 * Acá, una vez, pura. El SQL (`consultarEnvios.ts`) **solo trae hechos crudos**
 * —cuándo llegó el primer entrante, qué etapas se asentaron, cuándo hubo una
 * venta— y no juzga nada; el agregado (`agregar.ts`) también es puro. Es el
 * patrón de `senales/`: cuando no hay una segunda implementación, no hay nada
 * que pueda divergir. El test con base (`resultado.paridad.test.db.ts`) es el
 * candado contra que alguien «optimice» el conteo metiéndolo en un GROUP BY.
 */

/**
 * LAS DOS VENTANAS, y son distintas a propósito.
 *
 * Una respuesta y una compra no viven en la misma escala de tiempo. Con una
 * sola ventana hay que elegir entre dos errores: 48 h para la venta descarta
 * casi todas las compras reales (nadie decide un diploma en dos días), y 14
 * días para la respuesta le acredita a este mensaje un «hola» de la semana que
 * viene. Así que son dos números, con nombre, y el reporte los imprime — un
 * porcentaje sin su ventana no se puede leer.
 */
export const VENTANA_HORAS_POR_DEFECTO = 48;
export const VENTANA_VENTA_DIAS_POR_DEFECTO = 14;

export interface Ventanas {
  /** Cuánto cuenta como «contestó a esto». */
  horas: number;
  /** Cuánto cuenta como «después de esto hubo una venta». */
  diasVenta: number;
}

export const VENTANAS_POR_DEFECTO: Ventanas = {
  horas: VENTANA_HORAS_POR_DEFECTO,
  diasVenta: VENTANA_VENTA_DIAS_POR_DEFECTO,
};

/**
 * Los HECHOS CRUDOS que el SQL trae para un envío. Ninguno es un veredicto:
 * son fechas y etiquetas, tal como están en la base.
 */
export interface HechosDeUnEnvio {
  envioId: number;
  /** La conversación (`conv:<canal>:<persona>:<numeroPropio>`). */
  clave: string;
  vendedoraId: string;
  procedencia: Procedencia;
  /**
   * EL TEXTO QUE SALIÓ.
   *
   * Viaja acá por una razón que no es la métrica: los envíos con
   * `procedencia = a-mano` son la línea de base **y además el semillero de
   * piezas nuevas**. «Se puede pagar en 2 cuotas» —el hallazgo que motivó toda
   * esta épica— no salió de ninguna plantilla: **la improvisó una persona**, dos
   * veces en 1.876 conversaciones. Si el lazo solo contara los envíos a mano
   * sin poder recuperar QUÉ dijeron, el catálogo no tendría de dónde crecer:
   * Ivi no escribe la frase, la encuentra y cita a una vendedora.
   *
   * Acá solo se deja la puerta abierta. El corpus, la anonimización en el borde
   * y el «proponer como pieza candidata» son el frente 3 — **no se construyen
   * en este PR**, pero tampoco se cierran: el modelo ya permite salir.
   */
  texto: string;
  /** Cuándo salió de verdad (`resuelto_at`, o el alta si falta). */
  salioEn: Date;
  /** El primer mensaje ENTRANTE de esa persona posterior al envío, si lo hubo. */
  primerEntranteEn: Date | null;
  /**
   * EL SIGUIENTE ENVÍO NUESTRO a esa misma conversación, si lo hubo.
   *
   * Sin este campo, **una sola respuesta se le acredita a todos los mensajes
   * anteriores**: en una conversación con cuatro salientes espaciados dos horas,
   * el «sí, me interesa» de la persona cuenta como respuesta de los cuatro. Se
   * midió sobre un corpus sintético con la forma de los datos reales: la tasa
   * sembrada era 22 % y el reporte imprimía **54 %**. Y el inflado no es
   * parejo —crece con cuántos mensajes tuvo la conversación, que es justo lo
   * que correlaciona con la gente que ya iba a contestar—, así que no se
   * cancela entre piezas: premia a las que se usan en conversaciones largas.
   */
  siguienteEnvioEn: Date | null;
  /** La última etapa que una persona asentó ANTES del envío (cruda, sin normalizar). */
  etapaAntes: string | null;
  /**
   * Las gestiones asentadas DESPUÉS del envío, **con su fecha y sin recortar
   * por ventana**. El recorte lo hace la función pura: si el `WHERE` del SQL
   * aplicara la ventana, la regla viviría en dos idiomas y podrían divergir.
   */
  etapasDespues: { etapa: string; cuando: Date }[];
  /**
   * La primera venta atribuida a esa conversación después del envío.
   *
   * `null` tiene DOS significados que no se pueden confundir, y por eso el
   * booleano de al lado existe: «no hubo venta» y «no lo sabemos».
   */
  ventaEn: Date | null;
  /** ¿La atribución de ventas está conectada? Si no, `ventaEn` no significa nada. */
  seSabeDeVentas: boolean;
}

/** El veredicto de UN envío. Todo lo que dice es «qué pasó después». */
export interface LoQuePaso {
  /**
   * ¿Contestó dentro de la ventana **y sin que le hayamos escrito otra cosa en
   * el medio**? Es la regla de «el último mensaje antes de la respuesta»: la
   * respuesta se le acredita al último saliente, no a todos los anteriores.
   */
  huboRespuesta: boolean;
  /** Cuánto tardó en contestar. `null` si no contestó. */
  minutosHastaLaRespuesta: number | null;
  /**
   * ¿Se asentó una etapa MÁS AVANZADA que la que había? Mira solo las
   * gestiones asentadas a mano —un acto afirmativo de la vendedora—, nunca la
   * etapa efectiva: esa sube sola a «contactado» cuando alguien responde, y
   * contaría la respuesta dos veces bajo dos nombres distintos.
   */
  huboAvanceDeEtapa: boolean;
  /** ¿Alguien la declaró perdida después? El contrapeso honesto de lo de arriba. */
  seDeclaroPerdida: boolean;
  /**
   * ¿Hubo una venta después? **`null` = no lo sabemos** (la atribución de
   * ventas todavía no está conectada — depende del PR #165). `null` y `false`
   * no se pueden dibujar igual: uno es «no compró» y el otro «no preguntes».
   */
  huboVentaDespues: boolean | null;
  /** Cuánto tardó la venta. `null` si no hubo, o si no se sabe. */
  minutosHastaLaVenta: number | null;
}

const minutos = (desde: Date, hasta: Date) => (hasta.getTime() - desde.getTime()) / 60_000;

/** El rango de una etapa en la escala compartida. Fuera de la escala = -1. */
function rango(etapa: string | null): number {
  if (etapa == null) return -1;
  const n = normalizarEtapa(etapa);
  if (n === "perdido") return -1; // no es un peldaño: es la salida
  return (ESCALA_ETAPAS as readonly string[]).indexOf(n);
}

/**
 * EL VEREDICTO, puro. La ventana acota qué cuenta como «después de»: una
 * respuesta a los cinco días es una respuesta, pero atribuírsela a este mensaje
 * sería inventar una causa. 48 h por defecto — el 27-jul había gente esperando
 * 72 h por una respuesta nuestra, así que la ventana de la persona del otro lado
 * no es más corta que eso.
 */
export function loQuePaso(h: HechosDeUnEnvio, v: Ventanas = VENTANAS_POR_DEFECTO): LoQuePaso {
  const topeRespuestaMin = v.horas * 60;
  const topeVentaMin = v.diasVenta * 24 * 60;

  // LA RESPUESTA ES DEL ÚLTIMO MENSAJE, NO DE TODOS LOS ANTERIORES.
  //
  // Si después de este envío le escribimos otra cosa ANTES de que ella
  // contestara, la respuesta no es de este mensaje: es del que vino después.
  // Sin esta línea, en una conversación de cuatro salientes la misma respuesta
  // se cuenta cuatro veces y toda tasa se infla (medido: 22 % sembrado → 54 %
  // reportado). No se puede saber cuál de los cuatro la ganó, y atribuírsela al
  // último es la única regla que no cuenta de más.
  const leEscribimosDeNuevoAntes =
    h.siguienteEnvioEn !== null &&
    h.primerEntranteEn !== null &&
    h.siguienteEnvioEn > h.salioEn &&
    h.siguienteEnvioEn <= h.primerEntranteEn;

  const minsRespuesta =
    h.primerEntranteEn && h.primerEntranteEn > h.salioEn && !leEscribimosDeNuevoAntes
      ? minutos(h.salioEn, h.primerEntranteEn)
      : null;
  const huboRespuesta = minsRespuesta !== null && minsRespuesta <= topeRespuestaMin;

  const rangoAntes = rango(h.etapaAntes);
  const enVentana = h.etapasDespues.filter(
    (g) => g.cuando > h.salioEn && minutos(h.salioEn, g.cuando) <= topeRespuestaMin,
  );
  const normalizadas = enVentana.map((g) => normalizarEtapa(g.etapa));
  const huboAvanceDeEtapa = normalizadas.some((e) => rango(e) > rangoAntes);
  const seDeclaroPerdida = normalizadas.includes("perdido");

  const minsVenta =
    h.seSabeDeVentas && h.ventaEn && h.ventaEn > h.salioEn ? minutos(h.salioEn, h.ventaEn) : null;
  const ventaEnVentana = minsVenta !== null && minsVenta <= topeVentaMin;

  return {
    huboRespuesta,
    minutosHastaLaRespuesta: huboRespuesta ? minsRespuesta : null,
    huboAvanceDeEtapa,
    seDeclaroPerdida,
    // Si nadie conectó la atribución, la pregunta no tiene respuesta — y decir
    // «no compró» sería exactamente la mentira que este módulo evita.
    huboVentaDespues: h.seSabeDeVentas ? ventaEnVentana : null,
    minutosHastaLaVenta: ventaEnVentana ? minsVenta : null,
  };
}
