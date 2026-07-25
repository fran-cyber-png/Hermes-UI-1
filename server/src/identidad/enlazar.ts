import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import {
  canalDeTipo,
  claveDeIdentidad,
  identidadDeClave,
  tipoDeCanal,
  type CanalConversacion,
  type IdentidadCanal,
  type TipoIdentidadCanal,
} from "./clave.js";
import { decidirEnlace, type LadoDelEnlace } from "./decidir.js";

/**
 * Lo mínimo que estas funciones necesitan de la base: poder ejecutar SQL. Con eso, la MISMA
 * función sirve al singleton, a la base de un test y a una transacción — sin castear nada.
 */
type Ejecutor = Pick<typeof db, "execute">;

/**
 * ENLAZAR DOS CONTACTOS — el lado que toca la base (issue #58, ADR 0017).
 *
 * La decisión de qué significa enlazar vive aparte y sin base (`decidir.ts`); acá está lo
 * que hay que ESCRIBIR para que esa decisión ocurra, y lo que hay que LEER para mostrarla.
 *
 * Todo lo que se escribe es `ontologia.vinculos_identidad` con `regla:'manual'` y
 * `actor:'operador:<vendedoraId>'`, que es exactamente para lo que la tabla fue diseñada
 * (`db/ontologia.ts:126-169`). Deshacer NUNCA borra: revoca (`revocado_at`), y el índice
 * parcial `vinculos_identidad_activo_uq` se encarga de que la arista revocada deje de contar
 * sin dejar de existir. Es la única tabla de identidad del mercado que puede des-fusionar;
 * este módulo es el primer lugar de Hermes que usa esa propiedad.
 *
 * Recibe `db` INYECTADO (ADR 0008): la ruta le pasa el singleton, el test su base aislada.
 */

export type ResultadoEnlace =
  | { ok: true; personaId: number; yaEstaban: boolean }
  | {
      ok: false;
      motivo:
        | "clave_no_enlazable"
        | "misma_identidad"
        | "demasiadas_identidades"
        | "identidad_bloqueada"
        | "conflicto";
    };

/** Un contacto del grupo unificado, con su origen a la vista. */
export type ContactoEnlazado = {
  /** «tipo:valor» — la identidad de canal. */
  identidad: string;
  canal: CanalConversacion;
  /** El `persona_id` del CRM: el teléfono en WhatsApp, el id de Meta en IG/Facebook. */
  personaId: string;
  nombre: string | null;
  /** Las claves concretas del CRM (una por número propio de Goberna por el que escribió). */
  claves: string[];
  mensajes: number;
  ultimoAt: string | null;
  /** Cuándo y quién afirmó que es la misma persona. Un enlace sin firma no es reversible. */
  enlazadoAt: string;
  enlazadoPor: string;
};

export type GrupoDeClave = {
  clave: string;
  /** `null` cuando la clave no identifica a nadie de forma estable (comentario suelto). */
  identidad: string | null;
  /** La persona canónica del grupo, o `null` si esta clave nunca se enlazó. */
  personaId: number | null;
  /** Los OTROS contactos del grupo. Vacío = esta ficha no está unificada con ninguna. */
  enlazados: ContactoEnlazado[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas
// ─────────────────────────────────────────────────────────────────────────────

/** Los tipos de identidad que fabrica el CRM. El poblador nunca produce ninguno. */
const TIPOS_DE_CANAL = ["wa_id", "ig_user", "psid"] as const;

async function estadoDeIdentidad(base: Ejecutor, ident: IdentidadCanal): Promise<LadoDelEnlace> {
  const filas = await base.execute<{ id: number; clave_raiz: string | null; n: string }>(sql`
    SELECT p.id,
           p.clave_raiz,
           (SELECT count(*) FROM ontologia.vinculos_identidad v2
              WHERE v2.persona_id = p.id AND v2.revocado_at IS NULL) AS n
    FROM ontologia.identidades i
    JOIN ontologia.vinculos_identidad v ON v.identidad_id = i.id AND v.revocado_at IS NULL
    JOIN ontologia.personas p ON p.id = v.persona_id
    WHERE i.tipo = ${ident.tipo} AND i.valor = ${ident.valor}
  `);

  const fila = filas[0];
  return {
    claveIdentidad: claveDeIdentidad(ident),
    persona: fila ? { id: Number(fila.id), claveRaiz: fila.clave_raiz ?? "" } : null,
    identidadesActivas: fila ? Number(fila.n) : 0,
  };
}

/** ¿Esta identidad está vetada? `identidades_bloqueadas` es un arma, no un adorno. */
async function estaBloqueada(base: Ejecutor, ident: IdentidadCanal): Promise<boolean> {
  const filas = await base.execute<{ tipo: string }>(sql`
    SELECT tipo FROM ontologia.identidades_bloqueadas
    WHERE tipo = ${ident.tipo} AND valor = ${ident.valor}
  `);
  return filas.length > 0;
}

/**
 * Las conversaciones REALES de un puñado de identidades de canal.
 *
 * La identidad no guarda el número propio de Goberna a propósito (ver `clave.ts`), así que
 * las claves concretas se reconstruyen desde `interactions` con la MISMA expresión que usan
 * la cola, el radar y el dashboard. Escribirla distinto acá sería la divergencia silenciosa
 * de #37 otra vez, con otro nombre.
 */
async function conversacionesDeIdentidades(
  base: Ejecutor,
  idents: IdentidadCanal[],
): Promise<Map<string, { claves: string[]; nombre: string | null; mensajes: number; ultimoAt: string | null }>> {
  const mapa = new Map<string, { claves: string[]; nombre: string | null; mensajes: number; ultimoAt: string | null }>();
  if (idents.length === 0) return mapa;

  const pares = sql.join(
    idents.map((i) => sql`(${canalDeTipo(i.tipo)}, ${i.valor})`),
    sql`, `,
  );

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
    WHERE (i.canal, i.persona_id) IN (${pares})
    GROUP BY 1, 2, 3
  `);

  for (const f of filas) {
    const tipo = tipoDeCanal(f.canal);
    if (!tipo) continue;
    const clave = `${tipo}:${f.persona_id}`;
    const acc = mapa.get(clave) ?? { claves: [], nombre: null, mensajes: 0, ultimoAt: null };
    acc.claves.push(f.clave);
    acc.mensajes += Number(f.mensajes);
    acc.nombre = acc.nombre ?? f.nombre;
    const iso = f.ultimo_at ? new Date(f.ultimo_at).toISOString() : null;
    if (iso && (!acc.ultimoAt || iso > acc.ultimoAt)) acc.ultimoAt = iso;
    mapa.set(clave, acc);
  }
  return mapa;
}

/**
 * El grupo unificado al que pertenece una clave del CRM.
 *
 * NO crea nada: leer una ficha jamás escribe en el grafo. Una clave que nunca se enlazó
 * devuelve `personaId: null` y `enlazados: []` — que es la verdad, no un estado degradado.
 */
export async function grupoDeClave(base: typeof db, clave: string): Promise<GrupoDeClave> {
  const ident = identidadDeClave(clave);
  if (!ident) return { clave, identidad: null, personaId: null, enlazados: [] };

  const estado = await estadoDeIdentidad(base, ident);
  if (!estado.persona) {
    return { clave, identidad: claveDeIdentidad(ident), personaId: null, enlazados: [] };
  }

  const aristas = await base.execute<{
    tipo: string;
    valor: string;
    creado_at: string | Date;
    actor: string;
  }>(sql`
    SELECT i.tipo, i.valor, v.creado_at, v.actor
    FROM ontologia.vinculos_identidad v
    JOIN ontologia.identidades i ON i.id = v.identidad_id
    WHERE v.persona_id = ${estado.persona.id}
      AND v.revocado_at IS NULL
      AND i.tipo IN (${sql.join(TIPOS_DE_CANAL.map((t) => sql`${t}`), sql`, `)})
    ORDER BY v.creado_at ASC
  `);

  const otras = aristas
    .map((a) => ({ ...a, tipo: a.tipo as TipoIdentidadCanal }))
    .filter((a) => !(a.tipo === ident.tipo && a.valor === ident.valor));

  const convs = await conversacionesDeIdentidades(
    base,
    otras.map((a) => ({ tipo: a.tipo, valor: a.valor })),
  );

  const enlazados: ContactoEnlazado[] = otras.map((a) => {
    const k = `${a.tipo}:${a.valor}`;
    const c = convs.get(k);
    return {
      identidad: k,
      canal: canalDeTipo(a.tipo),
      personaId: a.valor,
      nombre: c?.nombre ?? null,
      claves: c?.claves ?? [],
      mensajes: c?.mensajes ?? 0,
      ultimoAt: c?.ultimoAt ?? null,
      enlazadoAt: new Date(a.creado_at).toISOString(),
      enlazadoPor: a.actor,
    };
  });

  return { clave, identidad: claveDeIdentidad(ident), personaId: estado.persona.id, enlazados };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrituras
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La identidad, creada si no existía. Débil SIEMPRE: un id de canal no fusiona a nadie por
 * sí solo (la regla FUERTE/DÉBIL de `db/ontologia.ts:99-110`). Lo que fusiona acá es la
 * afirmación de una persona, y esa queda firmada en el vínculo, no en la identidad.
 */
async function identidadId(base: Ejecutor, ident: IdentidadCanal): Promise<number> {
  const filas = await base.execute<{ id: number }>(sql`
    WITH nueva AS (
      INSERT INTO ontologia.identidades (tipo, valor, fuerza)
      VALUES (${ident.tipo}, ${ident.valor}, 'debil')
      ON CONFLICT (tipo, valor) DO NOTHING
      RETURNING id
    )
    SELECT id FROM nueva
    UNION ALL
    SELECT id FROM ontologia.identidades WHERE tipo = ${ident.tipo} AND valor = ${ident.valor}
    LIMIT 1
  `);
  return Number(filas[0].id);
}

const ES_CONFLICTO = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

/**
 * «Es la misma persona que…» — el enlace manual.
 *
 * Idempotente: enlazar dos veces lo mismo devuelve `yaEstaban: true` sin escribir. Simétrico
 * por construcción: las dos identidades quedan colgadas de la misma persona, no hay un lado
 * «dueño». Y auditado: cada arista dice qué claves lo justificaron y qué vendedora lo firmó.
 */
export async function enlazarClaves(
  base: typeof db,
  entrada: { claveA: string; claveB: string; vendedoraId: string },
): Promise<ResultadoEnlace> {
  const identA = identidadDeClave(entrada.claveA);
  const identB = identidadDeClave(entrada.claveB);
  if (!identA || !identB) return { ok: false, motivo: "clave_no_enlazable" };

  if ((await estaBloqueada(base, identA)) || (await estaBloqueada(base, identB)))
    return { ok: false, motivo: "identidad_bloqueada" };

  const [ladoA, ladoB] = await Promise.all([
    estadoDeIdentidad(base, identA),
    estadoDeIdentidad(base, identB),
  ]);

  const decision = decidirEnlace(ladoA, ladoB);
  if (decision.accion === "rechazar") return { ok: false, motivo: decision.motivo };
  if (decision.accion === "ya_enlazadas")
    return { ok: true, personaId: decision.persona, yaEstaban: true };

  const actor = `operador:${entrada.vendedoraId}`;
  const evidencia = JSON.stringify({
    claves: [entrada.claveA, entrada.claveB],
    identidades: [ladoA.claveIdentidad, ladoB.claveIdentidad],
  });

  try {
    return await base.transaction(async (tx) => {
      const idA = await identidadId(tx, identA);
      const idB = await identidadId(tx, identB);

      if (decision.accion === "crear") {
        const [p] = await tx.execute<{ id: number }>(sql`
          INSERT INTO ontologia.personas (clave_raiz, nombre_display)
          VALUES (${decision.claveRaiz}, NULL)
          ON CONFLICT (clave_raiz) DO UPDATE SET clave_raiz = EXCLUDED.clave_raiz
          RETURNING id
        `);
        const personaId = Number(p.id);
        await tx.execute(sql`
          INSERT INTO ontologia.vinculos_identidad (identidad_id, persona_id, regla, evidencia, actor, confianza)
          VALUES (${idA}, ${personaId}, 'manual', ${evidencia}::jsonb, ${actor}, 'alta'),
                 (${idB}, ${personaId}, 'manual', ${evidencia}::jsonb, ${actor}, 'alta')
        `);
        return { ok: true as const, personaId, yaEstaban: false };
      }

      if (decision.accion === "sumar") {
        const idNuevo = decision.lado === "a" ? idA : idB;
        await tx.execute(sql`
          INSERT INTO ontologia.vinculos_identidad (identidad_id, persona_id, regla, evidencia, actor, confianza)
          VALUES (${idNuevo}, ${decision.persona}, 'manual', ${evidencia}::jsonb, ${actor}, 'alta')
        `);
        return { ok: true as const, personaId: decision.persona, yaEstaban: false };
      }

      // Fusionar: las identidades del grupo perdedor se MUDAN. La arista vieja se revoca —
      // queda el rastro de que estuvo ahí— y nace una nueva hacia el destino. Las que se
      // mudan son EXACTAMENTE las que devolvió el UPDATE, no las que un WHERE vuelva a
      // adivinar después: adivinarlas arrastraría fusiones viejas de la misma persona.
      const movidas = await tx.execute<{ identidad_id: number }>(sql`
        UPDATE ontologia.vinculos_identidad
        SET revocado_at = now(), revocado_por = ${actor}, revocado_motivo = 'fusion'
        WHERE persona_id = ${decision.origen} AND revocado_at IS NULL
        RETURNING identidad_id
      `);
      if (movidas.length > 0) {
        const nuevas = sql.join(
          movidas.map(
            (m) => sql`(${Number(m.identidad_id)}, ${decision.destino}, 'manual', ${evidencia}::jsonb, ${actor}, 'alta')`,
          ),
          sql`, `,
        );
        await tx.execute(sql`
          INSERT INTO ontologia.vinculos_identidad (identidad_id, persona_id, regla, evidencia, actor, confianza)
          VALUES ${nuevas}
        `);
      }
      return { ok: true as const, personaId: decision.destino, yaEstaban: false };
    });
  } catch (err) {
    // Dos vendedoras enlazando la misma ficha en el mismo instante: el índice activo lo
    // frena. No es un error del que haya que esconderse — es la garantía funcionando.
    if (ES_CONFLICTO(err)) return { ok: false, motivo: "conflicto" };
    throw err;
  }
}

/**
 * DESHACER — sacar un contacto del grupo unificado.
 *
 * No borra: revoca. La arista queda con `revocado_at` / `revocado_por` / `revocado_motivo`,
 * así que «quién enlazó mal a quién y cuándo se deshizo» sigue siendo contestable meses
 * después. Solo toca aristas `regla='manual'`: lo que derivó el sistema no se revoca desde
 * la ficha de una vendedora.
 */
export async function revocarEnlace(
  base: typeof db,
  entrada: { clave: string; vendedoraId: string; motivo?: string },
): Promise<{ ok: true; revocadas: number } | { ok: false; motivo: "clave_no_enlazable" }> {
  const ident = identidadDeClave(entrada.clave);
  if (!ident) return { ok: false, motivo: "clave_no_enlazable" };

  const filas = await base.execute<{ id: number }>(sql`
    UPDATE ontologia.vinculos_identidad v
    SET revocado_at = now(),
        revocado_por = ${`operador:${entrada.vendedoraId}`},
        revocado_motivo = ${entrada.motivo ?? "la vendedora deshizo el enlace"}
    FROM ontologia.identidades i
    WHERE i.id = v.identidad_id
      AND i.tipo = ${ident.tipo} AND i.valor = ${ident.valor}
      AND v.revocado_at IS NULL
      AND v.regla = 'manual'
    RETURNING v.id
  `);

  return { ok: true, revocadas: filas.length };
}
