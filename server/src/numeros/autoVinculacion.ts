import { esSupervisor } from "../padron/supervisor.js";

/**
 * ¿QUIÉN PUEDE AUTO-VINCULAR SU PROPIA LÍNEA, DESDE LA APP? — decisión del
 * dueño del 15-ago-2026: «siempre un vendedor (no supervisor) va a tener la
 * posibilidad de enlazar su número, solo 1».
 *
 * Hasta acá vincular era D13: server-side, con un operador mirando el `/vincular`
 * o el panel de Cerberus. Esto NO reemplaza esa puerta (Cerberus sigue pudiendo
 * declarar cualquier línea con `PUT /api/admin/numeros/:numero`) — abre una
 * segunda, más angosta: una vendedora sin línea puede traer la suya, sola, sin
 * pedirle nada a un operador.
 *
 * Pura: nada de base ni de vinculador acá, así la regla se puede interrogar sin
 * levantar nada. Quien llama trae ya resueltas las líneas actuales
 * (`numeros/repositorio.ts:lineasDeVendedora`) — la MISMA consulta que usa «Las
 * mías» — para que «ya tenés una línea» sea el mismo hecho en los dos lugares.
 */

export type MotivoRechazoAutoVinculacion = "es_supervisor" | "ya_tiene_linea";

export type DecisionAutoVinculacion =
  | { ok: true }
  | { ok: false; motivo: MotivoRechazoAutoVinculacion };

export function puedeAutoVincular(
  vendedoraId: string,
  env: NodeJS.ProcessEnv,
  lineasActuales: readonly string[],
): DecisionAutoVinculacion {
  // Los supervisores no traen línea propia: supervisan las de las demás. Va
  // primero porque es la condición que no cambia con el tiempo — «ya tiene
  // línea» sí, si algún día se retira una.
  if (esSupervisor(vendedoraId, env)) return { ok: false, motivo: "es_supervisor" };
  if (lineasActuales.length > 0) return { ok: false, motivo: "ya_tiene_linea" };
  return { ok: true };
}
