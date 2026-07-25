import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { cursoDeLeadSql, sufijoTelefonoSql } from "../gente/leadDeTelefono.js";
import type { AliasCurso } from "./alias.js";
import { derivarInteres, type CandidatoCurso, type InteresDerivado } from "./derivar.js";
import { aliasesActivos } from "./repositorio.js";

/**
 * EL SEAM DEL INTERÉS DERIVADO — dónde la derivación pura se encuentra con la base.
 *
 * Junta, para un puñado de conversaciones, los DOS textos que pueden nombrar un
 * curso, y le pasa la decisión a `derivarInteres` (puro). No escribe nada: esto
 * es una consulta, y el asiento en `intereses` solo lo hace un clic humano
 * (`confirmar.ts`).
 *
 * ── DE DÓNDE SALE CADA CANDIDATO ────────────────────────────────────────────
 *
 * · **el anuncio** — `events.payload->'origen'`, el referral de Click-to-WhatsApp
 *   que `whatsapp/origen.ts` capturó en el primer mensaje. Se toma el **PRIMERO**
 *   de la conversación, que es exactamente el que la app le muestra a la
 *   vendedora en el banner «Vino del anuncio…» (`routes/whatsapp.ts`): la
 *   propuesta no puede contradecir lo que está en pantalla.
 *   ⚠️ Se usa `titulo` (el que viaja EN el mensaje). El nombre de la campaña que
 *   se ve en el banner NO está en la base: sale de una llamada viva a la Graph
 *   API (`meta/anuncio.ts`) al abrir la conversación, y una consulta de listado
 *   no puede depender de Meta.
 * · **el formulario** — `leads.campaign_name`/`form_name` de la persona,
 *   emparejado por teléfono. No se reescribe acá NADA de eso: la llave
 *   (`sufijoTelefonoSql`) y qué curso dice un lead (`cursoDeLeadSql`) vienen de
 *   `gente/leadDeTelefono.ts`, su único hogar — el mismo del que ya comen la cola
 *   (#72) y el Dashboard (#128). Dos escrituras de la misma regla es la
 *   divergencia silenciosa de #37, otra vez.
 *
 * Solo WhatsApp cruza contra `leads`: en Messenger el `persona_id` es un PSID,
 * y sus últimos 9 dígitos podrían chocar con los de un teléfono real — sería
 * proponerle a alguien el curso de OTRA persona.
 */

/** El tope del lote. La ficha pide una clave; la cola, una pantalla. Más que esto es un reporte. */
const MAX_CLAVES = 200;

/** `conv:<canal>:<personaId>:<numeroPropio>` — las partes que la consulta necesita. */
function partirClave(clave: string): { canal: string; personaId: string } | null {
  const m = /^conv:([^:]+):([^:]*):/.exec(clave);
  return m && m[2] ? { canal: m[1], personaId: m[2] } : null;
}

interface FilaCandidatos {
  clave: string;
  titulo_anuncio: string | null;
  curso_lead: string | null;
}

/**
 * Los textos candidatos por conversación, **en orden de precedencia** (el
 * formulario antes que el anuncio — ver `derivar.ts`).
 *
 * El filtro entra por `(canal, persona_id)`, que es el índice
 * `interactions_persona_idx`: filtrar directo por la clave concatenada obligaría
 * a escanear `interactions` entera para poder compararla.
 */
export async function candidatosPorClave(
  base: typeof db,
  claves: readonly string[],
): Promise<Record<string, CandidatoCurso[]>> {
  const partes = claves.map((c) => ({ clave: c, p: partirClave(c) })).filter((x) => x.p !== null);
  if (partes.length === 0) return {};

  const pares = sql.join(
    partes.map((x) => sql`(${x.p!.canal}, ${x.p!.personaId})`),
    sql`, `,
  );
  const lista = sql.join(
    partes.map((x) => sql`${x.clave}`),
    sql`, `,
  );

  const filas = (await base.execute(sql`
    WITH msg AS (
      SELECT 'conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '') AS clave,
             i.canal, i.persona_id, i.occurred_at,
             e.payload->'origen' AS origen
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje' AND (i.canal, i.persona_id) IN (${pares})
    ),
    mio AS (
      SELECT * FROM msg WHERE clave IN (${lista})
    ),
    -- El PRIMER anuncio de la conversación: el mismo que muestra el banner.
    anuncio AS (
      SELECT DISTINCT ON (clave) clave, btrim(origen->>'titulo') AS titulo
      FROM mio
      WHERE origen->>'fuente' = 'anuncio' AND NULLIF(btrim(origen->>'titulo'), '') IS NOT NULL
      ORDER BY clave, occurred_at ASC
    ),
    personas AS (
      SELECT DISTINCT clave, (${sufijoTelefonoSql("persona_id")}) AS sufijo
      FROM mio
      WHERE canal = 'whatsapp' AND persona_id IS NOT NULL
    ),
    -- El lead MÁS RECIENTE con curso: lo viejo no manda sobre lo nuevo (mismo
    -- desempate que el chip de la cola, cola/cursoSql.ts).
    lead_curso AS (
      SELECT DISTINCT ON (p.clave) p.clave, (${cursoDeLeadSql}) AS curso
      FROM personas p
      JOIN leads l ON (${sufijoTelefonoSql("l.phone")}) = p.sufijo
      WHERE (${cursoDeLeadSql}) IS NOT NULL AND (${cursoDeLeadSql}) <> ''
      ORDER BY p.clave, l.created_time DESC
    )
    SELECT c.clave,
           a.titulo AS titulo_anuncio,
           lc.curso AS curso_lead
    FROM (SELECT DISTINCT clave FROM mio) c
    LEFT JOIN anuncio a ON a.clave = c.clave
    LEFT JOIN lead_curso lc ON lc.clave = c.clave
  `)) as unknown as FilaCandidatos[];

  const salida: Record<string, CandidatoCurso[]> = {};
  for (const f of filas) {
    const candidatos: CandidatoCurso[] = [];
    if (f.curso_lead) candidatos.push({ fuente: "lead", texto: f.curso_lead });
    if (f.titulo_anuncio) candidatos.push({ fuente: "anuncio", texto: f.titulo_anuncio });
    if (candidatos.length) salida[f.clave] = candidatos;
  }
  return salida;
}

/**
 * La propuesta de cada conversación que NO tiene interés asentado. Devuelve solo
 * las claves con algo que proponer: una entrada ausente significa «nada que
 * decir», y la UI no dibuja nada.
 *
 * `registradosPorClave` lo pasa quien ya los tiene a mano (`consultarIntereses`),
 * para no consultar `intereses` dos veces en el mismo request.
 */
export async function consultarInteresesDerivados(
  base: typeof db,
  v: {
    claves: readonly string[];
    registradosPorClave: Record<string, string[]>;
    /** Los alias a usar. Por defecto, los activos de la tabla. */
    aliases?: readonly AliasCurso[];
  },
): Promise<Record<string, InteresDerivado>> {
  // Solo las conversaciones sin interés asentado necesitan propuesta: lo
  // registrado manda (`derivar.ts`), así que ni se consultan sus candidatos.
  const pendientes = [...new Set(v.claves)]
    .filter((c) => c.startsWith("conv:") && !(v.registradosPorClave[c]?.length > 0))
    .slice(0, MAX_CLAVES);
  if (pendientes.length === 0) return {};

  const aliases = v.aliases ?? (await aliasesActivos(base));
  const candidatos = await candidatosPorClave(base, pendientes);

  const salida: Record<string, InteresDerivado> = {};
  for (const clave of pendientes) {
    const d = derivarInteres({
      registrados: [],
      candidatos: candidatos[clave] ?? [],
      aliases,
    });
    if (d) salida[clave] = d;
  }
  return salida;
}
