import { eq, inArray, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { equipo, equipoBitacora, equipoGrafia } from "../db/equipo.js";
import { esTablaAusente } from "../cola/estadoSql.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { supervisoresConfigurados } from "../padron/supervisor.js";
import { esNombreDeVerdad } from "./nombre.js";
import { clavePersona, esRol, type Rol } from "./roles.js";
import type { LecturaDeEquipo } from "./cascada.js";

/**
 * LA LECTURA DE `equipo` — y las DOS formas de fallar, separadas.
 *
 * 🔴 Este módulo existe sobre todo para NO colapsar «la tabla no está» con «la
 * consulta falló». Son dos errores que en un `catch` se ven igual y significan lo
 * contrario: el primero es un despliegue a medias (la migración viaja por N5, un
 * botón) y el segundo es un hipo de Postgres. La cascada de `cascada.ts` los
 * trata distinto porque el precio de confundirlos es abrir o cerrar la cola
 * entera sin que nadie se entere. Acá se distinguen mirando el código del driver
 * (42P01 = `undefined_table`), con la misma función que ya usa la cola
 * (`esTablaAusente`, que camina la cadena de `cause` porque drizzle envuelve el
 * error del driver en un «Failed query: …»).
 *
 * ⚠️ **Ninguna función de acá tira.** Se consultan en el camino de TODO request
 * con token: un throw se convertiría en 500 en cada ruta de la app.
 */

/** Lo que la cascada necesita saber de esta persona. Nunca tira. */
export async function leerPersona(base: typeof Base, idCrudo: string): Promise<LecturaDeEquipo> {
  const personaId = clavePersona(idCrudo);
  if (!personaId) return { estado: "ok", fila: null };
  try {
    const filas = await base
      .select({
        personaId: equipo.personaId,
        nombre: equipo.nombre,
        rol: equipo.rol,
        activa: equipo.activa,
      })
      .from(equipo)
      .where(eq(equipo.personaId, personaId))
      .limit(1);

    const f = filas[0];
    if (!f) return { estado: "ok", fila: null };
    // Un `rol` que no está en la escalera se lee como `vendedora`, NO se tira:
    // la columna es `text` y el CHECK vive en la base, pero un despliegue viejo
    // leyendo un rol nuevo tiene que degradar hacia MENOS, nunca reventar.
    return {
      estado: "ok",
      fila: {
        personaId: f.personaId,
        nombre: f.nombre,
        rol: esRol(f.rol) ? f.rol : "vendedora",
        activa: f.activa,
      },
    };
  } catch (e) {
    if (esTablaAusente(e)) return { estado: "sin_tabla", fila: null };
    // Ruidoso: un blip que recorta a todo el mundo sin dejar rastro es el fallo
    // que nadie investiga porque «la app anda, solo se ve poco».
    console.error(`[equipo] no se pudo leer el rol de «${personaId}» — ${porQueFallo(e)}`);
    return { estado: "fallo", fila: null };
  }
}

/**
 * ¿HAY ALGUIEN QUE MANDE? — el reemplazo de `supervisoresConfigurados(env).length === 0`.
 *
 * Las cuatro rutas que hoy preguntan eso lo hacen para una sola cosa: distinguir
 * **«vos no sos supervisor»** de **«no hay ninguno configurado»**. Una lista
 * vacía se lee «se perdieron los contactos»; el motivo dicho se lee «falta
 * configurar esto». Esa distinción tiene que sobrevivir a la mudanza a tabla, o
 * el paso que apaga los CSV la deja diciendo «nadie manda» para siempre.
 *
 * ⚠️ **Con la tabla ausente o caída cae al CSV**, que es exactamente el respaldo
 * que la cascada usa para el rol: si acá dijera «no hay nadie» mientras la
 * cascada sigue dándole supervisor a quien está en el `.env`, la pantalla
 * contradiría a la puerta.
 */
export async function hayQuienMande(base: typeof Base, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const filas = await base
      .select({ n: sql<number>`count(*)::int` })
      .from(equipo)
      .where(sql`${equipo.activa} AND ${equipo.rol} IN ('admin','supervisor')`);
    if ((filas[0]?.n ?? 0) > 0) return true;
  } catch (e) {
    if (!esTablaAusente(e)) {
      console.error(`[equipo] no se pudo contar a quién manda — ${porQueFallo(e)}`);
    }
    // Se sigue de largo al CSV a propósito: ver el docblock.
  }
  // El MISMO parser que usa la cascada, no una relectura a mano: dos formas de
  // leer el mismo CSV divergen, y la que se olvide de recortar espacios diría
  // «no hay nadie» sobre una lista que sí tiene gente.
  return supervisoresConfigurados(env).length > 0;
}

/**
 * CÓMO SE LLAMAN ESTAS PERSONAS — el `id → nombre` para pintar una lista.
 *
 * Devuelve un objeto porque su destino es un JSON que el front indexa por id, y
 * **solo trae a quien tiene nombre de verdad** (`esNombreDeVerdad`): el resto no
 * viaja, y del otro lado cae a su `nombreCorto()` de siempre. Un id ausente y un
 * id cuyo «nombre» es su propio username son el mismo hecho —Hermes no sabe cómo
 * se llama— y tienen que verse igual.
 *
 * ⚠️ **La clave del objeto es el id CANÓNICO** (`lower(btrim)`), y el consumidor
 * tiene que normalizar antes de buscar. En producción el mismo humano tiene dos
 * grafías vivas (`Luz` de Cerberus, `luz` del login) y la lista de destinos sirve
 * la que escribió el operador: con `nombres[id]` a secas, la persona con el id
 * capitalizado no encuentra su nombre y nadie ve un error.
 *
 * ⚠️ **No tira nunca**, igual que todo este módulo: se consulta desde una ruta de
 * la mesa de trabajo y un nombre que no se pudo leer no puede costar la lista.
 * Sin tabla o con la consulta caída devuelve `{}` — que es «no sé cómo se llaman»,
 * o sea exactamente lo que se ve hoy.
 */
export async function nombresDe(
  base: typeof Base,
  ids: readonly string[],
): Promise<Record<string, string>> {
  const canonicos = [...new Set(ids.map(clavePersona).filter(Boolean))];
  if (canonicos.length === 0) return {};
  try {
    const filas = await base
      .select({ personaId: equipo.personaId, nombre: equipo.nombre })
      .from(equipo)
      .where(inArray(equipo.personaId, canonicos));
    const salida: Record<string, string> = {};
    for (const f of filas) {
      if (esNombreDeVerdad(f.personaId, f.nombre)) salida[f.personaId] = f.nombre.trim();
    }
    return salida;
  } catch (e) {
    if (!esTablaAusente(e)) {
      console.error(`[equipo] no se pudieron leer los nombres — ${porQueFallo(e)}`);
    }
    return {};
  }
}

/** Una persona para sembrar: el id ya canónico, con las grafías que se le vieron. */
export interface PersonaASembrar {
  personaId: string;
  nombre: string;
  rol: Rol;
  origen?: "cerberus" | "centurion";
  /** Las formas crudas que aparecen en la base (`Luz`, `luz`…). */
  grafias: readonly string[];
}

export interface ResultadoDeSiembra {
  personas: number;
  grafias: number;
  /** La tabla no está: la siembra no hizo nada y hay que decirlo, no fingir un 0. */
  sinTabla: boolean;
}

/**
 * SEMBRAR EL EQUIPO — idempotente, y **no pisa lo editado a mano**.
 *
 * Molde exacto de `sembrarAliasCurso`: `onConflictDoNothing` y corre al arranque.
 * 🔴 **No pisar es la mitad importante.** Esta siembra va a correr en cada
 * arranque del server durante todo el tiempo que dure la mudanza; con un upsert,
 * cada restart devolvería a su rol de fábrica a quien el admin acaba de cambiar
 * desde el panel — y el síntoma («se le volvió a caer el permiso») aparecería
 * horas después, atado a un deploy que nadie relaciona.
 */
export async function sembrarEquipo(
  base: typeof Base,
  personas: readonly PersonaASembrar[],
): Promise<ResultadoDeSiembra> {
  if (personas.length === 0) return { personas: 0, grafias: 0, sinTabla: false };
  try {
    const insertadas = await base
      .insert(equipo)
      .values(
        personas.map((p) => ({
          personaId: clavePersona(p.personaId),
          nombre: p.nombre,
          rol: p.rol,
          origen: p.origen ?? "cerberus",
          creadaPor: "siembra",
        })),
      )
      .onConflictDoNothing()
      .returning({ id: equipo.personaId });

    // Las grafías van DESPUÉS y en su propio insert: tienen FK a `equipo`, así
    // que si una persona no entró (ya existía) su grafía sí puede entrar igual.
    const grafias = personas.flatMap((p) =>
      p.grafias
        .filter((g) => g.trim() !== "")
        .map((g) => ({ grafia: g, personaId: clavePersona(p.personaId) })),
    );
    const grafiasInsertadas = grafias.length
      ? await base
          .insert(equipoGrafia)
          .values(grafias)
          .onConflictDoNothing()
          .returning({ g: equipoGrafia.grafia })
      : [];

    if (insertadas.length > 0) {
      await base.insert(equipoBitacora).values(
        insertadas.map((i) => ({
          quien: "siembra",
          fuente: "siembra",
          que: "alta",
          sobre: i.id,
          despues: personas.find((p) => clavePersona(p.personaId) === i.id) ?? null,
        })),
      );
    }
    return { personas: insertadas.length, grafias: grafiasInsertadas.length, sinTabla: false };
  } catch (e) {
    if (esTablaAusente(e)) return { personas: 0, grafias: 0, sinTabla: true };
    throw e;
  }
}

/** Quiénes están hoy en la tabla, para que un script pueda mostrar el antes y el después. */
export async function leerEquipo(base: typeof Base, soloActivas = false) {
  const q = base
    .select({
      personaId: equipo.personaId,
      nombre: equipo.nombre,
      rol: equipo.rol,
      origen: equipo.origen,
      activa: equipo.activa,
    })
    .from(equipo);
  const filas = soloActivas ? await q.where(eq(equipo.activa, true)) : await q;
  return filas.sort((a, b) => a.personaId.localeCompare(b.personaId));
}
