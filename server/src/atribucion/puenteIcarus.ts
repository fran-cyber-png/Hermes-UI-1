import type { db } from "../db/client.js";
import { leerEventoCerberus, ventaDeEvento } from "./payload.js";
import { proyectarVenta } from "./proyectarVenta.js";
import { resolverConversacion } from "./resolverConversacion.js";
import type { ComoSeAtribuyo, MotivoSinAtribuir } from "./venta.js";

/**
 * ⚠️ EL PUENTE TEMPORAL — se apaga solo, y está escrito para que se pueda apagar.
 *
 * ── Por qué existe ──
 * Cerberus manda un webhook por cada venta desde hace meses. **No llega a Hermes**: el emisor es
 * mono-destino (`ceberusapp/sales/icarus_payload.py:471`, una sola env
 * `ICARUS_CERBERUS_WEBHOOK_URL`) y esa URL apunta a **icarus** — verificado en el `.env` de
 * producción de Cerberus. Icarus guarda cada payload crudo en `icarus.cerberus_events`
 * (7.566 filas al 2026-07-27, la última de ese mismo día).
 *
 * O sea: **los eventos ya existen, ya son de Cerberus, y están al lado.** Esperar el fan-out
 * para empezar a atribuir sería dejar la plata sin contar durante semanas por una variable de
 * entorno de otro repo.
 *
 * ── Por qué se apaga y no se queda ──
 * Icarus **no es el espejo de Cerberus**: es la plataforma multi-tenant de los clientes de
 * consultoría (`icarus_api:8092`, `icarus_tejada_api:8093`), y sirve a un cliente real. Que las
 * ventas de la Escuela estén ahí es un desvío, no un diseño. Construir algo permanente sobre
 * icarus sería hornear ese desvío. Por eso este archivo lee **una sola tabla**, **de solo
 * lectura**, y produce exactamente lo mismo que produciría el webhook.
 *
 * ── Por qué NO cambia nada el día del fan-out ──
 * El puente no interpreta: toma el `payload` crudo y lo pasa por `leerEventoCerberus` +
 * `ventaDeEvento` + `proyectarVenta` — el MISMO camino que `webhook/ruta.ts`. Es literalmente
 * el mismo JSON. Cuando Cerberus postee también a Hermes, se deja de correr el script y no hay
 * una línea que tocar: no hay un segundo modelo que retirar.
 *
 * ── El costo, dicho de frente ──
 * Una venta = una consulta de resolución sobre `interactions`, y el prefiltro por sufijo no usa
 * índice (es una función sobre la columna). Con 7.566 eventos y 6.767 interacciones eso son
 * segundos; el día que `interactions` tenga cientos de miles de filas, hay que correrlo con
 * `--desde`. No se optimiza antes de que duela: esto se apaga.
 */

/** Una fila de `icarus.cerberus_events`, tal como la devuelve el driver. */
export interface EventoGuardado {
  id: number | string;
  payload: unknown;
}

export interface ResumenPuente {
  leidos: number;
  /** Payloads que no validaron contra el contrato. Se cuentan, no se tragan. */
  invalidos: number;
  /** `products.sync`, `sale.deleted` y eventos sin id de venta: no hay nada que proyectar. */
  noSonVenta: number;
  atribuidas: Record<ComoSeAtribuyo, number>;
  sinAtribuir: Record<MotivoSinAtribuir, number>;
  /** Los primeros motivos de rechazo, para poder mirarlos sin abrir la base. */
  ejemplosInvalidos: string[];
  /** El último id procesado: el cursor para la próxima corrida. */
  ultimoId: number | string | null;
}

export function resumenVacio(): ResumenPuente {
  return {
    leidos: 0,
    invalidos: 0,
    noSonVenta: 0,
    atribuidas: { llave: 0, telefono_e164: 0, telefono_sufijo: 0 },
    sinAtribuir: { sin_telefono: 0, sin_conversacion: 0, sin_llave_natural: 0 },
    ejemplosInvalidos: [],
    ultimoId: null,
  };
}

export function sumarResumen(a: ResumenPuente, b: ResumenPuente): ResumenPuente {
  return {
    leidos: a.leidos + b.leidos,
    invalidos: a.invalidos + b.invalidos,
    noSonVenta: a.noSonVenta + b.noSonVenta,
    atribuidas: {
      llave: a.atribuidas.llave + b.atribuidas.llave,
      telefono_e164: a.atribuidas.telefono_e164 + b.atribuidas.telefono_e164,
      telefono_sufijo: a.atribuidas.telefono_sufijo + b.atribuidas.telefono_sufijo,
    },
    sinAtribuir: {
      sin_telefono: a.sinAtribuir.sin_telefono + b.sinAtribuir.sin_telefono,
      sin_conversacion: a.sinAtribuir.sin_conversacion + b.sinAtribuir.sin_conversacion,
      sin_llave_natural: a.sinAtribuir.sin_llave_natural + b.sinAtribuir.sin_llave_natural,
    },
    ejemplosInvalidos: [...a.ejemplosInvalidos, ...b.ejemplosInvalidos].slice(0, 5),
    ultimoId: b.ultimoId ?? a.ultimoId,
  };
}

/**
 * Procesa un lote de eventos guardados.
 *
 * `aplicar: false` (el default) **no escribe nada**: resuelve la conversación —que es una
 * consulta— y cuenta. Sirve para medir cuánto cerraría el puente antes de dejarlo escribir.
 * Es el mismo espíritu que `auto:simulacro` y `plantillas:proponer`.
 */
export async function procesarLote(
  base: typeof db,
  filas: EventoGuardado[],
  opciones: { aplicar?: boolean } = {},
): Promise<ResumenPuente> {
  const r = resumenVacio();

  for (const fila of filas) {
    r.leidos++;
    r.ultimoId = fila.id;

    const lectura = leerEventoCerberus(fila.payload);
    if (!lectura.ok) {
      r.invalidos++;
      if (r.ejemplosInvalidos.length < 5) r.ejemplosInvalidos.push(lectura.motivo);
      continue;
    }

    const venta = ventaDeEvento(lectura.evento, "puente-icarus");
    if (!venta) {
      r.noSonVenta++;
      continue;
    }

    if (!opciones.aplicar) {
      const conv = await resolverConversacion(base, venta);
      if (conv) r.atribuidas[conv.como]++;
      else if (venta.cliente.telefonos.length === 0) r.sinAtribuir.sin_telefono++;
      else r.sinAtribuir.sin_conversacion++;
      continue;
    }

    const resultado = await proyectarVenta(base, venta);
    if (resultado.atribuida) r.atribuidas[resultado.como]++;
    else r.sinAtribuir[resultado.motivo]++;
  }

  return r;
}
