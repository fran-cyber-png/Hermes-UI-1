import type { TransporteWhatsapp } from './transporte.js';

/**
 * LA ÚNICA PUERTA DE SALIDA HACIA WHATSAPP.
 *
 * Nadie llama `transporte.enviarTexto` directo. Todo envío pasa por acá, y esta
 * es la diferencia entre "un chat manejado por un humano" y "un bot": cada envío
 * exige una vendedora identificada, queda auditado con su nombre, y respeta dos
 * frenos que un bot no tendría —
 *
 *   · el CORTA-CORRIENTE: un freno global que apaga TODOS los envíos de una, para
 *     cuando algo se dispara solo o hay que parar en seco;
 *   · el ESTADO DE LA SESIÓN: si el número está baneado o desconectado, el envío
 *     se rechaza con motivo visible y NO se reintenta — escribir contra un número
 *     muerto solo empeora el ban.
 *
 * No existe forma de mandarle una lista: la firma es `enviar(unaOrden)`, un
 * destinatario. Que no haya envío masivo no es una regla escrita en un doc, es la
 * forma del código.
 */

export interface OrdenEnvio {
  /** Quién manda. Sin vendedora identificada no hay envío (invariante). */
  vendedoraId: string;
  /** Desde qué número propio de Goberna sale. */
  numeroPropio: string;
  /** A quién (teléfono del contacto). */
  telefono: string;
  texto: string;
  /** La conversación de referencia: ata el envío a un contexto, no es un disparo suelto. */
  referencia: string;
}

export type ResultadoControlado =
  | { ok: true; idExterno: string; ocurridoEn: Date }
  | { ok: false; motivo: string };

/**
 * El registro de auditoría de envíos. Es SEPARADO de la interacción saliente (esa
 * la persiste la ingesta cuando el transporte hace eco del mensaje enviado): acá
 * vive el "quién, cuándo, con qué resultado", incluidos los intentos bloqueados.
 */
export interface RegistroEnvios {
  /** Anota el intento (estado pendiente). Devuelve el id de la fila de auditoría. */
  registrarIntento(orden: OrdenEnvio): Promise<number>;
  marcarEnviado(id: number, idExterno: string, ocurridoEn: Date): Promise<void>;
  marcarFallido(id: number, motivo: string): Promise<void>;
}

export class EnvioControlado {
  constructor(
    private transporte: TransporteWhatsapp,
    private registro: RegistroEnvios,
    /** El freno global. Por defecto apagado; se enciende para parar todo en seco. */
    private cortaCorriente: () => boolean = () => false,
  ) {}

  async enviar(orden: OrdenEnvio): Promise<ResultadoControlado> {
    // Validación dura: una orden sin vendedora, número, destinatario, texto o
    // referencia no es un envío real — es un bug de quien llama. Se rechaza sin
    // auditar (no ensuciamos el registro con órdenes malformadas).
    if (!orden.vendedoraId || !orden.numeroPropio || !orden.telefono || !orden.texto.trim() || !orden.referencia) {
      return { ok: false, motivo: 'faltan datos obligatorios del envío (vendedora, número, teléfono, texto o referencia)' };
    }

    // A partir de acá es un intento REAL: se audita, pase lo que pase.
    const auditId = await this.registro.registrarIntento(orden);

    // El corta-corriente gana sobre todo. El intento queda registrado como
    // bloqueado, pero el transporte no se toca.
    if (this.cortaCorriente()) {
      const motivo = 'envíos frenados: el corta-corriente está activo';
      await this.registro.marcarFallido(auditId, motivo);
      return { ok: false, motivo };
    }

    // La sesión tiene que estar conectada. Baneado / desconectado / sin vincular →
    // rechazo visible, cero llamadas al transporte, cero reintentos.
    const estado = this.transporte.estado();
    if (estado.estado !== 'conectado') {
      const motivo =
        estado.estado === 'baneado'
          ? `el número está suspendido por WhatsApp (código ${estado.codigo}); se levanta ${estado.expira}`
          : `la sesión está "${estado.estado}", no conectada`;
      await this.registro.marcarFallido(auditId, motivo);
      return { ok: false, motivo };
    }

    // El envío. Si el transporte falla —incluido el ban que llega JUSTO entre el
    // chequeo de arriba y esta línea (TOCTOU)— queda como intento fallido auditado,
    // nunca como un saliente fantasma.
    try {
      const r = await this.transporte.enviarTexto(orden.telefono, orden.texto);
      await this.registro.marcarEnviado(auditId, r.idExterno, r.ocurridoEn);
      return { ok: true, idExterno: r.idExterno, ocurridoEn: r.ocurridoEn };
    } catch (err) {
      const motivo = (err as Error).message;
      await this.registro.marcarFallido(auditId, motivo);
      return { ok: false, motivo };
    }
  }
}
