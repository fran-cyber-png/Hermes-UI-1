import { z } from "zod";
import type { EntradaCatalogo, Herramienta, Resultado } from "./tipos.js";

/**
 * EL REGISTRO — el único lugar por donde se llega a una Herramienta.
 *
 * Todo lo que quiera usar el SDK pasa por acá: `kos cq verify` hoy, Ivi en la iteración 2, un
 * servidor MCP en la 3, y el tool calling del modelo cuando Qwen lo soporte bien. Ninguno de esos
 * consumidores necesita saber que abajo hay Express, Drizzle o Postgres.
 *
 * Y es el punto donde algún día nace `ToolInvoked`: un solo lugar donde toda invocación pasa es
 * un solo lugar donde emitir el evento. Todavía no se emite —no hay quién lo consuma, y un log
 * sin lector es deuda disfrazada de arquitectura— pero el gancho es esta función y no hay otra.
 */

const HERRAMIENTAS = new Map<string, Herramienta<z.ZodType, unknown>>();

/** `governa.<dominio>.<accion>` — minúsculas, sin guiones. Las CQs guardan este nombre. */
const NOMBRE_VALIDO = /^governa\.[a-z]+\.[a-zA-Z]+$/;

export function registrar<E extends z.ZodType, S>(h: Herramienta<E, S>): void {
  if (!NOMBRE_VALIDO.test(h.nombre)) {
    throw new Error(
      `Nombre de Herramienta inválido: "${h.nombre}". Se espera governa.<dominio>.<accion>.`,
    );
  }
  // Registrar dos veces el mismo nombre es un error de programación, no un caso de uso: el
  // segundo pisaría al primero en silencio y las CQs quedarían apuntando a otra cosa.
  if (HERRAMIENTAS.has(h.nombre)) {
    throw new Error(`La Herramienta "${h.nombre}" ya está registrada.`);
  }
  HERRAMIENTAS.set(h.nombre, h as unknown as Herramienta<z.ZodType, unknown>);
}

export function listar(): string[] {
  return [...HERRAMIENTAS.keys()].sort();
}

export function obtener(nombre: string): Herramienta<z.ZodType, unknown> | null {
  return HERRAMIENTAS.get(nombre) ?? null;
}

/**
 * EL CATÁLOGO — lo que el sistema puede responder, en un JSON que se lee sin leer el código.
 *
 * El JSON Schema sale de `z.toJSONSchema()`: no hay una segunda declaración que mantener
 * sincronizada. Es la misma razón por la que las Tools se declaran con Zod y no con un objeto
 * suelto — una sola fuente para validar, tipar y documentar.
 */
export function catalogo(): EntradaCatalogo[] {
  return listar().map((nombre) => {
    const h = HERRAMIENTAS.get(nombre)!;
    return {
      nombre: h.nombre,
      descripcion: h.descripcion,
      entrada: z.toJSONSchema(h.entrada),
      idempotente: h.idempotente,
      cqIds: h.cqIds ?? [],
      fuentes: h.fuentes ?? [],
    };
  });
}

/**
 * Invocar una Herramienta por nombre, con una entrada que todavía no es de confianza.
 *
 * Nunca lanza: devuelve un `Resultado` discriminado. Quien llama —una ruta HTTP, un CLI, un
 * modelo— tiene que decidir explícitamente qué hacer con el fracaso, en vez de dejar que una
 * excepción se escape hacia arriba y se convierta en un 500 sin explicación.
 */
export async function invocar<S = unknown>(
  nombre: string,
  entradaCruda: unknown,
): Promise<Resultado<S>> {
  const arranque = Date.now();
  const ms = () => Date.now() - arranque;

  const h = HERRAMIENTAS.get(nombre);
  if (!h) {
    return {
      ok: false,
      motivo: "no_existe",
      detalle: `No existe "${nombre}". Disponibles: ${listar().join(", ")}`,
      ms: ms(),
    };
  }

  // `undefined` y `{}` son lo mismo para una Tool sin parámetros: quien invoca por HTTP con el
  // body vacío no debería tener que mandar un objeto vacío a mano.
  const parseo = h.entrada.safeParse(entradaCruda ?? {});
  if (!parseo.success) {
    return {
      ok: false,
      motivo: "entrada_invalida",
      detalle: parseo.error.issues
        .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
        .join(" · "),
      ms: ms(),
    };
  }

  try {
    const salida = (await h.ejecutar(parseo.data)) as S;
    return { ok: true, salida, ms: ms() };
  } catch (e) {
    // Que una Tool reviente es un hecho del sistema, no una sorpresa. Se reporta con su nombre
    // para que se sepa cuál fue, en vez de un stack trace anónimo en un log.
    return {
      ok: false,
      motivo: "fallo_ejecucion",
      detalle: e instanceof Error ? e.message : String(e),
      ms: ms(),
    };
  }
}

/** Solo para tests: deja el registro en cero. En producción nadie desregistra nada. */
export function _vaciarRegistro(): void {
  HERRAMIENTAS.clear();
}
