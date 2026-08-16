import { describe, it, expect } from 'vitest';
import { marcaDeDueno, nombreCorto } from './dueno';

/**
 * LA MARCA DE DUEÑO. Lo que se protege acá es sobre todo lo que NO se dibuja:
 * una píldora en cada una de las 1.900 filas sin asignar convertiría la señal en
 * ruido, y un «Vos» repetido dentro de la propia cola dice lo que ya dice el filtro.
 */

describe('marcaDeDueno', () => {
  it('sin dueño no dibuja nada', () => {
    expect(marcaDeDueno({}, { yo: 'ana' })).toBeNull();
    expect(marcaDeDueno({ asignada_a: null }, { yo: 'ana' })).toBeNull();
    expect(marcaDeDueno({ asignada_a: '   ' }, { yo: 'ana' })).toBeNull();
  });

  /**
   * ⚠️ «Vos» SE RETIRÓ (4-ago-2026). Existía para marcar lo propio dentro de una
   * cola compartida, y esa cola dejó de existir: quien está en una rueda del
   * reparto ve solo lo suyo, así que habría sido la misma píldora en todas las
   * filas. Lo propio no se rotula nunca; lo ajeno sí, que es donde importa.
   */
  it('lo propio NO se rotula: sería la misma píldora en todas las filas', () => {
    expect(marcaDeDueno({ asignada_a: 'ana' }, { yo: 'ana' })).toBeNull();
  });

  it('lo ajeno SÍ se rotula: es la señal accionable', () => {
    const m = marcaDeDueno({ asignada_a: 'sindy' }, { yo: 'ana' });
    expect(m?.tono).toBe('otra');
    expect(m?.texto).toBe('Sindy');
  });

  it('el título del ajeno dice que se puede abrir igual: es un filtro, no un permiso', () => {
    const m = marcaDeDueno({ asignada_a: 'sindy' }, { yo: 'ana' });
    expect(m?.titulo).toContain('podés abrirla igual');
  });

  /**
   * Sin saber quién mira no se puede decir «Vos», pero SÍ se puede decir de quién
   * es — que es el dato que evita que dos contesten al mismo lead.
   */
  it('sin sesión rotula todo: no hay con qué saber qué es propio', () => {
    const m = marcaDeDueno({ asignada_a: 'ana' }, {});
    expect(m?.tono).toBe('otra');
    expect(m?.texto).toBe('Ana');
  });

  /**
   * ⚠️ ESTE TEST ESTABA AL REVÉS y lo dio vuelta la evidencia de producción.
   *
   * Medido en VPS1 el 4-ago-2026: Cerberus empuja `Luz` a `numero_vendedora` y
   * ella entra al login como `luz`; en `gestiones` conviven `Usuario1` y `luz`.
   * Con la comparación exacta, sus propias conversaciones le aparecían rotuladas
   * con el nombre de otra persona. Se normaliza de los DOS lados, igual que
   * `esMiaSql` y `destino.ts` — si los tres no dicen lo mismo, la fila diría
   * «Vos» sobre algo que el recorte «Míos» no trae.
   */
  it('la misma persona con otra grafía sigue siendo propia (`Luz` ≡ `luz`)', () => {
    expect(marcaDeDueno({ asignada_a: 'Ana' }, { yo: 'ana' })).toBeNull();
    expect(marcaDeDueno({ asignada_a: 'luz' }, { yo: '  LUZ ' })).toBeNull();
  });

  it('pero otra persona sigue siendo otra persona', () => {
    expect(marcaDeDueno({ asignada_a: 'anna' }, { yo: 'ana' })?.tono).toBe('otra');
  });

  /**
   * El username de los cinco vendedores nuevos ES el correo completo (verificado
   * en el panel de Cerberus el 4-ago-2026: `@ventas10@grupogoberna.com`, sin email
   * registrado). La píldora tiene que decir «Ventas10», no el correo entero, que
   * en 360 px no entra y además no es un nombre.
   */
  it('un username que es un correo se muestra por su parte útil', () => {
    expect(marcaDeDueno({ asignada_a: 'ventas12@grupogoberna.com' }, { yo: 'ana' })?.texto).toBe('Ventas12');
  });
});

describe('nombreCorto', () => {
  it('corta en el primer separador y capitaliza', () => {
    expect(nombreCorto('sindy.rojas')).toBe('Sindy');
    expect(nombreCorto('ana_perez')).toBe('Ana');
    expect(nombreCorto('luz@goberna.us')).toBe('Luz');
    expect(nombreCorto('walter-b')).toBe('Walter');
  });

  it('un username sin forma de nombre se muestra tal cual: no se adivina uno', () => {
    expect(nombreCorto('srojas')).toBe('Srojas');
  });

  it('no rompe con basura', () => {
    expect(nombreCorto('  ')).toBe('');
    expect(nombreCorto('.hola')).toBe('.hola');
  });
});
