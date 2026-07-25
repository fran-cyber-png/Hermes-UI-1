import type { Conversacion } from '../canales/conversaciones';
import type { GrupoBandeja, MensajeBandeja } from './bandeja';

/**
 * EL MODO REVISIÓN — la parte que no puede estar mal, sin React (ADR 0018).
 *
 * La revisión dejó de ser una hoja aparte: ahora pasa DENTRO de Mensajes, con
 * la conversación real a la vista y el borrador en el composer. Lo que eso
 * cambia acá es que la lista deja de ser algo que se lee de arriba abajo y pasa
 * a ser algo que se RECORRE: hay una abierta, se decide, y la siguiente tiene
 * que aparecer sola.
 *
 * Todo lo de este archivo existe por esa sola frase. Aprobar saca la fila de la
 * lista, así que «la siguiente» no es «la de más abajo en la lista de antes»:
 * es la que ocupa su lugar en la lista de después. Si eso vive en un
 * `useEffect` que reacciona al refetch, se porta distinto según cuándo llegue
 * la respuesta del server — y el síntoma es el peor posible: la vendedora
 * aprueba, la pantalla salta a otra parte, y aprueba de nuevo creyendo que la
 * anterior no entró.
 */

/** Uno de los tres eslabones de `campana.ts` (server), tal como viene guardado. */
export type FuenteCampana = 'interes' | 'lead' | 'anuncio';

/**
 * LA FILA — el orden en el que se recorre.
 *
 * Dos criterios, en este orden y por razones distintas:
 *
 * 1. **Se respeta la agrupación por campaña que ya manda el server** (grupo más
 *    grande primero: es donde un OK hace más trabajo). Recorrer saltando de
 *    campaña obliga a releer la plantilla en cada salto; quedarse adentro del
 *    grupo es leerla UNA vez y después juzgar solo a la persona. Es el argumento
 *    de ADR 0016 —«los 12 de Inteligencia se aprueban de un vistazo»— traducido
 *    a una pantalla que muestra de a uno.
 * 2. **Adentro de cada campaña, primero el que más esperó.** Es el argumento
 *    para aprobar: en #153 el enganche cae de ~20% a **0,7%** cuando nadie
 *    responde. Si hay que cortar a la mitad, que lo que quedó afuera sea lo que
 *    menos duele.
 */
export function enFila(grupos: readonly GrupoBandeja[]): MensajeBandeja[] {
  return grupos.flatMap((g) => [...g.mensajes].sort((a, b) => b.esperandoMinutos - a.esperandoMinutos));
}

export function hayQueRevisar(grupos: readonly GrupoBandeja[]): boolean {
  return grupos.some((g) => g.mensajes.length > 0);
}

/**
 * A CUÁL VOY cuando la que estaba mirando se resuelve (aprobada o descartada).
 *
 * A la de abajo: la lista se corre sola y la mano no se mueve. Si era la última,
 * a la de arriba —irse al vacío teniendo trabajo al lado es hacerla volver a
 * buscar—. Si era la única, `null`: no queda nada y el modo se cierra solo.
 *
 * `null` también cuando el id no está en la fila, que es lo que pasa si dos
 * pestañas resuelven la misma: mover el foco por algo que ya no existía sería
 * moverlo por sorpresa.
 */
export function proximaTrasResolver(fila: readonly MensajeBandeja[], resueltoId: number): number | null {
  const i = fila.findIndex((m) => m.id === resueltoId);
  if (i === -1) return null;
  const siguiente = fila[i + 1] ?? fila[i - 1];
  return siguiente?.id ?? null;
}

/** Lo que queda tras resolver un lote. La cuenta se hace ANTES de refrescar. */
export function quedanTras(fila: readonly MensajeBandeja[], resueltos: readonly number[]): MensajeBandeja[] {
  const fuera = new Set(resueltos);
  return fila.filter((m) => !fuera.has(m.id));
}

/**
 * SALTAR SIN DECIDIR. No da la vuelta a propósito: si «siguiente» al final
 * volviera a la primera, la vendedora creería que le quedan más de las que le
 * quedan y revisaría dos veces lo mismo. El tope se siente y se entiende.
 */
export function saltar(
  fila: readonly MensajeBandeja[],
  actualId: number | null,
  paso: 1 | -1,
): number | null {
  if (fila.length === 0) return null;
  if (actualId === null) return fila[0].id;
  const i = fila.findIndex((m) => m.id === actualId);
  if (i === -1) return fila[0].id;
  const destino = Math.min(fila.length - 1, Math.max(0, i + paso));
  return fila[destino].id;
}

/** «3 de 12» — contado desde 1, como lo diría una persona. */
export function paso(fila: readonly MensajeBandeja[], actualId: number | null): { actual: number; total: number } {
  const i = actualId === null ? -1 : fila.findIndex((m) => m.id === actualId);
  return { actual: i + 1, total: fila.length };
}

/**
 * QUÉ DICE EL BOTÓN. «Aprobar» a secas mientras el texto es el de la plantilla;
 * «Aprobar lo editado» apenas se tocó una letra. Si dijera lo mismo en los dos
 * casos, aprobar algo que editaste y aprobar la plantilla se sentirían idéntico
 * —y son dos hechos distintos: el server marca `editada`, y esa marca es la que
 * después dice qué plantillas conviene reescribir.
 */
export function textoDelBoton({ editado }: { editado: boolean }): string {
  return editado ? 'Aprobar lo editado' : 'Aprobar';
}

/**
 * POR QUÉ ESTA CAMPAÑA — la precedencia de `campana.ts`, dicha en criollo y con
 * su nivel de confianza puesto: lo que una persona asentó pesa más que un
 * formulario, y un formulario más que el anuncio por el que entró.
 *
 * Una fila anterior a la columna `campana_fuente` devuelve `null` y la pantalla
 * muestra la campaña sin la cadena. **No se adivina**: inventar una procedencia
 * en la única pantalla que existe para explicar la sugerencia sería exactamente
 * el problema que la pantalla viene a resolver.
 */
export function porQueEstaCampana(fuente: string | null | undefined): string | null {
  switch (fuente) {
    case 'interes':
      return 'del interés que alguien le asentó en la ficha';
    case 'lead':
      return 'del curso que puso en el formulario que llenó';
    case 'anuncio':
      return 'del anuncio por el que escribió';
    default:
      return null;
  }
}

/**
 * DE UNA SUGERENCIA A LA CONVERSACIÓN QUE HAY QUE ABRIR.
 *
 * El modo revisión muestra la conversación REAL en la columna del medio —esa es
 * toda la idea: no se aprueba un texto suelto, se aprueba una respuesta a algo
 * que alguien escribió—. Para abrirla hace falta una `Conversacion`, y la
 * pendiente ya trae todo: la clave de la cola lleva adentro el número propio
 * (`conv:<canal>:<persona>:<numeroPropio>`), así que no hay que ir a buscarlo.
 *
 * Si la clave no tiene la forma esperada, el número propio queda **vacío** en
 * vez de adivinado: el hilo se busca por teléfono igual, y un número propio
 * inventado sería el composer mandando desde otro número. Vacío es honesto.
 */
export function conversacionDeSugerencia(m: MensajeBandeja): Conversacion {
  const partes = m.clave.split(':');
  const numeroPropio = partes.length >= 4 ? partes[3] : '';

  return {
    clave: m.clave,
    canal: 'whatsapp',
    tipo: 'mensaje',
    persona_id: m.telefono,
    persona_nombre: m.personaNombre,
    numero_propio: numeroPropio,
    texto: null,
    contexto_texto: null,
    // Sin responder por definición: la auto-respuesta solo prepara para
    // conversaciones donde la persona escribió y nadie contestó.
    respondida: false,
    ventana_abierta: false,
    pide_info: false,
    n: 0,
    referencia: m.disparadaPor,
    ultimo_at: m.disparadaPor,
    dias: 0,
    // Neutro: el hilo real recalcula lo suyo al cargar. Inventar un nivel de
    // urgencia acá haría que la fila se pinte distinto según de dónde se abrió.
    nivel: 5,
  };
}
