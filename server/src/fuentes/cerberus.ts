import { createReadStream } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { registro } from "../db/ontologia.js";
import { sincronizaciones } from "../db/operacion.js";
import { parsearInserts, type Valor } from "./mysqldump.js";

/**
 * Ingesta de Cerberus: del dump al espejo crudo.
 *
 * ── La regla ──
 * El espejo NO se normaliza. Guardamos la fila tal cual vino, como jsonb. La normalización
 * (correos en minúscula, teléfonos en E.164, monedas) vive en la ONTOLOGÍA, que se deriva de acá.
 *
 * Ya nos salvó una vez: encontramos que la ingesta de Meta estaba TIRANDO nuestros propios
 * mensajes salientes, y lo pudimos ver porque el payload crudo estaba guardado. Si solo hubiéramos
 * guardado lo "limpio", ese bug sería invisible para siempre.
 *
 * ── Idempotencia ──
 * `UNIQUE(fuente, tabla, clave)` + `ON CONFLICT DO UPDATE`. Correr el import dos veces sobre el
 * mismo dump no duplica nada; correrlo sobre un dump más fresco actualiza lo que cambió.
 *
 * Cerberus aprendió esto por las malas (commit `3e6573f`): su sync de Meta Ads hacía
 * "borro la ventana y reinserto", el filtro de borrado tenía un mismatch de formato de ID
 * (`act_123` vs `123`), el borrado no borraba nada, y el reinsert chocaba contra el UNIQUE.
 * **Upsert por clave natural, nunca borrar-y-reinsertar.**
 */

/**
 * Las tablas que espejamos, y cuál de sus columnas es la clave.
 *
 * El orden de las columnas sale del `CREATE TABLE` del dump — que también parseamos, para no
 * hardcodearlo. Si Cerberus agrega una columna, el espejo la recibe sin que toquemos nada.
 */
const TABLAS: Record<string, { clave: string }> = {
  // El camino del dinero
  tb_venta: { clave: "id" },
  tb_detalleVenta: { clave: "id" },
  tb_cuotas: { clave: "id" },
  tb_pago: { clave: "id" },
  tb_metodoPago: { clave: "id" },
  tb_moneda: { clave: "id" },

  // Quién es quién — el grafo de identidades que Cerberus ya tenía
  tb_cliente: { clave: "id" },
  tb_correo: { clave: "id" },
  tb_telefono: { clave: "id" },
  tb_pais: { clave: "id" },

  // Qué se vendió
  tb_producto: { clave: "id" },
  tb_categoria: { clave: "codigo_categoria" },

  // El puente con Moodle. OJO: es una fuente INCOMPLETA — las matrículas hechas vía Cerberus
  // llegan a Moodle pero no siempre escriben acá (verificado: 20 ventas "sin matrícula" estaban
  // 20/20 en Moodle). Moodle es la fuente de verdad; esto es solo una señal parcial.
  tb_matricula: { clave: "id" },
};

/** Las columnas de cada tabla, leídas del `CREATE TABLE` del propio dump. */
function leerColumnas(dump: string): Map<string, string[]> {
  const cols = new Map<string, string[]>();
  const re = /CREATE\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(dump)) !== null) {
    const tabla = m[1];
    if (!(tabla in TABLAS)) continue;

    const nombres: string[] = [];
    for (const linea of m[2].split("\n")) {
      // Solo las definiciones de columna: `nombre` tipo … — no KEY, PRIMARY KEY, CONSTRAINT.
      const c = linea.trim().match(/^`([A-Za-z0-9_]+)`\s+\w/);
      if (c) nombres.push(c[1]);
    }
    cols.set(tabla, nombres);
  }
  return cols;
}

export type ResumenIngesta = {
  porTabla: Record<string, number>;
  total: number;
  faltantes: string[];
  duracionMs: number;
};

/** Lee el dump y deja las filas en `fuentes.registro`. No toca producción: lee un archivo. */
export async function ingestarDump(rutaDump: string): Promise<ResumenIngesta> {
  const arranque = Date.now();
  const dump = await leerArchivo(rutaDump);

  const columnas = leerColumnas(dump);
  const faltantes = Object.keys(TABLAS).filter((t) => !columnas.has(t));

  const porTabla: Record<string, number> = {};
  let lote: { fuente: string; tabla: string; clave: string; payload: unknown }[] = [];
  let total = 0;

  const vaciar = async () => {
    if (lote.length === 0) return;
    await db
      .insert(registro)
      .values(lote)
      .onConflictDoUpdate({
        target: [registro.fuente, registro.tabla, registro.clave],
        // Upsert, nunca borrar-y-reinsertar. Un dump más fresco pisa lo viejo.
        set: { payload: sql`excluded.payload`, ingeridoAt: new Date() },
      });
    lote = [];
  };

  for (const { tabla, valores } of parsearInserts(dump, new Set(Object.keys(TABLAS)))) {
    const nombres = columnas.get(tabla);
    if (!nombres) continue;

    const payload = aObjeto(nombres, valores);
    const clave = payload[TABLAS[tabla].clave];
    if (clave == null) continue; // sin clave no hay idempotencia posible: no la guardamos

    lote.push({ fuente: "cerberus", tabla, clave: String(clave), payload });
    porTabla[tabla] = (porTabla[tabla] ?? 0) + 1;
    total += 1;

    if (lote.length >= 500) await vaciar();
  }
  await vaciar();

  const duracionMs = Date.now() - arranque;

  await db
    .insert(sincronizaciones)
    .values({
      fuente: "cerberus",
      ultimaOk: new Date(),
      duracionMs,
      cursor: `${total} filas de ${Object.keys(porTabla).length} tablas`,
      ultimoError: faltantes.length ? `no se encontraron: ${faltantes.join(", ")}` : null,
      ultimoErrorAt: faltantes.length ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: sincronizaciones.fuente,
      set: {
        ultimaOk: new Date(),
        duracionMs,
        cursor: `${total} filas de ${Object.keys(porTabla).length} tablas`,
        ultimoError: faltantes.length ? `no se encontraron: ${faltantes.join(", ")}` : null,
        ultimoErrorAt: faltantes.length ? new Date() : null,
      },
    });

  return { porTabla, total, faltantes, duracionMs };
}

function aObjeto(nombres: string[], valores: Valor[]): Record<string, Valor> {
  const o: Record<string, Valor> = {};
  for (let i = 0; i < nombres.length; i++) o[nombres[i]] = valores[i] ?? null;
  return o;
}

async function leerArchivo(ruta: string): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const t of createReadStream(ruta)) trozos.push(t as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}
