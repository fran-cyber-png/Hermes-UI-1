import "dotenv/config";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { events, interactions } from "../db/schema.js";
import { contenidoDe, plantillaPorNombre } from "../campana/plantillasAprobadas.js";
import { deUnaCampana } from "../procedencia/pieza.js";
import { enviarPlantillaYProyectar } from "../whatsapp/enviarYProyectar.js";
import { huboRechazo } from "../autorespuesta/rechazo.js";

/**
 * LA CAMPAÑA POR PLANTILLA APROBADA — dry-run por default.
 *
 * ══ POR QUÉ EL SIMULACRO IMPRIME CONDICIONES Y NO RESULTADOS ════════════════
 *
 * Es la lección de #166, y costó cara: el plan de la auto-respuesta del 27-jul
 * se veía impecable y estaba mal de siete formas, porque imprimía la hora de
 * SALIDA y nunca la de llegada. Un dry-run que muestra a quién le va a tocar,
 * pero no POR QUÉ califica, no verifica nada — solo tranquiliza.
 *
 * Por eso cada renglón de acá dice: quién, a qué línea escribió, CUÁNDO
 * escribió, cuánto hace, si su ventana de 24 h está abierta o cerrada, qué
 * preguntó, y si ya se le mandó precio. Con eso se puede discutir la lista antes
 * de que salga, que es el punto.
 *
 * ══ LO QUE NO HACE ══════════════════════════════════════════════════════════
 *
 * **No decide a quién**: la lista se acota por línea y por fechas desde la línea
 * de comandos, y se imprime entera. No hay heurística escondida.
 *
 * **No reintenta.** El 131049 (tope de marketing por usuario) es adaptativo y
 * sin número publicado: una parte del lote va a fallar y no se puede predecir
 * cuál. Se cuenta aparte y se sigue — no es una caída.
 *
 * **Frena entero** ante un error que no sea 131049: si Meta empieza a rechazar
 * por otra cosa, seguir mandando es cavar.
 *
 * ══ USO ═════════════════════════════════════════════════════════════════════
 *
 *   npm run campana -- --linea 51984429504 --desde 2026-07-31 --hasta 2026-08-02
 *   npm run campana -- --linea 51984429504 --desde … --hasta … --imagen <URL> --enviar
 */

const args = process.argv.slice(2);
const opcion = (n: string): string | null => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const bandera = (n: string) => args.includes(`--${n}`);

const LINEA = opcion("linea");
const DESDE = opcion("desde");
const HASTA = opcion("hasta");
const NOMBRE = opcion("plantilla") ?? "promo_3x1_cursos";
const IMAGEN = opcion("imagen");
const ENVIAR = bandera("enviar");
const TOPE = Number(opcion("tope") ?? "0") || Infinity;
/**
 * A quién quedan asignadas estas conversaciones.
 *
 * ⚠️ **No hace falta que esté en la rueda.** `asignarSiHaceFalta` devuelve
 * temprano si la conversación ya tiene dueño, así que una asignación manual
 * sobrevive al round-robin: la rueda solo reparte lo que NO tiene dueño.
 */
const ASIGNAR_A = opcion("asignar-a");
/** Espaciado entre envíos. El mismo orden de magnitud que el acuse nocturno. */
const ESPERA_MIN_MS = Number(opcion("espera") ?? "60") * 1000;

// `--subir` es un modo aparte y no necesita lista: la validación de abajo se
// saltea a propósito (si no, subir el flyer pide fechas que no usa para nada).
if (!args.includes("--subir") && (!LINEA || !DESDE || !HASTA)) {
  console.error("Faltan --linea, --desde y --hasta (YYYY-MM-DD, hora de Lima).");
  process.exit(1);
}

const SUBIR = opcion("subir");

const plantilla = plantillaPorNombre(NOMBRE);
if (!plantilla) {
  console.error(`No conozco la plantilla «${NOMBRE}». Están en campana/plantillasAprobadas.ts`);
  process.exit(1);
}

/**
 * SUBIR EL FLYER A META Y DEVOLVER SU `media_id`.
 *
 * Un header de imagen se puede pasar por `link` (URL pública) o por `id` (subido
 * a Meta). Se prefiere el `id`: no depende de que un hosting esté arriba en el
 * momento del envío, y Meta ya lo tiene cacheado cuando manda los 91.
 *
 * El id es **por número y caduca a los 30 días**, así que no se guarda en
 * ningún lado: se sube al empezar cada campaña. Cachearlo costaría un mensaje
 * que no llega, que es peor que una request de más.
 */
async function subirImagen(ruta: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error("faltan WHATSAPP_CLOUD_API_TOKEN / _PHONE_NUMBER_ID");

  const bytes = await readFile(ruta);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/jpeg");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "flyer.jpg");

  const r = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await r.json()) as { id?: string };
  if (!r.ok || !data.id) throw new Error(`Meta rechazó la subida: ${JSON.stringify(data)}`);
  return data.id;
}

/**
 * ⚠️ Con `await` y no con `.then()`: el módulo sigue ejecutándose mientras la
 * promesa está en vuelo, y `main()` más abajo llama a `process.exit(0)` — que
 * mata la subida antes de que imprima el id. Pasó en el primer intento real.
 */
if (SUBIR) {
  try {
    const id = await subirImagen(SUBIR);
    console.log(`\nmedia_id: ${id}\n`);
    console.log(`Ahora:\n  npm run campana -- --linea … --desde … --hasta … --imagen-id ${id}\n`);
    process.exit(0);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
}

const IMAGEN_ID = opcion("imagen-id");
if (!SUBIR && plantilla.headerDeImagen && !IMAGEN && !IMAGEN_ID) {
  console.error(
    `«${NOMBRE}» tiene header de IMAGEN: Meta la exige en cada envío.\n` +
      `  · subila:  npm run campana -- --subir /ruta/al/flyer.jpg\n` +
      `  · o pasá:  --imagen-id <id>   o   --imagen <URL pública>\n` +
      `Sin eso el envío falla con 132012.`,
  );
  process.exit(1);
}

interface Destinatario {
  telefono: string;
  nombre: string | null;
  primerMensaje: string;
  ultimoSuyo: Date;
  yaTienePrecio: boolean;
  /** El anuncio por el que llegó, si llegó por uno. `null` = entró de otra forma. */
  anuncio: string | null;
  yaLeLlego: boolean;
}

/**
 * Los hechos crudos: quién escribió a esta línea en esas fechas. Ni un `CASE`,
 * ni un umbral — el veredicto lo dan las funciones puras, abajo (patrón `senales/`).
 */
async function traerCandidatos(): Promise<Destinatario[]> {
  const filas = await db.execute(sql`
    with entrantes as (
      select persona_id,
             max(persona_nombre) filter (where persona_nombre is not null) as nombre,
             min(occurred_at) as primero_en,
             max(occurred_at) as ultimo_suyo
        from ${interactions}
       where canal = 'whatsapp' and direccion = 'entrante'
         and numero_propio = ${LINEA}
         and (occurred_at at time zone 'America/Lima')::date between ${DESDE}::date and ${HASTA}::date
       group by persona_id
    )
    select e.persona_id, e.nombre, e.ultimo_suyo,
           (select i.texto from ${interactions} i
             where i.persona_id = e.persona_id and i.direccion = 'entrante'
             order by i.occurred_at limit 1) as primer_mensaje,
           exists (select 1 from ${interactions} i
                    where i.persona_id = e.persona_id and i.direccion = 'saliente'
                      and i.texto ~ '(S/|USD|\\$|soles|precio|inversi)') as ya_tiene_precio,
           (select max(i.occurred_at) from ${interactions} i
             where i.persona_id = e.persona_id and i.direccion = 'entrante') as ultimo_entrante_global,
           -- El ANUNCIO por el que llegó. Vive en el evento crudo y no en la
           -- interacción: es lo que Meta manda en el referral de un
           -- Click-to-WhatsApp. fuente='anuncio' es el discriminador, la misma
           -- expresión que usa cola/cursoSql.ts — no una segunda copia.
           (select coalesce(ev.payload->'origen'->>'titulo', ev.payload->'origen'->>'adId')
              from ${interactions} i2
              join events ev on ev.id = i2.event_id
             where i2.persona_id = e.persona_id and i2.direccion = 'entrante'
               and ev.payload->'origen'->>'fuente' = 'anuncio'
             order by i2.occurred_at limit 1) as anuncio,
           -- Ya se le mandó ESTA campaña. La guarda contra el doble envío
           -- después de una corrida frenada a la mitad.
           -- OJO: pieza_ref NO lleva el prefijo de la clase. refDeDireccion solo
           -- pega el orden con # y solo para las clases con pasos. Comparar
           -- contra 'hsm:promo_3x1_cursos' daba SIEMPRE falso, y el simulacro
           -- estaba por mandar un segundo mensaje a los 13 de la corrida frenada.
           exists (select 1 from envios_wa w
                    where w.telefono = e.persona_id
                      and w.pieza_clase = 'hsm' and w.pieza_ref = ${NOMBRE}
                      and w.estado = 'enviado') as ya_le_llego
      from entrantes e
     order by e.ultimo_suyo
  `);

  return (filas as unknown as Record<string, unknown>[]).map((f) => ({
    telefono: String(f.persona_id),
    nombre: (f.nombre as string | null) ?? null,
    primerMensaje: (f.primer_mensaje as string | null) ?? "",
    ultimoSuyo: new Date(String(f.ultimo_entrante_global ?? f.ultimo_suyo)),
    yaTienePrecio: Boolean(f.ya_tiene_precio),
    anuncio: (f.anuncio as string | null) ?? null,
    yaLeLlego: Boolean(f.ya_le_llego),
  }));
}

/** Horas desde su último mensaje. La ventana de servicio son 24. */
const horasDesde = (d: Date, ahora: Date) => (ahora.getTime() - d.getTime()) / 3_600_000;

const hora = (d: Date) =>
  d.toLocaleString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

async function main() {
  const ahora = new Date();
  const todos = await traerCandidatos();

  // El único descarte con criterio, y no es nuevo: quien ya dijo que no.
  // `rechazo.ts` es puro, tiene tests y está sesgado al falso negativo a
  // propósito — se reusa tal cual en vez de escribir un segundo criterio.
  const conRechazo = new Set<string>();
  for (const d of todos) {
    if (huboRechazo([d.primerMensaje])) conRechazo.add(d.telefono);
  }

  /**
   * SOLO LOS QUE LLEGARON POR UN ANUNCIO (por default).
   *
   * Es el pedido explícito del dueño y tiene sentido de negocio: quien hizo
   * clic en un anuncio de la Escuela ya levantó la mano por ESTO. Los que
   * entraron por otra vía —el número compartido por un conocido, un comentario,
   * un formulario— no pidieron una promo de este diploma, y mandársela es
   * ruido para ellos y riesgo de bloqueo para el número.
   *
   * `--todos` lo desactiva, a propósito y con nombre feo: que ampliar la lista
   * cueste escribir algo.
   */
  const soloDeAnuncio = !bandera("todos");

  const sinAnuncio = todos.filter((d) => soloDeAnuncio && !d.anuncio);
  const yaLesLlego = todos.filter((d) => d.yaLeLlego);

  /**
   * EL PÚBLICO de la campaña: a quién le corresponde este mensaje.
   *
   * Se separa de `elegibles` a propósito. La ASIGNACIÓN va sobre este conjunto
   * —incluidos los que ya recibieron el mensaje en una corrida anterior—, porque
   * la conversación es suya igual: dejarlos sin dueño porque el envío llegó
   * primero es exactamente al revés de lo que hace falta cuando contesten.
   */
  const publico = todos
    .filter((d) => !conRechazo.has(d.telefono))
    .filter((d) => !soloDeAnuncio || d.anuncio);

  // A quién se le MANDA: el público menos quien ya lo recibió. Una corrida
  // frenada a la mitad no puede convertirse en un segundo mensaje.
  const elegibles = publico.filter((d) => !d.yaLeLlego).slice(0, TOPE);

  console.log(`\n═══ CAMPAÑA «${plantilla!.nombre}» (idioma ${plantilla!.idioma}) ═══`);
  console.log(`línea ${LINEA} · leads que escribieron entre ${DESDE} y ${HASTA}`);
  console.log(`${ENVIAR ? "🔴 ENVÍO REAL" : "simulacro (agregá --enviar para mandar)"}\n`);

  console.log("─".repeat(124));
  console.log(
    ["#", "teléfono", "escribió", "hace", "ventana", "precio", "anuncio por el que llegó"]
      .map((s, i) => s.padEnd([4, 15, 16, 7, 10, 8, 40][i]))
      .join(""),
  );
  console.log("─".repeat(124));

  elegibles.forEach((d, i) => {
    const h = horasDesde(d.ultimoSuyo, ahora);
    console.log(
      [
        String(i + 1).padEnd(4),
        d.telefono.padEnd(15),
        hora(d.ultimoSuyo).padEnd(16),
        `${Math.round(h)}h`.padEnd(7),
        (h < 24 ? "ABIERTA" : "cerrada").padEnd(10),
        (d.yaTienePrecio ? "sí" : "—").padEnd(8),
        (d.anuncio ?? "(sin anuncio)").slice(0, 40),
      ].join(""),
    );
  });

  const abiertas = elegibles.filter((d) => horasDesde(d.ultimoSuyo, ahora) < 24).length;
  console.log("─".repeat(124));
  console.log(`\nTotal a mandar: ${elegibles.length}   (de ${todos.length} que escribieron en esas fechas)`);
  console.log(`  · ventana abierta: ${abiertas} (a estos se les puede escribir texto libre también)`);
  console.log(`  · ventana cerrada: ${elegibles.length - abiertas} (solo alcanzables con esta plantilla)`);
  console.log(`  · con precio ya enviado: ${elegibles.filter((d) => d.yaTienePrecio).length}`);
  console.log(`\nDescartados:`);
  if (soloDeAnuncio) console.log(`  · ${sinAnuncio.length} porque NO llegaron por un anuncio (--todos los incluye)`);
  if (yaLesLlego.length) console.log(`  · ${yaLesLlego.length} porque YA recibieron esta campaña`);
  if (conRechazo.size) console.log(`  · ${conRechazo.size} porque ya dijeron que no`);
  console.log(
    `\nEspaciado: ${ESPERA_MIN_MS / 1000}s entre envíos · imagen: ${IMAGEN_ID ? `media_id ${IMAGEN_ID}` : (IMAGEN ?? "(ninguna)")}`,
  );

  if (ASIGNAR_A) {
    console.log(
      `\nSe van a asignar ${publico.length} conversaciones a «${ASIGNAR_A}»` +
        (publico.length !== elegibles.length
          ? ` (las ${elegibles.length} que reciben el mensaje MÁS las ${publico.length - elegibles.length} que ya lo habían recibido).`
          : "."),
    );
  }

  if (!ENVIAR) {
    console.log("\nSimulacro. No salió ningún mensaje y no se asignó nada.\n");
    process.exit(0);
  }

  /**
   * ASIGNAR ANTES DE MANDAR, y a propósito.
   *
   * Si el envío se frena a la mitad —pasó: la primera corrida se detuvo en 13
   * de 91—, los que ya recibieron el mensaje tienen que estar en la cola de
   * quien va a atenderlos. Al revés, quedarían mensajes contestando a una
   * conversación que nadie tiene asignada.
   *
   * ⚠️ Esto es un FILTRO, no un permiso. Hermes no tiene modelo de permisos:
   * `requiereVendedora` dice «es una vendedora», no «cuál». Asignarlas hace que
   * aparezcan como suyas y que el segmento «Las mías» las muestre solo a ella,
   * pero cualquier otra vendedora las sigue pudiendo abrir si no filtra.
   */
  if (ASIGNAR_A) {
    const { reasignar } = await import("../reparto/asignar.js");
    let asignadas = 0;
    for (const d of publico) {
      await reasignar(db, `conv:whatsapp:${d.telefono}:${LINEA}`, LINEA!, ASIGNAR_A, "campana");
      asignadas++;
    }
    console.log(`✅ ${asignadas} conversaciones asignadas a «${ASIGNAR_A}».\n`);
  }

  /**
   * ARRANCAR EL TRANSPORTE — el script corre FUERA del server.
   *
   * `enviarPlantillaYProyectar` pide `gestorWhatsapp()`, que lanza «WhatsApp no
   * está arrancado todavía» si nadie lo montó: en producción lo monta
   * `index.ts:142` al levantar el proceso, y un script suelto no pasa por ahí.
   * Se descubrió mandando de verdad — el primer envío murió acá.
   *
   * Va DESPUÉS del simulacro a propósito: un dry-run no tiene por qué abrir una
   * sesión de WhatsApp, y así se puede correr en cualquier lado sin efectos.
   */
  const { arrancarWhatsapp } = await import("../whatsapp/wiring.js");
  arrancarWhatsapp();
  // La Cloud API confirma su sesión con un GET a Meta: sin esta espera, el
  // primer envío sale con la sesión en «conectando» y `EnvioControlado` lo
  // rechaza sin auditar.
  await new Promise((listo) => setTimeout(listo, 5000));

  console.log(`\n🔴 Mandando de verdad. Ctrl-C corta.\n`);
  const procedencia = deUnaCampana({ nombre: plantilla!.nombre, contenido: contenidoDe(plantilla!) });
  // `id` gana sobre `link`: no depende de que un hosting esté arriba durante los
  // ~90 minutos que dura el reparto.
  const imagen = IMAGEN_ID ? { id: IMAGEN_ID } : IMAGEN ? { link: IMAGEN } : null;
  const componentes = imagen
    ? [{ type: "header", parameters: [{ type: "image", image: imagen }] }]
    : undefined;

  let ok = 0;
  const topeados: string[] = [];

  for (const [i, d] of elegibles.entries()) {
    const r = await enviarPlantillaYProyectar({
      vendedoraId: "campana",
      numeroPropio: LINEA!,
      telefono: d.telefono,
      referencia: `campana:${plantilla!.nombre}:${d.telefono}`,
      automatico: true,
      procedencia,
      plantilla: {
        nombre: plantilla!.nombre,
        idioma: plantilla!.idioma,
        componentes,
        cuerpoRenderizado: plantilla!.cuerpo,
      },
    });

    if (r.ok) {
      ok++;
      console.log(`[${i + 1}/${elegibles.length}] ✅ ${d.telefono}`);
    } else {
      const esTope = /131049/.test(r.motivo);
      console.log(`[${i + 1}/${elegibles.length}] ${esTope ? "⏸" : "❌"} ${d.telefono} — ${r.motivo.slice(0, 120)}`);
      if (esTope) {
        // El tope por usuario es de Meta y es adaptativo: no es una caída.
        topeados.push(d.telefono);
      } else {
        console.error(`\n🛑 FRENO: un error que no es el tope por usuario. No sigo.\n`);
        break;
      }
    }

    if (i < elegibles.length - 1) {
      await new Promise((listo) => setTimeout(listo, ESPERA_MIN_MS));
    }
  }

  console.log(`\n─── salieron ${ok} · topeados por Meta ${topeados.length} ───\n`);
  process.exit(0);
}

void main();
