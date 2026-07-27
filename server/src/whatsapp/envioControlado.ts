import type { MediaSaliente, ResultadoEnvio, TransporteWhatsapp } from './transporte.js';
import { normalizarTelefono } from './identidadWa.js';
import { A_MANO, type Procedencia } from '../procedencia/pieza.js';

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
  /**
   * LA EXCEPCIÓN, DECLARADA (#125, ADR 0015). `true` solo para la auto-respuesta
   * fuera de horario: acuses a gente que escribió PRIMERO, en la franja en que
   * no hay nadie, con techos y freno.
   *
   * Está acá y no en un camino paralelo a propósito: la excepción tiene que
   * pasar por la MISMA puerta que todo lo demás —mismo corta-corriente, mismo
   * chequeo de ban, misma auditoría— y quedar marcada en `envios_wa` para que
   * dentro de un mes se pueda distinguir qué mandó una persona y qué la
   * máquina. Ausente o `false` = lo apretó un humano, como siempre.
   */
  automatico?: boolean;
  /**
   * DE QUÉ PIEZA SALIÓ (épica #169). Ausente = `A_MANO`, que **no es un hueco:
   * es la línea de base** contra la que se compara todo lo demás.
   *
   * Vive en la orden y no en un `update` posterior por la misma razón que
   * `automatico`: pasa por la MISMA puerta, se audita en la MISMA fila, y un
   * envío bloqueado también deja escrito qué se iba a mandar. Si la procedencia
   * se anotara aparte, un fallo entre las dos escrituras dejaría un envío
   * huérfano — y un envío sin procedencia se cuenta como escrito a mano, o sea
   * que el error ensuciaría justo la línea de base.
   */
  procedencia?: Procedencia;
}

/** Una orden de adjunto: mismas exigencias que el texto + el archivo a mandar. */
export interface OrdenEnvioMedia extends Omit<OrdenEnvio, 'texto'> {
  media: MediaSaliente;
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
    const lineaAjena = this.lineaAjena(orden);
    if (lineaAjena) return lineaAjena;
    return this.conGuardas(
      { ...orden, procedencia: orden.procedencia ?? A_MANO },
      () => this.transporte.enviarTexto(orden.telefono, orden.texto),
    );
  }

  /**
   * Un adjunto (imagen, video, audio o documento) por la MISMA puerta: idénticas
   * guardas, idéntica auditoría. En el registro, el "texto" del intento es el
   * caption o una descripción del archivo — el quién/cuándo/qué no se pierde.
   */
  async enviarMedia(orden: OrdenEnvioMedia): Promise<ResultadoControlado> {
    if (!orden.vendedoraId || !orden.numeroPropio || !orden.telefono || !orden.referencia || !orden.media?.ruta) {
      return { ok: false, motivo: 'faltan datos obligatorios del envío (vendedora, número, teléfono, archivo o referencia)' };
    }
    const lineaAjena = this.lineaAjena(orden);
    if (lineaAjena) return lineaAjena;
    const descripcion = orden.media.texto?.trim() || `[${orden.media.clase}] ${orden.media.nombre ?? orden.media.mime}`;
    return this.conGuardas(
      { ...orden, texto: descripcion, procedencia: orden.procedencia ?? A_MANO },
      () => this.transporte.enviarMedia(orden.telefono, orden.media),
    );
  }

  /**
   * GUARDA #0 — que un envío no salga por la LÍNEA EQUIVOCADA (#50).
   *
   * Con un solo transporte esta comprobación no tenía sentido: había una sola
   * línea y `numeroPropio` no podía discrepar de nada. Con varias vivas a la vez,
   * el enrutado lo hace el gestor y **un error de enrutado es invisible desde
   * adentro**: el mensaje sale bien, se audita bien, y llega desde un número que
   * el lead no conoce. Para él no es «Goberna otra vez», es un desconocido
   * escribiéndole en otro chat — y la respuesta se pierde en un hilo que la
   * vendedora que atendía no está mirando.
   *
   * Se rechaza **sin auditar**, igual que la validación dura de arriba y por el
   * mismo motivo: una orden enrutada al transporte equivocado no es un envío que
   * falló, es un bug de quien llama. Anotarla en `envios_wa` ensuciaría la
   * auditoría —y la línea de base del lazo— con algo que nunca se intentó mandar.
   *
   * La comparación es sobre dígitos normalizados: `+51 986…` y `51986…` son la
   * misma línea, y hacer fallar un envío por un `+` sería un guardarraíl que
   * estorba en vez de proteger.
   */
  private lineaAjena(orden: { numeroPropio: string }): { ok: false; motivo: string } | null {
    const delTransporte = normalizarTelefono(this.transporte.numeroPropio);
    const deLaOrden = normalizarTelefono(orden.numeroPropio);
    // Un transporte sin número propio (el falso sin vincular) no puede afirmar
    // que la orden sea ajena: sin con qué comparar, no se inventa un veredicto.
    if (!delTransporte || !deLaOrden || delTransporte === deLaOrden) return null;
    return {
      ok: false,
      motivo: `la orden sale por ${orden.numeroPropio} y este transporte es ${this.transporte.numeroPropio}: envío enrutado a la línea equivocada`,
    };
  }

  /** El corazón compartido: auditar, frenar (corta-corriente, sesión) y ejecutar. */
  private async conGuardas(ordenAuditada: OrdenEnvio, ejecutar: () => Promise<ResultadoEnvio>): Promise<ResultadoControlado> {
    // A partir de acá es un intento REAL: se audita, pase lo que pase.
    const auditId = await this.registro.registrarIntento(ordenAuditada);

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
      const r = await ejecutar();
      await this.registro.marcarEnviado(auditId, r.idExterno, r.ocurridoEn);
      return { ok: true, idExterno: r.idExterno, ocurridoEn: r.ocurridoEn };
    } catch (err) {
      const motivo = (err as Error).message;
      await this.registro.marcarFallido(auditId, motivo);
      return { ok: false, motivo };
    }
  }
}
