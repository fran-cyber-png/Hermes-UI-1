import { and, eq, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { campanaAnuncio, campanaMeta, campanaCable, cursoRuteo } from "../db/routing.js";
import { leerEstado, llegaALaLinea, ordenarCampanas, type CampanaEnRouting } from "./dominio.js";
import { productoLeadSql } from "../dashboard/fuenteLead.js";
import { esTablaAusente } from "../cola/estadoSql.js";
import { aliasesActivos } from "../cursos/repositorio.js";
import { familiaDe } from "./producto.js";

/**
 * LO QUE LEE Y ESCRIBE EL RUTEO. El veredicto vive en `dominio.ts` (puro); acá
 * solo se trae el dato crudo y se guarda lo decidido.
 *
 * ⚠️ **Todo degrada, nunca tumba.** Sin las tablas migradas la pantalla muestra
 * cero campañas y lo DICE (`sinMigracion`), y el webhook sigue repartiendo por
 * la rueda. Es lo contrario del catálogo de piezas (ADR 0023) y por el mismo
 * criterio: acá el consumidor es una persona mirando una pantalla, no un índice
 * que cachea.
 */

/** Cuánto para atrás mira la pantalla. La misma ventana que la cola (`ventanaCola`). */
export const VENTANA_DIAS = 30;

/**
 * LOS ANUNCIOS QUE TRAJERON GENTE, crudos, desde el event store.
 *
 * 🔴 Se agrupa por `source_id` y **nunca por el titular**: el mismo anuncio
 * aparece con titulares distintos cuando le cambian el creativo (medido:
 * `120248616484060016` sale como «Inteligencia Estratégica» y como «I Foro de
 * Estado 2026»). Agrupar por titular partiría una campaña en dos.
 *
 * `meta_wa_ctwa` es el único `source` que trae referral: lo escribe
 * `webhook/whatsapp.ts` justo cuando el mensaje viene de un click-to-WhatsApp.
 */
export interface AnuncioVisto {
  adId: string;
  personas: number;
  ultima: string;
}

export async function anunciosVistos(
  base: typeof Base,
  dias = VENTANA_DIAS,
): Promise<AnuncioVisto[]> {
  const filas = await base.execute<{ ad_id: string; personas: number; ultima: string }>(sql`
    SELECT payload->'referral'->>'source_id'        AS ad_id,
           count(DISTINCT payload->>'from')::int    AS personas,
           max(occurred_at)                         AS ultima
      FROM events
     WHERE source = 'meta_wa_ctwa'
       AND occurred_at > now() - ${`${dias} days`}::interval
       AND NULLIF(btrim(payload->'referral'->>'source_id'), '') IS NOT NULL
     GROUP BY 1
  `);
  return filas.map((f) => ({
    adId: f.ad_id,
    // Se cuentan PERSONAS y no mensajes: quien escribe tres veces por el mismo
    // anuncio es un lead, no tres. Con mensajes, la fila premiaría a la campaña
    // que trae gente insistente en vez de a la que trae gente.
    personas: Number(f.personas ?? 0),
    ultima: new Date(f.ultima).toISOString(),
  }));
}

/** El mapa `ad_id → campaña` que ya resolvimos contra Meta. */
export async function mapaDeAnuncios(base: typeof Base) {
  const filas = await base
    .select({
      adId: campanaAnuncio.adId,
      campanaId: campanaAnuncio.campanaId,
      campanaNombre: campanaAnuncio.campanaNombre,
      estado: campanaAnuncio.estado,
      actualizadoAt: campanaAnuncio.actualizadoAt,
    })
    .from(campanaAnuncio);
  return new Map(filas.map((f) => [f.adId, f]));
}

/**
 * LOS CABLES DE UNA LÍNEA: campaña → el conjunto de vendedoras conectadas.
 *
 * Devuelve el conjunto ORDENADO. El orden no decide a quién le toca —eso lo hace
 * la carga— pero sí que dos aperturas de la pantalla dibujen los mismos cables
 * en el mismo lugar.
 */
export async function cablesDe(base: typeof Base, numeroPropio: string) {
  const filas = await base
    .select({ campanaId: campanaCable.campanaId, vendedoraId: campanaCable.vendedoraId })
    .from(campanaCable)
    .where(eq(campanaCable.numeroPropio, numeroPropio));

  const por = new Map<string, string[]>();
  for (const f of filas) por.set(f.campanaId, [...(por.get(f.campanaId) ?? []), f.vendedoraId]);
  for (const [k, v] of por) por.set(k, v.sort((a, b) => a.localeCompare(b, "es")));
  return por;
}

/** El catálogo de campañas que Meta conoce, con los números a los que mandan. */
export async function campanasConocidas(base: typeof Base) {
  return base
    .select({
      campanaId: campanaMeta.campanaId,
      nombre: campanaMeta.nombre,
      estado: campanaMeta.estado,
      numeros: campanaMeta.numeros,
      actualizadoAt: campanaMeta.actualizadoAt,
    })
    .from(campanaMeta);
}

export interface FotoDeRouting {
  campanas: CampanaEnRouting[];
  /** Anuncios que trajeron gente y todavía no se resolvieron contra Meta. */
  anunciosSinResolver: number;
  /**
   * Campañas de la cuenta que mandan a WhatsApp pero **no a esta línea**. No se
   * listan —no se pueden rutear— pero se CUENTAN: sin este número la pantalla
   * afirmaría «estas son todas las campañas» sobre una cuenta donde, medido el
   * 12-ago-2026, dieciséis de diecisiete adsets activos mandan a otro lado.
   */
  campanasEnOtraLinea: number;
  /** Cuándo se le preguntó a Meta por última vez. `null` = nunca. */
  actualizadoAt: string | null;
  /** Sin las tablas migradas la pantalla lo dice en vez de mostrar una lista vacía. */
  sinMigracion: boolean;
}

/**
 * LA FOTO QUE VE LA PANTALLA.
 *
 * 🔴 **La lista sale del catálogo de META, no de `events`.** El primer borrador
 * la derivaba de los click-to-WhatsApp recibidos, y eso deja afuera justo el caso
 * que importa: una campaña estrenada hoy, que es cuando querés dejar el cable
 * puesto ANTES del primer lead. El volumen observado se suma como dato de la
 * fila, no como condición para existir.
 *
 * 🔴 **Y se recorta a las que mandan a ESTA línea** (`llegaALaLinea`). Ofrecer un
 * cable sobre una campaña que apunta a otro teléfono sería ofrecer un cable que
 * no puede llevar nada: el lead entra por un número que este server no atiende.
 */
export async function fotoDeRouting(
  base: typeof Base,
  numeroPropio: string,
  dias = VENTANA_DIAS,
): Promise<FotoDeRouting> {
  let vistos: AnuncioVisto[];
  let mapa: Awaited<ReturnType<typeof mapaDeAnuncios>>;
  let cables: Awaited<ReturnType<typeof cablesDe>>;
  let catalogo: Awaited<ReturnType<typeof campanasConocidas>>;
  try {
    [vistos, mapa, cables, catalogo] = await Promise.all([
      anunciosVistos(base, dias),
      mapaDeAnuncios(base),
      cablesDe(base, numeroPropio),
      campanasConocidas(base),
    ]);
  } catch (e) {
    /**
     * ⚠️ **Solo una TABLA AUSENTE es «falta la migración».** El borrador
     * contestaba `sinMigracion` ante cualquier fallo, así que un timeout o una
     * caída momentánea de la base reemplazaban la pantalla entera por «aplicá la
     * migración» — y quien la lea va a buscar el problema en el lugar
     * equivocado. Lo demás sube y sale como el error que es.
     */
    if (!esTablaAusente(e)) throw e;
    return {
      campanas: [],
      anunciosSinResolver: 0,
      campanasEnOtraLinea: 0,
      actualizadoAt: null,
      sinMigracion: true,
    };
  }

  // El volumen observado, por campaña. Un anuncio sin resolver no suma a ninguna.
  const volumen = new Map<string, { anuncios: number; personas: number; ultima: string }>();
  let sinResolver = 0;
  for (const v of vistos) {
    const campanaId = mapa.get(v.adId)?.campanaId;
    if (!campanaId) {
      sinResolver++;
      continue;
    }
    const previa = volumen.get(campanaId);
    volumen.set(campanaId, {
      anuncios: (previa?.anuncios ?? 0) + 1,
      personas: (previa?.personas ?? 0) + v.personas,
      ultima: previa?.ultima && previa.ultima > v.ultima ? previa.ultima : v.ultima,
    });
  }

  // El diccionario de productos. Una consulta por pedido y no una por fila: son
  // ~40 aliases y ~44 campañas, y resolver en TypeScript deja `familiaDeTexto`
  // como única implementación (el gemelo en SQL sería el defecto de #37).
  const aliases = await aliasesActivos(base as never).catch(() => []);

  let ultimoRefresco: Date | null = null;
  let enOtraLinea = 0;
  const campanas: CampanaEnRouting[] = [];
  for (const c of catalogo) {
    if (!ultimoRefresco || c.actualizadoAt > ultimoRefresco) ultimoRefresco = c.actualizadoAt;
    if (!llegaALaLinea(c.numeros, numeroPropio)) {
      // Solo cuentan las que mandan a ALGÚN WhatsApp: una campaña de tráfico web
      // no es «de otra línea», simplemente no es de este frente.
      if (c.numeros.length > 0) enOtraLinea++;
      continue;
    }
    const v = volumen.get(c.campanaId);
    campanas.push({
      campanaId: c.campanaId,
      nombre: c.nombre,
      estado: leerEstado(c.estado),
      anuncios: v?.anuncios ?? 0,
      personas: v?.personas ?? 0,
      ultima: v?.ultima ?? null,
      familia: familiaDe(aliases, c.nombre),
      vendedoras: cables.get(c.campanaId) ?? [],
    });
  }

  return {
    campanas: ordenarCampanas(campanas),
    anunciosSinResolver: sinResolver,
    campanasEnOtraLinea: enOtraLinea,
    actualizadoAt: ultimoRefresco?.toISOString() ?? null,
    sinMigracion: false,
  };
}

/** Guarda lo que Meta contestó. Idempotente: reflejar el estado de hoy es el punto. */
export async function guardarAnuncios(
  base: typeof Base,
  filas: readonly { adId: string; campanaId: string; campanaNombre: string; estado: string }[],
): Promise<number> {
  if (filas.length === 0) return 0;
  await base
    .insert(campanaAnuncio)
    .values(filas.map((f) => ({ ...f, actualizadoAt: new Date() })))
    .onConflictDoUpdate({
      target: campanaAnuncio.adId,
      set: {
        campanaId: sql`excluded.campana_id`,
        campanaNombre: sql`excluded.campana_nombre`,
        estado: sql`excluded.estado`,
        actualizadoAt: sql`excluded.actualizado_at`,
      },
    });
  return filas.length;
}

/**
 * DEJA LOS CABLES DE UNA CAMPAÑA EXACTAMENTE COMO SE PIDIÓ.
 *
 * 🔴 **Es declarativo y reemplaza el conjunto entero**, no un `connect`/`disconnect`
 * por cable. Con operaciones incrementales, dos personas editando la misma
 * campaña se pisan y ninguna se entera: la última en apretar cree que sumó un
 * cable y en realidad borró el de la otra. Mandando el conjunto completo, lo que
 * quedó guardado es lo que la pantalla mostraba.
 *
 * ⚠️ **Borra y reinserta adentro de UNA transacción.** Sin ella, una caída entre
 * el DELETE y el INSERT deja la campaña sin ningún cable —o sea, repartiendo por
 * la rueda general— que es un estado que nadie pidió.
 *
 * Lista vacía = se cortan todos los cables y la campaña vuelve a la rueda.
 */
export async function ponerCables(
  base: typeof Base,
  numeroPropio: string,
  campanaId: string,
  vendedoras: readonly string[],
  quienLosPone: string,
): Promise<void> {
  const unicas = [...new Set(vendedoras.map((v) => v.trim()).filter(Boolean))];
  await base.transaction(async (tx) => {
    await tx
      .delete(campanaCable)
      .where(
        and(eq(campanaCable.numeroPropio, numeroPropio), eq(campanaCable.campanaId, campanaId)),
      );
    if (unicas.length === 0) return;
    await tx.insert(campanaCable).values(
      unicas.map((vendedoraId) => ({
        numeroPropio,
        campanaId,
        vendedoraId,
        asignadaPor: quienLosPone,
      })),
    );
  });
}

/**
 * A QUIÉNES LES PUEDE CAER ESTE ANUNCIO — la consulta que hace el webhook.
 *
 * 🔴 **Vacío ante cualquier duda, y vacío es «que decida la rueda»**. El `try` es
 * parte del contrato: el reparto no puede tumbar la ingesta de un mensaje.
 */
export async function duenosPorCampana(
  base: typeof Base,
  numeroPropio: string,
  adId: string | null | undefined,
): Promise<string[]> {
  const ad = (adId ?? "").trim();
  if (!ad) return [];
  try {
    const filas = await base
      .select({ vendedoraId: campanaCable.vendedoraId })
      .from(campanaAnuncio)
      .innerJoin(
        campanaCable,
        and(
          eq(campanaCable.campanaId, campanaAnuncio.campanaId),
          eq(campanaCable.numeroPropio, numeroPropio),
        ),
      )
      .where(eq(campanaAnuncio.adId, ad));
    return filas.map((f) => f.vendedoraId).sort((a, b) => a.localeCompare(b, "es"));
  } catch {
    return [];
  }
}

/** Guarda el catálogo de campañas que contestó Meta. Idempotente: refleja el hoy. */
export async function guardarCampanas(
  base: typeof Base,
  filas: readonly { campanaId: string; nombre: string; estado: string; numeros: string[] }[],
): Promise<number> {
  if (filas.length === 0) return 0;
  await base
    .insert(campanaMeta)
    .values(filas.map((f) => ({ ...f, actualizadoAt: new Date() })))
    .onConflictDoUpdate({
      target: campanaMeta.campanaId,
      set: {
        nombre: sql`excluded.nombre`,
        estado: sql`excluded.estado`,
        numeros: sql`excluded.numeros`,
        actualizadoAt: sql`excluded.actualizado_at`,
      },
    });
  return filas.length;
}

/** Un curso de formulario, como se lo ve en la pantalla. */
export interface CursoEnRouting {
  curso: string;
  /** Su producto. Los cursos resuelven 19 de 21: son nombres comerciales. */
  familia: string | null;
  /** Cuántos leads llegaron por ese curso en la ventana. */
  leads: number;
  /** El último. ISO, o `null`. */
  ultimo: string | null;
  /** Los cables. Vacío = lo ve todo el equipo, como hoy. */
  vendedoras: string[];
}

/**
 * LOS CURSOS QUE LLEGAN POR FORMULARIO, con su volumen y sus cables.
 *
 * 🔴 **EL CURSO SALE DE `productoLeadSql`, EL MISMO FRAGMENTO QUE USA LA COLA.**
 * Y no es una preferencia: es la llave con la que se guarda el cable y la llave
 * con la que después se matchea (`cr.curso = todo.curso_lead` en
 * `cola/asignadaSql.ts`). El primer borrador usaba `cursoDeLeadSql`, que es
 * PARECIDO y no igual — difiere cuando `form_name` no lleva el prefijo `icarus:`
 * o cuando `campaign_name` viene vacío.
 *
 * Lo que eso producía, medido por la auditoría del 12-ago-2026: la pantalla
 * listaba un curso «Datos», la supervisora le ponía un cable, el PUT contestaba
 * ok **y la regla no se aplicaba nunca** porque el `curso_lead` de esos leads era
 * otro. Sin error, sin log, y con la pantalla mostrando la pieza como conectada.
 * Son 23 filas hoy (las de icarus sin `product_name`) y todas las del webhook de
 * Bravo, donde las dos expresiones dan dos strings REALES distintos.
 *
 * ⚠️ Se listan los cursos VISTOS en la ventana **más** los que ya tienen cable,
 * aunque no hayan traído a nadie: si un curso deja de traer leads por un mes, su
 * regla no se puede borrar desde la pantalla porque el renglón desapareció.
 */
export async function cursosDeFormulario(
  base: typeof Base,
  dias = VENTANA_DIAS,
): Promise<CursoEnRouting[]> {
  const [vistos, cables, aliases] = await Promise.all([
    base.execute<{ curso: string; leads: number; ultimo: string }>(sql`
      SELECT ${productoLeadSql}                    AS curso,
             count(*)::int                         AS leads,
             max(created_time)                     AS ultimo
        FROM leads
       WHERE created_time > now() - ${`${dias} days`}::interval
         AND NULLIF(btrim(${productoLeadSql}), '') IS NOT NULL
       GROUP BY 1
    `),
    cablesDeCurso(base),
    aliasesActivos(base as never).catch(() => []),
  ]);

  const filas = new Map<string, CursoEnRouting>();
  for (const v of vistos) {
    filas.set(v.curso, {
      curso: v.curso,
      familia: familiaDe(aliases, v.curso),
      leads: Number(v.leads ?? 0),
      ultimo: new Date(v.ultimo).toISOString(),
      vendedoras: cables.get(v.curso) ?? [],
    });
  }
  for (const [curso, vendedoras] of cables) {
    if (!filas.has(curso))
      filas.set(curso, { curso, familia: familiaDe(aliases, curso), leads: 0, ultimo: null, vendedoras });
  }

  // Primero lo que más gente trae; a igualdad, alfabético para que dos aperturas
  // de la pantalla no muestren dos órdenes distintos.
  return [...filas.values()].sort(
    (a, b) => b.leads - a.leads || a.curso.localeCompare(b.curso, "es"),
  );
}

/** Los cables por curso, como conjunto ordenado. */
export async function cablesDeCurso(base: typeof Base) {
  const filas = await base
    .select({ curso: cursoRuteo.curso, vendedoraId: cursoRuteo.vendedoraId })
    .from(cursoRuteo);
  const por = new Map<string, string[]>();
  for (const f of filas) por.set(f.curso, [...(por.get(f.curso) ?? []), f.vendedoraId]);
  for (const [k, v] of por) por.set(k, v.sort((a, b) => a.localeCompare(b, "es")));
  return por;
}

/**
 * Deja los cables de un curso exactamente como se pidió. Mismo contrato
 * declarativo que `ponerCables`: viaja el conjunto entero, no un cable.
 */
export async function ponerCablesDeCurso(
  base: typeof Base,
  curso: string,
  vendedoras: readonly string[],
  quienLosPone: string,
): Promise<void> {
  const unicas = [...new Set(vendedoras.map((v) => v.trim()).filter(Boolean))];
  await base.transaction(async (tx) => {
    await tx.delete(cursoRuteo).where(eq(cursoRuteo.curso, curso));
    if (unicas.length === 0) return;
    await tx
      .insert(cursoRuteo)
      .values(unicas.map((vendedoraId) => ({ curso, vendedoraId, asignadaPor: quienLosPone })));
  });
}

/**
 * CABLEA TODO UN PRODUCTO — sus campañas de Meta y sus cursos de formulario.
 *
 * 🔴 **Escribe en cada uno; no crea una regla de producto.** Lo que se ve en cada
 * renglón ES la regla (decisión del dueño del 12-ago-2026), así que la cola no
 * cambia: sigue leyendo `campana_ruteo` y `curso_ruteo` sin precedencias.
 *
 * ⚠️ **Todo adentro de UNA transacción.** A medio aplicar, un producto quedaría
 * con dos campañas en una vendedora y tres en otra — un estado que nadie pidió y
 * que además se lee como si alguien lo hubiera configurado así.
 *
 * Devuelve qué tocó: sin ese número, «listo» sobre cinco renglones es
 * indistinguible de «listo» sobre cero.
 */
/**
 * CÓMO SE APLICA UN CABLE DE PRODUCTO SOBRE SUS PIEZAS.
 *
 * 🔴 **`agregar`/`quitar` existen porque un ARRASTRE no puede ser destructivo.**
 * El botón «Poner este cable en las N» dice explícitamente qué va a pisar y para
 * eso está `reemplazar`. Pero tirar un cable del producto a una vendedora es el
 * MISMO verbo que tirarlo de una pieza —conectar a esa persona—, y si eso
 * reemplazara el conjunto, arrastrar hacia Luz **borraría a Tracy de las otras
 * cuatro piezas sin decir una palabra**. Un gesto de un dedo no puede tener el
 * alcance de un botón que pregunta.
 */
export type ModoDeCableado = "reemplazar" | "agregar" | "quitar";

export async function cablearProducto(
  base: typeof Base,
  numeroPropio: string | null,
  familia: string,
  vendedoras: readonly string[],
  quienLosPone: string,
  modo: ModoDeCableado = "reemplazar",
): Promise<{ campanas: number; cursos: number }> {
  const [aliases, catalogo, cursos] = await Promise.all([
    aliasesActivos(base as never).catch(() => []),
    campanasConocidas(base),
    base.execute<{ curso: string }>(sql`
      SELECT DISTINCT ${productoLeadSql} AS curso
        FROM leads
       WHERE created_time > now() - ${`${VENTANA_DIAS} days`}::interval
         AND NULLIF(btrim(${productoLeadSql}), '') IS NOT NULL
    `),
  ]);

  const deLaFamilia = (texto: string) => familiaDe(aliases, texto) === familia;
  // Solo las que esta línea puede recibir: cablear una que manda a otro teléfono
  // escribiría una regla que no se va a aplicar nunca.
  const campanas = catalogo.filter(
    (c) => deLaFamilia(c.nombre) && (!numeroPropio || llegaALaLinea(c.numeros, numeroPropio)),
  );
  const losCursos = [...cursos].map((c) => c.curso).filter(deLaFamilia);

  const unicas = [...new Set(vendedoras.map((v) => v.trim()).filter(Boolean))];
  const enMinuscula = unicas.map((v) => v.toLowerCase());

  await base.transaction(async (tx) => {
    for (const c of campanas) {
      if (modo === "reemplazar") {
        await ponerCables(tx as never, numeroPropio ?? "", c.campanaId, vendedoras, quienLosPone);
      } else if (modo === "agregar") {
        if (unicas.length === 0) continue;
        await tx
          .insert(campanaCable)
          .values(
            unicas.map((vendedoraId) => ({
              numeroPropio: numeroPropio ?? "",
              campanaId: c.campanaId,
              vendedoraId,
              asignadaPor: quienLosPone,
            })),
          )
          .onConflictDoNothing();
      } else {
        // ⚠️ Se compara NORMALIZANDO: la fila puede decir `Luz` y el pedido `luz`
        // (las dos grafías están vivas en prod). Con comparación exacta, quitar
        // no quita y el cable queda pegado sin síntoma.
        await tx
          .delete(campanaCable)
          .where(
            and(
              eq(campanaCable.numeroPropio, numeroPropio ?? ""),
              eq(campanaCable.campanaId, c.campanaId),
              sql`lower(${campanaCable.vendedoraId}) = ANY(${enMinuscula})`,
            ),
          );
      }
    }
    for (const curso of losCursos) {
      if (modo === "reemplazar") {
        await ponerCablesDeCurso(tx as never, curso, vendedoras, quienLosPone);
      } else if (modo === "agregar") {
        if (unicas.length === 0) continue;
        await tx
          .insert(cursoRuteo)
          .values(unicas.map((vendedoraId) => ({ curso, vendedoraId, asignadaPor: quienLosPone })))
          .onConflictDoNothing();
      } else {
        await tx
          .delete(cursoRuteo)
          .where(
            and(
              eq(cursoRuteo.curso, curso),
              sql`lower(${cursoRuteo.vendedoraId}) = ANY(${enMinuscula})`,
            ),
          );
      }
    }
  });

  return { campanas: campanas.length, cursos: losCursos.length };
}

/** Un anuncio de una campaña, con lo que trajo. */
export interface AnuncioDeCampana {
  adId: string;
  /** El titular del creativo, del último referral que llegó. Puede faltar. */
  titular: string | null;
  personas: number;
  ultima: string | null;
}

/**
 * LOS ANUNCIOS DE UNA CAMPAÑA — para el nivel de adentro del lienzo.
 *
 * 🔴 **Es SOLO LECTURA, y el server no ofrece guardar nada acá a propósito.** El
 * reparto resuelve `ad_id → campaña → vendedoras`: **no existe una regla por
 * anuncio**. Servir esto con forma de algo conectable prometería un control que
 * no hay.
 *
 * ⚠️ **El titular sale del ÚLTIMO referral y no es identidad.** Medido el
 * 11-ago-2026: el mismo `ad_id` llega con titulares distintos cuando le cambian
 * el creativo, así que se agrupa por `source_id` y el titular es informativo.
 */
export async function anunciosDeCampana(
  base: typeof Base,
  campanaId: string,
  dias = VENTANA_DIAS,
): Promise<AnuncioDeCampana[]> {
  const filas = await base.execute<{
    ad_id: string;
    titular: string | null;
    personas: number;
    ultima: string | null;
  }>(sql`
    SELECT a.ad_id                                         AS ad_id,
           (array_agg(e.payload->'referral'->>'headline'
                      ORDER BY e.occurred_at DESC)
              FILTER (WHERE e.payload->'referral'->>'headline' IS NOT NULL))[1] AS titular,
           count(DISTINCT e.payload->>'from')::int         AS personas,
           max(e.occurred_at)                              AS ultima
      FROM campana_anuncio a
      LEFT JOIN events e
        ON e.source = 'meta_wa_ctwa'
       AND e.payload->'referral'->>'source_id' = a.ad_id
       AND e.occurred_at > now() - ${`${dias} days`}::interval
     WHERE a.campana_id = ${campanaId}
     GROUP BY a.ad_id
     ORDER BY 3 DESC, 1
  `);
  return filas.map((f) => ({
    adId: f.ad_id,
    titular: f.titular,
    personas: Number(f.personas ?? 0),
    ultima: f.ultima ? new Date(f.ultima).toISOString() : null,
  }));
}
