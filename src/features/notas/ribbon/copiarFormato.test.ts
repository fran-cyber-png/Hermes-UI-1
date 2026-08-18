import { expect, test } from 'vitest';
import { cambioDeFormato } from './copiarFormato';

/**
 * EL PINCEL — la decisión, sin editor.
 *
 * Lo que se prueba acá es lo único que se puede hacer mal en silencio: **qué se
 * saca**. Poner lo copiado es obvio; lo que no lo es tanto es que el pincel
 * también tiene que LIMPIAR lo que el destino traía y el origen no.
 */

test('pone lo copiado', () => {
  const { aPoner } = cambioDeFormato({ bold: true, fuente: 'Georgia' }, {});
  expect(aPoner).toEqual({ bold: true, fuente: 'Georgia' });
});

test('🔴 saca lo que el destino tiene y el origen no', () => {
  // El caso que lo obliga: se copia de un texto normal y se suelta sobre una
  // negrita. Sin esta mitad, la negrita se queda y el resultado no se parece al
  // origen — o sea que el pincel copió una parte y no el formato.
  const { aQuitar, aPoner } = cambioDeFormato({}, { bold: true, italic: true });
  expect(aQuitar).toEqual({ bold: true, italic: true });
  expect(aPoner).toEqual({});
});

test('lo que está en los dos no se saca: se pisa con el valor del origen', () => {
  const { aQuitar, aPoner } = cambioDeFormato({ tamano: '24px' }, { tamano: '12px' });
  expect(aQuitar).toEqual({});
  expect(aPoner).toEqual({ tamano: '24px' });
});

test('no se queda con una referencia al objeto del editor', () => {
  // `getActiveStyles()` devuelve un objeto nuevo por llamada hoy, pero el pincel
  // guarda lo copiado durante varios segundos: si algún día devolviera el mismo
  // objeto mutado, el pincel armado cambiaría solo al mover el cursor.
  const origen = { bold: true };
  const { aPoner } = cambioDeFormato(origen, {});
  origen.bold = false;
  expect(aPoner).toEqual({ bold: true });
});
