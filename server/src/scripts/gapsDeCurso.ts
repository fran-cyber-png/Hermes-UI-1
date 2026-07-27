import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { cursoDeLeadSql } from "../gente/leadDeTelefono.js";
import { familiaDeAnuncio, familiaDeTexto } from "../cursos/alias.js";
import { aliasesActivos } from "../cursos/repositorio.js";

/**
 * LOS GAPS DE ATRIBUCIÓN, DICHOS EN VOZ ALTA — «definir bien flyer + campaña a
 * qué cursos van para que no tengamos gaps» (dueño, 2026-07-26).
 *
 * ```
 * cd server && npm run cursos:gaps            # anuncios y campañas sin familia
 * cd server && npm run cursos:gaps -- --todo  # también los que YA están mapeados
 * ```
 *
 * Es de SOLO LECTURA: no escribe una fila. Lo que imprime es el pedido de trabajo
 * — por dónde llega gente y qué curso no sabemos decirle. La respuesta se carga
 * en `alias_curso` (editable sin deploy) o en `ALIAS_SEMILLA` si es permanente.
 *
 * Los anuncios salen con su **adId**, que es lo único que identifica a los
 * genéricos: «Adquiérelo ahora» y «No lo dejes pasar» no nombran ningún curso, y
 * mapearlos por texto le heredaría el curso equivocado al próximo anuncio que
 * reuse ese copy. Para esos, la fila de `alias_curso` va con `ad_id`.
 */

const verTodo = process.argv.includes("--todo");
const dias = Number(process.argv[process.argv.indexOf("--dias") + 1]) || 90;

interface FilaAnuncio {
  ad_id: string | null;
  titulo: string | null;
  personas: string | number;
}

interface FilaCampana {
  campana: string;
  leads: string | number;
}

function pintar(
  titulo: string,
  filas: { etiqueta: string; extra: string; volumen: number; familia: string | null }[],
): void {
  const sinMapear = filas.filter((f) => f.familia === null);
  const mostrar = verTodo ? filas : sinMapear;

  console.log(`\n══ ${titulo} ═══════════════════════════════════════════════`);
  console.log(
    `${filas.length} distintos · ${sinMapear.length} sin familia · ` +
      `${sinMapear.reduce((n, f) => n + f.volumen, 0)} personas sin atribuir\n`,
  );
  if (mostrar.length === 0) {
    console.log("   (nada que reportar)\n");
    return;
  }
  for (const f of mostrar) {
    const marca = f.familia ? `→ ${f.familia}` : "→ SIN FAMILIA";
    console.log(`   ${String(f.volumen).padStart(6)}  ${marca.padEnd(16)} ${f.etiqueta}${f.extra}`);
  }
  console.log("");
}

async function main() {
  const aliases = await aliasesActivos(db);
  console.log(`\nAlias activos: ${aliases.length} (${aliases.filter((a) => a.adId).length} por anuncio)`);
  console.log(`Ventana: ${dias} días`);

  const anuncios = (await db.execute(sql`
    SELECT e.payload->'origen'->>'adId'   AS ad_id,
           e.payload->'origen'->>'titulo' AS titulo,
           count(DISTINCT i.persona_id)   AS personas
    FROM interactions i
    JOIN events e ON e.id = i.event_id
    WHERE i.tipo = 'mensaje'
      AND e.payload->'origen'->>'fuente' = 'anuncio'
      AND i.occurred_at > now() - (${dias} || ' days')::interval
    GROUP BY 1, 2
    ORDER BY personas DESC
  `)) as unknown as FilaAnuncio[];

  pintar(
    "ANUNCIOS de Click-to-WhatsApp",
    anuncios.map((a) => ({
      etiqueta: a.titulo ?? "(sin título)",
      extra: a.ad_id ? `   [ad_id ${a.ad_id}]` : "   [SIN adId: no se puede mapear por anuncio]",
      volumen: Number(a.personas),
      familia: familiaDeAnuncio(aliases, { adId: a.ad_id, titulo: a.titulo })?.familia ?? null,
    })),
  );

  const campanas = (await db.execute(sql`
    SELECT (${cursoDeLeadSql}) AS campana, count(*) AS leads
    FROM leads
    WHERE (${cursoDeLeadSql}) IS NOT NULL
    GROUP BY 1
    ORDER BY leads DESC
  `)) as unknown as FilaCampana[];

  pintar(
    "CAMPAÑAS de formulario (leads)",
    campanas.map((c) => ({
      etiqueta: c.campana,
      extra: "",
      volumen: Number(c.leads),
      familia: familiaDeTexto(aliases, c.campana)?.familia ?? null,
    })),
  );

  console.log("Para mapear uno: INSERT en `alias_curso` (alias + familia + nombre_curso [+ ad_id]).");
  console.log("Si es permanente, va también en ALIAS_SEMILLA (`cursos/alias.ts`).\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
