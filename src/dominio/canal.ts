import type { Conversacion } from './conversaciones';

/**
 * ══ QUÉ SE LE PUEDE PREGUNTAR A UN CANAL ═══════════════════════════════════
 *
 * 🔴 **`canal === 'whatsapp'` estaba escrito 20 veces en `src/` respondiendo
 * TRES preguntas distintas**, y confundirlas costó que la ficha de un lead de
 * formulario saliera vacía teniendo el teléfono a la vista (11-ago-2026):
 *
 *   1. **¿`persona_id` es un teléfono?** → lo que hay acá. Decide si se puede
 *      buscar la ficha de Cerberus, el lead-form y el padrón. **`landing` sí**.
 *   2. **¿Le pedimos la foto de perfil de WhatsApp?** → `fotoVisible.ts`
 *      (`quiereFoto`). **`landing` NO**: nunca le escribimos, y pedir la foto de
 *      un número con el que jamás hablamos es justo lo que #59 evita.
 *   3. **¿Se le puede MANDAR algo?** → las guardas de `DosRespuestas`,
 *      `PanelPlantillas`, `BloqueHechos` y `compuertas.ts`. **`landing` NO**: no
 *      hay hilo abierto, abrirlo en frío es otro problema (regla dura #7).
 *
 * Las tres se veían iguales escritas y son opuestas en dos de los tres casos.
 * Por eso ésta vive acá, con nombre, y las otras dos se quedan donde están —
 * separarlas ES el arreglo; unificarlas de nuevo sería volver al defecto.
 */

/**
 * ¿El `persona_id` de esta fila ES un número de teléfono?
 *
 * · `whatsapp` — sí, el `persona_id` es el teléfono.
 * · `landing`  — **sí**: `cola/leadsCte.ts` emite `regexp_replace(phone,…)` como
 *   `persona_id`. Es la persona que llenó el formulario, y su teléfono es lo
 *   único que tenemos para cruzarla con Cerberus, con `leads` y con el padrón.
 * · `facebook` / `instagram` — **no**: ahí el `persona_id` es un id de Meta o un
 *   PSID. Es una cadena de dígitos que **no es un número**, y buscarla como si
 *   lo fuera devolvería la ficha de otra persona.
 *
 * Se acepta el `string` crudo y no la unión: un canal nuevo que el front todavía
 * no conoce cae en `false`, que es el lado seguro (no se le inventa un teléfono).
 */
export function personaEsTelefono(canal: string, personaId?: string | null): boolean {
  // ⚠️ DENTRO DE `whatsapp` TAMBIÉN HAY PERSONAS SIN TELÉFONO. Cuando WhatsApp
  // identifica a quien escribe con un LID y no entrega su número, la fila entra
  // con la identidad `lid-…` (`server/src/whatsapp/identidadWa.ts`). Es una
  // cadena de dígitos con prefijo, o sea exactamente el caso que este archivo ya
  // describe para Meta: buscarla como teléfono devolvería la ficha de OTRA
  // persona. El canal no alcanza para responder la pregunta — hace falta mirar
  // el `persona_id`, y por eso el parámetro. Es opcional para no romper a quien
  // solo tiene el canal a mano, y omitirlo conserva la respuesta de antes.
  if (personaId != null && personaId.startsWith(PREFIJO_LID)) return false;
  return canal === 'whatsapp' || canal === 'landing';
}

/**
 * El prefijo de una identidad que NO es un teléfono. Su gemelo vive en
 * `server/src/whatsapp/identidadWa.ts`; los cruza `canal.paridad.test.ts`,
 * porque si divergen el front trataría un LID como número sin un solo síntoma.
 */
export const PREFIJO_LID = 'lid-';

/** El teléfono de la fila, o `null` si esta persona no trae uno. */
export function telefonoDe(c: Pick<Conversacion, 'canal' | 'persona_id'>): string | null {
  return personaEsTelefono(c.canal, c.persona_id) ? c.persona_id : null;
}
