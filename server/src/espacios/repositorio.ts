import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db as DbSingleton } from "../db/client.js";
import { notaLink } from "../db/links.js";
import { espacioMiembro, espacios, numeroVendedora, repartoRueda } from "../db/schema.js";
import { etiquetaDeToken } from "./auditoriaLink.js";
import { anotarCortes } from "./auditoriaLinkRepositorio.js";
import { destinosPosibles } from "../reparto/destino.js";

/**
 * LOS ESPACIOS, CONTRA LA BASE — `db` inyectado como todo seam de esta casa
 * (`cola/consultarCola.ts`, `notas/notas.ts`): el router le pasa el singleton, el
 * test su base de prueba.
 *
 * Las REGLAS no viven acá: viven puras en `visibilidad.ts`. Acá vive el IO.
 */

export interface EspacioFila {
  id: number;
  nombre: string;
  creadaPor: string;
  creadoAt: Date;
  /** Los miembros, con la grafía con la que se guardaron. */
  miembros: string[];
}

/**
 * DE QUÉ ESPACIOS ES MIEMBRO ESTA PERSONA — la consulta que abre todas las demás.
 *
 * ⚠️ **Degrada, nunca tumba.** Sin la migración `0022` la tabla no existe y esto
 * devuelve `[]`, que por la regla de `visibilidad.ts` colapsa a «solo mi libreta
 * privada»: exactamente la Libreta de antes de este frente. Es lo contrario del
 * catálogo de piezas (ADR 0023) y por el mismo criterio — **acá el consumidor es
 * una persona**, y para una persona la degradación honesta es ver lo suyo, no un
 * 503 en la pantalla donde escribe.
 *
 * Lo que NO puede hacer al degradar es servir de más: por eso devuelve la lista
 * vacía y no `null`, que el llamador podría leer como «no filtres».
 */
export async function espaciosDe(base: typeof DbSingleton, vendedoraId: string): Promise<number[]> {
  const yo = vendedoraId.trim().toLowerCase();
  if (!yo) return [];
  try {
    const filas = await base
      .select({ id: espacioMiembro.espacioId })
      .from(espacioMiembro)
      .innerJoin(espacios, eq(espacios.id, espacioMiembro.espacioId))
      .where(and(sql`lower(btrim(${espacioMiembro.vendedoraId})) = ${yo}`, isNull(espacios.archivadoAt)));
    return filas.map((f) => f.id);
  } catch (e) {
    console.warn("[espacios] no se pudieron leer los espacios (¿falta la migración 0022?):", e);
    return [];
  }
}

/** Un espacio con sus miembros, o `null` si no existe o está archivado. */
export async function leerEspacio(base: typeof DbSingleton, id: number): Promise<EspacioFila | null> {
  const [fila] = await base
    .select()
    .from(espacios)
    .where(and(eq(espacios.id, id), isNull(espacios.archivadoAt)));
  if (!fila) return null;

  const miembros = await base
    .select({ vendedoraId: espacioMiembro.vendedoraId })
    .from(espacioMiembro)
    .where(eq(espacioMiembro.espacioId, id))
    .orderBy(asc(espacioMiembro.agregadoAt));

  return {
    id: fila.id,
    nombre: fila.nombre,
    creadaPor: fila.creadaPor,
    creadoAt: fila.creadoAt,
    miembros: miembros.map((m) => m.vendedoraId),
  };
}

/** Los espacios vivos de los que esta persona es miembro, con sus miembros. */
export async function listarEspaciosDe(base: typeof DbSingleton, vendedoraId: string): Promise<EspacioFila[]> {
  const ids = await espaciosDe(base, vendedoraId);
  if (ids.length === 0) return [];
  const leidos = await Promise.all(ids.map((id) => leerEspacio(base, id)));
  return leidos
    .filter((e): e is EspacioFila => e !== null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * CREAR UN ESPACIO — y **quien lo crea entra como miembro en la misma
 * transacción**, no en una llamada aparte.
 *
 * Si fueran dos escrituras, un fallo entre medio dejaría un espacio del que su
 * propia creadora no es miembro: invisible para ella (la regla de visibilidad
 * pregunta por membresía, no por autoría) e imposible de arreglar desde la app,
 * porque administrarlo también exige verlo primero.
 */
export async function crearEspacio(
  base: typeof DbSingleton,
  datos: { nombre: string; creadaPor: string; miembros: readonly string[] },
): Promise<EspacioFila> {
  const id = await base.transaction(async (tx) => {
    const [fila] = await tx
      .insert(espacios)
      .values({ nombre: datos.nombre, creadaPor: datos.creadaPor })
      .returning({ id: espacios.id });

    await tx
      .insert(espacioMiembro)
      .values(
        conLaCreadoraAdentro(datos.miembros, datos.creadaPor).map((vendedoraId) => ({
          espacioId: fila.id,
          vendedoraId,
          agregadoPor: datos.creadaPor,
        })),
      )
      .onConflictDoNothing();

    return fila.id;
  });

  const creado = await leerEspacio(base, id);
  if (!creado) throw new Error("el espacio se creó y no se pudo releer");
  return creado;
}

/**
 * La lista de miembros con la creadora adentro, sin repetirla.
 *
 * Se compara normalizando (`toLowerCase`) porque la pantalla puede mandarla con
 * la grafía del padrón (`Luz`) mientras el token dice `luz`: sin esto se
 * insertarían **dos filas para el mismo humano**, y sacar a uno lo dejaría
 * adentro por el otro.
 */
function conLaCreadoraAdentro(miembros: readonly string[], creadaPor: string): string[] {
  const vistos = new Map<string, string>();
  for (const crudo of [creadaPor, ...miembros]) {
    const limpio = crudo.trim();
    if (!limpio) continue;
    const llave = limpio.toLowerCase();
    if (!vistos.has(llave)) vistos.set(llave, limpio);
  }
  return [...vistos.values()];
}

export async function agregarMiembro(
  base: typeof DbSingleton,
  datos: { espacioId: number; vendedoraId: string; agregadoPor: string },
): Promise<void> {
  await base
    .insert(espacioMiembro)
    .values({
      espacioId: datos.espacioId,
      vendedoraId: datos.vendedoraId.trim(),
      agregadoPor: datos.agregadoPor,
    })
    .onConflictDoNothing();
}

/**
 * SACAR A ALGUIEN. Borra la fila —no hay baja lógica— porque no conserva nada:
 * las páginas que escribió se quedan en el espacio con su `vendedora_id` intacto.
 *
 * ⚠️ Se borra comparando NORMALIZADO, no por igualdad exacta: si a Luz la
 * agregaron como `Luz` y la pantalla manda `luz`, un `DELETE` exacto no borraría
 * nada **y respondería 200**.
 */
export async function sacarMiembro(
  base: typeof DbSingleton,
  datos: { espacioId: number; vendedoraId: string },
): Promise<number> {
  const quien = datos.vendedoraId.trim().toLowerCase();
  if (!quien) return 0;

  // 🔴 SACAR A ALGUIEN LE CORTA TAMBIÉN LOS LINKS QUE ABRIÓ, y esto NO es un
  // extra: sin esto, ADR 0046 promete que sacar a alguien le saca las páginas —
  // y le sacaba las de adentro dejándole abierta la puerta que había dejado al
  // mundo. El link seguía sirviendo la página del equipo, no aparecía en ninguna
  // alerta, y solo lo cortaba un miembro actual que se acordara de ir a mirar.
  //
  // Va PRIMERO y en la misma transacción que la baja: si se hiciera después y
  // fallara, la persona quedaría afuera con su link vivo — exactamente el estado
  // que esto viene a impedir.
  const cortados = await base.transaction(async (tx) => {
    const borrados = await tx
      .delete(notaLink)
      .where(
        sql`lower(btrim(${notaLink.creadoPor})) = ${quien}
            AND ${notaLink.notaId} IN (SELECT id FROM notas WHERE espacio_id = ${datos.espacioId})`,
      )
      .returning({ token: notaLink.token, notaId: notaLink.notaId });

    await tx
      .delete(espacioMiembro)
      .where(
        and(
          eq(espacioMiembro.espacioId, datos.espacioId),
          sql`lower(btrim(${espacioMiembro.vendedoraId})) = ${quien}`,
        ),
      );

    return borrados;
  });

  // ⚠️ **El registro se escribe DESPUÉS de la transacción, y a propósito.** Adentro,
  // un fallo al anotar revertiría el corte — y la persona quedaría afuera del
  // espacio con su link vivo, que es exactamente el estado que este corte existe
  // para impedir. El corte manda; el registro acompaña (`anotar` nunca lanza).
  //
  // 🔴 Y lleva MOTIVO: sin él, estos cortes aparecen firmados por quien administró
  // el espacio, como si hubiera ido link por link. Lo que pasó es otra cosa.
  await anotarCortes(
    base,
    cortados.map((c) => ({ notaId: c.notaId, etiqueta: etiquetaDeToken(c.token) })),
    { quien: datos.vendedoraId.trim(), motivo: "sacaron_al_miembro", at: new Date() },
  );

  return cortados.length;
}

/**
 * Archivar el espacio. Las páginas NO se tocan: se archiva el lugar, no lo escrito.
 *
 * 🔴 **Pero los links SÍ se cortan**, por el mismo motivo que al sacar a un
 * miembro: archivar un espacio saca sus páginas de la vista de todos, y un link
 * vivo dejaría una puerta abierta al mundo hacia algo que el equipo ya dio por
 * cerrado. Es el único caso donde archivar destruye algo — y destruye la puerta,
 * no el contenido.
 */
export async function archivarEspacio(base: typeof DbSingleton, id: number, ahora: Date): Promise<number> {
  const cortados = await base.transaction(async (tx) => {
    const borrados = await tx
      .delete(notaLink)
      .where(sql`${notaLink.notaId} IN (SELECT id FROM notas WHERE espacio_id = ${id})`)
      .returning({ token: notaLink.token, notaId: notaLink.notaId });

    await tx.update(espacios).set({ archivadoAt: ahora }).where(eq(espacios.id, id));
    return borrados;
  });

  // ⚠️ `quien: null` no es un dato faltante: **nadie cortó estos links**. Se
  // cayeron porque se archivó el lugar donde vivían sus páginas, y la pantalla lo
  // dice con esas palabras. Poner acá a quien archivó el espacio lo haría figurar
  // cortando links que ni sabía que existían.
  await anotarCortes(
    base,
    cortados.map((c) => ({ notaId: c.notaId, etiqueta: etiquetaDeToken(c.token) })),
    { quien: null, motivo: "archivaron_el_espacio", at: ahora },
  );

  return cortados.length;
}

/**
 * RENOMBRAR un espacio.
 *
 * Existe porque sin esto **un nombre mal puesto no tenía arreglo desde la app**:
 * el primer espacio que alguien creara con un typo se quedaba así para siempre, y
 * la única salida era archivarlo y rehacerlo — perdiendo las páginas de lugar.
 *
 * ⚠️ El nombre **no es la identidad**: la identidad es el `id`, así que renombrar
 * no rompe ningún link, ninguna membresía ni ninguna página. Es la misma regla que
 * `hechos`, donde la clave es el slug y el rótulo se edita libre.
 */
export async function renombrarEspacio(base: typeof DbSingleton, id: number, nombre: string): Promise<void> {
  await base.update(espacios).set({ nombre }).where(eq(espacios.id, id));
}

/**
 * EL PADRÓN DE PERSONAS A LAS QUE SE PUEDE INVITAR.
 *
 * 🔴 **Hermes no tiene tabla de usuarios**: el login es un handshake contra Django
 * y lo único que vuelve es «entró» o «no entró» (`cerberus/auth.ts`). El único
 * padrón que existe es **la rueda del reparto ∪ el mapa `numero_vendedora`**, que
 * es exactamente lo que `reparto/destino.ts` ya usa para verificar el destino de
 * una reasignación. Medido el 10-ago-2026 tiene 9 personas.
 *
 * ⚠️ **Se reusa `destinosPosibles`, no se escribe una segunda.** Ahí ya vive la
 * decisión de qué grafía gana cuando el mismo humano aparece dos veces (gana la
 * de la rueda), y con dos implementaciones la pantalla ofrecería una lista y el
 * server aceptaría otra (#37). Lo único distinto es el alcance: `destinosPosibles`
 * se pregunta **por línea** —a quién le paso ESTA conversación— y acá se pregunta
 * global, porque un espacio de trabajo no es de ninguna línea.
 *
 * Invitar a alguien que no está en el padrón es 409 enumerando a quién sí se
 * puede: un `vendedora_id` inventado escribe una fila perfectamente válida y la
 * persona nunca ve el espacio, sin un solo síntoma.
 */
export async function padronDePersonas(base: typeof DbSingleton): Promise<string[]> {
  const [rueda, mapa] = await Promise.all([
    base.selectDistinct({ v: repartoRueda.vendedoraId }).from(repartoRueda),
    base.selectDistinct({ v: numeroVendedora.vendedoraId }).from(numeroVendedora),
  ]);
  return destinosPosibles({ rueda: rueda.map((f) => f.v), mapa: mapa.map((f) => f.v) });
}
