/**
 * ¿QUIÉN PUEDE AUTO-VINCULAR SU PROPIA LÍNEA, DESDE LA APP? — **cualquiera del
 * equipo, incluidas las supervisoras**.
 *
 * 🔴 **ENMIENDA DEL 18-ago-2026, y revierte al dueño del 15-ago.** La regla nació
 * como «siempre un vendedor (NO supervisor) va a tener la posibilidad de enlazar
 * su número, solo 1»; el dueño la cambió a que **todos puedan**, supervisoras
 * incluidas. El tope de **una línea por persona no se toca**: lo que se retira es
 * el veto por rol, no el de cantidad.
 *
 * Lo que costaba en producción, medido antes de sacarlo: `HERMES_SUPERVISORES`
 * tenía tres ids (`ventas10@grupogoberna.com`, `alan`, `Usuario1`) y esas tres
 * personas comían 409 al intentar traer su propio número.
 *
 * ⚠️ **Por qué el veto ya no tiene a quién proteger**: era una regla de PRODUCTO
 * («los supervisores supervisan las líneas de las demás»), nunca de seguridad —
 * la línea que traen queda atada 1:1 a quien la trajo, y un supervisor ya podía
 * declararse una por Cerberus. Sacarlo no le da acceso a nada ajeno.
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
 *
 * ══ 🔴 EL PRIMER VETO ES DEL SERVER, NO DE LA PERSONA ══════════════════════
 *
 * Un botón de esta ruta **escribe una credencial real de WhatsApp en el disco de
 * VPS1**: `Vinculador.iniciar()` hace `createClient({ store: .wa-sessions/<n>.db })`
 * SIN mirar el transporte (`whatsapp/vinculador.ts`), y ese `.db` es la cuenta de
 * WhatsApp de esa persona — 43 MB de credencial, gitignored por el nombre exacto
 * del directorio, imposible de recuperar sin el teléfono físico.
 *
 * Por eso la guarda va acá, que es **antes de iniciar el pareo**, y no antes de
 * montar la línea: para cuando se monta, la credencial ya está escrita. Con
 * cualquier transporte que no sea `whatsmeow` no hay nada que esa sesión pueda
 * hacer después —el proceso no va a levantar esa línea— así que escribirla es
 * puro riesgo sin contrapartida.
 *
 * ⚠️ **Y esto tiene un precio que hay que decir en voz alta**: producción corre
 * hoy `WHATSAPP_TRANSPORTE=falso`, así que con esta guarda la auto-vinculación
 * responde **409 en producción** hasta que alguien cambie el `.env` de VPS1 y
 * reinicie a mano (N5 sale verde sin reiniciar si el SHA ya está desplegado).
 * El frente queda dependiendo de esa operación; no es un detalle de código.
 *
 * ══ ⚠️ EL ROL, CUANDO ATERRICE LA TABLA DE EQUIPO ═════════════════════════
 *
 * Hoy esto pregunta `esSupervisor(id, env)`, que lee `HERMES_SUPERVISORES`. Con
 * el modelo de roles administrado desde Hermes (paso 5 del plan, tabla `equipo`,
 * la construye otra unidad en paralelo) este call site pasa a preguntar
 * **`rol === 'vendedora'`** — comparación EXACTA al rol más bajo—, y **no**
 * `!alcanzaRol(rol, 'supervisor')`.
 *
 * Es el decimoctavo call site y el único que no pregunta «¿ve de más?» sino «¿es
 * del piso?». La diferencia la decide un caso real: Luz dirige *y además* atiende
 * 2.355 conversaciones. Con la pregunta jerárquica, subirle el rol le sacaría la
 * línea propia con la que trabaja todos los días — o sea que la jerarquía se
 * vuelve en contra justo en la persona que más la necesita. Con la exacta, sólo
 * quien es *solamente* vendedora trae línea, y quien tiene un rol más alto se lo
 * declara Cerberus como cualquier otra línea.
 */

/** El único transporte que puede USAR una sesión de whatsmeow después de escribirla. */
export const TRANSPORTE_QUE_VINCULA = "whatsmeow";

export type MotivoRechazoAutoVinculacion =
  | "transporte_sin_vinculacion"
  | "ya_tiene_linea";

export type DecisionAutoVinculacion =
  | { ok: true }
  | { ok: false; motivo: MotivoRechazoAutoVinculacion };

/**
 * ¿Este server puede escribir una sesión de WhatsApp que después va a servir para
 * algo? Default `falso` — el mismo default que `whatsapp/wiring.ts:arrancarWhatsapp`,
 * a propósito: dos defaults distintos darían un server que vincula sesiones que
 * nunca va a montar.
 */
export function transportePuedeVincular(env: NodeJS.ProcessEnv): boolean {
  return (env.WHATSAPP_TRANSPORTE ?? "falso") === TRANSPORTE_QUE_VINCULA;
}

/**
 * Una línea de la vendedora, con **cuántas personas la atienden**.
 *
 * `duenas` es el dato que separa «su línea» de «la línea del equipo», y viene de
 * contar `numero_vendedora` — no de `proposito`, que no alcanza: la línea de
 * Meta es `proposito: 'vendedora'` igual que lo sería una personal.
 */
export interface LineaDeLaVendedora {
  numero: string;
  /** Cuántas vendedoras la tienen asignada. `1` = suya. `> 1` = del equipo. */
  duenas: number;
}

/**
 * 🔴 UNA LÍNEA COMPARTIDA NO CUENTA PARA EL TOPE, Y ESO ES LA REGLA — no una
 * excepción (decisión del dueño, 17-ago-2026).
 *
 * ── Qué se rompió sin esto, medido en producción ──
 *
 * `51984429504` («Ventas Meta», la Cloud API que trae TODOS los leads) tiene
 * **siete personas asignadas**: Luz, Sindy y las cinco `ventas1X@`. Con el tope
 * contando cualquier línea, las siete caían en `ya_tiene_linea` y el panel les
 * escondía el botón — o sea que **el frente entero era inalcanzable justo para
 * el equipo que vende**, que es para quien se construyó. Y no daba error: el
 * front sólo ofrece «Vincular tu WhatsApp» a quien no tiene ninguna, así que la
 * vendedora no veía un rechazo, no veía nada.
 *
 * ⚠️ **Lo destapó la normalización de grafías de este mismo frente.** Antes,
 * `lineasDeVendedora('luz')` comparaba exacto contra el `Luz` que empuja
 * Cerberus y devolvía `[]`: Luz habría pasado, por un bug. Al arreglar la
 * comparación empezó a resolver bien a `{51984429504}` y quedó bloqueada. El
 * arreglo correcto no era volver atrás: era que el tope mire lo que de verdad
 * importa.
 *
 * ── Por qué `duenas` y no `proposito` ──
 *
 * `proposito` no distingue: la línea de Meta es `'vendedora'`, igual que lo sería
 * la personal de alguien. Lo que separa una de otra es que **la del equipo la
 * comparten varias**. `soloSusLineas` (`cola/lineas.ts`) mira `'campana'` y
 * responde otra pregunta —«¿ve sólo lo suyo?»—, así que reusarla acá habría
 * atado dos decisiones que cambian por motivos distintos.
 *
 * `numeroPedido` existe para que **re-vincular la línea propia siga siendo
 * posible**: «solo 1» es un tope de CUÁNTAS, no una prohibición de volver a
 * parear la que ya es suya. Sin esto, si el montaje en caliente falla —o si el
 * server reinicia y la línea queda registrada y muda (#194)— la vendedora tiene
 * su fila escrita y ninguna forma de volver a intentarlo desde la app.
 */
export function puedeAutoVincular(
  /**
   * ⚠️ **Ya no decide nada, y se conserva a propósito.** Con el veto por rol
   * retirado, la decisión no mira quién pregunta — pero la firma es el contrato
   * del call site y sacarlo obligaría a tocarlo por un cambio que no es suyo. El
   * día que vuelva a haber una regla por persona, el parámetro ya está.
   */
  _vendedoraId: string,
  env: NodeJS.ProcessEnv,
  lineasActuales: readonly LineaDeLaVendedora[],
  numeroPedido: string,
): DecisionAutoVinculacion {
  // Primero el veto del SERVER: no depende de quién pregunte y es el que evita
  // escribir una credencial que nadie va a usar.
  if (!transportePuedeVincular(env)) return { ok: false, motivo: "transporte_sin_vinculacion" };
  // Acá vivía el veto por rol (`esSupervisor`). Se retiró el 18-ago-2026: ahora
  // **todo el equipo** puede traer su línea. Lo que queda es el tope de cantidad.
  // Sólo las EXCLUSIVAMENTE suyas ocupan el cupo. Una compartida es del equipo:
  // no se la trajo ella, no la puede retirar, y tenerla no dice nada sobre si
  // necesita una propia.
  const propias = lineasActuales.filter((l) => l.duenas === 1);
  const otraLinea = propias.some((l) => l.numero !== numeroPedido);
  if (otraLinea) return { ok: false, motivo: "ya_tiene_linea" };
  return { ok: true };
}
