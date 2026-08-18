import { mismoUsuario } from '../notas/espacios';

/**
 * QUIÉN VE «ROUTING» — la décima vista del riel.
 *
 * ⚠️ **ESTO ES VISIBILIDAD, NO UNA FRONTERA**, y decirlo importa más que el
 * código: hoy la vista está VACÍA, así que no hay un dato que recortar. El día
 * que traiga algo del server, el recorte tiene que vivir en el `WHERE` de su
 * ruta —como el padrón (ADR 0035) y el Dashboard (ADR 0036)— y no acá: un
 * recorte dibujado en el navegador no existe, los datos ya viajaron. Un recorte
 * presentado como frontera es peor que ninguno, porque se le cree.
 *
 * La lista va a mano, como `HERMES_SUPERVISORES` y la rueda del reparto: no hay
 * tabla, no la edita nadie desde la app, y agregar a alguien es un commit.
 *
 * 🔴 **SE COMPARA NORMALIZANDO LOS DOS LADOS.** En producción el mismo humano
 * tiene dos grafías vivas (`Usuario1` es lo que empuja Cerberus, `usuario1` es
 * lo que se tipea al entrar; con Luz pasa igual). Comparar exacto no da error:
 * da que la vista **no aparece nunca**, sin un solo síntoma. Por eso se reusa
 * `mismoUsuario` y no se escribe un cuarto normalizador (#37).
 */
export const VEN_ROUTING = ['alan', 'Usuario1'] as const;

/** ¿Esta vendedora tiene la vista Routing en su riel? */
export function veRouting(vendedoraId: string | null | undefined): boolean {
  return VEN_ROUTING.some((quien) => mismoUsuario(quien, vendedoraId));
}

/**
 * QUIÉN MIRA — lo mínimo que una regla del riel necesita saber de la persona.
 *
 * Era `vendedoraId: string | null`, y con eso alcanzaba mientras la única regla
 * fuera «¿es de esta lista?». La segunda pregunta —«¿de qué lado del negocio
 * trabaja?»— no se puede contestar desde un id: la contesta el server, que es
 * quien tiene `numero_vendedora`. Por eso el parámetro pasa a ser la vendedora.
 */
export interface QuienMira {
  id?: string | null;
  esDeCampana?: boolean;
}

/**
 * LAS CUATRO VISTAS QUE UN OPERADOR DE CAMPAÑA NO TIENE — Navegador, Libreta,
 * Correos y Entrenar bot. Decisión del dueño del 18-ago-2026.
 *
 * 🔴 **ESTO ESCONDE, NO PROTEGE — y acá esa distinción sí muerde.** Routing se
 * podía dar el lujo de vivir sólo en el riel porque su vista está vacía; estas
 * cuatro tienen datos. Lo que de verdad las niega es `numeros/soloEscuela.ts`,
 * montado sobre `/api/correos`, `/api/notas`, `/api/espacios` y
 * `/api/entrenamiento`. Si alguien saca este `soloPara`, el operador de campaña
 * ve los íconos y come 403; si alguien saca el del server, **la frontera
 * desaparece y la pantalla sigue diciendo que está** — que es la peor de las dos
 * mitades para perder.
 *
 * El Navegador no tiene ruta que negar: es un comando de la cáscara Tauri (ADR
 * 0043), así que sacarle la vista sí es todo lo que hay que hacer, y su candado
 * de verdad son las capabilities.
 */
export function noEsDeCampana(quien: QuienMira | null | undefined): boolean {
  return !quien?.esDeCampana;
}
