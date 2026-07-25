import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { grupoDeClave, type ContactoEnlazado } from "./enlazar.js";

/**
 * EL 360 UNIFICADO — la ficha de una persona que escribió desde varios lados.
 *
 * Lo que se unifica es la FICHA, y solo la ficha (decisión del dueño, issue #58): los hilos
 * siguen por canal, la cola no cambia, la clave `conv:<canal>:<persona>:<numeroPropio>` no se
 * toca. Acá se junta lo que cuelga de ESAS claves —intereses y gestiones— para los contactos
 * que una vendedora afirmó que son la misma persona.
 *
 * **Cada dato viaja con su origen.** No se mezcla en un total anónimo: el bloque dice «de
 * +51 987… (WhatsApp)» al lado de cada cosa. Unificar sin decir de dónde salió cada dato es
 * cómo se fabrica un Frankenstein que nadie puede auditar después.
 *
 * Lo que NO agrega acá: las compras de Cerberus. Esas ya las sabe pedir la ficha por teléfono
 * (`/api/contactos/ficha`), una por origen, y duplicar ese camino sería una segunda fuente de
 * verdad sobre la misma pregunta.
 */

export type OrigenUnificado = ContactoEnlazado & {
  /** Los cursos que pidió por ESE canal (#57). */
  intereses: string[];
  /** Cuántas gestiones se asentaron por ESE canal, y en qué etapa quedó. */
  gestiones: number;
  ultimaEtapa: string | null;
};

export type Unificado = {
  clave: string;
  personaId: number | null;
  /** Los OTROS contactos del grupo. Vacío = esta ficha no está unificada con nadie. */
  origenes: OrigenUnificado[];
};

export async function resumenUnificado(base: typeof db, clave: string): Promise<Unificado> {
  const grupo = await grupoDeClave(base, clave);
  if (grupo.enlazados.length === 0) {
    return { clave, personaId: grupo.personaId, origenes: [] };
  }

  const claves = grupo.enlazados.flatMap((e) => e.claves);
  if (claves.length === 0) {
    // Enlazada pero sin conversación reconstruible: se muestra igual, vacía y honesta.
    return {
      clave,
      personaId: grupo.personaId,
      origenes: grupo.enlazados.map((e) => ({ ...e, intereses: [], gestiones: 0, ultimaEtapa: null })),
    };
  }

  const lista = sql.join(
    claves.map((c) => sql`${c}`),
    sql`, `,
  );

  const [intereses, gestiones] = await Promise.all([
    base.execute<{ clave: string; curso: string }>(sql`
      SELECT clave, curso FROM intereses WHERE clave IN (${lista}) ORDER BY creado_at DESC
    `),
    base.execute<{ clave: string; n: number; etapa: string | null }>(sql`
      SELECT clave,
             count(*)::int AS n,
             (array_agg(etapa ORDER BY creado_at DESC))[1] AS etapa
      FROM gestiones WHERE clave IN (${lista}) GROUP BY clave
    `),
  ]);

  const cursosPorClave = new Map<string, string[]>();
  for (const i of intereses) {
    const acc = cursosPorClave.get(i.clave) ?? [];
    acc.push(i.curso);
    cursosPorClave.set(i.clave, acc);
  }

  const gestionesPorClave = new Map(gestiones.map((g) => [g.clave, g]));

  const origenes: OrigenUnificado[] = grupo.enlazados.map((e) => {
    const cursos = new Set<string>();
    let n = 0;
    let etapa: string | null = null;
    for (const c of e.claves) {
      for (const curso of cursosPorClave.get(c) ?? []) cursos.add(curso);
      const g = gestionesPorClave.get(c);
      if (g) {
        n += Number(g.n);
        etapa = etapa ?? g.etapa;
      }
    }
    return { ...e, intereses: [...cursos], gestiones: n, ultimaEtapa: etapa };
  });

  return { clave, personaId: grupo.personaId, origenes };
}

/**
 * EL BUSCADOR DE CONTACTOS del «Es la misma persona que…».
 *
 * Busca sobre las conversaciones que la vendedora ya ve —no sobre el grafo de identidad, que
 * hoy está vacío— por nombre o por teléfono. El teléfono se compara por dígitos: quien escribe
 * «986 394» tiene que encontrar al 51986394450.
 *
 * Devuelve la CLAVE de cada resultado, que es lo único con lo que se puede enlazar.
 */
export type ContactoBuscado = {
  clave: string;
  canal: string;
  personaId: string;
  nombre: string | null;
  ultimoAt: string | null;
  mensajes: number;
};

export async function buscarContactos(
  base: typeof db,
  q: string,
  limite = 12,
): Promise<ContactoBuscado[]> {
  const termino = q.trim().toLowerCase();
  if (termino.length < 2) return [];

  const digitos = termino.replace(/\D/g, "");
  // Sin dígitos suficientes no se busca por número: `%1%` traería a media base.
  const porNumero = digitos.length >= 3 ? `%${digitos}%` : null;
  const porNombre = `%${termino}%`;

  const filas = await base.execute<{
    canal: string;
    persona_id: string;
    clave: string;
    mensajes: number;
    ultimo_at: string | Date | null;
    nombre: string | null;
  }>(sql`
    SELECT i.canal,
           i.persona_id,
           'conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '') AS clave,
           count(*)::int AS mensajes,
           max(i.occurred_at) AS ultimo_at,
           (array_agg(i.persona_nombre ORDER BY i.occurred_at DESC)
              FILTER (WHERE i.persona_nombre IS NOT NULL))[1] AS nombre
    FROM interactions i
    JOIN events e ON e.id = i.event_id
    WHERE i.persona_id IS NOT NULL
      AND i.canal IN ('whatsapp', 'instagram', 'facebook')
      AND (
        lower(coalesce(i.persona_nombre, '')) LIKE ${porNombre}
        ${porNumero ? sql`OR regexp_replace(i.persona_id, '[^0-9]', '', 'g') LIKE ${porNumero}` : sql``}
      )
    GROUP BY 1, 2, 3
    ORDER BY max(i.occurred_at) DESC
    LIMIT ${limite}
  `);

  return filas.map((f) => ({
    clave: f.clave,
    canal: f.canal,
    personaId: f.persona_id,
    nombre: f.nombre,
    ultimoAt: f.ultimo_at ? new Date(f.ultimo_at).toISOString() : null,
    mensajes: Number(f.mensajes),
  }));
}
