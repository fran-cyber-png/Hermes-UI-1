import type { EstadoSesion } from '../whatsapp/transporte.js';
import type { OrdenEnvio, ResultadoControlado } from '../whatsapp/envioControlado.js';
import { caducoSinAprobar } from './caducidad.js';
import type { ConfigAutoRespuesta } from './config.js';
import { diaLocal, dentroDe } from './franja.js';
import { faltaEsquema, type Pendiente, type RepositorioAutoRespuesta } from './repositorio.js';

/**
 * EL DESPACHADOR — el único lugar de esta feature que manda algo, y el que
 * frena todo cuando algo huele mal.
 *
 * Garantías que fija este archivo (y sus tests):
 *
 *   · **Un envío a la vez.** `enVuelo` es un cerrojo de proceso: un tick que
 *     llega mientras el anterior sigue mandando se va sin hacer nada. Nunca dos
 *     `enviar` en paralelo, ni siquiera si el reloj se acelera.
 *   · **Una por tick.** Toma UNA pendiente vencida, no la lista. El ritmo lo
 *     puso el programador; acá no se puede «ponerse al día» de golpe.
 *   · **Freno total, sin reintentos a ciegas.** Ban, error de envío o sesión
 *     caída ⇒ el interruptor de la base se apaga con el motivo escrito, y no
 *     vuelve solo. Volver a prender es una decisión humana.
 *   · **Se apaga cuando entra la humana.** Al empezar el horario laboral la
 *     cola se cancela entera: ella responde en 10 minutos.
 *   · **Nada viejo.** Una pendiente atrasada (un restart, una noche frenada) se
 *     CANCELA en vez de mandarse: nadie quiere el acuse de anoche a las 3 de la
 *     tarde.
 *   · **Todo por `EnvioControlado`.** No hay un camino paralelo al transporte:
 *     misma puerta, misma auditoría, con `automatico: true` para que se sepa.
 */

/** El «quién» de un envío automático en `envios_wa`. No es una vendedora, y se nota. */
export const AUTOR_AUTOMATICO = 'auto-respuesta';

/**
 * Cuánto atraso se tolera entre la hora programada y el envío real. Más que
 * esto y la pendiente se cancela: la utilidad de un acuse fuera de horario
 * caduca rápido.
 */
export const MAX_ATRASO_MINUTOS = 90;

export interface PuertaDeEnvio {
  enviar(orden: OrdenEnvio): Promise<ResultadoControlado>;
}

export interface SalienteEnviado {
  idExterno: string;
  numeroPropio: string;
  telefono: string;
  texto: string;
  ocurridoEn: Date;
}

export interface DepsDespachador {
  repo: RepositorioAutoRespuesta;
  envio: PuertaDeEnvio;
  /** El estado de la sesión de WhatsApp. Si no está conectada, se frena. */
  estadoSesion: () => EstadoSesion;
  cfg: ConfigAutoRespuesta;
  ahora?: () => Date;
  /** Persiste el saliente para que aparezca en el hilo (idempotente). */
  persistirSaliente?: (s: SalienteEnviado) => Promise<void>;
  registrar?: (linea: string) => void;
}

export type ResultadoTick =
  | { accion: 'apagada'; detalle: string }
  | { accion: 'ocupado' }
  | { accion: 'horario-laboral'; canceladas: number }
  | { accion: 'frenada'; motivo: string }
  | { accion: 'sin-pendientes' }
  | { accion: 'caducadas'; cuantas: number }
  | { accion: 'cancelada'; clave: string; motivo: string }
  | { accion: 'enviada'; clave: string; idExterno: string };

export class Despachador {
  private enVuelo = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly ahora: () => Date;
  private readonly registrar: (linea: string) => void;

  constructor(private deps: DepsDespachador) {
    this.ahora = deps.ahora ?? (() => new Date());
    this.registrar = deps.registrar ?? ((l) => console.log(l));
  }

  async tick(): Promise<ResultadoTick> {
    if (this.enVuelo) return { accion: 'ocupado' };
    this.enVuelo = true;
    try {
      return await this.unPaso();
    } finally {
      this.enVuelo = false;
    }
  }

  private async unPaso(): Promise<ResultadoTick> {
    const { repo, cfg } = this.deps;
    const ahora = this.ahora();

    // Llave 1: el entorno. Sin esto ni se pregunta a la base.
    if (!cfg.habilitada) return { accion: 'apagada', detalle: 'AUTO_RESPUESTA no está en `on`' };

    // Llave 2: el interruptor de la base (el kill-switch sin deploy). Si las
    // tablas todavía no están (el `db:push` es manual, ADR 0015), esto se
    // comporta como apagada en vez de tirar un error cada 30 segundos.
    let interruptor;
    try {
      interruptor = await repo.leerInterruptor();
    } catch (e) {
      if (!faltaEsquema(e)) throw e;
      return { accion: 'apagada', detalle: 'faltan las tablas: corré `npm run db:push` (ADR 0015)' };
    }
    if (!interruptor.encendida) {
      return { accion: 'apagada', detalle: interruptor.motivo ?? 'el interruptor está apagado' };
    }

    // Entró la vendedora: la cola AUTOMÁTICA se cancela entera. No es un freno
    // de emergencia, es que ya no hace falta — ella responde en 10 minutos.
    //
    // Lo que NO se cancela (ADR 0016): lo que una persona aprobó y lo que espera
    // su OK. La regla existe para callar a la máquina cuando está la humana; si
    // la que decidió mandar fue ella, la regla no tiene a quién callar. Por eso
    // acá no se corta el paso: si no había nada automático que cancelar, se
    // sigue de largo y lo aprobado sale con su ritmo.
    if (dentroDe(ahora, cfg.franja, cfg.zona)) {
      const canceladas = await repo.cancelarAutomaticas('empezó el horario de atención: responde la vendedora');
      if (canceladas > 0) {
        this.registrar(`[auto-respuesta] entró el horario: ${canceladas} pendientes canceladas`);
        return { accion: 'horario-laboral', canceladas };
      }
    }

    // El barrido de lo que nadie aprobó a tiempo. Va antes que el envío para que
    // una bandeja llena de cosas viejas no tape lo que sí hay que mandar.
    const caducadas = await this.barrerCaducadas(ahora);
    if (caducadas > 0) return { accion: 'caducadas', cuantas: caducadas };

    // La sesión tiene que estar sana. Un ban o una desconexión frenan TODO: no
    // se reintenta contra un número que WhatsApp ya está mirando de reojo.
    const sesion = this.deps.estadoSesion();
    if (sesion.estado !== 'conectado') {
      const motivo =
        sesion.estado === 'baneado'
          ? `freno automático: el número está suspendido por WhatsApp (código ${sesion.codigo}, se levanta ${sesion.expira})`
          : `freno automático: la sesión está «${sesion.estado}», no conectada`;
      return await this.frenar(motivo);
    }

    const pendiente = await repo.proximaVencida(ahora);
    if (!pendiente) return { accion: 'sin-pendientes' };

    // Nada viejo: si quedó atrasada (restart, noche frenada), se cancela.
    const atrasoMin = (ahora.getTime() - pendiente.programadoPara.getTime()) / 60_000;
    const otroDia = diaLocal(pendiente.programadoPara, cfg.zona) !== diaLocal(ahora, cfg.zona);
    if (atrasoMin > MAX_ATRASO_MINUTOS || otroDia) {
      const motivo = `quedó vieja (${Math.round(atrasoMin)} min de atraso): un acuse fuera de tiempo molesta más de lo que ayuda`;
      await repo.cancelar(pendiente.id, motivo);
      return { accion: 'cancelada', clave: pendiente.clave, motivo };
    }

    // La cancelación que importa: si alguien de la casa ya contestó, esto sobra.
    const respondida = await repo.huboRespuestaHumana({
      canal: pendiente.canal,
      telefono: pendiente.telefono,
      numeroPropio: pendiente.numeroPropio,
      desde: pendiente.disparadaPor,
    });
    if (respondida) {
      const motivo = 'la vendedora ya respondió esta conversación';
      await repo.cancelar(pendiente.id, motivo);
      return { accion: 'cancelada', clave: pendiente.clave, motivo };
    }

    return await this.mandar(pendiente);
  }

  private async mandar(p: Pendiente): Promise<ResultadoTick> {
    const r = await this.deps.envio.enviar({
      vendedoraId: AUTOR_AUTOMATICO,
      numeroPropio: p.numeroPropio,
      telefono: p.telefono,
      texto: p.texto,
      referencia: p.clave,
      automatico: true,
    });

    if (!r.ok) {
      await this.deps.repo.marcarFallida(p.id, r.motivo);
      return await this.frenar(`freno automático: falló un envío (${r.motivo})`);
    }

    await this.deps.repo.marcarEnviada(p.id, r.idExterno, r.ocurridoEn);
    await this.deps.persistirSaliente?.({
      idExterno: r.idExterno,
      numeroPropio: p.numeroPropio,
      telefono: p.telefono,
      texto: p.texto,
      ocurridoEn: r.ocurridoEn,
    });
    this.registrar(`[auto-respuesta] enviada a ${p.telefono} (${p.plantillaId}) — ${p.clave}`);
    return { accion: 'enviada', clave: p.clave, idExterno: r.idExterno };
  }

  /**
   * EL BARRIDO DE LO CADUCADO (ADR 0016) — lo que se preparó, nadie aprobó y ya
   * no sirve.
   *
   * El veredicto lo da la función PURA (`caducidad.ts`) sobre las filas que
   * devuelve el repositorio, no un `WHERE` con la misma cuenta escrita en SQL.
   * Es a propósito y es la lección de #37: dos escrituras de la misma regla
   * divergen, y acá divergir significa o borrar de la bandeja algo que la
   * vendedora todavía podía aprobar, o dejarle aprobar algo que ya no debía
   * salir. El volumen lo permite de sobra (60 al día como techo).
   */
  private async barrerCaducadas(ahora: Date): Promise<number> {
    const esperando = await this.deps.repo.listarEsperandoAprobacion();
    let cuantas = 0;
    for (const p of esperando) {
      const v = caducoSinAprobar(p.programadoPara, this.deps.cfg, ahora);
      if (!v.caduco) continue;
      await this.deps.repo.caducar(p.id, v.motivo);
      cuantas++;
    }
    if (cuantas > 0) this.registrar(`[auto-respuesta] ${cuantas} preparada(s) caducaron sin aprobación`);
    return cuantas;
  }

  /** Apaga el interruptor con el motivo escrito. No cancela: deja ver qué quedó. */
  private async frenar(motivo: string): Promise<ResultadoTick> {
    await this.deps.repo.fijarModo('apagada', motivo, 'sistema');
    this.registrar(`[auto-respuesta] FRENO TOTAL — ${motivo}`);
    return { accion: 'frenada', motivo };
  }

  /** El reloj. `unref` para que un `npm test` no quede colgado por esto. */
  iniciar(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.registrar(`[auto-respuesta] error en el tick: ${(e as Error).message}`));
    }, this.deps.cfg.tickSegundos * 1000);
    this.timer.unref?.();
  }

  detener(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
