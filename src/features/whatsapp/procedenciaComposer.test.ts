import { beforeEach, describe, expect, test } from 'vitest';
import {
  anotarPieza,
  limpiarPiezas,
  olvidarPieza,
  piezaDelTexto,
} from './procedenciaComposer';

const DATO = { clase: 'dato', ref: 'cuotas', via: 'panel-datos' } as const;
const FRASE = 'El pago se puede hacer en 2 cuotas.';
const TEL = '51961506674';

beforeEach(() => limpiarPiezas());

describe('qué pieza declarar para lo que hay en la caja', () => {
  test('sin nada anotado, no hay pieza — y eso es la línea de base', () => {
    expect(piezaDelTexto(TEL, 'hola, ¿cómo estás?')).toBeUndefined();
  });

  test('el texto tal cual salió del catálogo: la pieza, sin editar', () => {
    anotarPieza(TEL, DATO, FRASE);
    expect(piezaDelTexto(TEL, FRASE)).toEqual({ ...DATO, editada: false, textoPieza: FRASE });
  });

  test('los espacios de más no son una edición', () => {
    anotarPieza(TEL, DATO, FRASE);
    expect(piezaDelTexto(TEL, `  ${FRASE}\n`)).toEqual({ ...DATO, editada: false, textoPieza: FRASE });
  });

  test('le agregó un saludo delante: sigue siendo la pieza, pero EDITADA', () => {
    // Trazable a la pieza que se la sugirió, sí; acreditable entera, no —
    // porque parte de lo que salió lo escribió ella.
    anotarPieza(TEL, DATO, FRASE);
    expect(piezaDelTexto(TEL, `Hola Ana! ${FRASE}`)).toEqual({
      ...DATO,
      editada: true,
      // El texto de la PIEZA sigue siendo el del catálogo, no lo que ella
      // escribió: la versión habla de la pieza, no del mensaje que salió.
      textoPieza: FRASE,
    });
  });

  test('reescribió todo: NO hay pieza, el envío cuenta como escrito a mano', () => {
    anotarPieza(TEL, DATO, FRASE);
    expect(piezaDelTexto(TEL, 'podés pagarlo en dos veces si querés')).toBeUndefined();
  });

  test('borró la caja y escribió otra cosa: tampoco hereda la pieza', () => {
    anotarPieza(TEL, DATO, FRASE);
    expect(piezaDelTexto(TEL, '')).toBeUndefined();
  });

  test('la anotación es POR CONVERSACIÓN: el dato de un chat no se filtra al de al lado', () => {
    anotarPieza(TEL, DATO, FRASE);
    expect(piezaDelTexto('51900000001', FRASE)).toBeUndefined();
  });

  test('la última pieza puesta gana: poner un dato y después otro no acumula', () => {
    anotarPieza(TEL, DATO, FRASE);
    const otro = { clase: 'dato', ref: 'acceso-un-anio', via: 'panel-datos' } as const;
    anotarPieza(TEL, otro, 'El acceso lo tenés por todo un año.');
    expect(piezaDelTexto(TEL, 'El acceso lo tenés por todo un año.')).toEqual({
      ...otro,
      editada: false,
      textoPieza: 'El acceso lo tenés por todo un año.',
    });
  });

  test('olvidar la pieza deja la conversación en la línea de base', () => {
    anotarPieza(TEL, DATO, FRASE);
    olvidarPieza(TEL);
    expect(piezaDelTexto(TEL, FRASE)).toBeUndefined();
  });

  test('una sugerencia del panel se declara como paso, con su vía', () => {
    const paso = { clase: 'paso', ref: '12#1', via: 'panel-sugerencia' } as const;
    anotarPieza(TEL, paso, 'Te cuento del diploma…');
    expect(piezaDelTexto(TEL, 'Te cuento del diploma…')).toEqual({
      ...paso,
      editada: false,
      textoPieza: 'Te cuento del diploma…',
    });
  });
});
