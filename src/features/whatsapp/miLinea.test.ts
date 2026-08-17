import { describe, expect, test } from 'vitest';
import { RITMO_POLLING_MS, esEstadoTerminal, ritmoDePolling } from './miLinea';

/**
 * 🔴 CUÁNDO SE DEJA DE PREGUNTAR — la mitad del defecto que hacía que el camino
 * feliz dijera «La vinculación se cortó».
 *
 * El server, al llegar a `conectado`, suelta el candado del pareo. O sea que el
 * poll SIGUIENTE contesta `expirado`, y con el intervalo prendido para siempre
 * esa respuesta pisaba el «¡Listo!» un segundo y medio después. Lo mismo con
 * `error` y `baneado`: el motivo real —lo único accionable— se reemplazaba por
 * el genérico.
 */

describe('esEstadoTerminal', () => {
  test('lo que sigue en vuelo NO es terminal: hay que seguir preguntando', () => {
    expect(esEstadoTerminal({ estado: 'vinculando' })).toBe(false);
    expect(esEstadoTerminal({ estado: 'esperando_qr', qr: 'data:,' })).toBe(false);
  });

  test('🔴 `conectado` es terminal: el poll siguiente diría `expirado` y desmentiría el éxito', () => {
    expect(esEstadoTerminal({ estado: 'conectado', numero: '51955135507' })).toBe(true);
  });

  test('🔴 `error` y `baneado` también: su motivo es lo único accionable que hay', () => {
    expect(esEstadoTerminal({ estado: 'error', motivo: 'whatsmeow no levantó' })).toBe(true);
    expect(esEstadoTerminal({ estado: 'baneado', ban: { codigo: '131056', expira: 'mañana' } })).toBe(true);
  });

  test('`expirado` es terminal: el server no tiene nada mío, preguntar no lo cambia', () => {
    expect(esEstadoTerminal({ estado: 'expirado' })).toBe(true);
  });

  test('sin dato todavía, no es terminal — el primer poll no puede apagarse solo', () => {
    expect(esEstadoTerminal(undefined)).toBe(false);
  });
});

describe('ritmoDePolling', () => {
  test('en vuelo, el ritmo de la consola de operador', () => {
    expect(ritmoDePolling({ estado: 'vinculando' })).toBe(RITMO_POLLING_MS);
    expect(ritmoDePolling(undefined)).toBe(RITMO_POLLING_MS);
  });

  test('🔴 en un estado terminal, `false`: el intervalo se apaga solo', () => {
    expect(ritmoDePolling({ estado: 'conectado', numero: '51955135507' })).toBe(false);
    expect(ritmoDePolling({ estado: 'error', motivo: 'x' })).toBe(false);
  });
});
