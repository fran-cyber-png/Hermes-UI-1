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
