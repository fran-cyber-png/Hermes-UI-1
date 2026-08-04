import { mismaVendedora } from "../reparto/destino.js";

/**
 * QUIÉN VE EL PADRÓN ENTERO — la regla, pura.
 *
 * ══ POR QUÉ ESTO NO ES «UN FILTRO MÁS» ═══════════════════════════════════
 *
 * Todo lo demás que recorta en Hermes —«Las mías» (`cola/lineas.ts`), «Míos»
 * (`cola/asignadaSql.ts`)— es explícitamente **un filtro y no un permiso**, y
 * está escrito así porque la cola es una pantalla compartida donde cualquiera
 * puede abrir cualquier conversación: presentar ese recorte como frontera sería
 * una frontera imaginaria, peor que ninguna porque se le cree.
 *
 * Acá la decisión del dueño es la contraria y hay que decirla en voz alta: **la
 * vendedora normal NO ve el padrón**, ve lo que el supervisor le habilitó. Eso
 * sí es una frontera, y por eso vive en el SERVER y no en un `if` del navegador:
 * la ruta no sirve las 72.923 filas a un token que no es supervisor. Un recorte
 * hecho en el front sería exactamente la frontera imaginaria de la que se
 * defiende el resto del repo — los datos ya habrían viajado.
 *
 * ══ POR QUÉ UNA ENV Y NO UNA TABLA ═══════════════════════════════════════
 *
 * Hermes **no tiene padrón de usuarios**: el login es un handshake contra Django
 * y lo único que vuelve es «entró» o «no entró» (`cerberus/auth.ts`). No hay
 * dónde colgar un rol. Las dos opciones honestas eran una tabla nueva con su
 * script —como `reparto_rueda`— o una variable de entorno, y con UN supervisor
 * la tabla es andamiaje: agrega una migración, un CLI y un lugar más donde
 * mirar, para representar una lista de un elemento.
 *
 * Lo que sí se hereda de la rueda es el criterio de que **no se edita desde la
 * app**: quién ve 72.923 contactos con nombre, teléfono y correo no puede estar
 * a un clic de cualquier token de vendedora. Cambiar la lista es tocar el
 * entorno y reiniciar — deliberadamente incómodo, deliberadamente auditable.
 *
 * El día que sean cinco supervisores y cambien seguido, esto se muda a tabla sin
 * tocar a quien lo llama: la firma ya es `(vendedoraId, env) → boolean`.
 *
 * ══ FAIL-CLOSED ══════════════════════════════════════════════════════════
 *
 * Sin la variable, **nadie** es supervisor: no se sirve el padrón a nadie. La
 * alternativa —«sin configurar, todos ven todo»— convierte una config que falta
 * en una fuga de la base entera, y es justo el fallo que nadie investiga porque
 * se ve como que funciona.
 *
 * Que nadie sea supervisor NO se dibuja como una lista vacía: la ruta lo dice
 * (`sinSupervisores`), como `sinLineasPropias` y `sinPadron`. Una pantalla en
 * blanco se lee «se perdieron los contactos», no «falta configurar esto».
 */

/** El nombre de la variable, en un solo lugar (regla dura #1: se referencia, no se pega). */
export const ENV_SUPERVISORES = "HERMES_SUPERVISORES";

/**
 * Los supervisores configurados, tal como se escribieron.
 *
 * Se conserva la grafía de entrada y no se normaliza al guardar, por lo mismo
 * que el reparto: la comparación normaliza de los DOS lados (`mismaVendedora`),
 * y reescribir la grafía rompería el cruce con todo lo que ya tiene filas
 * (`gestiones`, `estado_conversacion`, `conversacion_asignada`).
 */
export function supervisoresConfigurados(env: NodeJS.ProcessEnv): string[] {
  const crudo = env[ENV_SUPERVISORES];
  if (typeof crudo !== "string") return [];
  return crudo
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * ¿Este token puede ver el padrón entero y repartirlo?
 *
 * ⚠️ **Normaliza de los DOS lados.** En producción el mismo humano tiene dos
 * grafías vivas —Cerberus empuja `Luz`, ella entra como `luz`— y el `vendedoraId`
 * del token es lo que se TIPEÓ en el login. Un supervisor configurado como
 * `Ventas10@grupogoberna.com` que entra escribiendo `ventas10@grupogoberna.com`
 * dejaría de ser supervisor sin un solo síntoma: vería su propia pantalla vacía
 * y leería «no me habilitaron nada». Ver `mismaVendedora`.
 */
export function esSupervisor(vendedoraId: string, env: NodeJS.ProcessEnv): boolean {
  const lista = supervisoresConfigurados(env);
  if (lista.length === 0) return false; // fail-closed: sin config, nadie.
  return lista.some((s) => mismaVendedora(s, vendedoraId));
}
