/**
 * CUÁNTO HACE QUE ESTÁ DONDE ESTÁ — puro, fuera del JSX.
 *
 * El server manda el INSTANTE de ingreso (`etapa_desde`, de
 * `cola/tiempoEnEtapa.ts`) y acá se decide qué se lee. Vive afuera del componente
 * por lo mismo que `canales/ventana.ts`: un `if` adentro del JSX no se puede
 * interrogar sobre los casos que todavía no pasaron —el server viejo que no manda
 * el campo, la fila que no se pudo fechar— y esos son justo los que importan.
 *
 * ── POR QUÉ ESTO ES LA MITAD DEL FRENTE ───────────────────────────────────
 * Dos personas en «Cotizados» pueden ser cosas completamente distintas: una
 * recibió el precio hace 40 minutos, la otra hace tres semanas y no contestó
 * nunca. **La etapa las iguala.** Sin esta lectura, lo único que separa a una de
 * otra es abrir las dos conversaciones.
 *
 * ── SIN ORO, Y NO ES UN DESCUIDO ──────────────────────────────────────────
 * En esta app el oro significa **tiempo que se acaba** y nada más
 * (`src/index.css`): la ventana de conversación que se cierra, el reloj de Meta.
 * Una conversación vieja no tiene ningún plazo corriendo — tenerla en oro haría
 * que el oro pasara a significar «viejo», y entonces dejaría de significar
 * «ahora» donde de verdad hace falta. Va en tinta neutra, y **se apaga** cuando
 * es reciente: lo que merece leerse es lo que lleva rato quieto.
 */

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/**
 * Debajo de esto no se dibuja nada. Una tarjeta que entró hoy a su columna no
 * tiene ninguna antigüedad que reportar, y «hace 2 h» en las cuatro tarjetas
 * nuevas es ruido que compite con el resto de la fila.
 */
export const UMBRAL_SILENCIO_MS = DIA;

export interface LecturaAntiguedad {
  /** Lo que se lee: «3 d», «2 sem», «1 mes». */
  texto: string;
  /** El texto largo del `title`, que es donde se dice de qué etapa se habla. */
  ayuda: string;
}

/**
 * Cuánto hace, en criollo. **Redondea para ABAJO**: con 13 días dice «1 sem», no
 * «2». Es la misma decisión que `cuantoFalta` y por el mismo motivo — el error
 * que se puede pagar es el que exagera, y acá exagerar la antigüedad haría
 * descartar a alguien antes de tiempo.
 */
export function cuantoHace(ms: number): string {
  if (ms >= 30 * DIA) return `${Math.floor(ms / (30 * DIA))} mes`;
  if (ms >= 7 * DIA) return `${Math.floor(ms / (7 * DIA))} sem`;
  if (ms >= DIA) return `${Math.floor(ms / DIA)} d`;
  return `${Math.max(1, Math.floor(ms / HORA))} h`;
}

/**
 * QUÉ DICE LA MARCA, o `null` si no se dibuja nada.
 *
 * `null` en cuatro casos que se ven igual en pantalla y son distintos abajo — y
 * está bien que se vean igual, porque **la ausencia de marca no afirma nada**:
 *   · entró hace menos de un día (no hay antigüedad que reportar);
 *   · no se pudo determinar (`null` del server: un comentario respondido no
 *     guarda cuándo se respondió);
 *   · el server todavía no manda el campo (N4 va solo y N5 es un botón: hay una
 *     franja de deploy con el front nuevo contra el server viejo);
 *   · la fecha no se puede leer.
 *
 * Lo que NUNCA pasa es que se dibuje un «hace 0 d» o una antigüedad inventada:
 * es la misma regla de los ✓✓ de entrega — un dato falso es peor que un hueco,
 * porque el hueco se nota y el invento se cree.
 */
export function lecturaDeAntiguedad(
  etapaDesde: string | null | undefined,
  ahora: Date,
  opciones: {
    /** Para el `title`: «lleva 3 d en Cotizados». Sin ella, la ayuda es genérica. */
    columna?: string;
    /**
     * LO QUE LA TARJETA YA DICE en su reloj (`haceCorto` del último movimiento).
     *
     * 🔴 **La quinta razón para no dibujar nada, y es la más frecuente.** Los dos
     * relojes miden cosas distintas —uno el último movimiento, el otro el ingreso
     * a la etapa— pero en la mayoría de las conversaciones coinciden: a nadie le
     * mandamos el precio y después le insistimos. Cuando los dos dan el MISMO
     * texto, la tarjeta diría «3 d ··· 3 d» y el segundo número no agrega un dato,
     * agrega una pregunta («¿por qué dice dos veces lo mismo?»).
     *
     * Se compara el TEXTO ya redondeado y no los milisegundos: lo que no puede
     * pasar es que se lea repetido, y eso es exactamente una igualdad de strings.
     */
    yaVisible?: string;
  } = {},
): LecturaAntiguedad | null {
  if (!etapaDesde) return null;

  const desde = new Date(etapaDesde).getTime();
  if (Number.isNaN(desde)) return null;

  const hace = ahora.getTime() - desde;
  if (hace < UMBRAL_SILENCIO_MS) return null;

  const texto = cuantoHace(hace);
  if (opciones.yaVisible != null && opciones.yaVisible.trim() === texto) return null;

  return {
    texto,
    ayuda: opciones.columna ? `Lleva ${texto} en ${opciones.columna}` : `Lleva ${texto} en esta etapa`,
  };
}
