import { sql } from "drizzle-orm";

/**
 * QUIÉN PUEDE NOMBRAR A ESTA PERSONA — y por lo tanto quién puede borrarla del
 * mapa de líneas.
 *
 * ══ EL PROBLEMA QUE RESUELVE ════════════════════════════════════════════════
 *
 * `PUT /api/admin/numeros/:numero` es **declarativo**: Cerberus manda el set
 * completo de vendedoras de ese número y `upsertNumero` reemplaza. Eso está bien
 * mientras Cerberus sea el único que puede nombrar a alguien.
 *
 * Dejó de serlo el 13-ago-2026, cuando entró el login de Centurión: una identidad
 * como `centurion:betto.romero` la crea Centurión, **no Cerberus**, y Cerberus no
 * la conoce ni la va a mandar nunca en su set. Con el reemplazo a secas, el primer
 * push legítimo de Cerberus a esa línea **borraba al agente digital y lo devolvía
 * al 403** — sin error, sin log, y sin que bajara ningún conteo global (bajó una
 * fila de un número).
 *
 * ══ LA REGLA, Y POR QUÉ ES EL PREFIJO ═══════════════════════════════════════
 *
 * Una identidad **federada** lleva `<origen>:` adelante. No es una convención
 * nueva: es exactamente para lo que `vendedoraIdDeCenturion` inventó el namespace
 * —«nunca puede chocar con un username de Cerberus»— y acá se cobra la segunda
 * vez. Un username de Cerberus (`luz`, `ventas10@grupogoberna.com`, `Usuario1`)
 * **no lleva dos puntos**; una identidad de otro sistema, sí.
 *
 * Así que la regla se lee sola: **el set declarativo de Cerberus reemplaza sólo
 * las identidades que Cerberus puede nombrar.** Las federadas sobreviven a su
 * push, porque no son suyas para borrar.
 *
 * ⚠️ Esto NO es un modelo de permisos ni una columna de origen. Es lo más chico
 * que hace correcto el caso de hoy. El día que haya un tercer escritor con
 * identidades sin prefijo, hace falta la columna de verdad — y ahí esta función
 * es el lugar donde se ve que hizo falta.
 */
export function esIdentidadFederada(vendedoraId: string): boolean {
  return vendedoraId.includes(":");
}

/**
 * El gemelo SQL de `esIdentidadFederada`, para el `DELETE` del upsert.
 *
 * Vive al lado de la función pura y hay un test de paridad que las cruza sobre los
 * mismos casos: son dos escrituras de una sola regla, que es cómo este repo paga
 * el #37 en todos lados donde una regla tiene que existir en los dos lenguajes.
 */
export const esIdentidadFederadaSql = sql`position(':' in vendedora_id) > 0`;
