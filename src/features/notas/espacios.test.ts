import { describe, expect, test } from 'vitest';
import { mismoUsuario, nombreCorto, puedoAdministrar, type Espacio } from './espacios';

/**
 * LAS REGLAS DE LECTURA DE LOS ESPACIOS (ADR 0046), puras.
 *
 * Lo que fija este archivo es la MISMA comparación que el server hace en
 * `reparto/destino.ts` y `espacios/visibilidad.ts`. Los tres tienen que decir lo
 * mismo, y el fallo de que no lo digan no es un error: es que **Luz no ve los
 * botones de su propio espacio** y nadie entiende por qué.
 */

const espacio = (creadaPor: string): Espacio => ({
  id: 1,
  nombre: 'ventas',
  creadaPor,
  creadoAt: '2026-08-10T00:00:00Z',
  miembros: [creadaPor],
});

describe('mismoUsuario', () => {
  test('🔴 las dos grafías vivas en producción son la misma persona', () => {
    // Cerberus empuja `Luz`; ella entra escribiendo `luz`. Medido en prod.
    expect(mismoUsuario('Luz', 'luz')).toBe(true);
    expect(mismoUsuario('  LUZ  ', 'luz')).toBe(true);
    expect(mismoUsuario('Usuario1', 'usuario1')).toBe(true);
  });

  test('personas distintas siguen siendo distintas', () => {
    expect(mismoUsuario('luz', 'sindy')).toBe(false);
    expect(mismoUsuario('ventas10@grupogoberna.com', 'ventas11@grupogoberna.com')).toBe(false);
  });

  test('vacío o ausente NO es «cualquiera»', () => {
    // Sin esto, un `vendedoraId` todavía sin cargar haría que la pantalla dibuje
    // los botones de administrar sobre TODOS los espacios.
    expect(mismoUsuario('', '')).toBe(false);
    expect(mismoUsuario(null, null)).toBe(false);
    expect(mismoUsuario(undefined, 'luz')).toBe(false);
    expect(mismoUsuario('   ', 'luz')).toBe(false);
  });
});

describe('puedoAdministrar', () => {
  test('solo quien creó el espacio, con cualquiera de sus grafías', () => {
    expect(puedoAdministrar(espacio('Luz'), 'luz')).toBe(true);
    expect(puedoAdministrar(espacio('luz'), 'Luz')).toBe(true);
  });

  test('un miembro cualquiera NO administra', () => {
    expect(puedoAdministrar(espacio('tracy'), 'luz')).toBe(false);
  });

  test('sin sesión resuelta todavía, no se administra nada', () => {
    expect(puedoAdministrar(espacio('luz'), null)).toBe(false);
    expect(puedoAdministrar(espacio('luz'), undefined)).toBe(false);
  });
});

describe('nombreCorto', () => {
  test('corta el dominio: cinco de las nueve personas son un correo entero', () => {
    // `ventas10@grupogoberna.com` no entra en una fila de 19rem ni de cerca.
    expect(nombreCorto('ventas10@grupogoberna.com')).toBe('ventas10');
  });

  test('un username sin arroba se deja como está', () => {
    expect(nombreCorto('Luz')).toBe('Luz');
  });

  test('nunca devuelve vacío — un chip sin texto no se puede tocar ni entender', () => {
    expect(nombreCorto('@grupogoberna.com')).toBe('@grupogoberna.com');
  });
});
