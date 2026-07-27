import { describe, expect, it } from 'vitest';
import {
  TIPO_IVI,
  cifrasDudosas,
  fuentesLegibles,
  lecturaDeFrescura,
  presentacionDe,
  tramosMarcados,
} from './presentacion';

/**
 * LA CAPA DE HONESTIDAD DE IVI, DECIDIDA UNA SOLA VEZ.
 *
 * El 2026-07-25 se midió en vivo que Ivi reportaba datos de 12 días como `HECHO`. Toda su
 * capa de honestidad existe por ese incidente. Si la app aplana los tres tipos al mismo
 * componente, esa capa no protege a nadie — solo hace sentir que sí.
 *
 * Por eso el ruteo vive acá, puro y con estos tests, y no adentro de un `switch` en el JSX:
 * un componente no se puede interrogar sobre qué hace con un tipo que todavía no existe.
 */

describe('presentacionDe — con qué cara se dibuja cada tipo', () => {
  it('los tres tipos conocidos se reconocen y se dibujan como ellos mismos', () => {
    for (const tipo of [TIPO_IVI.HECHO, TIPO_IVI.CONTEXTO, TIPO_IVI.SIN_EVIDENCIA]) {
      const p = presentacionDe(tipo);
      expect(p.tipo).toBe(tipo);
      expect(p.reconocido).toBe(true);
      expect(p.crudo).toBe(tipo);
    }
  });

  it('un tipo NUEVO de Ivi cae en la rama conservadora: CONTEXTO, nunca HECHO y nunca un throw', () => {
    // El criterio de aceptación de H3. Ivi puede crecer su enum sin coordinar un release
    // con Hermes; lo único que no puede pasar es que un tipo desconocido se muestre con la
    // confianza de un dato verificado.
    for (const desconocido of ['ENSAMBLADO', 'HIPOTESIS', 'HECHO_PARCIAL', 'dato', '', 'CONTEXTO_L4']) {
      const p = presentacionDe(desconocido);
      expect(p.tipo, `tipo «${desconocido}»`).toBe(TIPO_IVI.CONTEXTO);
      expect(p.tipo).not.toBe(TIPO_IVI.HECHO);
      expect(p.reconocido).toBe(false);
      // Se conserva lo que vino: la pantalla lo dice en letra chica en vez de tragárselo.
      expect(p.crudo).toBe(desconocido);
    }
  });

  it('un tipo ausente o de otra forma tampoco rompe: CONTEXTO', () => {
    for (const basura of [undefined, null, 42, {}, []]) {
      const p = presentacionDe(basura);
      expect(p.tipo).toBe(TIPO_IVI.CONTEXTO);
      expect(p.reconocido).toBe(false);
    }
  });

  it('tolera el casing y los espacios, que son ruido de transporte y no un tipo nuevo', () => {
    expect(presentacionDe(' hecho ').tipo).toBe(TIPO_IVI.HECHO);
    expect(presentacionDe(' hecho ').reconocido).toBe(true);
    expect(presentacionDe('sin_evidencia').tipo).toBe(TIPO_IVI.SIN_EVIDENCIA);
  });

  it('pero una PALABRA distinta que empieza igual NO se promueve a HECHO', () => {
    expect(presentacionDe('HECHOS').tipo).toBe(TIPO_IVI.CONTEXTO);
    expect(presentacionDe('HECHO_DEBIL').tipo).toBe(TIPO_IVI.CONTEXTO);
  });
});

describe('fuentesLegibles — de dónde salió, en criollo', () => {
  it('distingue una tool del SDK de una cita de documento', () => {
    // La gramática real de Ivi (rag/ask.py:497 y :554): `SDK:<tool>` para lo determinista,
    // `<doc> › <sección> › <subsección>` para lo citado.
    const [sdk, doc] = fuentesLegibles([
      'SDK:governa.ventas.porPais',
      'politica-de-cuotas.md › Pagos › Cuotas',
    ]);
    expect(sdk).toEqual({ clase: 'sdk', etiqueta: 'governa.ventas.porPais', detalle: null });
    expect(doc).toEqual({ clase: 'documento', etiqueta: 'politica-de-cuotas.md', detalle: 'Pagos › Cuotas' });
  });

  it('un documento sin breadcrumbs no inventa un detalle', () => {
    expect(fuentesLegibles(['manual.md'])).toEqual([{ clase: 'documento', etiqueta: 'manual.md', detalle: null }]);
  });

  it('una fuente en forma de objeto se lee por sus claves conocidas, no se tira', () => {
    expect(fuentesLegibles([{ cita: 'temario.md › Módulo 3' }])[0].etiqueta).toBe('temario.md');
    expect(fuentesLegibles([{ fuente: 'SDK:governa.tesoreria.saldo' }])[0].clase).toBe('sdk');
    expect(fuentesLegibles([{ titulo: 'informe.pdf' }])[0].etiqueta).toBe('informe.pdf');
  });

  it('una fuente que no se entiende se muestra igual: no se descarta en silencio', () => {
    const r = fuentesLegibles([{ raro: true }, 123]);
    expect(r).toHaveLength(2);
    expect(r.every((f) => f.etiqueta.length > 0)).toBe(true);
  });

  it('sin fuentes devuelve lista vacía, y `undefined` no rompe', () => {
    expect(fuentesLegibles([])).toEqual([]);
    expect(fuentesLegibles(undefined)).toEqual([]);
  });
});

describe('lecturaDeFrescura — «no medido» NO es «fresco»', () => {
  it('null y undefined se dicen en voz alta, nunca con silencio', () => {
    for (const sinDato of [null, undefined]) {
      const f = lecturaDeFrescura(sinDato);
      expect(f.medido).toBe(false);
      expect(f.texto).toMatch(/no se puede confirmar/i);
    }
  });

  it('los segundos se leen en la escala que corresponde', () => {
    expect(lecturaDeFrescura(30)).toEqual({ medido: true, texto: 'del último minuto' });
    expect(lecturaDeFrescura(1_840).texto).toBe('de hace 31 minutos');
    expect(lecturaDeFrescura(7_200).texto).toBe('de hace 2 horas');
    expect(lecturaDeFrescura(3 * 86_400).texto).toBe('de hace 3 días');
    // Singular: «de hace 1 días» delata que nadie leyó nunca este renglón.
    expect(lecturaDeFrescura(86_400).texto).toBe('de hace 1 día');
    expect(lecturaDeFrescura(3_600).texto).toBe('de hace 1 hora');
    // El incidente que originó todo: 12 días reportados como HECHO. Se tiene que leer.
    expect(lecturaDeFrescura(12 * 86_400).texto).toBe('de hace 12 días');
  });

  it('un texto ya redactado por Ivi se respeta tal cual', () => {
    expect(lecturaDeFrescura('hace 2 horas')).toEqual({ medido: true, texto: 'hace 2 horas' });
  });

  it('un número imposible se trata como no medido, no como cero', () => {
    for (const imposible of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lecturaDeFrescura(imposible).medido, `${imposible}`).toBe(false);
    }
  });
});

describe('cifrasDudosas + tramosMarcados — marcar lo que no se pudo verificar', () => {
  it('normaliza la lista a texto y descarta lo que no se puede señalar', () => {
    expect(cifrasDudosas(['642', 12, ' 40 % ', '', null, undefined])).toEqual(['642', '12', '40 %']);
    expect(cifrasDudosas(undefined)).toEqual([]);
  });

  it('parte el texto en tramos y marca SOLO las cifras señaladas', () => {
    const tramos = tramosMarcados('Llevamos 642 ventas y 12 % de conversión.', ['642', '12 %']);
    expect(tramos.filter((t) => t.dudoso).map((t) => t.texto)).toEqual(['642', '12 %']);
    // El resto del texto sobrevive entero: no se descarta la respuesta, se marca la cifra.
    expect(tramos.map((t) => t.texto).join('')).toBe('Llevamos 642 ventas y 12 % de conversión.');
  });

  it('la cifra más larga gana: «12 %» no se parte en «12»', () => {
    const tramos = tramosMarcados('subió 12 %', ['12', '12 %']);
    expect(tramos.filter((t) => t.dudoso).map((t) => t.texto)).toEqual(['12 %']);
  });

  it('los caracteres de regex en la cifra no rompen nada (S/. 1.200, 40 %)', () => {
    const tramos = tramosMarcados('cuesta S/. 1.200 (40 % menos)', ['S/. 1.200', '40 %']);
    expect(tramos.filter((t) => t.dudoso).map((t) => t.texto)).toEqual(['S/. 1.200', '40 %']);
  });

  it('sin cifras, el texto queda de una pieza y sin marcar', () => {
    expect(tramosMarcados('todo bien', [])).toEqual([{ texto: 'todo bien', dudoso: false }]);
  });

  it('una cifra que NO aparece en el texto no inventa un tramo', () => {
    const tramos = tramosMarcados('no hay números acá', ['999']);
    expect(tramos.every((t) => !t.dudoso)).toBe(true);
  });

  it('marca todas las apariciones, no solo la primera', () => {
    const tramos = tramosMarcados('642 acá y 642 allá', ['642']);
    expect(tramos.filter((t) => t.dudoso)).toHaveLength(2);
  });
});
