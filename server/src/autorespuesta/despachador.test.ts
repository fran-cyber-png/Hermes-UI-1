import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EstadoSesion } from '../whatsapp/transporte.js';
import type { OrdenEnvio, ResultadoControlado } from '../whatsapp/envioControlado.js';
import { CONFIG_POR_DEFECTO, type ConfigAutoRespuesta } from './config.js';
import { AUTOR_AUTOMATICO, Despachador } from './despachador.js';
import type {
  EstadoInterruptor,
  NuevaPendiente,
  Pendiente,
  RepositorioAutoRespuesta,
} from './repositorio.js';

/**
 * EL DESPACHADOR, con la base y el transporte de mentira. Acá se fijan las
 * garantías que hacen que esto se pueda prender sin miedo: el freno total ante
 * un ban, la cancelación cuando la vendedora ya respondió, un envío a la vez, y
 * que nada viejo salga tarde.
 */

const cfg: ConfigAutoRespuesta = { ...CONFIG_POR_DEFECTO, habilitada: true };

/** 12:35Z = 07:35 de Lima: adentro de la ventana de despacho de la mañana. */
const MANIANA = new Date('2026-07-25T12:35:00Z');

const conectado = (): EstadoSesion => ({ estado: 'conectado', telefono: '51986394450' });

class RepoFalso implements RepositorioAutoRespuesta {
  filas: (Pendiente & { estado: string; motivo: string | null; idExterno?: string })[] = [];
  interruptor: EstadoInterruptor = { encendida: true, motivo: null, actualizadoPor: 'ana', actualizadoAt: null };
  respuestaHumana = false;
  private siguiente = 1;

  async encolar(p: NuevaPendiente): Promise<Pendiente | null> {
    if (this.filas.some((f) => f.clave === p.clave && f.diaLima === p.diaLima)) return null;
    const fila = { ...p, id: this.siguiente++, estado: 'pendiente', motivo: null };
    this.filas.push(fila);
    return fila;
  }
  async proximaVencida(ahora: Date): Promise<Pendiente | null> {
    return (
      this.filas
        .filter((f) => f.estado === 'pendiente' && f.programadoPara.getTime() <= ahora.getTime())
        .sort((a, b) => a.programadoPara.getTime() - b.programadoPara.getTime())[0] ?? null
    );
  }
  async marcarEnviada(id: number, idExterno: string): Promise<void> {
    const f = this.filas.find((x) => x.id === id);
    if (f) Object.assign(f, { estado: 'enviada', idExterno });
  }
  async marcarFallida(id: number, motivo: string): Promise<void> {
    const f = this.filas.find((x) => x.id === id);
    if (f) Object.assign(f, { estado: 'fallida', motivo });
  }
  async cancelar(id: number, motivo: string): Promise<void> {
    const f = this.filas.find((x) => x.id === id && x.estado === 'pendiente');
    if (f) Object.assign(f, { estado: 'cancelada', motivo });
  }
  async cancelarDeConversacion(clave: string, motivo: string): Promise<number> {
    const afectadas = this.filas.filter((f) => f.clave === clave && f.estado === 'pendiente');
    for (const f of afectadas) Object.assign(f, { estado: 'cancelada', motivo });
    return afectadas.length;
  }
  async cancelarTodas(motivo: string): Promise<number> {
    const afectadas = this.filas.filter((f) => f.estado === 'pendiente');
    for (const f of afectadas) Object.assign(f, { estado: 'cancelada', motivo });
    return afectadas.length;
  }
  async ocupacionDesde() {
    return this.filas.map((f) => ({ numeroPropio: f.numeroPropio, cuando: f.programadoPara }));
  }
  async huboRespuestaHumana(): Promise<boolean> {
    return this.respuestaHumana;
  }
  async listarDelDia() {
    return this.filas;
  }
  async leerInterruptor(): Promise<EstadoInterruptor> {
    return this.interruptor;
  }
  async fijarInterruptor(encendida: boolean, motivo: string | null, quien: string): Promise<EstadoInterruptor> {
    this.interruptor = { encendida, motivo, actualizadoPor: quien, actualizadoAt: new Date() };
    return this.interruptor;
  }
}

class EnvioFalso {
  ordenes: OrdenEnvio[] = [];
  resultado: ResultadoControlado = { ok: true, idExterno: 'wa-1', ocurridoEn: MANIANA };
  /** Para probar el cerrojo: retiene el envío hasta que el test lo suelte. */
  soltar: (() => void) | null = null;

  async enviar(orden: OrdenEnvio): Promise<ResultadoControlado> {
    this.ordenes.push(orden);
    if (this.soltar) {
      await new Promise<void>((resolve) => {
        this.soltar = resolve;
      });
    }
    return this.resultado;
  }
}

const pendiente = (over: Partial<NuevaPendiente> = {}): NuevaPendiente => ({
  clave: 'conv:whatsapp:51961506674:51986394450',
  canal: 'whatsapp',
  telefono: '51961506674',
  numeroPropio: '51986394450',
  personaNombre: 'Ana',
  plantillaId: 'fuera-de-horario-primer-contacto',
  texto: 'Hola Ana, gracias por escribirnos…',
  disparadaPor: new Date('2026-07-25T07:00:00Z'),
  programadoPara: new Date('2026-07-25T12:30:00Z'),
  diaLima: '2026-07-25',
  ...over,
});

function armar(over: Partial<{ repo: RepoFalso; envio: EnvioFalso; sesion: () => EstadoSesion; config: ConfigAutoRespuesta }> = {}) {
  const repo = over.repo ?? new RepoFalso();
  const envio = over.envio ?? new EnvioFalso();
  const despachador = new Despachador({
    repo,
    envio,
    estadoSesion: over.sesion ?? conectado,
    cfg: over.config ?? cfg,
    ahora: () => MANIANA,
    registrar: () => {},
  });
  return { repo, envio, despachador };
}

describe('el despachador manda', () => {
  test('una pendiente vencida sale por EnvioControlado, marcada como automática', async () => {
    const { repo, envio, despachador } = armar();
    await repo.encolar(pendiente());

    const r = await despachador.tick();

    assert.equal(r.accion, 'enviada');
    assert.equal(envio.ordenes.length, 1);
    assert.equal(envio.ordenes[0].automatico, true, 'queda marcado como automático en la auditoría');
    assert.equal(envio.ordenes[0].vendedoraId, AUTOR_AUTOMATICO, 'el autor no finge ser una vendedora');
    assert.equal(envio.ordenes[0].referencia, 'conv:whatsapp:51961506674:51986394450');
    assert.equal(repo.filas[0].estado, 'enviada');
  });

  test('una sola por tick: la segunda espera su turno', async () => {
    const { repo, envio, despachador } = armar();
    await repo.encolar(pendiente());
    await repo.encolar(pendiente({ clave: 'conv:whatsapp:51999:51986394450', telefono: '51999' }));

    await despachador.tick();
    assert.equal(envio.ordenes.length, 1);

    await despachador.tick();
    assert.equal(envio.ordenes.length, 2);
  });

  test('nada que mandar todavía: la programada para más tarde no sale antes', async () => {
    const { repo, envio, despachador } = armar();
    await repo.encolar(pendiente({ programadoPara: new Date('2026-07-25T12:50:00Z') }));

    const r = await despachador.tick();
    assert.equal(r.accion, 'sin-pendientes');
    assert.equal(envio.ordenes.length, 0);
  });
});

describe('un envío a la vez, nunca en paralelo', () => {
  test('un tick que llega con otro en vuelo se va sin tocar nada', async () => {
    const envio = new EnvioFalso();
    envio.soltar = () => {}; // el envío queda retenido
    const { repo, despachador } = armar({ envio });
    await repo.encolar(pendiente());
    await repo.encolar(pendiente({ clave: 'conv:whatsapp:51999:51986394450', telefono: '51999' }));

    const primero = despachador.tick();
    // Un latido después: el primer envío sigue colgado.
    await new Promise((r) => setImmediate(r));
    const segundo = await despachador.tick();

    assert.equal(segundo.accion, 'ocupado');
    assert.equal(envio.ordenes.length, 1, 'el transporte recibió UNO solo');

    envio.soltar?.(); // se suelta el primero
    assert.equal((await primero).accion, 'enviada');
  });
});

describe('las dos llaves y el freno', () => {
  test('con AUTO_RESPUESTA apagado no se pregunta ni a la base', async () => {
    const { repo, envio, despachador } = armar({ config: { ...cfg, habilitada: false } });
    await repo.encolar(pendiente());

    const r = await despachador.tick();
    assert.equal(r.accion, 'apagada');
    assert.equal(envio.ordenes.length, 0);
    assert.equal(repo.filas[0].estado, 'pendiente', 'no se toca nada: apagado es apagado');
  });

  test('con el interruptor de la base apagado, tampoco', async () => {
    const repo = new RepoFalso();
    repo.interruptor = { encendida: false, motivo: 'la apagó Estephano', actualizadoPor: 'arky', actualizadoAt: null };
    const { envio, despachador } = armar({ repo });
    await repo.encolar(pendiente());

    const r = await despachador.tick();
    assert.equal(r.accion, 'apagada');
    assert.equal(r.accion === 'apagada' && r.detalle, 'la apagó Estephano');
    assert.equal(envio.ordenes.length, 0);
  });

  test('temporary_ban: freno total, con el motivo escrito y sin tocar el transporte', async () => {
    const baneado = (): EstadoSesion => ({ estado: 'baneado', codigo: '403', expira: '2026-07-28' });
    const { repo, envio, despachador } = armar({ sesion: baneado });
    await repo.encolar(pendiente());

    const r = await despachador.tick();

    assert.equal(r.accion, 'frenada');
    assert.equal(envio.ordenes.length, 0, 'no se le escribe a un número suspendido');
    assert.equal(repo.interruptor.encendida, false, 'la cola queda apagada entera');
    assert.match(repo.interruptor.motivo ?? '', /suspendido por WhatsApp/);
    assert.equal(repo.interruptor.actualizadoPor, 'sistema');
  });

  test('la sesión desconectada también frena todo', async () => {
    const caida = (): EstadoSesion => ({ estado: 'desconectado', motivo: 'se cayó el binario' });
    const { repo, despachador } = armar({ sesion: caida });
    await repo.encolar(pendiente());

    const r = await despachador.tick();
    assert.equal(r.accion, 'frenada');
    assert.equal(repo.interruptor.encendida, false);
  });

  test('un envío que falla frena la cola: nada de reintentar a ciegas', async () => {
    const envio = new EnvioFalso();
    envio.resultado = { ok: false, motivo: 'el transporte no respondió' };
    const { repo, despachador } = armar({ envio });
    await repo.encolar(pendiente());

    const r = await despachador.tick();

    assert.equal(r.accion, 'frenada');
    assert.equal(repo.filas[0].estado, 'fallida');
    assert.equal(repo.interruptor.encendida, false);
    assert.match(repo.interruptor.motivo ?? '', /falló un envío/);

    // Y el siguiente tick ya no manda nada, aunque haya cola.
    await repo.encolar(pendiente({ clave: 'conv:whatsapp:51999:51986394450', telefono: '51999' }));
    assert.equal((await despachador.tick()).accion, 'apagada');
    assert.equal(envio.ordenes.length, 1);
  });
});

describe('la cola se apaga sola cuando entra la humana', () => {
  test('empezado el horario de atención, se cancela todo lo pendiente', async () => {
    const repo = new RepoFalso();
    const envio = new EnvioFalso();
    const despachador = new Despachador({
      repo,
      envio,
      estadoSesion: conectado,
      cfg,
      ahora: () => new Date('2026-07-25T14:05:00Z'), // 09:05 de Lima
      registrar: () => {},
    });
    await repo.encolar(pendiente());
    await repo.encolar(pendiente({ clave: 'conv:whatsapp:51999:51986394450', telefono: '51999' }));

    const r = await despachador.tick();

    assert.equal(r.accion, 'horario-laboral');
    assert.equal(r.accion === 'horario-laboral' && r.canceladas, 2);
    assert.equal(envio.ordenes.length, 0);
    assert.ok(repo.filas.every((f) => f.estado === 'cancelada'));
    assert.match(repo.filas[0].motivo ?? '', /horario de atención/);
  });

  test('si la vendedora ya respondió esa conversación, la pendiente se cancela', async () => {
    const repo = new RepoFalso();
    repo.respuestaHumana = true;
    const { envio, despachador } = armar({ repo });
    await repo.encolar(pendiente());

    const r = await despachador.tick();

    assert.equal(r.accion, 'cancelada');
    assert.equal(envio.ordenes.length, 0);
    assert.equal(repo.filas[0].estado, 'cancelada');
    assert.match(repo.filas[0].motivo ?? '', /ya respondió/);
  });
});

describe('nada viejo sale tarde', () => {
  test('una pendiente atrasada más de 90 minutos se cancela en vez de mandarse', async () => {
    const { repo, envio, despachador } = armar();
    await repo.encolar(pendiente({ programadoPara: new Date('2026-07-25T10:00:00Z') })); // 2,5 h antes

    const r = await despachador.tick();

    assert.equal(r.accion, 'cancelada');
    assert.equal(envio.ordenes.length, 0);
    assert.match(repo.filas[0].motivo ?? '', /vieja/);
  });

  test('una pendiente de ayer no se manda hoy', async () => {
    const { repo, envio, despachador } = armar();
    await repo.encolar(
      pendiente({ programadoPara: new Date('2026-07-25T12:34:00Z'), diaLima: '2026-07-24' }),
    );
    // Un minuto de atraso, pero es de otro día local: no sale.
    const anteayer = repo.filas[0];
    anteayer.programadoPara = new Date('2026-07-24T12:30:00Z');

    const r = await despachador.tick();
    assert.equal(r.accion, 'cancelada');
    assert.equal(envio.ordenes.length, 0);
  });
});
