import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { EnvioControlado, type OrdenEnvio, type RegistroEnvios } from './envioControlado.js';
import { TransporteFalso } from './transporteFalso.js';
import type { EstadoSesion, MensajeWhatsapp, ResultadoEnvio, TransporteWhatsapp } from './transporte.js';

/**
 * EnvioControlado es la puerta por la que sale TODO mensaje. Estos tests fijan las
 * garantías que la separan de un bot: una orden = un envío, cada intento auditado,
 * el corta-corriente y el ban frenan sin reintentar.
 */

/** Registro de auditoría en memoria: guarda qué se intentó y con qué resultado. */
class RegistroFalso implements RegistroEnvios {
  readonly intentos: OrdenEnvio[] = [];
  readonly enviados: { id: number; idExterno: string }[] = [];
  readonly fallidos: { id: number; motivo: string }[] = [];
  private siguiente = 1;

  async registrarIntento(orden: OrdenEnvio): Promise<number> {
    const id = this.siguiente++;
    this.intentos.push(orden);
    return id;
  }
  async marcarEnviado(id: number, idExterno: string): Promise<void> {
    this.enviados.push({ id, idExterno });
  }
  async marcarFallido(id: number, motivo: string): Promise<void> {
    this.fallidos.push({ id, motivo });
  }
}

const orden = (over: Partial<OrdenEnvio> = {}): OrdenEnvio => ({
  vendedoraId: 'ana',
  numeroPropio: '51987654321',
  telefono: '51961506674',
  texto: 'con gusto, te paso el temario',
  referencia: 'conv:whatsapp:51961506674:51987654321',
  ...over,
});

describe('EnvioControlado', () => {
  test('T9 — una orden = un envío, con auditoría de quién y a quién', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden());

    assert.ok(r.ok);
    assert.equal(transporte.enviados.length, 1, 'exactamente un envío al transporte');
    assert.equal(registro.enviados.length, 1);
    assert.equal(registro.enviados[0].idExterno, transporte.enviados[0].idExterno);
    // La auditoría sabe quién mandó y a quién.
    assert.equal(registro.intentos[0].vendedoraId, 'ana');
    assert.equal(registro.intentos[0].telefono, '51961506674');
  });

  test('T10 — sin vendedora, el transporte no recibe nada y no se audita', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden({ vendedoraId: '' }));

    assert.equal(r.ok, false);
    assert.equal(transporte.enviados.length, 0);
    assert.equal(registro.intentos.length, 0, 'una orden malformada no ensucia la auditoría');
  });

  test('T11 — corta-corriente: rechazo con motivo, cero envíos, intento auditado como bloqueado', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro, () => true); // freno activo

    const r = await envio.enviar(orden());

    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /corta-corriente/i);
    assert.equal(transporte.enviados.length, 0, 'el transporte no se toca');
    // El intento SÍ queda: un envío bloqueado es parte de la auditoría.
    assert.equal(registro.intentos.length, 1);
    assert.equal(registro.fallidos.length, 1);
  });

  test('T12 — sesión baneada: rechazo visible con la fecha, sin llamar al transporte', async () => {
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    transporte.simularBan('191', 'en 24 horas');
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const r = await envio.enviar(orden());

    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /suspendido|191|24 horas/i);
    assert.equal(transporte.enviados.length, 0);
    assert.equal(registro.fallidos.length, 1);
  });

  test('T9b — TOCTOU: la sesión pasa el chequeo pero el envío falla → intento fallido, sin saliente fantasma', async () => {
    // Un transporte que se REPORTA conectado pero cuyo enviarTexto explota: simula
    // el ban que llega justo entre el chequeo de estado y el envío.
    const transporteTraidor: TransporteWhatsapp = {
      nombre: 'falso',
      async iniciar() {},
      estado(): EstadoSesion {
        return { estado: 'conectado', telefono: '51987654321' };
      },
      onMensaje(_cb: (m: MensajeWhatsapp) => void) {},
      onEstado(_cb: (e: EstadoSesion) => void) {},
      async enviarTexto(): Promise<ResultadoEnvio> {
        throw new Error('el número se baneó en el envío');
      },
      async marcarLeido() {},
      async detener() {},
    };
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporteTraidor, registro);

    const r = await envio.enviar(orden());

    assert.equal(r.ok, false);
    // El intento quedó registrado como fallido — nunca como enviado.
    assert.equal(registro.enviados.length, 0, 'no hay saliente fantasma');
    assert.equal(registro.fallidos.length, 1);
  });
});
