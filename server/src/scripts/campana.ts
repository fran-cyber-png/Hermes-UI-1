import "dotenv/config";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { clientesPadron, enviosWa, events, interactions } from "../db/schema.js";
import { contenidoDe, type PlantillaAprobada } from "../campana/plantillasAprobadas.js";
import { comoPlantillaAprobada, ErrorDeMeta, traerPlantillasDeMeta } from "../campana/metaPlantillas.js";
import { deUnaCampana } from "../procedencia/pieza.js";
import { enviarPlantillaYProyectar } from "../whatsapp/enviarYProyectar.js";
import { contarPorMotivo, elegirPublico } from "../campana/publico.js";
import {
  contarMotivosDeLista,
  leerLista,
  parsearCsv,
  type FilaDescartada,
} from "../campana/lista.js";
import {
  contarCancelaciones,
  vetoAlSalir,
  type EstadoAlSalir,
  type Veredicto,
} from "../campana/vetoAlSalir.js";

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
 * ══ DOS ORÍGENES PARA LA LISTA, Y NO SON LA MISMA CAMPAÑA ═══════════════════
 *
 * **`--desde/--hasta`** — el original: gente que le **escribió** a esta línea en
 * esas fechas. Es seguimiento; no cae en «no inicia conversaciones» (ADR 0015
 * §37) porque la conversación ya la abrió la persona.
 *
 * **`--lista <archivo.csv>`** — un padrón de afuera. La mayoría **nunca escribió
 * a este número**: eso ES contacto en frío, y el ADR lo prohíbe. Que el modo
 * exista no lo autoriza — lo autoriza una decisión escrita del dueño, y este
 * script sólo se encarga de que lo que salga sea auditable y de que nadie
 * reciba un mensaje que no le corresponde. El parseo y la normalización viven
 * puros y con tests en `campana/lista.ts`.
 *
 * Las dos ramas comparten TODO lo que viene después: el veto al salir, la
 * procedencia, la puerta de envío y el freno. Sólo cambia de dónde sale la
 * lista y qué se puede decir de cada persona en el simulacro.
 *
 * ══ USO ═════════════════════════════════════════════════════════════════════
 *
 *   npm run campana -- --linea 51984429504 --desde 2026-07-31 --hasta 2026-08-02
 *   npm run campana -- --linea 51984429504 --desde … --hasta … --imagen <URL> --enviar
 *   npm run campana -- --linea 51984429504 --plantilla foro_estado_5_ago \
 *                      --lista base-foro.csv --tope 1000 --imagen-id <id>
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
/** El CSV con el padrón de afuera. Su presencia ES el modo (ver cabecera). */
const LISTA = opcion("lista");

// `--subir` es un modo aparte y no necesita lista: la validación de abajo se
// saltea a propósito (si no, subir el flyer pide fechas que no usa para nada).
if (!args.includes("--subir") && (!LINEA || (!LISTA && (!DESDE || !HASTA)))) {
  console.error(
    "Falta --linea, y después una de dos:\n" +
      "  · --desde y --hasta (YYYY-MM-DD, hora de Lima) para los que escribieron;\n" +
      "  · --lista <archivo.csv> para un padrón de afuera (contacto en frío).",
  );
  process.exit(1);
}

const SUBIR = opcion("subir");

/**
 * LA PLANTILLA SE LE PREGUNTA A META, QUE ES QUIEN LA APRUEBA Y QUIEN LA PAUSA.
 *
 * Acá había `plantillaPorNombre(NOMBRE)` contra una constante compilada, y el
 * 5-ago-2026 eso significó que una plantilla aprobada esa misma mañana
 * (`foro_estado_5_ago`) **no se podía mandar sin un deploy**.
 *
 * Preguntarle a Meta arregla dos cosas de una: el catálogo deja de envejecer, y
 * —más importante— cada campaña **verifica que la plantilla siga aprobada antes
 * de mandar**. Una constante no puede contestar eso: diría «aprobada» sobre algo
 * que Meta pausó hace dos horas, y el resultado es un `132015` por destinatario
 * con la calidad del número cayendo con cada uno.
 *
 * Fail-closed: si no se puede preguntar, no se manda.
 */
async function resolverPlantilla(): Promise<PlantillaAprobada> {
  try {
    const deMeta = await traerPlantillasDeMeta();
    const encontrada = deMeta.find((p) => p.nombre === NOMBRE);
    if (!encontrada) {
      const nombres = deMeta.map((p) => `${p.nombre} [${p.idioma}] ${p.estado}`).join("\n    · ");
      console.error(`\n❌ Meta no tiene ninguna plantilla «${NOMBRE}». Las que hay:\n    · ${nombres}\n`);
      process.exit(1);
    }
    console.log(
      `Plantilla «${encontrada.nombre}» [${encontrada.idioma}] · ${encontrada.lectura.titulo}` +
        ` · calidad: ${encontrada.calidad.texto}`,
    );
    if (encontrada.lectura.detalle) console.log(`  ${encontrada.lectura.detalle}`);

    const lista = comoPlantillaAprobada(encontrada);
    if (!lista) {
      console.error(
        `\n🛑 NO SE PUEDE MANDAR: ${encontrada.lectura.titulo}.` +
          (encontrada.cuerpo === null
            ? " Meta no devolvió el cuerpo, y sin cuerpo no hay versión de pieza (el envío quedaría fuera del lazo de resultados)."
            : "") +
          "\n",
      );
      process.exit(1);
    }
    return lista;
  } catch (e) {
    const codigo = e instanceof ErrorDeMeta ? e.codigo : "desconocido";
    console.error(`\n🛑 No se le pudo preguntar a Meta por las plantillas (${codigo}).`);
    console.error(`   No se manda: una copia local no puede saber si Meta la pausó.\n`);
    console.error(e);
    process.exit(1);
  }
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

/**
 * ⚠️ Esta guarda se corrió DENTRO de `main()` porque ahora la plantilla la
 * decide Meta, no una constante: a nivel de módulo todavía no se sabe si pide
 * imagen. Sin ella el envío falla con `132012` en el primer destinatario.
 */
function exigirImagenSiHaceFalta(p: PlantillaAprobada) {
  if (!p.headerDeImagen || IMAGEN || IMAGEN_ID) return;
  console.error(
    `\n«${p.nombre}» tiene header de IMAGEN: Meta la exige en cada envío.\n` +
      `  · subila:  npm run campana -- --subir /ruta/al/flyer.jpg\n` +
      `  · o pasá:  --imagen-id <id>   o   --imagen <URL pública>\n` +
      `Sin eso el envío falla con 132012.\n`,
  );
  process.exit(1);
}

interface Destinatario {
  telefono: string;
  nombre: string | null;
  /**
   * TODOS sus mensajes entrantes, en orden.
   *
   * ⚠️ Acá había `primerMensaje: string`, y esa forma del dato ES el defecto:
   * un campo que sólo puede contener un texto obliga a preguntarle el rechazo a
   * un texto. Con la lista, `huboRechazo` recibe lo que su firma pide.
   */
  mensajes: string[];
  ultimoSuyo: Date;
  yaTienePrecio: boolean;
  /** El anuncio por el que llegó, si llegó por uno. `null` = entró de otra forma. */
  anuncio: string | null;
  yaLeLlego: boolean;
  /** Tiene una compra que la respalda en `clientes_padron` (nunca `n_purchases`). */
  yaCompro: boolean;
  /** Sólo en el modo `--lista`: ¿esta persona ya nos escribió alguna vez? */
  yaNosEscribio?: boolean;
  /** Sólo en el modo `--lista`: su fila en el archivo, para poder señalarla. */
  lineaDelArchivo?: number;
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
           -- TODOS sus mensajes, en orden. Antes acá salía sólo el primero
           -- (limit 1) y eso hacía imposible ver un rechazo posterior.
           (select array_agg(i.texto order by i.occurred_at)
              from ${interactions} i
             where i.persona_id = e.persona_id and i.direccion = 'entrante'
               and i.texto is not null) as mensajes,
           -- Ya compró: se exige una venta que lo respalde. El nivel de
           -- clientes_padron se congela al sincronizar y sale del EXISTS sobre
           -- icarus.sales, nunca del contador n_purchases (55% infundado, #133).
           exists (select 1 from clientes_padron p
                    where right(e.persona_id, 9) = p.sufijo) as ya_compro,
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
    mensajes: (f.mensajes as string[] | null) ?? [],
    ultimoSuyo: new Date(String(f.ultimo_entrante_global ?? f.ultimo_suyo)),
    yaTienePrecio: Boolean(f.ya_tiene_precio),
    anuncio: (f.anuncio as string | null) ?? null,
    yaLeLlego: Boolean(f.ya_le_llego),
    yaCompro: Boolean(f.ya_compro),
  }));
}

/**
 * LA LISTA DE AFUERA, CRUZADA CONTRA LO QUE HERMES YA SABE.
 *
 * El archivo sólo trae teléfono, nombre y estado. Eso alcanza para saber a
 * quién NO escribirle por lo que dice la planilla (`campana/lista.ts`), y no
 * alcanza para lo que Hermes sabe y la planilla no:
 *
 *   · que esa persona **ya nos escribió** alguna vez, y qué dijo — porque si en
 *     esa conversación dijo que no, el archivo no se enteró;
 *   · que **ya recibió esta misma pieza** en una corrida frenada;
 *   · que **ya compró** algo (informativo acá: quien hizo un curso es mejor
 *     candidato a un foro, no peor — ver `elegirPublico` más abajo).
 *
 * Una sola consulta con `= ANY(...)` y no una por persona: con 1.000
 * destinatarios, mil consultas antes de empezar es media hora de nada.
 *
 * ⚠️ El cruce contra `interactions` va por `persona_id` **sin importar la
 * línea**: si alguien de esta lista habló con la línea de una vendedora y ahí
 * dijo que no, ese «no» vale igual. Un rechazo es de la persona, no del número
 * por el que entró.
 */
async function traerDeLista(ruta: string): Promise<{
  destinatarios: Destinatario[];
  descartadasDelArchivo: FilaDescartada[];
  filasLeidas: number;
}> {
  const { readFile } = await import("node:fs/promises");
  const filas = parsearCsv(await readFile(ruta, "utf8"));
  const { destinatarios: crudos, descartadas } = leerLista(filas);

  const telefonos = crudos.map((d) => d.telefono);

  /**
   * TRES CONSULTAS AGRUPADAS, NO UNA CON SUBCONSULTAS CORRELACIONADAS.
   *
   * La forma obvia —`unnest(lista)` como tabla y cuatro `select` correlacionados
   * al lado— es cuatro mil consultas escondidas adentro de una para un lote de
   * mil. Acá cada pregunta se hace UNA vez sobre el conjunto y el cruce lo hace
   * JS, que para mil filas es gratis.
   *
   * ⚠️ El `inArray` de drizzle y no un `unnest`: `sql.array()` es un helper de
   * **postgres.js** (lo usa `padron/donde.ts`, que habla con icarus por esa
   * conexión) y no existe en el `sql` de drizzle. Interpolar el arreglo pelado
   * lo expande en mil parámetros sueltos — que es exactamente lo que `IN (…)`
   * necesita y lo que `unnest(…)` no puede recibir.
   */
  const sufijos = [...new Set(telefonos.map((t) => t.slice(-9)))];
  const [hablaron, lesLlego, compraron] = await Promise.all([
    db.execute(sql`
      select persona_id,
             array_agg(texto order by occurred_at) as mensajes,
             max(occurred_at)                      as ultimo_suyo
        from ${interactions}
       where direccion = 'entrante' and texto is not null
         and ${inArray(interactions.personaId, telefonos)}
       group by persona_id
    `),
    db.execute(sql`
      select distinct telefono from ${enviosWa}
       where pieza_clase = 'hsm' and pieza_ref = ${NOMBRE} and estado = 'enviado'
         and ${inArray(enviosWa.telefono, telefonos)}
    `),
    /**
     * El sufijo de 9 y no el E.164, porque así está guardado `clientes_padron`
     * (`sufijoTelefonoSql`, la llave de la casa). Acá es seguro sin la guarda de
     * país de #119: todos estos números ya se validaron como peruanos en
     * `campana/lista.ts`, así que no hay un mexicano compartiendo sufijo.
     */
    db.execute(sql`
      select distinct sufijo from ${clientesPadron}
       where ${inArray(clientesPadron.sufijo, sufijos)}
    `),
  ]);

  const conversaciones = new Map(
    (hablaron as unknown as Record<string, unknown>[]).map((f) => [String(f.persona_id), f]),
  );
  const yaLesLlego = new Set(
    (lesLlego as unknown as Record<string, unknown>[]).map((f) => String(f.telefono)),
  );
  const sufijosCliente = new Set(
    (compraron as unknown as Record<string, unknown>[]).map((f) => String(f.sufijo)),
  );

  return {
    destinatarios: crudos.map((d) => {
      const f = conversaciones.get(d.telefono);
      const ultimo = f?.ultimo_suyo ? new Date(String(f.ultimo_suyo)) : null;
      return {
        telefono: d.telefono,
        nombre: d.nombre,
        mensajes: (f?.mensajes as string[] | null) ?? [],
        /**
         * ⚠️ `ultimoSuyo` es la fecha de su último mensaje ENTRANTE, y en esta
         * rama la mayoría no tiene ninguno. Se pone la época y no `now()`: con
         * `now()` la columna «ventana» diría **ABIERTA** para gente que jamás
         * escribió, que es exactamente la clase de dato inventado que el
         * simulacro existe para no producir. En el modo lista esa columna no se
         * dibuja; la fecha queda por si alguien la mira.
         */
        ultimoSuyo: ultimo ?? new Date(0),
        yaTienePrecio: false,
        anuncio: null,
        yaLeLlego: yaLesLlego.has(d.telefono),
        yaCompro: sufijosCliente.has(d.telefono.slice(-9)),
        /** Sólo en el modo lista: ¿esta persona ya habló con nosotros? */
        yaNosEscribio: ultimo !== null,
        lineaDelArchivo: d.linea,
      };
    }),
    descartadasDelArchivo: descartadas,
    filasLeidas: filas.length,
  };
}

/**
 * EL ESTADO DE UNA PERSONA EN EL INSTANTE DE MANDARLE.
 *
 * Es el lector del veto: cinco hechos crudos, ni un veredicto. El veredicto lo
 * da `vetoAlSalir`, que es puro y tiene tests — acá no puede haber un `if` que
 * decida, porque sería una segunda implementación de la regla.
 *
 * Cuesta una consulta por envío. Es barato al lado de lo que evita: con 30–60 s
 * entre mensajes, esta consulta es ruido y la promo a quien dijo que no no
 * se puede deshacer.
 */
async function estadoAlSalir(
  telefono: string,
  autorizadoEn: Date,
  nombrePieza: string,
): Promise<EstadoAlSalir> {
  /**
   * ⚠️ EL INSTANTE VIAJA COMO TEXTO ISO CON SU CAST, NO COMO `Date`.
   *
   * Interpolar el `Date` pelado hace que postgres.js muera al bindear —«The
   * "string" argument must be of type string … Received an instance of Date»— y
   * el veto entero se cae con él. Es un fallo de la PRIMERA fila del lote, o
   * sea que el envío no arranca: no hay forma de que esto pase inadvertido,
   * pero sí de que llegue hasta acá sin que nadie lo note. Llegó: `vetoAlSalir`
   * tiene sus tests puros (le pasan el estado, no la hora) y esta consulta —el
   * lector— nunca había corrido contra una base real hasta el primer envío del
   * Foro.
   */
  const desde = autorizadoEn.toISOString();
  const filas = await db.execute(sql`
    select
      (select array_agg(i.texto order by i.occurred_at)
         from ${interactions} i
        where i.persona_id = ${telefono} and i.direccion = 'entrante'
          and i.texto is not null)                                    as mensajes,
      exists (select 1 from ${interactions} i
               where i.persona_id = ${telefono} and i.direccion = 'entrante'
                 and i.occurred_at > ${desde}::timestamptz)           as escribio,
      -- Un saliente HUMANO: el de la campaña es automatico y no cuenta como
      -- atencion (misma regla que atencion/tiempos.ts).
      exists (select 1 from envios_wa w
               where w.telefono = ${telefono} and w.estado = 'enviado'
                 and w.creado_at > ${desde}::timestamptz
                 and coalesce(w.automatico, false) = false)           as le_escribieron,
      exists (select 1 from envios_wa w
               where w.telefono = ${telefono} and w.estado = 'enviado'
                 and w.pieza_clase = 'hsm' and w.pieza_ref = ${nombrePieza}) as ya_le_llego
  `);
  const f = (filas as unknown as Record<string, unknown>[])[0] ?? {};
  return {
    mensajes: (f.mensajes as string[] | null) ?? [],
    escribioDesdeQueSeAutorizo: Boolean(f.escribio),
    leEscribieronDesdeQueSeAutorizo: Boolean(f.le_escribieron),
    yaLeLlego: Boolean(f.ya_le_llego),
  };
}

/**
 * ¿EXISTE LA PERSONA A LA QUE SE LE VAN A ASIGNAR?
 *
 * ⚠️ `reasignar()` **no verifica nada**: hace un upsert y listo. La guarda vive
 * en la ruta `/api/reparto`, y este script no pasa por ahí — así que hasta acá
 * un dedazo en `--asignar-a` escribía mil filas perfectamente válidas con un
 * `vendedora_id` que no existe, y esas mil conversaciones desaparecían de la
 * cola de todo el mundo **sin un solo síntoma**. Es el fallo exacto que
 * `reparto/destino.ts` existe para impedir, entrando por la puerta de atrás.
 *
 * Se reusa `destinosPosibles`/`esDestinoValido`, no se escribe un criterio
 * nuevo: comparan normalizando los DOS lados, que es lo que hace falta cuando
 * el mismo humano vive como `Luz` en el mapa de Cerberus y como `luz` en las
 * asignaciones que ya tiene escritas.
 *
 * **Se guarda la grafía que vino**, no la de la lista: reescribirla rompería el
 * cruce con `gestiones` y `estado_conversacion`, que ya tienen filas.
 */
async function verificarDestino(numeroPropio: string, destino: string): Promise<void> {
  const { destinosPosibles, esDestinoValido } = await import("../reparto/destino.js");
  const filas = await db.execute(sql`
    select vendedora_id, 'rueda' as de from reparto_rueda where numero_propio = ${numeroPropio}
    union all
    select vendedora_id, 'mapa'  as de from numero_vendedora where numero = ${numeroPropio}
  `);
  const todas = filas as unknown as { vendedora_id: string; de: string }[];
  const posibles = destinosPosibles({
    rueda: todas.filter((f) => f.de === "rueda").map((f) => f.vendedora_id),
    mapa: todas.filter((f) => f.de === "mapa").map((f) => f.vendedora_id),
  });

  if (!esDestinoValido(destino, posibles)) {
    console.error(
      `\n🛑 «${destino}» no atiende la línea ${numeroPropio}, y asignarle mil conversaciones\n` +
        `   las haría invisibles para todos sin ningún error.\n\n` +
        `   A quién sí se le puede: ${posibles.join(" · ")}\n`,
    );
    process.exit(1);
  }
}

/** Horas desde su último mensaje. La ventana de servicio son 24. */
const horasDesde = (d: Date, ahora: Date) => (ahora.getTime() - d.getTime()) / 3_600_000;

const hora = (d: Date) =>
  d.toLocaleString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

async function main() {
  const ahora = new Date();
  // Fail-closed y barato, antes de tocar la base: la plantilla la valida Meta
  // (no una constante compilada) y un destino inexistente mata el simulacro acá,
  // y no después de imprimir mil renglones que dan la impresión de estar bien.
  const plantilla = await resolverPlantilla();
  exigirImagenSiHaceFalta(plantilla);
  if (ASIGNAR_A) await verificarDestino(LINEA!, ASIGNAR_A);
  const deLista = LISTA ? await traerDeLista(LISTA) : null;
  const todos = deLista ? deLista.destinatarios : await traerCandidatos();

  /**
   * ⚠️ ACÁ VIVÍA EL DEFECTO QUE MANDÓ DOS PROMOS A QUIEN HABÍA DICHO QUE NO.
   *
   * Decía `huboRechazo([d.primerMensaje])`. Esa función mira una LISTA
   * (`textos.some(expresaRechazo)`) porque un «ya no quiero» del tercer mensaje
   * vale igual que uno del primero — y con un solo texto, quien saludó con
   * «Hola» calificaba como público. Medido sobre los 88 de la primera corrida:
   * detectó 0 rechazos donde había 2.
   *
   * Ahora la selección entera vive pura y con tests en `campana/publico.ts`, y
   * pregunta las TRES formas de decir que no que `rechazo.ts` distingue.
   */

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
   *
   * ⚠️ **En el modo `--lista` no aplica, y no es una excepción cómoda**: nadie
   * de un padrón de afuera llegó por un anuncio, así que dejarlo prendido
   * descartaría el 100 % de la lista. Que el filtro no corra es justamente lo
   * que hace que esa campaña sea fría — y por eso el encabezado lo dice con
   * todas las letras en vez de callarlo.
   */
  const soloDeAnuncio = !LISTA && !bandera("todos");

  /**
   * EL PÚBLICO y LOS ELEGIBLES los decide `campana/publico.ts`, puro y con tests.
   *
   * Se separan a propósito: la ASIGNACIÓN va sobre el público —incluidos los que
   * ya recibieron el mensaje en una corrida anterior—, porque la conversación es
   * suya igual. Dejarlos sin dueño porque el envío llegó primero es al revés de
   * lo que hace falta cuando contesten.
   */
  const seleccion = elegirPublico(
    todos.map((d) => ({
      telefono: d.telefono,
      mensajes: d.mensajes,
      anuncio: d.anuncio,
      yaLeLlego: d.yaLeLlego,
      yaCompro: d.yaCompro,
    })),
    {
      soloDeAnuncio,
      /**
       * ⚠️ EN EL MODO LISTA, HABER COMPRADO NO DESCALIFICA — Y ES AL REVÉS DE
       * LA CAMPAÑA ANTERIOR A PROPÓSITO.
       *
       * Allá el descarte era correcto: la 3x1 vendía cursos y mandársela a
       * alguien que ya los compró es ofrecerle lo que ya tiene. Acá el producto
       * es OTRO —una entrada a un foro presencial— y quien ya hizo un curso con
       * nosotros es **mejor** candidato, no peor.
       *
       * Lo que sí protege a quien ya tiene su lugar en el Foro es el estado del
       * propio archivo (`Inscrito`/`RESERVADO` → `ya_inscrito`, en
       * `campana/lista.ts`), que es el dato pertinente. `clientes_padron` no
       * sabe nada de este evento: habla de cursos.
       */
      excluirClientes: !LISTA,
      tope: TOPE,
    },
  );
  const porTelefono = new Map(todos.map((d) => [d.telefono, d]));
  // `aAsignar` y NO `publico`: con `--tope` no son lo mismo, y asignar el
  // público entero le pone dueña a gente a la que nunca se le escribió.
  const publico = seleccion.aAsignar.map((c) => porTelefono.get(c.telefono)!);
  const elegibles = seleccion.elegibles.map((c) => porTelefono.get(c.telefono)!);
  const cuenta = contarPorMotivo(seleccion.descartados);

  console.log(`\n═══ CAMPAÑA «${plantilla.nombre}» (idioma ${plantilla.idioma}) ═══`);
  if (deLista) {
    /**
     * EL ENCABEZADO DICE QUE ES EN FRÍO, y no es adorno.
     *
     * Los dos modos imprimen tablas parecidas y el que mira el simulacro tiene
     * que poder distinguirlos de un vistazo: uno es seguimiento a quien
     * escribió, el otro cruza ADR 0015 §37. Si eso hay que deducirlo de los
     * flags de la línea de comandos, tarde o temprano alguien no lo deduce.
     */
    console.log(`línea ${LINEA} · 🧊 CONTACTO EN FRÍO desde ${LISTA}`);
    console.log(`   ${deLista.filasLeidas} filas leídas del archivo`);
  } else {
    console.log(`línea ${LINEA} · leads que escribieron entre ${DESDE} y ${HASTA}`);
  }
  console.log(`${ENVIAR ? "🔴 ENVÍO REAL" : "simulacro (agregá --enviar para mandar)"}\n`);

  const anchos = deLista ? [5, 15, 30, 8, 14, 12] : [4, 15, 16, 7, 10, 8, 40];
  const titulos = deLista
    ? ["#", "teléfono", "nombre", "fila", "¿nos escribió?", "¿ya compró?"]
    : ["#", "teléfono", "escribió", "hace", "ventana", "precio", "anuncio por el que llegó"];

  console.log("─".repeat(124));
  console.log(titulos.map((s, i) => s.padEnd(anchos[i]!)).join(""));
  console.log("─".repeat(124));

  elegibles.forEach((d, i) => {
    if (deLista) {
      /**
       * ⚠️ ACÁ NO SE IMPRIME «ventana ABIERTA/cerrada», y es deliberado.
       *
       * Esa columna contesta «¿le puedo escribir texto libre?», y para quien
       * nunca escribió la respuesta es no, siempre. Mostrarla igual —con la
       * fecha de época que `traerDeLista` pone— la haría decir «cerrada · 500000h»,
       * un dato correcto y sin significado que empuja a leer el resto de la
       * tabla como si fuera lo mismo que la del otro modo. Se muestran los
       * hechos que ACÁ deciden: quién es, de qué fila salió, y si ya tuvimos
       * algo que ver con esta persona.
       */
      console.log(
        [
          String(i + 1).padEnd(anchos[0]!),
          d.telefono.padEnd(anchos[1]!),
          (d.nombre ?? "(sin nombre)").slice(0, 28).padEnd(anchos[2]!),
          String(d.lineaDelArchivo ?? "—").padEnd(anchos[3]!),
          (d.yaNosEscribio ? `sí · ${d.mensajes.length} msj` : "nunca").padEnd(anchos[4]!),
          d.yaCompro ? "sí" : "—",
        ].join(""),
      );
      return;
    }
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

  console.log("─".repeat(124));
  if (deLista) {
    const conocidos = elegibles.filter((d) => d.yaNosEscribio).length;
    console.log(`\nTotal a mandar: ${elegibles.length}   (de ${todos.length} teléfonos legibles del archivo)`);
    console.log(`  · ya nos habían escrito alguna vez: ${conocidos}`);
    console.log(`  · nunca hablaron con este número: ${elegibles.length - conocidos} 🧊`);
    console.log(`  · ya compraron algún curso: ${elegibles.filter((d) => d.yaCompro).length} (no descalifica: el Foro es otro producto)`);
  } else {
    const abiertas = elegibles.filter((d) => horasDesde(d.ultimoSuyo, ahora) < 24).length;
    console.log(`\nTotal a mandar: ${elegibles.length}   (de ${todos.length} que escribieron en esas fechas)`);
    console.log(`  · ventana abierta: ${abiertas} (a estos se les puede escribir texto libre también)`);
    console.log(`  · ventana cerrada: ${elegibles.length - abiertas} (solo alcanzables con esta plantilla)`);
    console.log(`  · con precio ya enviado: ${elegibles.filter((d) => d.yaTienePrecio).length}`);
  }
  /**
   * LOS DESCARTADOS SE IMPRIMEN TODOS, incluso los que dieron cero.
   *
   * Un motivo que desaparece de la lista cuando no agarró a nadie se lee como
   * «ese filtro no existe». Y el que más importa —«ya dijeron que no»— es
   * justamente el que dio 0 en la primera corrida **porque estaba roto**: verlo
   * en 0 al lado de los otros es lo que habría hecho sospechar.
   */
  if (deLista) {
    /**
     * LOS DESCARTES DEL ARCHIVO VAN APARTE DE LOS DE HERMES, y en ese orden.
     *
     * Son dos preguntas distintas y confundirlas es lo que hace ilegible un
     * informe: arriba, «qué traía el archivo que no sirve» (se arregla editando
     * la planilla); abajo, «qué sabe Hermes que el archivo no sabe» (no se
     * arregla, y es lo que justifica el cruce). Un solo montón de números
     * respondería las dos a medias.
     */
    const enArchivo = contarMotivosDeLista(deLista.descartadasDelArchivo);
    console.log(`\nDescartados POR EL ARCHIVO (${deLista.descartadasDelArchivo.length} de ${deLista.filasLeidas} filas):`);
    console.log(`  · ${enArchivo.dijo_que_no} marcados «Desinteresado»`);
    console.log(`  · ${enArchivo.ya_inscrito} ya inscritos o con reserva`);
    console.log(`  · ${enArchivo.sin_telefono} sin teléfono`);
    console.log(`  · ${enArchivo.otro_pais} de otro país`);
    console.log(`  · ${enArchivo.telefono_ilegible} con el teléfono ilegible (no se adivina ninguno)`);
    console.log(`  · ${enArchivo.duplicado} repetidos dentro del archivo`);

    /**
     * Y UNA MUESTRA DE LOS ILEGIBLES, CON EL NÚMERO TAL COMO VENÍA.
     *
     * Un contador dice cuántas filas se perdieron; sólo el crudo dice si el
     * archivo está mal cargado o si el normalizador es demasiado angosto. Sin
     * esto, «412 ilegibles» es indistinguible de un bug nuestro.
     */
    const muestra = deLista.descartadasDelArchivo
      .filter((d) => d.motivo === "telefono_ilegible" || d.motivo === "otro_pais")
      .slice(0, 8);
    if (muestra.length) {
      console.log(`    muestra: ${muestra.map((d) => `fila ${d.linea} «${d.crudo}»`).join(" · ")}`);
    }
  }

  console.log(`\nDescartados POR LO QUE HERMES YA SABE:`);
  console.log(`  · ${cuenta.rechazo} porque ya dijeron que no en una conversación`);
  console.log(`  · ${cuenta.despedida} porque se despidieron`);
  if (!LISTA) console.log(`  · ${cuenta.ya_compro} porque YA compraron`);
  if (soloDeAnuncio) console.log(`  · ${cuenta.sin_anuncio} porque NO llegaron por un anuncio (--todos los incluye)`);
  console.log(`  · ${cuenta.ya_le_llego} porque YA recibieron esta campaña`);
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
  const procedencia = deUnaCampana({ nombre: plantilla.nombre, contenido: contenidoDe(plantilla!) });
  // `id` gana sobre `link`: no depende de que un hosting esté arriba durante los
  // ~90 minutos que dura el reparto.
  const imagen = IMAGEN_ID ? { id: IMAGEN_ID } : IMAGEN ? { link: IMAGEN } : null;
  const componentes = imagen
    ? [{ type: "header", parameters: [{ type: "image", image: imagen }] }]
    : undefined;

  let ok = 0;
  const topeados: string[] = [];
  const retenidos: string[] = [];
  const cancelados: Veredicto[] = [];
  /** Desde cuándo se cuenta «pasó algo mientras esperaba su turno». */
  const autorizadoEn = new Date();

  for (const [i, d] of elegibles.entries()) {
    /**
     * ⚠️ EL VETO SE PREGUNTA ACÁ, NO ALLÁ ARRIBA.
     *
     * `elegirPublico` decidió hace rato. Este lote dura horas, y en ese rato la
     * persona puede haber contestado, haberse despedido o haber dicho que no.
     * Su lugar en la fila se decidió antes de que hablara: sin esta pregunta,
     * alguien que escribe «sacame de esta lista» a las 15:00 recibe el flyer a
     * las 17:30. La regla vive pura en `campana/vetoAlSalir.ts`.
     */
    const estado = await estadoAlSalir(d.telefono, autorizadoEn, plantilla.nombre);
    const veredicto = vetoAlSalir(estado);
    if (!veredicto.sale) {
      cancelados.push(veredicto);
      console.log(`[${i + 1}/${elegibles.length}] ⊘ ${d.telefono} — cancelado: ${veredicto.motivo}`);
      continue;
    }

    const r = await enviarPlantillaYProyectar({
      vendedoraId: "campana",
      numeroPropio: LINEA!,
      telefono: d.telefono,
      /**
       * LA REFERENCIA ES LA CLAVE DE LA CONVERSACIÓN, no una sintética.
       *
       * Decía `campana:<pieza>:<telefono>`, y eso dejó los 88 envíos INVISIBLES
       * para el lazo de resultados: `consultarResultados.ts` filtra por
       * `referencia LIKE 'conv:%'`, así que la procedencia se estampó perfecta
       * y no la ve nadie. Además partía cada conversación en dos y el join
       * contra `conversacion_asignada` daba cero filas en silencio.
       */
      referencia: `conv:whatsapp:${d.telefono}:${LINEA}`,
      automatico: true,
      procedencia,
      plantilla: {
        nombre: plantilla.nombre,
        idioma: plantilla.idioma,
        componentes,
        cuerpoRenderizado: plantilla.cuerpo,
      },
    });

    if (r.ok) {
      ok++;
      /**
       * ⚠️ META LO ACEPTÓ, ¿PERO LO MANDÓ?
       *
       * `held_for_quality_assessment` es el PACING: con una plantilla nueva
       * (o despausada, o sin calidad GREEN) Meta retiene parte de los mensajes
       * para juntar feedback, y **si las señales son malas descarta los que
       * siguen**. Sin este renglón, «salieron 1000» puede querer decir «Meta
       * aceptó 1000 POSTs y soltó 200», sin un solo error que lo delate.
       */
      if (r.retenidoPorCalidad) retenidos.push(d.telefono);
      console.log(
        `[${i + 1}/${elegibles.length}] ${r.retenidoPorCalidad ? "⏳" : "✅"} ${d.telefono}` +
          (r.retenidoPorCalidad ? "  — RETENIDO por Meta (pacing)" : ""),
      );
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

  /**
   * EL RESUMEN DICE LO CANCELADO CON SU MOTIVO.
   *
   * Sin este renglón, «salieron 46 de 75» se lee como que fallaron 29 — y lo
   * que pasó es que a 29 personas se decidió, con criterio, no escribirles.
   * Son cosas distintas y la diferencia es la que defiende el envío.
   */
  const porMotivo = contarCancelaciones(cancelados);
  console.log(
    `\n─── salieron ${ok} · topeados por Meta ${topeados.length} · cancelados al salir ${cancelados.length} ───`,
  );
  if (retenidos.length) {
    console.log(
      `\n⏳ META RETUVO ${retenidos.length} de ${ok} por PACING.\n` +
        `   No es un error: es Meta juntando feedback antes de soltar el resto.\n` +
        `   Pasa con plantillas nuevas o sin calidad GREEN. Si la proporción es alta,\n` +
        `   PARÁ y esperá — si las señales salen mal, los siguientes se descartan.\n`,
    );
  }
  if (cancelados.length) {
    for (const [motivo, n] of Object.entries(porMotivo)) {
      if (n > 0) console.log(`      ⊘ ${n} — ${motivo}`);
    }
  }
  console.log("");
  process.exit(0);
}

void main();
