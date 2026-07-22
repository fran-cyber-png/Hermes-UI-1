import { describe, expect, it } from 'vitest';
import { quienDiceSer } from './sesion';

/**
 * El atajo que deja entrar a la vendedora sin esperar al server (ver el bloque
 * de `sesion.ts`). Vale la pena testearlo aunque no valide nada: si se equivoca
 * con la expiración, la app se abre para un token vencido.
 *
 * Los tokens se arman como los arma el server (`server/src/auth/sesion.ts`):
 * `base64url("<id>|<vence>") + "." + firma`. La firma no se mira acá.
 */
function tokenComoElDelServer(id: string, vence: number): string {
  const cuerpo = btoa(`${id}|${vence}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${cuerpo}.firma-que-solo-el-server-verifica`;
}

const EN_DOS_SEMANAS = Date.now() + 14 * 24 * 3600 * 1000;
const ANTEAYER = Date.now() - 2 * 24 * 3600 * 1000;

describe('quienDiceSer — quién dice ser el token guardado', () => {
  it('con un token vigente devuelve la vendedora, para pintar sin esperar al server', () => {
    expect(quienDiceSer(tokenComoElDelServer('Usuario1', EN_DOS_SEMANAS))).toEqual({
      id: 'Usuario1',
      nombre: 'Usuario1',
    });
  });

  it('un token vencido no da atajo: se espera al server, que es quien echa', () => {
    expect(quienDiceSer(tokenComoElDelServer('Usuario1', ANTEAYER))).toBeNull();
  });

  it('ante cualquier cosa rara, no hay atajo', () => {
    expect(quienDiceSer('')).toBeNull();
    expect(quienDiceSer('no-es-un-token')).toBeNull();
    expect(quienDiceSer('.solo-firma')).toBeNull();
    expect(quienDiceSer(tokenComoElDelServer('', EN_DOS_SEMANAS))).toBeNull();
    expect(quienDiceSer(tokenComoElDelServer('Usuario1', Number.NaN))).toBeNull();
    // Cuerpo sin la barra que separa id de vencimiento.
    expect(quienDiceSer(`${btoa('Usuario1')}.firma`)).toBeNull();
  });
});
