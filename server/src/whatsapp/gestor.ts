import { normalizarTelefono } from './identidadWa.js';
import type { EnvioControlado } from './envioControlado.js';
import type { TransporteFalso } from './transporteFalso.js';
import type { TransporteWhatsapp } from './transporte.js';

/**
 * QUÉ LÍNEAS CORREN Y CÓMO SE LAS ENCUENTRA — la parte pura de #50.
 *
 * Vive aparte de `wiring.ts` a propósito: aquél importa el repositorio Drizzle y
 * por lo tanto `db/client.ts`, que **tira al importarse si falta `DATABASE_URL`**.
 * Con las dos cosas en el mismo archivo, decidir qué números levantar no se podía
 * testear sin una base — y es justo la decisión que hay que poder interrogar,
 * porque de ella depende que producción levante igual que ayer.
 *
 * Es el mismo corte que el resto del repo ya hace: el criterio puro de un lado,
 * el cableado con la base del otro.
 */

export interface WhatsappArmado {
  /** El número propio de esta línea, normalizado. Es la clave del gestor. */
  numero: string;
  transporte: TransporteWhatsapp;
  envio: EnvioControlado;
  /** Solo si corre el falso — para la ruta de dev que inyecta mensajes. */
  falso: TransporteFalso | null;
}

/**
 * Los números a levantar, en orden. `WHATSAPP_NUMEROS` (coma) gana; si no está,
 * `WHATSAPP_NUMERO` — el comportamiento de siempre.
 *
 * **El fallback no es comodidad: es que producción no se entere.** VPS1 levanta
 * sin tocar una variable y con el mismo comportamiento de hoy. Un cambio de
 * arranque que exige editar el entorno del server es un cambio que puede dejar
 * la línea de producción abajo justo en el reinicio.
 *
 * Se normalizan y se deduplican: la misma sesión `.db` abierta dos veces es un
 * conflicto de escritura de SQLite, no una línea de más.
 */
export function numerosConfigurados(env: NodeJS.ProcessEnv = process.env): string[] {
  const crudo = env.WHATSAPP_NUMEROS ?? env.WHATSAPP_NUMERO ?? '';
  const vistos = new Set<string>();
  const numeros: string[] = [];
  for (const parte of crudo.split(',')) {
    const n = normalizarTelefono(parte.trim());
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    numeros.push(n);
  }
  return numeros;
}

/** El gestor: N líneas vivas, direccionadas por su número propio. */
export class GestorWhatsapp {
  private porNumero = new Map<string, WhatsappArmado>();
  /** El orden de arranque: `primero()` devuelve el de esta lista. */
  private orden: string[] = [];

  agregar(armado: WhatsappArmado): void {
    if (this.porNumero.has(armado.numero)) {
      throw new Error(`El número ${armado.numero} ya está montado: dos sesiones sobre la misma .db se pisan.`);
    }
    this.porNumero.set(armado.numero, armado);
    this.orden.push(armado.numero);
  }

  /**
   * La línea de un número. `null` si no está montada — **nunca cae al primero**.
   *
   * Devolver el primero ante un número desconocido sería exactamente el defecto
   * que este frente existe para evitar: el envío saldría, bien auditado, por la
   * línea de otra persona. Que devuelva `null` obliga a quien llama a decidir
   * qué hacer con un número que no corre.
   */
  de(numero: string): WhatsappArmado | null {
    const n = normalizarTelefono(numero);
    return n ? (this.porNumero.get(n) ?? null) : null;
  }

  /** El primero que arrancó: para los consumidores de una sola línea. */
  primero(): WhatsappArmado {
    const n = this.orden[0];
    const a = n ? this.porNumero.get(n) : undefined;
    if (!a) throw new Error('WhatsApp no está arrancado todavía.');
    return a;
  }

  numeros(): string[] {
    return [...this.orden];
  }

  todos(): WhatsappArmado[] {
    return this.orden.map((n) => this.porNumero.get(n)!);
  }
}
