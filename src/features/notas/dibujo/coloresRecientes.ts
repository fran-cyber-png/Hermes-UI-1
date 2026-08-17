/**
 * LOS COLORES QUE SE USARON HACE POCO.
 *
 * ══ POR QUÉ EXISTEN ═════════════════════════════════════════════════════════
 *
 * La paleta rápida tiene doce colores fijos y el selector avanzado tiene
 * dieciséis millones. Entre esas dos cosas falta la de siempre: **el color que
 * acabo de armar y quiero volver a usar en el trazo siguiente**. Sin esto, cada
 * uso de un color propio cuesta abrir el selector y volver a acertarle.
 *
 * ══ POR QUÉ EN `localStorage` Y NO EN LA BASE ═══════════════════════════════
 *
 * Es una preferencia de la herramienta, no contenido de la página: no viaja con
 * la nota, no lo ve el equipo y no tiene por qué sobrevivir a un cambio de
 * máquina. Guardarlo en el server sería una columna, una migración y un request
 * más en cada trazo, para algo que no cambia nada si se pierde.
 *
 * Este módulo es puro salvo el `localStorage`, y toda lectura y escritura está
 * envuelta: en la app de escritorio y en un test sin DOM el acceso puede tirar,
 * y quedarse sin colores recientes no puede ser el motivo por el que la Libreta
 * no abre.
 */

const CLAVE = 'hermes.libreta.coloresRecientes';

/**
 * Cuántos se guardan. Ocho entra justo en cuatro filas de dos en la barra de 12
 * de ancho, y es el rango que el pedido marcó (6–10).
 */
export const TOPE_RECIENTES = 8;

function almacen(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Un `#rrggbb` en minúsculas, o `null`. Lo que no tenga esa forma no entra. */
function normalizar(color: unknown): string | null {
  if (typeof color !== 'string') return null;
  const limpio = color.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(limpio) ? limpio : null;
}

export function leerRecientes(): string[] {
  const store = almacen();
  if (!store) return [];
  try {
    const crudo: unknown = JSON.parse(store.getItem(CLAVE) ?? '[]');
    if (!Array.isArray(crudo)) return [];
    // Se sanea al LEER y no solo al escribir: lo que hay en `localStorage` lo
    // pudo dejar una versión anterior, u otra pestaña, o alguien a mano.
    return crudo.map(normalizar).filter((c): c is string => c !== null).slice(0, TOPE_RECIENTES);
  } catch {
    return [];
  }
}

/**
 * Agrega un color al frente y devuelve la lista nueva.
 *
 * Si ya estaba, **se mueve al frente en vez de duplicarse**: una lista de
 * recientes con el mismo color cuatro veces desperdicia el único espacio que
 * tiene, y el más usado sería el que más lugar ocupa.
 */
export function agregarReciente(color: string): string[] {
  const nuevo = normalizar(color);
  if (!nuevo) return leerRecientes();

  const lista = [nuevo, ...leerRecientes().filter((c) => c !== nuevo)].slice(0, TOPE_RECIENTES);
  const store = almacen();
  try {
    store?.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    // Cuota llena o almacenamiento bloqueado: la lista vale para esta sesión y
    // se pierde al recargar. No es motivo para romper nada.
  }
  return lista;
}
