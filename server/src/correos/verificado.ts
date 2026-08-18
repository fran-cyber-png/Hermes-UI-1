/**
 * QUÉ DIRECCIÓN PUEDE SER REMITENTE — la regla, pura.
 *
 * ══ POR QUÉ SE PREGUNTA AL DAR DE ALTA Y NO AL MANDAR ════════════════════
 *
 * 🔴 **SES contesta 554 a un `From` que no verificó, y ese 554 llega con un lead
 * esperando.** Un remitente mal dado de alta no se ve mal en ningún lado: la fila
 * de `remitentes_correo` queda escrita, la pantalla lo lista, el selector lo
 * ofrece — y el defecto aparece semanas después, en el correo de otra persona,
 * como «el correo no salió, volvé a intentar». Por eso la pregunta se hace en el
 * alta, que es el único momento en que hay alguien mirando la config y en que la
 * respuesta se puede explicar («ese dominio no está verificado en SES»).
 *
 * ⚠️ Esto NO reemplaza al 554: si alguien verifica un dominio en SES y se olvida
 * de agregarlo acá, el alta se rechaza (molesto, reversible); si lo agrega acá
 * sin verificarlo en SES, el alta pasa y el primer envío falla. La lista de acá
 * es una PROMESA sobre lo que SES ya aceptó, no una fuente de verdad — quien la
 * toca tiene que haber mirado SES primero.
 *
 * ══ LO MEDIDO (17-ago-2026), Y ES DE DÓNDE SALE EL DEFAULT ═══════════════
 *
 * - **`goberna.us` está verificado como DOMINIO** en SES (existe el TXT
 *   `_amazonses.goberna.us`): cualquier `direccion@goberna.us` sale de remitente
 *   sin verificar nada más, y el display name no se verifica nunca.
 * - **`grupogoberna.com` NO está verificado.** Los `vendedora_id` del equipo
 *   —`ventas10@`, `ventas11@`, `ventas12@grupogoberna.com`— **no pueden ser
 *   `From`**. Sí pueden ser **`Reply-To`**, que SES no verifica: eso es
 *   exactamente D2, y es lo que hace que la respuesta del lead vuelva a la
 *   persona que escribió y no a un buzón que Hermes no lee.
 *
 * Por eso el default es `goberna.us` y no la lista vacía: vacía, nadie podría dar
 * de alta un remitente y la pantalla de D1 quedaría muerta el día que alguien
 * borre la variable. Y no es «abierto por defecto» — es el único dominio del que
 * se midió que SES lo acepta.
 *
 * ══ POR QUÉ EL ENTORNO ENTRA COMO ARGUMENTO ══════════════════════════════
 *
 * Molde de `padron/supervisor.ts`. Un módulo puro que lee `process.env` adentro
 * no se puede interrogar sobre dos configuraciones en el mismo test, y en
 * `node:test` los archivos corren **en paralelo con el `process.env`
 * compartido**: un test que lo toca le cambia el mundo a otro archivo y el rojo
 * aparece en el que no tocó nada. La firma `(direccion, dominios)` además deja
 * esta regla testeable sin inventar un entorno.
 */

/** El nombre de la variable, en un solo lugar (regla dura #1: se referencia, no se pega). */
export const ENV_DOMINIOS = 'SMTP_DOMINIOS_VERIFICADOS';

/**
 * Lo único que se midió verificado en SES. No es una comodidad: es un hecho con
 * fecha, y cambiarlo acá sin tocar SES devuelve el 554 en el primer envío.
 */
const DOMINIO_POR_DEFECTO = 'goberna.us';

/**
 * Los dominios que SES acepta como remitente, tal como se escribieron.
 *
 * Se conserva la grafía de entrada —no se normaliza al guardar— por lo mismo que
 * la lista de supervisores: la comparación normaliza de los DOS lados, y lo que
 * se escribió es lo que la pantalla le muestra al operador cuando le rechaza un
 * alta («los dominios verificados son: …»). Un mensaje que reescribe lo que
 * configuraron es un mensaje que no ayuda a encontrar el error.
 */
export function dominiosVerificados(env: NodeJS.ProcessEnv): string[] {
  const crudo = env[ENV_DOMINIOS];
  if (typeof crudo !== 'string') return [DOMINIO_POR_DEFECTO];
  const lista = crudo
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  // Una variable presente pero vacía (o llena de comas) es la misma situación que
  // no tenerla: config a medio hacer, no «ningún dominio a propósito».
  return lista.length === 0 ? [DOMINIO_POR_DEFECTO] : lista;
}

/**
 * ¿Esta dirección puede ir en el `From`?
 *
 * ⚠️ **Normaliza de los DOS lados**, por la misma razón por la que el índice
 * `remitentes_correo_direccion_uq` va sobre `lower(direccion)`: `Escuela@Goberna.US`
 * y `escuela@goberna.us` son el MISMO buzón. Un alta rechazada por una mayúscula
 * no se lee como un error de config: se lee como «no me deja», y quien lo intenta
 * prueba con otra dirección en vez de mirar la variable.
 *
 * 🔴 **Las dos arrobas se rechazan acá y no más adelante.** `'a@b@goberna.us'`
 * leído con `split('@').pop()` da `goberna.us` y pasaría el chequeo de dominio
 * siendo una cabecera inválida — y el patrón es siempre el mismo: dos parsers que
 * leen distinto la misma cadena. Se exige **una sola** arroba, con las dos mitades
 * no vacías, y nada de espacios adentro (un espacio en una cabecera es la puerta
 * a que empiece a leerse como otra cosa; ver `sinSaltos` en `remitente.ts`).
 *
 * Con la lista vacía devuelve `false` para todo: fail-closed, aunque hoy
 * `dominiosVerificados` no pueda devolver una lista vacía.
 */
export function puedeSerRemitente(direccion: string, dominios: readonly string[]): boolean {
  const limpia = direccion.trim();
  if (limpia === '' || /\s/.test(limpia)) return false;

  const partes = limpia.split('@');
  if (partes.length !== 2) return false; // sin arroba, o con más de una
  const [local, dominio] = partes;
  if (local === '' || dominio === '') return false;

  const normal = dominio.toLowerCase();
  return dominios.some((d) => {
    const v = d.trim().toLowerCase();
    if (v === '') return false;
    // 🔴 **UN DOMINIO VERIFICADO EN SES CUBRE SUS SUBDOMINIOS, y está MEDIDO.**
    //
    // Esto comparaba por igualdad exacta y el front (`AdminRemitentes.dominioAceptado`)
    // aceptaba subdominios: la pantalla decía que sí y el server contestaba 400 sobre
    // una dirección que **SES manda sin chistar**. Se resolvió midiendo contra el SES
    // de producción el 17-ago-2026, no discutiendo:
    //
    //   avisos@mail.goberna.us   → ACEPTADO
    //   a@x.y.goberna.us         → ACEPTADO (anidado, también)
    //   a@gobernaus.com          → 554 «Email address is not verified»  ← el CONTROL
    //
    // El control es lo que hace válida la conclusión: sin él, tres «aceptado» seguidos
    // sólo prueban que la credencial anda.
    //
    // ⚠️ **El punto del prefijo es obligatorio y no es cosmético**: con un `endsWith(v)`
    // pelado, `xgoberna.us` termina en `goberna.us` y pasaría — un dominio de otra
    // persona, autorizado por una comparación de cadenas. Es el mismo error de forma que
    // el sufijo de 9 dígitos del teléfono (#119).
    return normal === v || normal.endsWith(`.${v}`);
  });
}
