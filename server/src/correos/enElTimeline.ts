import { desc, eq } from 'drizzle-orm';
import type { db as Base } from '../db/client.js';
import { correos } from '../db/schema.js';
import { porQueFallo } from '../lib/porQueFallo.js';

/**
 * LOS CORREOS DE UNA CONVERSACIÓN, PARA EL TIMELINE (H7).
 *
 * ══ 🔴 `correos.clave` SE ESCRIBÍA Y NO LA LEÍA NADIE ════════════════════════
 *
 * El front la manda (`VistaCorreos`), la ruta la guarda (`routes/correos.ts`) y
 * el schema la documenta como «la conversación de origen, ata el correo al
 * lead» — y hasta acá **ningún lector la consultaba**. El timeline del panel
 * derecho se arma con lo que sirve `GET /api/eventos?clave=`, y esa consulta
 * mira `eventos_contacto` y nada más.
 *
 * El defecto no se ve como un defecto: la vendedora abre la conversación de un
 * lead al que OTRA le mandó la cotización por correo ayer, ve los mensajes de
 * WhatsApp, ve los eventos registrados a mano, y **del correo no hay una sola
 * línea**. No lee «falta algo»: lee «acá nadie le pasó el precio». Y le vuelve a
 * mandar el mismo, o —peor, y es lo que cuesta plata— otro.
 *
 * ══ POR QUÉ ES UNA LISTA APARTE Y NO SE MEZCLA CON `eventos` ════════════════
 *
 * 🔴 **Mezclarlos colisiona los ids y le pone botones de Editar y Borrar a un
 * correo.** `eventos_contacto.id` y `correos.id` son dos `bigserial`
 * independientes: el evento 7 y el correo 7 existen los dos a la vez. El front
 * dibuja Editar/Borrar sobre `eventoId` cuando `esMio` (`panel/timeline.ts` →
 * `EventoLinea.tsx`), así que un correo mandado por quien está mirando saldría
 * con los dos botones, y tocarlos haría `PATCH /api/eventos/7` — que archivaría
 * **el evento manual de otra persona**, sin un solo error en pantalla: el
 * servidor contestaría 200 sobre una fila que existe y es de ella.
 *
 * Un correo tampoco es un evento del mismo tipo: no se edita, no se archiva y no
 * lo afirmó nadie — **pasó**. Servirlo aparte deja esa diferencia escrita en la
 * forma de la respuesta, en vez de en un `if` que alguien puede sacar.
 *
 * ══ EL CUERPO NO VIAJA ══════════════════════════════════════════════════════
 *
 * 🔴 Es el MISMO criterio que `listarCorreos` (H4), y por el mismo motivo: el
 * cuerpo es lo que una persona le escribió a un lead —la cotización, el precio,
 * lo que le prometió— y el timeline es una lista que se refresca sola cada vez
 * que se abre una conversación. Se pide aparte, por `GET /api/correos/:id`, que
 * ya existe y ya está cableado a `LecturaDeCorreo.tsx`. **El cuerpo se pide, no
 * se recibe de yapa.**
 *
 * ⚠️ Y como allá, las columnas se enumeran a mano: una columna nueva del schema
 * **nace fuera de la lista**. Con un `select()` a secas nace servida en cada
 * apertura de conversación, y quien la agrega ni se entera.
 */

/**
 * Un correo como lo ve el timeline: **sin `cuerpo`**.
 *
 * Se declara a mano en vez de derivarlo del schema para que el `tsc` cruce esta
 * forma contra la proyección de abajo: agregar una columna obliga a agregarla
 * acá y a **decidir** que el timeline la sirve.
 */
export interface CorreoEnTimeline {
  /** El id de `correos`. Es con lo que se pide el cuerpo: `GET /api/correos/:id`. */
  id: number;
  /**
   * Quién lo mandó, **con la grafía que se guardó** — `Luz` o `luz`, tal cual
   * quedó en la fila.
   *
   * 🔴 **No se manda el nombre corto ya calculado, y no es un olvido.** En el
   * repo hay TRES lecturas vivas de «nombre corto de una vendedora»: la del
   * server (`correos/nombreVendedora.ts`, que arma el `From`), `nombreCorto` de
   * `src/dominio/dueno.ts` y `nombreCortoVendedora` de
   * `src/features/eventos/eventos.ts` — y esta última corta **sólo por `@`**
   * mientras las otras dos cortan por `[.\-_@\s]`. O sea que sobre un id como
   * `luz.perez` dan «Luz» y «Luz.perez». Precalcularlo acá metería una CUARTA
   * lectura en la misma columna de la misma pantalla: el renglón del correo
   * diría «Luz» y el evento manual de abajo «Luz.perez», sobre el mismo humano,
   * uno debajo del otro. Sirviendo el id crudo, el front lo acorta con la misma
   * función que ya usa para las filas vecinas y la lista se lee pareja.
   *
   * ⚠️ Es además lo que hace falta para preguntar «¿es mío?»: esa comparación
   * normaliza los DOS lados (`esMio`, `mismaVendedora`) porque el mismo humano
   * tiene dos grafías vivas en producción. Con el nombre ya cortado no se puede
   * hacer.
   */
  vendedoraId: string;
  /** A qué dirección salió. La del lead: el timeline es la historia de esa persona. */
  para: string;
  asunto: string;
  /**
   * `enviado` o `fallido`.
   *
   * ⚠️ **`enviado` significa «SES aceptó el POST», no «llegó»**: el rebote y el
   * buzón lleno pasan después y sin webhook de bounce nadie se entera. Es el
   * mismo hueco que tenían los ✓✓ antes de la migración 0021, y la pantalla no
   * puede prometer más que esto.
   *
   * ⚠️ Es `string` y no la unión: la columna es `text` y una fila vieja o escrita
   * por otro camino puede traer cualquier cosa. Un estado desconocido se dibuja,
   * no se descarta — descartarlo escondería justo el correo raro.
   */
  estado: string;
  /** Por qué no salió, tal como lo dijo SES. `null` cuando salió. */
  motivo: string | null;
  creadoAt: Date;
}

/**
 * Las columnas que se sirven. **`cuerpo` no está y no puede estar.**
 *
 * Las siete existen desde el 21-jul-2026, o sea que esta consulta no depende de
 * la migración 0029: el sobre (`desde`, `responder_a`, `id_externo`) es de la
 * lista de Correos, no del timeline — acá la pregunta es «¿le escribimos?», y
 * con qué buzón salió se mira abriendo el correo.
 */
const COLUMNAS = {
  id: correos.id,
  vendedoraId: correos.vendedoraId,
  para: correos.para,
  asunto: correos.asunto,
  estado: correos.estado,
  motivo: correos.motivo,
  creadoAt: correos.creadoAt,
} as const;

/**
 * Tope duro. Una conversación con más de 30 correos no existe hoy —en producción
 * la tabla entera tiene 3 filas— pero el timeline se pinta entero en el panel: un
 * día raro no puede costar una pantalla de 400 renglones.
 */
const TOPE = 30;

/**
 * 🔴 EL `code` DE POSTGRES **NO** ESTÁ EN EL ERROR: ESTÁ EN `err.cause`.
 *
 * drizzle envuelve toda consulta fallida en un `DrizzleQueryError` cuyo `message`
 * es el SQL y cuya `cause` es el error del driver, así que un
 * `(e as {code?: string}).code === '42P01'` da **`undefined` siempre** y la
 * degradación no se dispara nunca: en vez de un timeline sin correos, el panel se
 * come un 500.
 *
 * ⚠️ **Es una copia de `codigoDeError` de `repositorio.ts`**, escrita a sabiendas
 * porque los dos archivos se están tocando en frentes distintos a la vez. Es un
 * lector de `err.cause`, no una regla del negocio —no hay dos comportamientos que
 * puedan divergir, sólo uno que puede quedar viejo— pero unificarlas es deuda
 * declarada: van a `lib/porQueFallo.ts`, al lado de la cicatriz que las dos citan.
 */
function codigoDeError(e: unknown): string | undefined {
  let actual: unknown = e;
  for (let salto = 0; salto < 4 && actual; salto += 1) {
    const codigo = (actual as { code?: unknown }).code;
    if (typeof codigo === 'string' && codigo !== '') return codigo;
    actual = (actual as { cause?: unknown }).cause;
  }
  return undefined;
}

/** 42P01 = undefined_table · 42703 = undefined_column. Falta una migración, no está caída la base. */
function faltaElSchema(e: unknown): boolean {
  const codigo = codigoDeError(e);
  return codigo === '42P01' || codigo === '42703';
}

/**
 * LOS CORREOS DE ESA CONVERSACIÓN, del más nuevo al más viejo.
 *
 * Seam con `db` inyectado (ADR 0008): la ruta le pasa el singleton, el test su
 * base de prueba.
 *
 * ⚠️ **Los fallidos SE SIRVEN.** Es el caso que más le importa a la vendedora
 * —«le escribí» y no salió— y esconderlo deja el mismo agujero de H7 con otra
 * forma: el correo desaparecido del timeline, sólo que ahora también desapareció
 * de la bandeja del lead. Quién decide si se dibuja distinto es la pantalla; acá
 * no se filtra nada.
 *
 * ⚠️ **`clave = NULL` no cae en ningún timeline, y eso es la verdad, no un
 * hueco**: un correo sin conversación de origen no es de nadie. Las tres filas de
 * producción son así (las tres son pruebas del 4 y el 6 de agosto). El `eq` ya lo
 * garantiza —en SQL nada iguala a NULL—, pero es la propiedad que fija el test:
 * el día que alguien lo cambie por un `COALESCE`, esas filas aparecen en TODAS
 * las conversaciones.
 *
 * ⚠️ El desempate va por `id` y no es adorno: dos correos del mismo segundo
 * quedan en orden arbitrario, y una lista que se reordena sola entre dos
 * refrescos se lee como que se mandó algo dos veces.
 *
 * ⚠️ **Degrada a `[]` con su log si falta el schema**, como
 * `reacciones/repositorio.ts`: el timeline se arma como hoy —sin correos— y la
 * conversación se sigue pudiendo trabajar. El criterio es el de siempre: acá el
 * consumidor es una persona mirando una historia, no un índice que cachea (ADR
 * 0023). Un fallo de conexión **no** se traga: eso no es «no hay correos».
 */
export async function correosDelTimeline(
  base: typeof Base,
  clave: string,
): Promise<CorreoEnTimeline[]> {
  const buscada = clave.trim();
  if (buscada === '') return [];

  try {
    return await base
      .select(COLUMNAS)
      .from(correos)
      .where(eq(correos.clave, buscada))
      .orderBy(desc(correos.creadoAt), desc(correos.id))
      .limit(TOPE);
  } catch (e) {
    if (!faltaElSchema(e)) throw e;
    console.warn(
      `[correos] la tabla \`correos\` no está como este timeline la espera: se sirve sin correos — ${porQueFallo(e)}`,
    );
    return [];
  }
}
