import { atiendeUnaCampana } from "../numeros/campana.js";

/**
 * LOS DOS MÓDULOS DE CRM QUE VIVE HERMES — decisión del dueño del 19-ago-2026.
 *
 * ══ QUÉ CAMBIA RESPECTO DE ADR 0061 ══════════════════════════════════════════
 *
 * ADR 0061 trató a la campaña como una EXCEPCIÓN de la Escuela: una línea con
 * `proposito = 'campana'` que no se le sirve a nadie más, y cuatro superficies
 * que su operador no tiene. Eso alcanzaba mientras hubiera un solo candidato y
 * el resto del producto fuera «la Escuela».
 *
 * La decisión del dueño lo da vuelta: **son dos módulos de CRM y ninguno es la
 * excepción del otro.** `ventas` atiende hoy a la Escuela de Goberna y mañana a
 * otros clientes; `campana` atiende hoy a Betto y mañana a otras candidaturas.
 * Lo que hasta ayer era «lo normal» pasa a ser **un módulo con nombre**, y eso
 * es lo que hace que una ruta nueva tenga que DECIDIR a cuál pertenece en vez
 * de heredar la Escuela por no decir nada.
 *
 * ══ 🔴 ESTO NO ES TODAVÍA EL AISLAMIENTO ENTRE DOS CLIENTES DEL MISMO MÓDULO ═
 *
 * Hay que decirlo acá porque es justo lo que se va a leer de más: esto separa
 * `ventas` de `campana`, **no** una campaña de otra campaña. Dos candidatos
 * pueden ser rivales en la misma elección, y hoy los dos caerían en `campana` y
 * se verían entre sí. El recorte que falta es por **entorno** y va en el `WHERE`
 * de las consultas compartidas (la cola, el hilo, la ficha), no acá — este
 * archivo decide QUÉ SUPERFICIE le toca a cada quien, no QUÉ FILAS.
 *
 * Mientras haya una sola campaña la diferencia no se nota, y por eso vale
 * escribirla: el día que entre la segunda, nadie va a releer este comentario si
 * no dice que la puerta quedó abierta.
 */
export type Modulo = "ventas" | "campana";

export const MODULOS = ["ventas", "campana"] as const satisfies readonly Modulo[];

/**
 * ¿DE QUÉ MÓDULO ES ESTA PERSONA? — y sale de sus LÍNEAS, que es el único lugar
 * donde el dato ya existe y lo mantiene quien da de alta un número.
 *
 * 🔴 **No se deriva del namespace de la identidad** (`centurion:` vs. un usuario
 * de Cerberus), aunque hoy los datos coincidan al 100 %: al 19-ago-2026 la línea
 * de campaña la atienden 17 identidades de Centurión y ninguna de Cerberus,
 * pero hasta el 15-ago la atendía `usuario2`, que es de Cerberus. Un segundo
 * criterio que hoy da lo mismo es un criterio que mañana decide distinto sin que
 * nada falle (#37). La fuente única es `atiendeUnaCampana`, la misma que usa
 * `cola/lineas.ts:soloSusLineas`.
 *
 * ⚠️ **El default es `ventas`, y es el default INSEGURO** — quien no tiene
 * ninguna línea cae acá. No se arregla invirtiéndolo: sin líneas tampoco es de
 * campaña, y devolver `campana` le cortaría la Escuela a toda vendedora nueva
 * mientras Cerberus todavía no empujó su número. Lo que sostiene el fail-closed
 * es el middleware, que ante un error de lectura **no llama a esta función**:
 * contesta 500 y no deja pasar.
 */
export function moduloDe(lineas: readonly { proposito: string }[] | undefined): Modulo {
  return atiendeUnaCampana(lineas) ? "campana" : "ventas";
}

/**
 * DE QUÉ MÓDULO ES CADA SUPERFICIE DE LA API — la lista, en un solo lugar, y con
 * su candado en `superficies.paridad.test.ts`.
 *
 * ══ 🔴 LO QUE NO ESTÁ ACÁ ES COMPARTIDO, Y ESO ES UNA DECISIÓN ══════════════
 *
 * El default de este mapa es «las dos». Es al revés de lo que pide un perímetro
 * —donde lo que no se declara se niega— y está elegido a propósito: el motor de
 * Hermes (la cola, el hilo, el envío, el reparto, los ✓✓, la agenda, el tiempo
 * real) sirve igual de bien a una vendedora y a un operador de campaña, y son
 * las más. Declararlas una por una convertiría cada ruta nueva del motor en un
 * 403 hasta que alguien se acuerde de anotarla.
 *
 * Lo que compensa ese default es que **agregar una ruta que toque Cerberus o
 * icarus sin anotarla acá es la única forma de que esto falle**, y para eso está
 * el segundo test: cruza este mapa contra los `import` de `cerberus/` e `icarus`
 * de cada router y se pone rojo si aparece uno sin declarar.
 *
 * ══ POR QUÉ CADA UNA ════════════════════════════════════════════════════════
 *
 * · Las cuatro de ADR 0061 (`notas`, `espacios`, `correos`, `entrenamiento`):
 *   el playbook del equipo, el remitente de Goberna, el bot de la Escuela.
 * · Las que sirven **Cerberus**: la ficha del contacto con su documento y sus
 *   compras, el formulario de venta que ESCRIBE en el ERP, el catálogo de
 *   productos que resuelve `{precio}`, las dos respuestas del panel.
 * · Las que sirven **icarus**: el padrón de 73.091 contactos y su reparto.
 * · Las que sirven el negocio de la Escuela: `hechos` (los argumentos de venta),
 *   `resultados` (qué pieza cierra ventas), `campana` (las plantillas de Meta y
 *   sus corridas), `routing` (qué pauta cae en qué vendedora) e `ivi` (el cerebro
 *   RAG del negocio, al que Hermes le habla con un token de servicio).
 *
 * ⚠️ **`/api/gestiones/intereses` es una SUBRUTA a propósito.** El resto de
 * `gestiones` —etapas, etiquetas, la bitácora— es CRM genérico y le sirve a los
 * dos módulos; lo único que va contra Cerberus es el catálogo de cursos. Vedar
 * el router entero le sacaría a la campaña las etiquetas, que no son de nadie.
 * Lo mismo con `/api/dashboard/negocio`, que es la facturación por curso adentro
 * de un Dashboard que sí es de los dos.
 *
 * ⚠️ **El Navegador no está y no es un olvido**: es un comando de la cáscara
 * Tauri (ADR 0043), no una ruta del server. Su candado son las capabilities.
 */
export const SUPERFICIES: Record<string, Modulo> = {
  // ── ADR 0061: las cuatro que ya estaban ──
  "/api/notas": "ventas",
  "/api/espacios": "ventas",
  "/api/correos": "ventas",
  "/api/entrenamiento": "ventas",
  /**
   * ⚠️ **Las piezas de texto de la Libreta**, no las secuencias de WhatsApp.
   * Es la superficie de `/api/notas` con otra forma —mismo dueño, mismos datos—
   * y entra por la misma puerta; dejarla afuera le daría al operador de campaña
   * justo lo que las otras cuatro le niegan, por un router agregado después.
   *
   * 🔴 **Y NO cae adentro de `/api/plantillas` por compartir el comienzo**: el
   * match exige el prefijo exacto o `prefijo + "/"`, así que las dos son
   * entradas separadas a propósito. Hay test.
   */
  "/api/plantillas-texto": "ventas",
  // ── Cerberus: la ficha, la venta y el catálogo de productos ──
  "/api/contactos": "ventas",
  "/api/venta": "ventas",
  "/api/plantillas": "ventas",
  "/api/sugerencias": "ventas",
  "/api/gestiones/intereses": "ventas",
  // ── icarus: el padrón de la Escuela y su reparto ──
  "/api/padron": "ventas",
  // ── el negocio de la Escuela ──
  "/api/hechos": "ventas",
  "/api/resultados": "ventas",
  "/api/campana": "ventas",
  "/api/routing": "ventas",
  "/api/ivi": "ventas",
  "/api/dashboard/negocio": "ventas",
};

/**
 * ¿A qué módulo pertenece este path? `undefined` = a los dos.
 *
 * 🔴 **Gana el prefijo MÁS LARGO**, y sin eso el mapa se leería al revés: con
 * `/api/gestiones/intereses` y `/api/gestiones` declarados a la vez, el primero
 * que matcheara decidiría, y el orden de las claves de un objeto no es un
 * contrato que se pueda leer en la pantalla. Hoy `gestiones` a secas no está
 * declarado, así que la regla no cambia nada — se escribe ahora porque el día
 * que alguien declare el padre, el hijo tiene que seguir ganando.
 *
 * ⚠️ **La barra del final es la que separa un prefijo de un parecido**: sin
 * ella `/api/notasimportantes` entraría por `/api/notas`, y una ruta nueva
 * quedaría vedada sin que nadie lo decidiera.
 */
export function moduloDeLaSuperficie(path: string): Modulo | undefined {
  let mejor = "";
  for (const prefijo of Object.keys(SUPERFICIES)) {
    if (path !== prefijo && !path.startsWith(`${prefijo}/`)) continue;
    if (prefijo.length > mejor.length) mejor = prefijo;
  }
  return mejor ? SUPERFICIES[mejor] : undefined;
}
