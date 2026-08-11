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
export function personaEsTelefono(canal: string): boolean {
  return canal === 'whatsapp' || canal === 'landing';
}

/** El teléfono de la fila, o `null` si este canal no trae uno. */
export function telefonoDe(c: Pick<Conversacion, 'canal' | 'persona_id'>): string | null {
  return personaEsTelefono(c.canal) ? c.persona_id : null;
}
