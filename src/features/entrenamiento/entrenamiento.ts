/**
 * LO QUE LA PANTALLA DE ENTRENAMIENTO DECIDE, sin JSX y con test.
 *
 * Vive aparte del componente porque las dos reglas de acá abajo no se pueden
 * interrogar desde adentro de un `switch` en el render — y son justamente las
 * que importan cuando el bot se porta raro.
 */

/** Un turno del chat de prueba, tal como se ve en pantalla. */
export interface TurnoDePrueba {
  de: "persona" | "bot";
  texto: string;
  /** Solo en los turnos del bot: qué decidió además de hablar. */
  detalle?: DetalleDeRespuesta;
}

export interface DetalleDeRespuesta {
  estado: string;
  motivo: string | null;
  acciones: unknown[];
  modelo: string | null;
  tokensEntrada: number | null;
  tokensSalida: number | null;
}

/** El tope del mensaje, el mismo que valida el server. */
export const TOPE_MENSAJE = 4000;

/**
 * ¿Por qué no se puede mandar todavía? `null` = se puede.
 *
 * Una sola función para el botón Y para el acorde de teclado. Separadas
 * divergen: es exactamente lo que pasó en la superficie de Ivi, donde `⌘↵` se
 * saltaba el tope y la pantalla reportaba «se rompió algo que nadie previó» en
 * vez de «te pasaste de largo» (ADR 0024).
 */
export function motivoParaNoProbar(entrada: {
  mensaje: string;
  esperando: boolean;
  linea: string | null;
}): string | null {
  if (entrada.esperando) return "Esperá la respuesta anterior.";
  if (!entrada.linea) return "Elegí contra qué línea probar.";
  const limpio = entrada.mensaje.trim();
  if (limpio.length === 0) return "Escribí un mensaje.";
  if (limpio.length > TOPE_MENSAJE) {
    return `Te pasaste por ${limpio.length - TOPE_MENSAJE} caracteres (el tope es ${TOPE_MENSAJE}).`;
  }
  return null;
}

/**
 * Cómo se lee una respuesta que llegó SIN texto.
 *
 * No es un error y no se dibuja como tal: el bot pensó y decidió no hablar
 * —un freno, un salto, un guardrail—, y eso es información sobre por qué una
 * persona real se habría quedado esperando. Mostrarlo como «error» mandaría a
 * buscar el problema al lado equivocado.
 */
export function lecturaDeSilencio(detalle: DetalleDeRespuesta): string {
  const porEstado: Record<string, string> = {
    sin_respuesta: "El pipeline cortó antes de producir una respuesta.",
    bloqueada: "El bot redactó algo y un freno lo bloqueó antes de salir.",
    error: "El modelo falló en este turno.",
    sombra: "El bot pensó la respuesta pero la línea está en modo sombra.",
  };
  const base = porEstado[detalle.estado] ?? `El bot no produjo texto (estado «${detalle.estado}»).`;
  return detalle.motivo ? `${base} Motivo: ${detalle.motivo}.` : base;
}
