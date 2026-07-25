import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { proponerSecuencias, type SalienteMinado } from "../plantillas/proponer.js";
import { guardarPropuestas } from "../plantillas/repositorio.js";

/**
 * APRENDER LA SECUENCIA DEL HISTÓRICO — el script que le deja a la vendedora sus
 * plantillas cargadas el día uno, en vez de una pantalla vacía y un «escribilas».
 *
 * ```
 * npm run plantillas:proponer                    # DRY-RUN: solo imprime
 * npm run plantillas:proponer -- --dias 14
 * npm run plantillas:proponer -- --aplicar luz   # las guarda como PROPUESTAS de «luz»
 * ```
 *
 * DOS PUERTAS antes de que algo se pueda mandar:
 *   1. sin `--aplicar` no escribe nada;
 *   2. lo que escribe nace en estado `propuesta`, y **una propuesta no se envía**
 *      (`routes/plantillas.ts`, guarda 1). Alguien la lee, le carga las imágenes
 *      y la aprueba.
 *
 * Es idempotente: re-correrlo reemplaza las propuestas minadas que nadie aprobó
 * todavía, y jamás toca una plantilla ya aprobada o editada a mano.
 */

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

const dias = Number(arg("dias")) || 7;
const vendedora = arg("aplicar");

interface FilaMinada {
  clave: string;
  texto: string | null;
  con_media: boolean;
  posicion: string | number;
}

async function main() {
  // Solo conversaciones NUEVAS de la ventana: la posición #1 tiene que ser de
  // verdad el primer mensaje que se le mandó a esa persona, no el primero que
  // cayó dentro del recorte.
  const filas = (await db.execute(sql`
    WITH msg AS (
      SELECT 'conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '') AS clave,
             i.direccion,
             i.texto,
             i.occurred_at,
             (e.payload->'media' IS NOT NULL AND e.payload->>'media' <> 'null') AS con_media
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje'
    ),
    nuevas AS (
      SELECT clave FROM msg
      GROUP BY clave
      HAVING min(occurred_at) > now() - (${dias} || ' days')::interval
    )
    SELECT m.clave, m.texto, m.con_media,
           row_number() OVER (PARTITION BY m.clave ORDER BY m.occurred_at) AS posicion
    FROM msg m
    JOIN nuevas n USING (clave)
    WHERE m.direccion = 'saliente'
  `)) as unknown as FilaMinada[];

  const salientes: SalienteMinado[] = filas.map((f) => ({
    clave: f.clave,
    posicion: Number(f.posicion),
    texto: f.texto,
    conMedia: f.con_media,
  }));

  const propuestas = proponerSecuencias(salientes);

  console.log(`\nVentana: conversaciones nuevas de los últimos ${dias} días`);
  console.log(`Salientes minados: ${salientes.length}\n`);

  if (propuestas.length === 0) {
    console.log("No hay ninguna secuencia con respaldo suficiente. No se propone nada.\n");
    process.exit(0);
  }

  propuestas.forEach((p, i) => {
    console.log(`── Propuesta ${i + 1} · «${p.nombre}» · ${p.respaldo} conversaciones`);
    for (const paso of p.pasos) {
      const marca = paso.conMedia ? "[imagen] " : "";
      const cuota = `${Math.round(paso.cuota * 100)}%`;
      const texto = (paso.texto ?? "(solo archivo)").replace(/\s+/g, " ").slice(0, 90);
      console.log(`   ${paso.orden}. ${marca}${texto}   — ${paso.respaldo} conv · ${cuota}`);
    }
    console.log("");
  });

  if (!vendedora) {
    console.log("DRY-RUN: no se guardó nada. Para guardarlas como propuestas:");
    console.log("   npm run plantillas:proponer -- --aplicar <vendedoraId>\n");
    process.exit(0);
  }

  const n = await guardarPropuestas(db, vendedora, propuestas);
  console.log(`Guardadas ${n} propuestas para «${vendedora}», en estado PROPUESTA.`);
  console.log("Nadie las puede mandar hasta que alguien las revise y las apruebe.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
