/**
 * «ESTA CONVERSACIÓN ES DE…» — la marca de dueño en la fila de la cola, pura.
 *
 * ── Por qué existe ──
 * Desde el 4-ago-2026 SIETE personas comparten la línea `51984429504`. El reparto
 * (`server/src/reparto/`) le pone dueño a cada conversación nueva, pero mientras
 * ese dueño no se VEA en el listado el reparto no evita nada: las dos cosas que
 * se querían impedir —**dos contestando al mismo lead** y **nadie contestando a
 * otro**— pasan igual, porque la fila se ve idéntica a como se veía.
 *
 * ── Qué dice, y por qué así ──
 * Dos lecturas, no tres:
 *
 *   · `Sindy`   — es de otra persona. La señal accionable de verdad: **no la
 *                 agarres, ya tiene dueño**. Es la ÚNICA lectura que queda.
 *
 * ⚠️ **«Vos» se retiró** (4-ago-2026, decisión del dueño). Existía para marcar lo
 * propio dentro de la cola compartida, y esa cola dejó de existir: quien está en
 * una rueda del reparto ve **solo lo suyo**, así que «Vos» sería la misma píldora
 * en todas las filas — la definición de ruido. Lo propio ya no se rotula en
 * ningún caso; lo ajeno sí, y ahí es donde importa.
 *
 * ── Lo que NO hace ──
 * **No dibuja «sin dueño».** Una conversación sin asignar es el estado más común
 * y más aburrido que hay —las 91 que ya existían el día del reparto, todo lo que
 * entra por las otras tres líneas, y cualquier cosa que llegue con la rueda
 * vacía—: una píldora en 1.900 filas no es información, es ruido. Ausencia de
 * dato = no se dibuja nada, igual que `cliente.ts` con el nivel desconocido.
 *
 * **Y no dice «Vos» adentro de tu propia cola.** Con el filtro «Míos» puesto,
 * TODAS las filas son tuyas: repetirlo en cada una es la misma píldora 14 veces
 * diciendo lo que ya dice el filtro de arriba.
 *
 * El color y la forma viven en el componente (misma división que `cliente.ts` y
 * `bot.ts`): acá se decide QUÉ se dice, no cómo se ve.
 */

export type TonoDueno = 'otra';

export interface MarcaDueno {
  tono: TonoDueno;
  /** Lo que se lee en la píldora. Corto: la fila mide 360 px y ya lleva mucho. */
  texto: string;
  /** El `title`, donde entra el detalle sin gastar ancho. */
  titulo: string;
}

/** Lo mínimo que la marca necesita de una fila de la cola. */
export interface FilaConDueno {
  /** El username de Cerberus de quien la tiene. `null`/ausente = sin dueño. */
  asignada_a?: string | null;
}

export interface QuienMira {
  /** El username de quien está logueada. Sin esto no se puede decir «Vos». */
  yo?: string | null;
}

/**
 * El nombre corto que va en la píldora.
 *
 * El `vendedora_id` es el username de Cerberus, que puede venir como `sindy`,
 * `sindy.rojas` o `srojas`. Se corta en el primer separador y se capitaliza: en
 * 360 px entra un nombre, no una dirección.
 *
 * **No inventa un nombre propio**: si el username no tiene forma de nombre
 * (`srojas`), se muestra tal cual capitalizado. Preferimos un rótulo feo y cierto
 * a uno lindo y adivinado — el `title` lleva el username completo igual.
 */
/**
 * ¿Es el mismo humano? — el gemelo de `mismaVendedora` del server
 * (`reparto/destino.ts`) y de `lower()` en `cola/asignadaSql.ts`. Los tres tienen
 * que decir lo mismo, o la fila diría «Vos» sobre algo que el recorte «Míos» no
 * trae (o al revés).
 *
 * ⚠️ Normaliza de los DOS lados, y eso es una corrección con evidencia: en
 * producción (medido el 4-ago-2026) Cerberus empuja `Luz` y ella entra como
 * `luz`. Con la comparación exacta, sus propias conversaciones le aparecían como
 * si fueran de otra persona.
 */
function mismaVendedora(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  return x !== '' && x === b.trim().toLowerCase();
}

export function nombreCorto(vendedoraId: string): string {
  const base = vendedoraId.trim().split(/[.\-_@\s]/)[0] ?? '';
  if (!base) return vendedoraId.trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * EL RÓTULO DE UNA PERSONA EN UNA LISTA — su nombre si Hermes lo sabe, y si no
 * el username recortado.
 *
 * ── Por qué existe, y qué se veía antes ──
 * El selector «Pasar la conversación a» mostraba `Ventas10 · Ventas11 · Ventas12`
 * sobre gente que se llama Alex, Cielo y James. No estaba leyendo mal un nombre:
 * **no leía ninguno** — `nombreCorto` recorta el `vendedora_id`, que para media
 * rueda es el correo de Cerberus (`ventas11@grupogoberna.com`), y de ahí sale un
 * rótulo que parece una cuenta de sistema en vez de una persona.
 *
 * ── De dónde sale el nombre ──
 * De `equipo.nombre`, que el server sirve en `nombres` (`GET /api/reparto/rueda`)
 * **ya filtrado**: ahí sólo viajan los nombres de verdad. Acá NO se vuelve a
 * juzgar cuál es de verdad y cuál es relleno — esa regla vive en el server
 * (`equipo/nombre.ts`) y tenerla dos veces es #37 sobre un dato que además viaja
 * normalizado.
 *
 * ⚠️ **`nombres` es OPCIONAL y ausente NO es un error.** Un server viejo no lo
 * manda, y una respuesta rehidratada del caché de IndexedDB (ADR 0007) tampoco:
 * en los dos casos se ve exactamente como se veía antes de este arreglo, que es
 * la degradación correcta. Por eso el parámetro admite `undefined` en vez de
 * exigir un objeto vacío.
 *
 * ⚠️ **Se busca por el id CANÓNICO**, no por la grafía que vino. La lista de
 * destinos sirve la grafía que escribió el operador (`Luz`, `Sindy`, `Tracy`) y
 * las claves de `nombres` son `lower(btrim(...))`: buscando tal cual, la persona
 * con el id capitalizado se queda sin nombre y **no hay ningún error que ver**.
 * Es la misma cicatriz de `mismaVendedora` acá abajo, por el mismo motivo.
 */
export function rotuloDePersona(
  vendedoraId: string,
  nombres?: Record<string, string>,
): string {
  const nombre = nombres?.[vendedoraId.trim().toLowerCase()]?.trim();
  return nombre || nombreCorto(vendedoraId);
}

export function marcaDeDueno(fila: FilaConDueno, quien: QuienMira = {}): MarcaDueno | null {
  const dueno = typeof fila.asignada_a === 'string' ? fila.asignada_a.trim() : '';
  // Sin dueño no se dibuja nada. Ausencia de dato NO es «es de nadie, agarrala»:
  // un server sin la migración del reparto manda exactamente esto en cada fila.
  if (!dueno) return null;

  const esMia = mismaVendedora(dueno, quien.yo ?? '');

  // Lo propio NO se rotula, nunca. Ver el docblock: «Vos» se retiró.
  if (esMia) return null;

  return {
    tono: 'otra',
    texto: nombreCorto(dueno),
    titulo: `Asignada a ${dueno} — podés abrirla igual, pero ya tiene dueño`,
  };
}
