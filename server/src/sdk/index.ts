/**
 * EL SDK GOVERNA — el punto de entrada.
 *
 * Importar este módulo registra todas las Herramientas. Es el único lugar donde se enumera qué
 * existe: agregar una Tool es crear su archivo y agregarlo acá.
 *
 * ── La regla ──
 * Una Herramienta DECLARA lógica que ya existe; no la implementa. Si escribiendo una Tool
 * aparecen cálculos, esos cálculos van a `dominio/`, `analisis/` o `canales/` — donde se pueden
 * testear puros y donde el resto del sistema ya los puede usar. El SDK es una fachada, no una capa
 * de negocio. Es lo que mantiene al modelo reemplazable: la inteligencia vive en el código y en
 * los datos, nunca en el prompt.
 */

import "./herramientas/atribucion.js";
import "./herramientas/historia.js";
import "./herramientas/lazo.js";
import "./herramientas/tesoreria.js";
import "./herramientas/ventas.js";

export { catalogo, invocar, listar, obtener } from "./registro.js";
export type { EntradaCatalogo, Herramienta, Resultado } from "./tipos.js";

/** La cadena de atribución, para que las rutas la usen sin pasar por el rodeo de la red. */
export { atribucionPorPais, type Atribucion } from "./herramientas/atribucion.js";
