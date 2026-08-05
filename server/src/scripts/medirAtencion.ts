import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  esperasDelHilo,
  resumirAtencion,
  type Espera,
  type MensajeDelHilo,
  type ResumenDeAtencion,
} from "../atencion/tiempos.js";

/**
 * CUÁNTO HACEMOS ESPERAR A LA GENTE — read-only, para poder mostrarlo con pruebas.
 *
 *   npm run medir:atencion -- [--dias 7] [--linea 51984429504] [--campana promo_3x1_cursos]
 *
 * La regla vive pura en `atencion/tiempos.ts`; acá sólo se traen HECHOS CRUDOS
 * (quién escribió cuándo, quién contestó cuándo, y si el que contestó era una
 * persona o una máquina). Ni un `CASE`, ni un umbral, ni una ventana en el SQL:
 * el veredicto es de la función pura, y así no hay una segunda implementación
 * que pueda divergir — la lección de #37, aplicada de entrada.
 *
 * `--campana <ref>` acota a las conversaciones a las que les salió esa pieza. Es
 * la vista que responde «la campaña trajo respuestas, ¿alguien las atendió?»,
 * que es distinta de «cómo venimos en general».
 *
 * NO ESCRIBE NADA.
 */

function bandera(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const dias = Number(bandera("dias")) || 7;
const linea = bandera("linea");
const campana = bandera("campana");
const MUESTRA = 12;

interface FilaMensaje {
  clave: string;
  telefono: string;
  cuando: Date;
  direccion: "entrante" | "saliente";
  /** Sólo en salientes. `true` = lo mandó una máquina. */
  automatico: boolean | null;
  vendedora_id: string | null;
}

interface FilaDuena {
  clave: string;
  vendedora_id: string;
}

/** `hh:mm` o `Nd hh:mm` — un número de minutos grande no se lee. */
function enCriollo(minutos: number): string {
  const m = Math.round(minutos);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

function imprimirResumen(titulo: string, r: ResumenDeAtencion) {
  console.log(`\n── ${titulo} ──`);
  console.log(`   esperas: ${r.esperas}   respondidas: ${r.respondidas}   SIN RESPONDER: ${r.sinResponder}`);
  if (r.mediana) {
    // La mediana NUNCA sale sola: al lado va sobre cuántas de cuántas se calculó.
    console.log(
      `   mediana: ${enCriollo(r.mediana.minutos)}   p90: ${enCriollo(r.p90!.minutos)}` +
        `   (sobre ${r.mediana.sobre} de ${r.mediana.de})`,
    );
    console.log(
      `   respondidas en ≤5 min: ${r.en5Min}   ≤1 h: ${r.en1Hora}   ≤24 h: ${r.en24Horas}`,
    );
  } else {
    console.log(`   mediana: — (no se respondió ni una; un 0 diría lo contrario)`);
  }
  if (r.masViejaSinResponder !== null) {
    console.log(`   🔴 la más vieja sin responder lleva ${enCriollo(r.masViejaSinResponder)}`);
  }
}

async function main() {
  const ahora = new Date();
  console.log(
    `Atención de los últimos ${dias} días` +
      (linea ? ` · línea ${linea}` : "") +
      (campana ? ` · sólo quienes recibieron «${campana}»` : "") +
      `\n(read-only; la regla vive en atencion/tiempos.ts)`,
  );

  // ── Los hechos crudos. Entrantes de `interactions`, salientes de `envios_wa`
  // (que es la única que sabe si lo mandó una máquina y quién lo mandó). ──
  const desde = sql`now() - (${dias} || ' days')::interval`;
  const filtroLinea = linea ? sql`AND numero_propio = ${linea}` : sql``;

  // El recorte por campaña se expresa una sola vez: o hay una lista de teléfonos
  // a la que acotar, o no hay recorte. Escribirlo como `... OR true` funcionaba
  // y era ilegible — y lo ilegible en un SQL es donde se esconde el próximo error.
  const soloDeLaCampana = campana
    ? sql`AND telefono IN (SELECT telefono FROM envios_wa
                            WHERE estado = 'enviado' AND pieza_ref = ${campana})`
    : sql``;

  const filas = (await db.execute(sql`
    WITH entrantes AS (
      SELECT 'conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '') AS clave,
             i.persona_id                                  AS telefono,
             i.occurred_at                                  AS cuando,
             'entrante'::text                               AS direccion,
             NULL::boolean                                  AS automatico,
             NULL::text                                     AS vendedora_id
        FROM interactions i
        JOIN events e ON e.id = i.event_id
       WHERE i.tipo = 'mensaje'
         AND i.direccion = 'entrante'
         AND i.canal = 'whatsapp'
         AND i.occurred_at > ${desde}
         ${linea ? sql`AND e.payload->>'numeroPropio' = ${linea}` : sql``}
    ),
    salientes AS (
      -- LA CLAVE SE DERIVA, NO SE LEE DE LA COLUMNA referencia.
      --
      -- envios_wa.referencia dice "el contexto de este envio" y NO siempre es
      -- la clave de una conversacion: una campana escribe ahi una referencia
      -- sintetica (campana:PIEZA:TELEFONO) porque el envio no nace de un chat
      -- abierto. Agrupar por esa columna partia cada conversacion en dos -- la
      -- real y la de la campana -- y el join contra conversacion_asignada daba
      -- CERO FILAS EN SILENCIO: 81 conversaciones con duena salian "sin duena".
      -- Es el mismo defecto contra el que avisan ADR 0022 y el catalogo de
      -- piezas, entrando por una columna que parecia inofensiva.
      SELECT 'conv:whatsapp:' || telefono || ':' || numero_propio AS clave,
             telefono,
             creado_at                                      AS cuando,
             'saliente'::text                               AS direccion,
             -- Una máquina es: el acuse nocturno (automatico), la plantilla de
             -- una campaña y el bot. Ninguna de las tres es atención.
             (automatico OR pieza_via IN ('campana', 'bot', 'automatica')) AS automatico,
             vendedora_id
        FROM envios_wa
       WHERE estado = 'enviado'
         AND creado_at > ${desde}
         ${filtroLinea}
    )
    SELECT * FROM entrantes WHERE true ${soloDeLaCampana}
    UNION ALL
    SELECT * FROM salientes WHERE true ${soloDeLaCampana}
    ORDER BY clave, cuando
  `)) as unknown as FilaMensaje[];

  if (filas.length === 0) {
    console.log("\nNo hay mensajes en esa ventana. Nada que medir.");
    return;
  }

  const duenas = (await db.execute(sql`
    SELECT clave, vendedora_id FROM conversacion_asignada
  `)) as unknown as FilaDuena[];
  const duenaDe = new Map(duenas.map((d) => [d.clave, d.vendedora_id]));

  // ── Agrupar por conversación y aplicar la regla pura ──
  const hilos = new Map<string, MensajeDelHilo[]>();
  const telefonoDe = new Map<string, string>();
  for (const f of filas) {
    const m: MensajeDelHilo = {
      cuando: new Date(f.cuando),
      direccion: f.direccion,
      ...(f.direccion === "saliente" ? { quien: f.automatico ? ("maquina" as const) : ("persona" as const) } : {}),
    };
    const lista = hilos.get(f.clave);
    if (lista) lista.push(m);
    else hilos.set(f.clave, [m]);
    telefonoDe.set(f.clave, f.telefono);
  }

  const todas: Espera[] = [];
  const abiertasConDuena: { clave: string; telefono: string; duena: string; minutos: number }[] = [];
  const porDuena = new Map<string, Espera[]>();

  for (const [clave, mensajes] of hilos) {
    // El SQL ya ordenó; se reordena igual porque el UNION no garantiza estabilidad
    // dentro del mismo instante y un empate mal ordenado inventa una espera.
    mensajes.sort((a, b) => a.cuando.getTime() - b.cuando.getTime());
    const esperas = esperasDelHilo(mensajes, ahora);
    todas.push(...esperas);

    const duena = duenaDe.get(clave) ?? "(sin dueña)";
    const acumulado = porDuena.get(duena);
    if (acumulado) acumulado.push(...esperas);
    else porDuena.set(duena, [...esperas]);

    for (const e of esperas) {
      if (e.minutos !== null) continue;
      abiertasConDuena.push({
        clave,
        telefono: telefonoDe.get(clave) ?? "?",
        duena,
        minutos: (ahora.getTime() - e.escribioEn.getTime()) / 60_000,
      });
    }
  }

  imprimirResumen(`TODO (${hilos.size} conversaciones)`, resumirAtencion(todas, ahora));

  console.log("\n── por dueña de la conversación ──");
  const ordenadas = [...porDuena.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [duena, esperas] of ordenadas) {
    const r = resumirAtencion(esperas, ahora);
    const med = r.mediana ? enCriollo(r.mediana.minutos) : "—";
    console.log(
      `   ${duena.padEnd(24)} esperas ${String(r.esperas).padStart(4)} · ` +
        `respondidas ${String(r.respondidas).padStart(4)} · ` +
        `sin responder ${String(r.sinResponder).padStart(4)} · mediana ${med}`,
    );
  }

  if (abiertasConDuena.length > 0) {
    console.log(`\n🔴 ESPERANDO AHORA MISMO (${abiertasConDuena.length}) — las ${MUESTRA} más viejas:`);
    abiertasConDuena
      .sort((a, b) => b.minutos - a.minutos)
      .slice(0, MUESTRA)
      .forEach((a) => {
        console.log(`   ${enCriollo(a.minutos).padStart(12)}  ${a.telefono.padEnd(15)} → ${a.duena}`);
      });
  }

  console.log(
    "\nOjo con la lectura: la mediana describe SÓLO a las que se respondieron.\n" +
      "Si «sin responder» es grande, la mediana es la de nuestros mejores casos.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
