import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { GestorWhatsapp, numerosConfigurados, type WhatsappArmado } from './gestor.js';
import { TransporteFalso } from './transporteFalso.js';
import { EnvioControlado, type OrdenEnvio, type RegistroEnvios } from './envioControlado.js';

/**
 * EL GESTOR DE N LÍNEAS (#50).
 *
 * Lo que estos tests protegen no es que el Map funcione: es que **producción
 * levante igual que ayer** y que un número desconocido no caiga a la línea de
 * otra persona.
 */

class RegistroNulo implements RegistroEnvios {
  async registrarIntento(_orden: OrdenEnvio): Promise<number> {
    return 1;
  }
  async marcarEnviado(): Promise<void> {}
  async marcarFallido(): Promise<void> {}
}

function armadoDe(numero: string): WhatsappArmado {
  const transporte = new TransporteFalso({ telefono: numero });
  return { numero, transporte, envio: new EnvioControlado(transporte, new RegistroNulo()), falso: transporte };
}

describe('numerosConfigurados — el fallback es lo que hace que VPS1 no se entere', () => {
  test('sin `WHATSAPP_NUMEROS`, manda `WHATSAPP_NUMERO`: el comportamiento de siempre', () => {
    assert.deepEqual(numerosConfigurados({ WHATSAPP_NUMERO: '51986394450' } as NodeJS.ProcessEnv), ['51986394450']);
  });

  test('`WHATSAPP_NUMEROS` con coma levanta varias, en orden', () => {
    assert.deepEqual(
      numerosConfigurados({ WHATSAPP_NUMEROS: '51986394450,51999888777' } as NodeJS.ProcessEnv),
      ['51986394450', '51999888777'],
    );
  });

  test('la lista gana sobre el singular — si están los dos, no se mezclan', () => {
    assert.deepEqual(
      numerosConfigurados({ WHATSAPP_NUMEROS: '51999888777', WHATSAPP_NUMERO: '51986394450' } as NodeJS.ProcessEnv),
      ['51999888777'],
    );
  });

  test('normaliza y tolera espacios y `+`: el número viene de un .env escrito a mano', () => {
    assert.deepEqual(
      numerosConfigurados({ WHATSAPP_NUMEROS: ' +51 986 394 450 , 51999888777 ' } as NodeJS.ProcessEnv),
      ['51986394450', '51999888777'],
    );
  });

  test('DEDUPLICA: la misma sesión .db abierta dos veces es un conflicto de SQLite, no una línea más', () => {
    assert.deepEqual(
      numerosConfigurados({ WHATSAPP_NUMEROS: '51986394450,+51986394450' } as NodeJS.ProcessEnv),
      ['51986394450'],
    );
  });

  test('sin nada configurado, la lista es vacía — quien llama decide si eso es un error', () => {
    assert.deepEqual(numerosConfigurados({} as NodeJS.ProcessEnv), []);
  });
});

describe('GestorWhatsapp', () => {
  test('cada número devuelve SU línea', () => {
    const g = new GestorWhatsapp();
    g.agregar(armadoDe('51986394450'));
    g.agregar(armadoDe('51999888777'));

    assert.equal(g.de('51986394450')?.numero, '51986394450');
    assert.equal(g.de('51999888777')?.numero, '51999888777');
    assert.deepEqual(g.numeros(), ['51986394450', '51999888777']);
  });

  test('🔴 un número DESCONOCIDO devuelve null, NUNCA el primero', () => {
    // Caer al primero sería el defecto que todo este frente existe para evitar:
    // el envío saldría, bien auditado, por la línea de otra persona.
    const g = new GestorWhatsapp();
    g.agregar(armadoDe('51986394450'));

    assert.equal(g.de('51900000000'), null);
  });

  test('el mismo número escrito distinto encuentra su línea', () => {
    const g = new GestorWhatsapp();
    g.agregar(armadoDe('51986394450'));

    assert.equal(g.de('+51 986 394 450')?.numero, '51986394450');
  });

  test('montar dos veces el mismo número TIRA: dos sesiones sobre la misma .db se pisan', () => {
    const g = new GestorWhatsapp();
    g.agregar(armadoDe('51986394450'));

    assert.throws(() => g.agregar(armadoDe('51986394450')), /ya está montado/);
  });

  test('`primero()` es la línea de arranque — el alias para los consumidores de un solo número', () => {
    const g = new GestorWhatsapp();
    g.agregar(armadoDe('51986394450'));
    g.agregar(armadoDe('51999888777'));

    assert.equal(g.primero().numero, '51986394450');
  });

  test('pedir el gestor vacío tira en vez de devolver algo a medias', () => {
    assert.throws(() => new GestorWhatsapp().primero(), /no está arrancado/);
  });
});
