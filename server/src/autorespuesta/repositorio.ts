import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { autoRespuestaEstado, autoRespuestasPendientes } from '../db/schema.js';
import {
  EN_COLA_DE_ENVIO,
  ESPERAN_APROBACION,
  OCUPAN_RITMO,
  esEstado,
  type EstadoPendiente,
} from './estados.js';
import { encendidaEn, leerModo, type ModoAutoRespuesta } from './modo.js';
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
  /** El día LOCAL del ENVÍO (`YYYY-MM-DD`): la clave del «una por día». */
  diaLima: string;
  /**
   * En qué estado nace. Lo decide el MODO (`modo.ts`): `pendiente` sale sola,
   * `preparada` espera el OK de una persona. Sin valor: `pendiente`, que es lo
   * que escribía ADR 0015.
   */
  estado?: EstadoPendiente;
  /** La campaña/curso que eligió la plantilla. Es por lo que agrupa la bandeja. */
  campana?: string | null;
  /** De cuál de las tres fuentes salió esa campaña. Es el «por qué» (ADR 0018). */
  campanaFuente?: string | null;
}

export interface Pendiente extends NuevaPendiente {
  id: number;
}

/** Una fila con todo lo que la bandeja de revisión necesita para decidir. */
export interface PendienteVista extends Pendiente {
  estado: EstadoPendiente;
  motivo: string | null;
  aprobadaPor: string | null;
  aprobadaAt: Date | null;
  editada: boolean;
}

export interface EstadoInterruptor {
  /** Derivado de `modo`, y se guarda igual: lo lee el código de ADR 0015. */
  encendida: boolean;
  modo: ModoAutoRespuesta;
  motivo: string | null;
  actualizadoPor: string | null;
  actualizadoAt: Date | null;
}

/** El OK de una persona sobre una preparada. */
export interface Aprobacion {
  id: number;
  /** La hora nueva que le tocó en el reparto del lote (`aprobar.ts`). */
  programadoPara: Date;
  /** El texto final. Si difiere del guardado, la fila queda marcada como editada. */
  texto?: string;
  quien: string;
  ahora: Date;
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
  /**
   * Cancela TODO lo vivo de UNA conversación (la vendedora respondió). Incluye
   * lo que está esperando aprobación: si ella ya contestó a mano, aprobar el
   * acuse sería mandarle dos mensajes seguidos.
   */
  cancelarDeConversacion(clave: string, motivo: string): Promise<number>;
  /**
   * Frena la cola AUTOMÁTICA: entró el horario de atención y la máquina se
   * calla. NO toca lo aprobado por una persona ni lo que espera su OK — ese es
   * trabajo de la vendedora, y la razón de la regla (adentro del horario
   * contesta ella) no aplica cuando la que decidió mandar fue ella.
   */
  cancelarAutomaticas(motivo: string): Promise<number>;

  // ── Modo supervisado (ADR 0016) ───────────────────────────────────────────
  /** Lo que espera el OK de una persona, más viejo primero. Es la bandeja. */
  listarEsperandoAprobacion(): Promise<PendienteVista[]>;
  /**
   * Da el OK. Devuelve `false` si esa fila ya no estaba esperando aprobación
   * (otra vendedora la aprobó, o se descartó): la guarda es el `WHERE estado =
   * 'preparada'` de la base, no un chequeo previo que dos pestañas abiertas
   * pueden ganar las dos.
   */
  aprobar(a: Aprobacion): Promise<boolean>;
  /** «Esta no va» — decisión humana. Devuelve cuántas se descartaron de verdad. */
  descartar(ids: readonly number[], quien: string, motivo: string): Promise<number>;
  /** Nadie la aprobó a tiempo (`caducidad.ts`). */
  caducar(id: number, motivo: string): Promise<void>;
  /**
   * Lo que ya ocupa lugar de hoy en adelante (programado o enviado): alimenta
   * los techos. Es «desde» y no «de hoy» porque una corrida de las 21:30
   * programa para MAÑANA a las 7:30 — si los techos solo miraran el día de la
   * corrida, esa mañana se llenaría dos veces.
   */
  ocupacionDesde(diaLima: string): Promise<Ocupacion[]>;
  /** ¿Alguien de la casa escribió en esa conversación después de `desde`? */
  huboRespuestaHumana(p: { canal: string; telefono: string; numeroPropio: string; desde: Date }): Promise<boolean>;
  /** Las pendientes de hoy, para el simulacro y la pantalla de estado. */
  listarDelDia(diaLima: string): Promise<PendienteVista[]>;
  leerInterruptor(): Promise<EstadoInterruptor>;
  fijarModo(modo: ModoAutoRespuesta, motivo: string | null, quien: string): Promise<EstadoInterruptor>;
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
  modo: 'apagada',
  motivo: 'nunca se encendió',
  actualizadoPor: null,
  actualizadoAt: null,
};

export function repositorioDrizzle(base: typeof db): RepositorioAutoRespuesta {
  return {
    async encolar(p) {
      const [fila] = await base
        .insert(autoRespuestasPendientes)
        .values({ ...p, estado: p.estado ?? 'pendiente', campana: p.campana ?? null, campanaFuente: p.campanaFuente ?? null })
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
            // `EN_COLA_DE_ENVIO`, no un literal: lo que el despachador puede
            // mandar es `pendiente` (la automática) y `aprobada` (la que una
            // persona autorizó). `preparada` no está, y esa ausencia ES el modo
            // supervisado — el despachador no la ignora, no la ve.
            inArray(autoRespuestasPendientes.estado, [...EN_COLA_DE_ENVIO]),
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
        .where(
          and(
            eq(autoRespuestasPendientes.id, id),
            inArray(autoRespuestasPendientes.estado, [...EN_COLA_DE_ENVIO]),
          ),
        );
    },

    async cancelarDeConversacion(clave, motivo) {
      const filas = await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'cancelada', motivo, resueltoAt: new Date() })
        .where(
          and(
            eq(autoRespuestasPendientes.clave, clave),
            // También lo que espera aprobación: si la vendedora ya contestó a
            // mano, dejarlo en la bandeja es invitarla a mandar el segundo.
            inArray(autoRespuestasPendientes.estado, [...EN_COLA_DE_ENVIO, ...ESPERAN_APROBACION]),
          ),
        )
        .returning({ id: autoRespuestasPendientes.id });
      return filas.length;
    },

    async cancelarAutomaticas(motivo) {
      const filas = await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'cancelada', motivo, resueltoAt: new Date() })
        .where(eq(autoRespuestasPendientes.estado, 'pendiente'))
        .returning({ id: autoRespuestasPendientes.id });
      return filas.length;
    },

    async listarEsperandoAprobacion() {
      const filas = await base
        .select()
        .from(autoRespuestasPendientes)
        .where(inArray(autoRespuestasPendientes.estado, [...ESPERAN_APROBACION]))
        .orderBy(asc(autoRespuestasPendientes.programadoPara));
      return filas.map(aVista);
    },

    async aprobar(a) {
      const filas = await base
        .update(autoRespuestasPendientes)
        .set({
          estado: 'aprobada',
          programadoPara: a.programadoPara,
          aprobadaPor: a.quien,
          aprobadaAt: a.ahora,
          ...(a.texto !== undefined ? { texto: a.texto, editada: true } : {}),
        })
        // LA GUARDA VIVE ACÁ, no en un `if` de arriba: dos pestañas abiertas
        // pueden leer «preparada» las dos y aprobar las dos. Gana el UPDATE que
        // llegó primero; el segundo no afecta ninguna fila y devuelve false.
        .where(
          and(
            eq(autoRespuestasPendientes.id, a.id),
            inArray(autoRespuestasPendientes.estado, [...ESPERAN_APROBACION]),
          ),
        )
        .returning({ id: autoRespuestasPendientes.id });
      return filas.length > 0;
    },

    async descartar(ids, quien, motivo) {
      if (ids.length === 0) return 0;
      const filas = await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'descartada', motivo: `${motivo} (${quien})`, resueltoAt: new Date() })
        .where(
          and(
            inArray(autoRespuestasPendientes.id, [...ids]),
            inArray(autoRespuestasPendientes.estado, [...ESPERAN_APROBACION]),
          ),
        )
        .returning({ id: autoRespuestasPendientes.id });
      return filas.length;
    },

    async caducar(id, motivo) {
      await base
        .update(autoRespuestasPendientes)
        .set({ estado: 'caducada', motivo, resueltoAt: new Date() })
        .where(
          and(
            eq(autoRespuestasPendientes.id, id),
            inArray(autoRespuestasPendientes.estado, [...ESPERAN_APROBACION]),
          ),
        );
    },

    async ocupacionDesde(diaLima) {
      const filas = await base
        .select({
          numeroPropio: autoRespuestasPendientes.numeroPropio,
          programadoPara: autoRespuestasPendientes.programadoPara,
        })
        .from(autoRespuestasPendientes)
        .where(
          and(
            gte(autoRespuestasPendientes.diaLima, diaLima),
            // `OCUPAN_RITMO`: lo preparado también reserva. Ver `estados.ts`.
            inArray(autoRespuestasPendientes.estado, [...OCUPAN_RITMO]),
          ),
        );
      return filas.map((f) => ({ numeroPropio: f.numeroPropio, cuando: f.programadoPara }));
    },

    async huboRespuestaHumana({ canal, telefono, numeroPropio, desde }) {
      // El saliente puede no haber pasado por Hermes: si la vendedora contesta
      // desde su teléfono, whatsmeow lo ingesta igual. Por eso se mira la
      // conversación (interactions), no `envios_wa`.
      //
      // El corte viaja como STRING ISO con cast explícito: un `Date` como
      // parámetro de `execute()` revienta en el bind (gotcha ya documentado en
      // `dashboard/series.ts`; lo confirmó CI en este mismo PR).
      const corte = desde.toISOString();
      const filas = await base.execute<{ hay: number }>(sql`
        SELECT 1 AS hay
        FROM interactions i
        JOIN events e ON e.id = i.event_id
        WHERE i.tipo = 'mensaje'
          AND i.canal = ${canal}
          AND i.persona_id = ${telefono}
          AND i.direccion = 'saliente'
          AND COALESCE(e.payload->>'numeroPropio', '') = ${numeroPropio}
          AND i.occurred_at > ${corte}::timestamptz
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
      return filas.map(aVista);
    },

    async leerInterruptor() {
      const [fila] = await base.select().from(autoRespuestaEstado).where(eq(autoRespuestaEstado.id, 1));
      if (!fila) return APAGADO_POR_DEFECTO;
      return aInterruptor(fila);
    },

    async fijarModo(modo, motivo, quien) {
      // Se escriben las DOS: `modo` es la verdad y `encendida` su sombra, para
      // que un rollback al código de ADR 0015 siga leyendo algo cierto.
      const valores = {
        modo,
        encendida: encendidaEn(modo),
        motivo,
        actualizadoPor: quien,
        actualizadoAt: new Date(),
      };
      const [fila] = await base
        .insert(autoRespuestaEstado)
        .values({ id: 1, ...valores })
        .onConflictDoUpdate({ target: autoRespuestaEstado.id, set: valores })
        .returning();
      return aInterruptor(fila);
    },
  };
}

type FilaPendiente = typeof autoRespuestasPendientes.$inferSelect;
type FilaEstado = typeof autoRespuestaEstado.$inferSelect;

function aInterruptor(f: FilaEstado): EstadoInterruptor {
  const modo = leerModo({ modo: f.modo, encendida: f.encendida });
  return {
    modo,
    // Del MODO, no de la columna: si las dos se contradijeran (un rollback a
    // medias, un UPDATE a mano), la que manda es la que tiene tres valores.
    encendida: encendidaEn(modo),
    motivo: f.motivo,
    actualizadoPor: f.actualizadoPor,
    actualizadoAt: f.actualizadoAt,
  };
}

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
    estado: esEstado(f.estado) ? f.estado : 'cancelada',
    campana: f.campana,
    campanaFuente: f.campanaFuente,
  };
}

function aVista(f: FilaPendiente): PendienteVista {
  return {
    ...aPendiente(f),
    // Un estado que no reconozco NO se muestra como aprobable. `cancelada` es
    // el balde inerte: se ve, no se puede tocar y no sale.
    estado: esEstado(f.estado) ? f.estado : 'cancelada',
    motivo: f.motivo,
    aprobadaPor: f.aprobadaPor,
    aprobadaAt: f.aprobadaAt,
    editada: f.editada,
  };
}
