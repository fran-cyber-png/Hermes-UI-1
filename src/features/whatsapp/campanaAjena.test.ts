import { describe, expect, test } from 'vitest';
import { ErrorApi } from '../../lib/datos/cliente';
import { esDeCampana, MOTIVO_CAMPANA } from './campanaAjena';

const conCuerpo = (status: number, cuerpo: Record<string, unknown>) =>
  new ErrorApi('no', status, undefined, undefined, undefined, undefined, cuerpo);

describe('esDeCampana', () => {
  test('reconoce el 403 de la frontera de campaña', () => {
    expect(esDeCampana(conCuerpo(403, { motivo: MOTIVO_CAMPANA }))).toBe(true);
  });

  test('🔴 un 403 de OTRA cosa no se disfraza de campaña', () => {
    // `/api/dashboard/negocio` contesta 403 con `no_es_supervisor`. Afirmar «es
    // de campaña» sobre cualquier 403 sería inventarle una explicación al fallo,
    // que es justo lo que los ocho códigos de Ivi existen para no hacer.
    expect(esDeCampana(conCuerpo(403, { motivo: 'no_es_supervisor' }))).toBe(false);
    expect(esDeCampana(conCuerpo(403, {}))).toBe(false);
  });

  test('el mismo motivo con otro estado tampoco', () => {
    expect(esDeCampana(conCuerpo(500, { motivo: MOTIVO_CAMPANA }))).toBe(false);
  });

  test('lo que no es un ErrorApi no dice nada', () => {
    expect(esDeCampana(new Error('boom'))).toBe(false);
    expect(esDeCampana(undefined)).toBe(false);
  });
});
