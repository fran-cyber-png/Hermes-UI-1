import type { Conversacion } from './conversaciones';

/**
 * UNA `Conversacion` ARMADA DESDE UN TELÉFONO — para las pantallas que tienen a
 * la persona pero no a su hilo.
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * Media app pide una `Conversacion` para hacer cualquier cosa con alguien: el
 * panel derecho, el registro de venta, el composer. Pero hay dos lugares donde
 * la persona aparece SIN hilo — el buscador de Contactos y el padrón (ADR 0035,
 * 72.923 contactos que **nunca escribieron**) — y ahí no hay ninguna fila de la
 * cola de la que copiar la clave.
 *
 * Esto ya existía: estaba escrito a mano adentro de `escribirA`, en `App.tsx`.
 * Se sacó acá porque desde el sidebar del padrón hay un SEGUNDO llamador, y dos
 * copias de una clave son dos claves distintas el día que una cambie — que en
 * este repo es el defecto de #37, escrito en cuatro archivos.
 *
 * ══ LA CLAVE NO SE INVENTA: ES LA MISMA QUE ARMA EL SERVER ═══════════════════
 *
 * `conv:<canal>:<persona>:<numeroPropio>` es literalmente lo que construye el
 * SQL de la cola y del radar (`'conv:' || canal || ':' || persona_id || ':' ||
 * numero_propio`). Por eso, si esa persona escribe después por esta misma línea,
 * la conversación que aparece en la cola **es esta**, no una nueva.
 *
 * ⚠️ **Y por eso mismo, si escribió por OTRA línea, esta clave no es la suya.**
 * Lo que se ve entonces —timeline, señales e intereses vacíos— no es un error de
 * carga: es que no hay nada guardado bajo esta clave. Lo que sí responde igual es
 * todo lo que se busca por TELÉFONO (la ficha de Cerberus, el lead-form), que es
 * la mitad que contesta «quién es».
 *
 * ⚠️ **Esta clave viaja en el POST de la venta** (`FormularioVenta`), así que
 * registrar una venta desde acá la atribuye a esta clave. No es nuevo —es
 * exactamente lo que hace hoy «Escribirle» desde Contactos— pero conviene que
 * esté escrito donde se arma y no solo donde se usa.
 *
 * ══ `numeroPropio` NULO NO ES UN CASO INVENTADO ══════════════════════════════
 *
 * Sin WhatsApp conectado no hay línea propia que poner. La cola tampoco la tiene
 * siempre: su SQL usa `COALESCE(e.payload->>'numeroPropio', '')`, o sea que una
 * clave terminada en `:` es una clave **real y posible**, no una rota. Se arma
 * igual —el panel se puede abrir con WhatsApp caído— y `numero_propio` queda en
 * `null`, que es lo que la app lee para saber que no hay línea.
 */
export function conversacionDeTelefono({
  telefono,
  numeroPropio,
  nombre = null,
  ahora = new Date(),
}: {
  /** Como venga: se le sacan los no-dígitos acá, una sola vez. */
  telefono: string;
  /** La línea propia de Goberna. `null` con WhatsApp desconectado. */
  numeroPropio: string | null;
  /** El nombre que ya sepamos (el del padrón, el del formulario). */
  nombre?: string | null;
  /** Inyectable para poder testear sin congelar el reloj global. */
  ahora?: Date;
}): Conversacion {
  const tel = telefono.replace(/\D/g, '');
  const iso = ahora.toISOString();
  return {
    clave: `conv:whatsapp:${tel}:${numeroPropio ?? ''}`,
    canal: 'whatsapp',
    tipo: 'mensaje',
    persona_id: tel,
    persona_nombre: nombre,
    numero_propio: numeroPropio,
    texto: null,
    contexto_texto: null,
    respondida: false,
    ventana_abierta: false,
    pregunto: false,
    n: 0,
    referencia: iso,
    ultimo_at: iso,
    dias: 0,
    // Neutro: el «resto» de la escala 0–5. La cola recalcula el real al cargar,
    // y acá no hay nada medido de lo que derivar una urgencia.
    nivel: 5,
  };
}
