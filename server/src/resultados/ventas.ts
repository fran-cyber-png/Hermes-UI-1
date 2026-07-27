import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";

/**
 * ¿COMPRÓ? — el seam, y su degradación honesta.
 *
 * ══ POR QUÉ ES UN SEAM Y NO UNA CONSULTA ═════════════════════════════════════
 *
 * La pregunta depende de que las ventas estén ligadas a las conversaciones, y
 * ese es el **PR #165** (`atribucion/`), que al escribir esto no está mergeado.
 * Este archivo hace dos cosas y ninguna es adivinar:
 *
 *   1. **Funciona hoy sin él.** Lee `conversiones_wa` cruzando por teléfono, que
 *      es lo único que esa tabla tiene hoy. Si no hay ni una fila, dice que la
 *      atribución NO está conectada, y entonces el lazo entero reporta «no lo
 *      sabemos» en vez de «no compró».
 *   2. **No estorba cuando llegue.** El día que #165 esté, `conversiones_wa`
 *      gana la llave de conversación y `ventasPorClave` cambia su `WHERE` —una
 *      consulta, en este archivo— sin que `loQuePaso`, `agregar`, el endpoint
 *      ni el script se enteren.
 *
 * ══ LA DEGRADACIÓN QUE IMPORTA ══════════════════════════════════════════════
 *
 * `false` y `null` no son lo mismo y no se pueden dibujar igual. Hoy Cerberus
 * tiene ~6.800 ventas y `conversiones_wa` tiene 0 filas: escribir «esta pieza
 * cerró 0 ventas» sería técnicamente cierto sobre nuestra tabla y una mentira
 * sobre el negocio. Con `hayAtribucion() === false`, la columna va **en blanco
 * y con el motivo escrito**, que es lo que hace el resto de la casa (`sinPadron`
 * en la cola, «falta la migración» en el interruptor).
 */
export interface FuenteDeVentas {
  /**
   * ¿Se puede responder «¿compró?» hoy? `false` ⇒ toda la columna es «no lo
   * sabemos», nunca «no».
   */
  hayAtribucion(): Promise<boolean>;
  /**
   * Las ventas de cada conversación posteriores a `desde`, sin recortar por
   * ventana — el recorte lo hace la función pura, como todo lo demás.
   */
  ventasPorClave(claves: readonly string[], desde: Date): Promise<Map<string, Date[]>>;
}

/** El teléfono de una clave `conv:whatsapp:<telefono>:<numeroPropio>`. */
function telefonoDe(clave: string): string | null {
  const [, canal, persona] = clave.split(":");
  // SOLO WhatsApp: en Messenger `persona_id` es un PSID y cruzarlo contra una
  // columna de teléfonos es pedir un falso positivo (la misma razón por la que
  // el padrón de ex-clientes se limita a WhatsApp, #133).
  return canal === "whatsapp" && persona ? persona : null;
}

/** ¿El error es «esa tabla/columna no existe»? (el `db:push` es manual). */
function faltaLaTabla(e: unknown): boolean {
  const codigo = (e as { code?: string })?.code;
  return codigo === "42P01" || codigo === "42703";
}

/**
 * La implementación viva: `conversiones_wa`, cruzada por teléfono.
 *
 * El cruce por teléfono es el escalón DÉBIL y está acá a propósito, porque es lo
 * único que hay hoy. Cuando llegue #165 esto pasa a cruzar por la llave de
 * conversación, que es determinista, y este comentario se borra con él.
 */
export function ventasDeConversionesWa(base: typeof db): FuenteDeVentas {
  return {
    async hayAtribucion() {
      try {
        const [fila] = await base.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM conversiones_wa`,
        );
        return (fila?.n ?? 0) > 0;
      } catch (e) {
        if (faltaLaTabla(e)) return false;
        throw e;
      }
    },

    async ventasPorClave(claves, desde) {
      const porTelefono = new Map<string, string[]>();
      for (const clave of claves) {
        const tel = telefonoDe(clave);
        if (!tel) continue;
        porTelefono.set(tel, [...(porTelefono.get(tel) ?? []), clave]);
      }
      const telefonos = [...porTelefono.keys()];
      const salida = new Map<string, Date[]>();
      if (telefonos.length === 0) return salida;

      try {
        const filas = await base.execute<{ telefono: string; iniciada_at: Date }>(sql`
          SELECT telefono, iniciada_at
          FROM conversiones_wa
          -- IN y no = ANY(...): drizzle expande el arreglo a una tupla ($1, $2),
          -- que es la forma de IN y no la de ANY. La lista nunca está vacía acá
          -- (hay un early-return arriba).
          WHERE telefono IN ${telefonos} AND iniciada_at >= ${desde.toISOString()}::timestamptz
        `);
        for (const f of filas) {
          for (const clave of porTelefono.get(f.telefono) ?? []) {
            salida.set(clave, [...(salida.get(clave) ?? []), new Date(f.iniciada_at)]);
          }
        }
      } catch (e) {
        if (!faltaLaTabla(e)) throw e;
      }
      return salida;
    },
  };
}
