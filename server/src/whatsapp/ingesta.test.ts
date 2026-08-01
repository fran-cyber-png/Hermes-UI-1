import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { IngestaWhatsapp, type RepositorioInteracciones } from './ingesta.js';
import { TransporteFalso } from './transporteFalso.js';
import type { EventoProyectado, InteraccionProyectada } from './proyectar.js';

/**
 * La ingesta es el puente entre el stream del transporte y el event store. Su
 * garantía central es la idempotencia: el mismo mensaje llegando dos veces (una
 * reconexión, un reenvío de WhatsApp) nunca produce dos filas. Eso se testea
 * contra un repositorio en memoria — sin Postgres, la lógica del puente se prueba
 * sola.
 */

/** Repo falso: guarda por externalId, reporta si la fila era nueva. Como el real, sin DB. */
class RepoEnMemoria implements RepositorioInteracciones {
  readonly guardadas: InteraccionProyectada[] = [];
  private vistos = new Set<string>();

  async persistir(evento: EventoProyectado, interaccion: InteraccionProyectada): Promise<boolean> {
    if (this.vistos.has(evento.externalId)) return false;
    this.vistos.add(evento.externalId);
    this.guardadas.push(interaccion);
    return true;
  }
}

describe('IngestaWhatsapp', () => {
  test('T6 — el mismo idExterno entregado dos veces produce UNA sola interacción', async () => {
    const repo = new RepoEnMemoria();
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const ingesta = new IngestaWhatsapp(transporte, repo);
    ingesta.iniciar();

    // Simular que el MISMO mensaje llega dos veces (idExterno idéntico).
    const mensaje = {
      idExterno: 'DUP-1',
      numeroPropio: '51987654321',
      telefono: '51961506674',
      esMio: false as const,
      esGrupo: false,
      ocurridoEn: new Date('2026-07-21T15:00:00Z'),
      nombreVisible: 'Andre',
      texto: 'hola',
      clase: 'texto' as const,
    };
    await ingesta.procesar(mensaje);
    await ingesta.procesar(mensaje);

    assert.equal(repo.guardadas.length, 1, 'reprocesar no duplica');
    assert.equal(ingesta.contadores.nuevos, 1);
    assert.equal(ingesta.contadores.duplicados, 1);
  });

  test('un grupo se descarta y no se persiste', async () => {
    const repo = new RepoEnMemoria();
    const ingesta = new IngestaWhatsapp(new TransporteFalso({ telefono: '51987654321' }), repo);

    await ingesta.procesar({
      idExterno: 'GRP-1',
      numeroPropio: '51987654321',
      telefono: '51961506674',
      esMio: false,
      esGrupo: true,
      ocurridoEn: new Date('2026-07-21T15:00:00Z'),
      nombreVisible: null,
      texto: 'hola grupo',
      clase: 'texto',
    });

    assert.equal(repo.guardadas.length, 0);
    assert.equal(ingesta.contadores.descartados, 1);
  });

  test('un entrante real desde el transporte llega a persistirse', async () => {
    const repo = new RepoEnMemoria();
    const transporte = new TransporteFalso({ telefono: '51987654321' });
    const ingesta = new IngestaWhatsapp(transporte, repo);
    ingesta.iniciar();

    // Cuando el transporte emite, la ingesta debe procesarlo. Como onMensaje es
    // fire-and-forget, esperamos un tick para que el async termine.
    transporte.simularEntrante('51961506674', 'quiero info', 'Rosa');
    await new Promise((r) => setImmediate(r));

    assert.equal(repo.guardadas.length, 1);
    assert.equal(repo.guardadas[0].personaId, '51961506674');
    assert.equal(repo.guardadas[0].direccion, 'entrante');
  });

  test('un entrante nuevo avisa al bot UNA vez; el duplicado no reabre la ventana', async () => {
    const repo = new RepoEnMemoria();
    const avisos: string[] = [];
    const ingesta = new IngestaWhatsapp(
      new TransporteFalso({ telefono: '51987654321' }),
      repo,
      (m) => avisos.push(m.telefono),
    );

    const mensaje = {
      idExterno: 'AVISO-1',
      numeroPropio: '51987654321',
      telefono: '51961506674',
      esMio: false as const,
      esGrupo: false,
      ocurridoEn: new Date('2026-07-21T15:00:00Z'),
      nombreVisible: 'Rosa',
      texto: 'hola',
      clase: 'texto' as const,
    };
    await ingesta.procesar(mensaje);
    await ingesta.procesar(mensaje);

    assert.deepStrictEqual(avisos, ['51961506674'], 'solo la primera entrega avisa');
  });

  test('un saliente propio nunca avisa al bot', async () => {
    const repo = new RepoEnMemoria();
    const avisos: string[] = [];
    const ingesta = new IngestaWhatsapp(
      new TransporteFalso({ telefono: '51987654321' }),
      repo,
      (m) => avisos.push(m.telefono),
    );

    await ingesta.procesar({
      idExterno: 'SAL-1',
      numeroPropio: '51987654321',
      telefono: '51961506674',
      esMio: true,
      esGrupo: false,
      ocurridoEn: new Date('2026-07-21T15:00:00Z'),
      nombreVisible: null,
      texto: 'hola, soy yo',
      clase: 'texto',
    });

    assert.equal(repo.guardadas.length, 1, 'el saliente se persiste igual');
    assert.deepStrictEqual(avisos, [], 'pero no hay aviso al bot');
  });
});
