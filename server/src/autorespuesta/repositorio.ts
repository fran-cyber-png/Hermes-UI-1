import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { autoRespuestaEstado, autoRespuestasPendientes } from '../db/schema.js';
import type { Ocupacion } from './programar.js';

/**
 * LA COLA, DEL LADO DE LA BASE — el único módulo de esta feature que escribe.
 *
 * Es un PUERTO (interfaz) + su implementación con Drizzle, igual que
 * `RegistroEnvios` en `whatsapp/envioControlado.ts`. El despachador habla con la
 * interfaz, así que sus tests pueden fijar el freno por ban o la cancelación por
 * respuesta humana sin una Postgres al lado; los tests con base
 * (`*.test.db.ts`) prueban ESTA implementación contra SQL de verdad.
 *
 * `base` va inyectada (`typeof db`): producción le pasa el singleton, el test su
 * base aislada. Es el mismo patrón de `consultarCola(base, …)` — ver ADR 0008.
 */

export interface NuevaPendiente {
  clave: string;
  canal: string;
  telefono: string;
  numeroPropio: string;
  personaNombre: string | null;
  plantillaId: string;
  texto: string;
  disparadaPor: Date;
  programadoPara: Date;
  /** El día LOCAL al que cuenta (`YYYY-MM-DD`): la clave del «una por día». */
  diaLima: string;
}

export interface Pendiente extends NuevaPendiente {
  id: number;
}

export interface EstadoInterruptor {
  encendida: boolean;
  motivo: string | null;
  actualizadoPor: string | null;
  actualizadoAt: Date | null;
}

export interface RepositorioAutoRespuesta {
  /**
   * Encola una. Devuelve `null` si esa conversación YA tiene una hoy — el
   * UNIQUE de la tabla es el que decide, no un `if` que se puede olvidar.
   */
  encolar(p: NuevaPendiente): Promise<Pendiente | null>;
  /** La más vieja que ya venció (`programado_para <= ahora`). Una, no una lista. */
  proximaVencida(ahora: Date): Promise<Pendiente | null>;
  marcarEnviada(id: number, idExterno: string, cuando: Date): Promise<void>;
  marcarFallida(id: number, motivo: string): Promise<void>;
  cancelar(id: number, motivo: string): Promise<void>;
  /** Cancela lo pendiente de UNA conversación (la vendedora respondió). */
  cancelarDeConversacion(clave: string, motivo: string): Promise<number>;
  /** Frena la cola entera: entró el horario laboral, o hubo que parar. */
  cancelarTodas(motivo: string): Promise<number>;
  /** Lo que ya ocupa lugar hoy (programado o enviado): alimenta los techos. */
  ocupacionDelDia(diaLima: string): Promise<Ocupacion[]>;
  /** ¿Alguien de la casa escribió en esa conversación después de `desde`? */
  huboRespuestaHumana(p: { canal: string; telefono: string; numeroPropio: string; desde: Date }): Promise<boolean>;
  /** Las pendientes de hoy, para el simulacro y la pantalla de estado. */
  listarDelDia(diaLima: string): Promise<(Pendiente & { estado: string; motivo: string | null })[]>;
  leerInterruptor(): Promise<EstadoInterruptor>;
  fijarInterruptor(encendida: boolean, motivo: string | null, quien: string): Promise<EstadoInterruptor>;
}

/**
 * ¿El error es «esa tabla/columna todavía no existe»? El `db:push` de esta
 * feature es MANUAL (ver ADR 0015), así que entre el deploy del código y el
 * push hay una ventana en la que el esquema viejo sigue vivo. Nada de lo que
 * agrega la auto-respuesta puede tumbar una pantalla en esa ventana: quien
 * consulta degrada, no revienta. 42P01 = tabla ausente, 42703 = columna ausente.
 */
export function faltaEsquema(e: unknown): boolean {
  for (let actual: unknown = e, saltos = 0; actual != null && saltos < 5; saltos++) {
    if (typeof actual !== 'object') break;
    const codigo = (actual as { code?: string }).code;
    if (codigo === '42P01' || codigo === '42703') return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * «La vendedora respondió»: cancela lo que hubiera en cola para esa
 * conversación. Se llama desde la ruta de envío, y si el esquema todavía no
 * está, NO rompe el envío — cancelar es una cortesía, mandar es lo importante.
 */
export async function cancelarPorRespuestaHumana(base: typeof db, clave: string): Promise<number> {
  if (!clave) return 0;
  try {
    return await repositorioDrizzle(base).cancelarDeConversacion(
      clave,
      'la vendedora respondió antes: la automática ya no hace falta',
    );
  } catch (e) {
    if (faltaEsquema(e)) return 0;
    throw e;
  }
}

const APAGADO_POR_DEFECTO: EstadoInterruptor = {
  encendida: false,
  motivo: 'nunca se encendió',
  actualizadoPor: null,
  actualizadoAt: null,
};

export function repositorioDrizzle(base: typeof db): RepositorioAutoRespuesta {
  return {
    async encolar(p) {
      const [fila] = await base
        .insert(autoRespuestasPendientes)
        .values({ ...p, estado: 'pendiente' })
        // El conflicto NO es un error: es «esta conversación ya tuvo la suya
        // hoy». La garantía vive en el UNIQUE (clave, dia_lima).
        .onConflictDoNothing({ target: [autoRespuestasPendientes.clave, autoRespuestasPendientes.diaLima] })
        .returning({ id: autoRespuestasPendientes.id });
      return fila ? { ...p, id: fila.id } : null;
    },

    async proximaVencida(ahora) {
      const [fila] = await base
        .select()
        .from(autoRespuestasPendientes)
        .where(
          and(
            eq(autoRespuestasPendientes.estado, 'pendiente'),
            lte(autoRespuestasPendientes.programadoPara, ahora),
          ),
        )
        .orderBy(asc(autoRespuestasPendientes.programadoPara))
        .limit(1);
      return fila ? aPendiente(fila) : null;
    },

    async marcarEnviada(id, idExterno, cuando) {
      await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'enviada', idExterno, resueltoAt: cuando })
        .where(eq(autoRespuestasPendientes.id, id));
    },

    async marcarFallida(id, motivo) {
      await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'fallida', motivo, resueltoAt: new Date() })
        .where(eq(autoRespuestasPendientes.id, id));
    },

    async cancelar(id, motivo) {
      await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'cancelada', motivo, resueltoAt: new Date() })
        .where(and(eq(autoRespuestasPendientes.id, id), eq(autoRespuestasPendientes.estado, 'pendiente')));
    },

    async cancelarDeConversacion(clave, motivo) {
      const filas = await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'cancelada', motivo, resueltoAt: new Date() })
        .where(and(eq(autoRespuestasPendientes.clave, clave), eq(autoRespuestasPendientes.estado, 'pendiente')))
        .returning({ id: autoRespuestasPendientes.id });
      return filas.length;
    },

    async cancelarTodas(motivo) {
      const filas = await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'cancelada', motivo, resueltoAt: new Date() })
        .where(eq(autoRespuestasPendientes.estado, 'pendiente'))
        .returning({ id: autoRespuestasPendientes.id });
      return filas.length;
    },

    async ocupacionDelDia(diaLima) {
      const filas = await base
        .select({
          numeroPropio: autoRespuestasPendientes.numeroPropio,
          programadoPara: autoRespuestasPendientes.programadoPara,
        })
        .from(autoRespuestasPendientes)
        .where(
          and(
            eq(autoRespuestasPendientes.diaLima, diaLima),
            inArray(autoRespuestasPendientes.estado, ['pendiente', 'enviada']),
          ),
        );
      return filas.map((f) => ({ numeroPropio: f.numeroPropio, cuando: f.programadoPara }));
    },

    async huboRespuestaHumana({ canal, telefono, numeroPropio, desde }) {
      // El saliente puede no haber pasado por Hermes: si la vendedora contesta
      // desde su teléfono, whatsmeow lo ingesta igual. Por eso se mira la
      // conversación (interactions), no `envios_wa`.
      const filas = await base.execute<{ hay: number }>(sql`
        SELECT 1 AS hay
        FROM interactions i
        JOIN events e ON e.id = i.event_id
        WHERE i.tipo = 'mensaje'
          AND i.canal = ${canal}
          AND i.persona_id = ${telefono}
          AND i.direccion = 'saliente'
          AND COALESCE(e.payload->>'numeroPropio', '') = ${numeroPropio}
          AND i.occurred_at > ${desde}
        LIMIT 1
      `);
      return filas.length > 0;
    },

    async listarDelDia(diaLima) {
      const filas = await base
        .select()
        .from(autoRespuestasPendientes)
        .where(eq(autoRespuestasPendientes.diaLima, diaLima))
        .orderBy(asc(autoRespuestasPendientes.programadoPara));
      return filas.map((f) => ({ ...aPendiente(f), estado: f.estado, motivo: f.motivo }));
    },

    async leerInterruptor() {
      const [fila] = await base.select().from(autoRespuestaEstado).where(eq(autoRespuestaEstado.id, 1));
      if (!fila) return APAGADO_POR_DEFECTO;
      return {
        encendida: fila.encendida,
        motivo: fila.motivo,
        actualizadoPor: fila.actualizadoPor,
        actualizadoAt: fila.actualizadoAt,
      };
    },

    async fijarInterruptor(encendida, motivo, quien) {
      const valores = { encendida, motivo, actualizadoPor: quien, actualizadoAt: new Date() };
      const [fila] = await base
        .insert(autoRespuestaEstado)
        .values({ id: 1, ...valores })
        .onConflictDoUpdate({ target: autoRespuestaEstado.id, set: valores })
        .returning();
      return {
        encendida: fila.encendida,
        motivo: fila.motivo,
        actualizadoPor: fila.actualizadoPor,
        actualizadoAt: fila.actualizadoAt,
      };
    },
  };
}

type FilaPendiente = typeof autoRespuestasPendientes.$inferSelect;

function aPendiente(f: FilaPendiente): Pendiente {
  return {
    id: f.id,
    clave: f.clave,
    canal: f.canal,
    telefono: f.telefono,
    numeroPropio: f.numeroPropio,
    personaNombre: f.personaNombre,
    plantillaId: f.plantillaId,
    texto: f.texto,
    disparadaPor: f.disparadaPor,
    programadoPara: f.programadoPara,
    diaLima: f.diaLima,
  };
}
